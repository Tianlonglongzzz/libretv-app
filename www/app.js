'use strict';

/* =========================================================
 * LibreTV 自包含客户端
 * - 源管理：支持 TVBox 多仓清单 / 单仓配置 / LibreTV 源列表 / 单个采集接口
 * - 搜索：并发请求所有已启用源，合并结果
 * - 播放：iOS 原生 HLS（<video> 直接播 m3u8）
 * - 全部数据存本地，不依赖任何服务器
 * ========================================================= */

const LS_SOURCES = 'libretv.sources.v1';
const LS_HISTORY = 'libretv.history.v1';

const state = {
  sources: readLS(LS_SOURCES, []),
  history: readLS(LS_HISTORY, []),
};

/* ---------------- 本地存储 ---------------- */
function readLS(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}
function writeLS(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {}
}

/* ---------------- HTTP：原生优先，绕过 CORS ---------------- */
function getCapacitorHttp() {
  const cap = window.Capacitor;
  return cap && cap.Plugins ? cap.Plugins.CapacitorHttp : null;
}

async function httpGetText(url, timeoutMs) {
  const native = getCapacitorHttp();
  if (native) {
    const res = await native.get({
      url: url,
      connectTimeout: timeoutMs || 12000,
      readTimeout: timeoutMs || 12000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        Accept: 'application/json, text/plain, */*',
      },
    });
    if (res && res.status >= 400) throw new Error('HTTP ' + res.status);
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  }
  // 浏览器兜底（本地调试用；iOS 上走上面的原生分支）
  const ctrl = new AbortController();
  const timer = setTimeout(function () {
    ctrl.abort();
  }, timeoutMs || 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

async function httpGetJson(url, timeoutMs) {
  const text = await httpGetText(url, timeoutMs);
  const clean = String(text).replace(/^\uFEFF/, '').trim();
  return JSON.parse(clean);
}

/* ---------------- 工具 ---------------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function hostOf(u) {
  try {
    return new URL(u).host;
  } catch (e) {
    return String(u).slice(0, 40);
  }
}
function withQuery(api) {
  return api.indexOf('?') >= 0 ? api + '&' : api + '?';
}
function isDirectApi(u) {
  if (!u || typeof u !== 'string') return false;
  return /^https?:\/\//i.test(u) && !/\.(js|py)(\?|$)/i.test(u);
}
function setStatus(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text || '';
}

/* ---------------- 源管理 ---------------- */
function addSource(name, api) {
  api = String(api || '').trim();
  if (!isDirectApi(api)) return false;
  if (state.sources.some(function (s) { return s.api === api; })) return false;
  state.sources.push({
    id: 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name: (name && String(name).trim()) || hostOf(api),
    api: api,
    enabled: true,
  });
  return true;
}

function importObject(obj) {
  let added = 0;
  if (!obj || typeof obj !== 'object') return 0;
  // TVBox 单仓：sites[]
  if (Array.isArray(obj.sites)) {
    obj.sites.forEach(function (s) {
      if (addSource(s.name, s.api)) added++;
    });
  }
  // LibreTV 源列表：sources[]
  if (Array.isArray(obj.sources)) {
    obj.sources.forEach(function (s) {
      if (addSource(s.name, s.url || s.api)) added++;
    });
  }
  // 裸数组
  if (Array.isArray(obj)) {
    obj.forEach(function (s) {
      if (s && (s.url || s.api)) {
        if (addSource(s.name, s.url || s.api)) added++;
      }
    });
  }
  // 单个 api
  if (added === 0 && isDirectApi(obj.api)) {
    if (addSource(obj.name, obj.api)) added++;
  }
  return added;
}

async function importFromUrl(url) {
  setStatus('source-status', '正在拉取订阅…');
  const obj = await httpGetJson(url, 20000);
  let added = 0;

  // 多仓清单：{ urls: [{ url, name }] }
  if (obj && Array.isArray(obj.urls)) {
    for (let i = 0; i < obj.urls.length; i++) {
      setStatus('source-status', '多仓清单：正在拉取子配置 ' + (i + 1) + '/' + obj.urls.length + '…');
      try {
        added += importObject(await httpGetJson(obj.urls[i].url, 20000));
      } catch (e) {
        /* 单个子配置失败不影响整体 */
      }
    }
  } else {
    added = importObject(obj);
  }

  writeLS(LS_SOURCES, state.sources);
  renderSources();
  if (added > 0) {
    setStatus('source-status', '导入成功，新增 ' + added + ' 个源');
  } else {
    setStatus('source-status', '没有找到可直接使用的接口（可能全是蜘蛛源，LibreTV 用不了）');
  }
}

/* ---------------- 搜索 ---------------- */
async function fetchSourceList(api, keyword) {
  const q = encodeURIComponent(keyword);
  const variants = [
    withQuery(api) + 'ac=videolist&wd=' + q,
    withQuery(api) + 'wd=' + q,
  ];
  for (let i = 0; i < variants.length; i++) {
    try {
      const d = await httpGetJson(variants[i], 10000);
      if (d && Array.isArray(d.list)) return d.list;
    } catch (e) {}
  }
  return [];
}

async function searchAll(keyword) {
  const sources = state.sources.filter(function (s) { return s.enabled; });
  const resultsEl = document.getElementById('results');
  resultsEl.innerHTML = '';

  if (sources.length === 0) {
    setStatus('search-status', '还没有可用的源，请先去「源管理」添加');
    return;
  }

  setStatus('search-status', '正在 ' + sources.length + ' 个源里搜索…');

  const tasks = sources.map(function (s) {
    return fetchSourceList(s.api, keyword).then(function (list) {
      return list.map(function (it) {
        it._source = s;
        return it;
      });
    }).catch(function () {
      return [];
    });
  });

  const groups = await Promise.all(tasks);
  const all = [];
  groups.forEach(function (g) {
    g.forEach(function (x) { all.push(x); });
  });

  if (all.length === 0) {
    setStatus('search-status', '没搜到结果。换个片名，或去「源管理」多加几个源');
    return;
  }
  setStatus('search-status', '找到 ' + all.length + ' 个结果');
  renderResults(all);
}

function renderResults(items) {
  const el = document.getElementById('results');
  el.innerHTML = '';
  items.forEach(function (it) {
    const btn = document.createElement('button');
    btn.className = 'card';
    const pic = it.vod_pic
      ? '<img src="' + esc(it.vod_pic) + '" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">'
      : '';
    btn.innerHTML =
      '<div class="poster">' + pic + '</div>' +
      '<div class="card-body">' +
        '<div class="card-name">' + esc(it.vod_name || '未知') + '</div>' +
        '<div class="card-sub">' + esc(it.vod_remarks || '') + '</div>' +
        '<div class="card-src">' + esc(it._source.name) + '</div>' +
      '</div>';
    btn.addEventListener('click', function () {
      openDetail(it);
    });
    el.appendChild(btn);
  });
}

/* ---------------- 详情 / 播放 ---------------- */
function parseEpisodes(playUrl) {
  if (!playUrl) return [];
  // 多线路用 $$$ 分隔，先取第一条线路
  const firstLine = String(playUrl).split('$$$')[0];
  return firstLine
    .split('#')
    .map(function (seg) {
      const i = seg.lastIndexOf('$');
      if (i < 0) return null;
      const name = seg.slice(0, i).trim() || '播放';
      const url = seg.slice(i + 1).trim();
      if (!/^https?:\/\//i.test(url)) return null;
      return { name: name, url: url };
    })
    .filter(Boolean);
}

async function openDetail(item) {
  showOverlay(item.vod_name || '详情', '<div class="status">正在加载剧集…</div>');

  let playUrl = item.vod_play_url || '';
  if (!playUrl && item._source) {
    const api = item._source.api;
    const id = item.vod_id;
    const variants = [
      withQuery(api) + 'ac=videolist&ids=' + encodeURIComponent(id),
      withQuery(api) + 'ac=detail&ids=' + encodeURIComponent(id),
    ];
    for (let i = 0; i < variants.length; i++) {
      try {
        const d = await httpGetJson(variants[i], 12000);
        const rec = d && d.list && d.list[0];
        if (rec && rec.vod_play_url) {
          playUrl = rec.vod_play_url;
          item.vod_pic = item.vod_pic || rec.vod_pic;
          break;
        }
      } catch (e) {}
    }
  }

  const episodes = parseEpisodes(playUrl);
  renderDetail(item, episodes);
}

function renderDetail(item, episodes) {
  const body = document.getElementById('overlay-body');
  const pic = item.vod_pic
    ? '<img src="' + esc(item.vod_pic) + '" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">'
    : '';

  let html =
    '<div class="detail-meta">' +
      '<div class="detail-poster">' + pic + '</div>' +
      '<div class="detail-info">' +
        '<h2>' + esc(item.vod_name || '') + '</h2>' +
        '<p>' + esc(item.vod_remarks || '') + '</p>' +
        '<p>来源：' + esc(item._source ? item._source.name : '') + '</p>' +
      '</div>' +
    '</div>';

  if (episodes.length === 0) {
    html += '<div class="status">这个源没返回可播放地址，回上一页换个源试试。</div>';
  } else {
    html += '<div class="episodes" id="episodes"></div>';
  }

  body.innerHTML = html;

  if (episodes.length > 0) {
    const box = document.getElementById('episodes');
    episodes.forEach(function (ep) {
      const b = document.createElement('button');
      b.className = 'ep';
      b.textContent = ep.name;
      b.addEventListener('click', function () {
        playEpisode(item, ep);
      });
      box.appendChild(b);
    });
  }
}

function playEpisode(item, ep) {
  saveHistory(item, ep);
  const body = document.getElementById('overlay-body');
  body.innerHTML =
    '<div class="player-wrap">' +
      '<video id="player" controls autoplay playsinline webkit-playsinline preload="metadata" src="' + esc(ep.url) + '"></video>' +
    '</div>' +
    '<div class="player-meta">' + esc(item.vod_name || '') + ' · ' + esc(ep.name) + '</div>';
  const v = document.getElementById('player');
  if (v) {
    v.play().catch(function () {});
  }
}

/* ---------------- 历史 ---------------- */
function saveHistory(item, ep) {
  const rec = {
    name: item.vod_name || '',
    pic: item.vod_pic || '',
    sourceName: item._source ? item._source.name : '',
    epName: ep.name,
    epUrl: ep.url,
    ts: Date.now(),
  };
  state.history = state.history.filter(function (h) {
    return !(h.name === rec.name && h.epName === rec.epName);
  });
  state.history.unshift(rec);
  state.history = state.history.slice(0, 100);
  writeLS(LS_HISTORY, state.history);
}

function renderHistory() {
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  list.innerHTML = '';

  if (state.history.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  state.history.forEach(function (h) {
    const li = document.createElement('li');
    li.innerHTML =
      '<div class="item-main">' +
        '<div class="item-title">' + esc(h.name) + '</div>' +
        '<div class="item-sub">' + esc(h.epName) + ' · ' + esc(h.sourceName) + '</div>' +
      '</div>';

    const playBtn = document.createElement('button');
    playBtn.className = 'icon-btn';
    playBtn.textContent = '播放';
    playBtn.addEventListener('click', function () {
      playEpisode({ vod_name: h.name, _source: { name: h.sourceName } }, { name: h.epName, url: h.epUrl });
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn danger';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', function () {
      state.history = state.history.filter(function (x) { return x !== h; });
      writeLS(LS_HISTORY, state.history);
      renderHistory();
    });

    li.appendChild(playBtn);
    li.appendChild(delBtn);
    list.appendChild(li);
  });
}

/* ---------------- 源列表渲染 ---------------- */
function renderSources() {
  const list = document.getElementById('source-list');
  const empty = document.getElementById('source-empty');
  const count = document.getElementById('source-count');
  list.innerHTML = '';

  if (state.sources.length === 0) {
    empty.style.display = 'block';
    count.textContent = '';
    return;
  }
  empty.style.display = 'none';
  count.textContent = state.sources.length + ' 个';

  state.sources.forEach(function (s) {
    const li = document.createElement('li');

    const main = document.createElement('div');
    main.className = 'item-main';
    main.innerHTML =
      '<div class="item-title">' + esc(s.name) + (s.enabled ? '' : '（已停用）') + '</div>' +
      '<div class="item-sub">' + esc(s.api) + '</div>';

    const toggle = document.createElement('button');
    toggle.className = 'icon-btn';
    toggle.textContent = s.enabled ? '停用' : '启用';
    toggle.addEventListener('click', function () {
      s.enabled = !s.enabled;
      writeLS(LS_SOURCES, state.sources);
      renderSources();
    });

    const del = document.createElement('button');
    del.className = 'icon-btn danger';
    del.textContent = '删除';
    del.addEventListener('click', function () {
      state.sources = state.sources.filter(function (x) { return x !== s; });
      writeLS(LS_SOURCES, state.sources);
      renderSources();
    });

    li.appendChild(main);
    li.appendChild(toggle);
    li.appendChild(del);
    list.appendChild(li);
  });
}

/* ---------------- 覆盖层 ---------------- */
function showOverlay(title, html) {
  document.getElementById('overlay-title').textContent = title;
  document.getElementById('overlay-body').innerHTML = html;
  document.getElementById('overlay').classList.remove('hidden');
}
function hideOverlay() {
  const body = document.getElementById('overlay-body');
  const v = body.querySelector('video');
  if (v) {
    try { v.pause(); } catch (e) {}
  }
  body.innerHTML = '';
  document.getElementById('overlay').classList.add('hidden');
}

/* ---------------- 初始化 ---------------- */
function switchView(name) {
  document.querySelectorAll('.tab').forEach(function (t) {
    t.classList.toggle('active', t.dataset.view === name);
  });
  document.querySelectorAll('.view').forEach(function (v) {
    v.classList.toggle('active', v.id === 'view-' + name);
  });
  if (name === 'sources') renderSources();
  if (name === 'history') renderHistory();
}

function init() {
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      switchView(tab.dataset.view);
    });
  });

  document.getElementById('search-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const kw = document.getElementById('search-input').value.trim();
    if (kw) searchAll(kw);
  });

  document.getElementById('import-url-btn').addEventListener('click', function () {
    const url = document.getElementById('sub-url').value.trim();
    if (!url) return;
    importFromUrl(url).catch(function (err) {
      setStatus('source-status', '导入失败：' + err.message);
    });
  });

  document.getElementById('add-api-btn').addEventListener('click', function () {
    const url = document.getElementById('api-url').value.trim();
    if (!url) return;
    if (addSource('', url)) {
      writeLS(LS_SOURCES, state.sources);
      renderSources();
      setStatus('source-status', '已添加');
      document.getElementById('api-url').value = '';
    } else {
      setStatus('source-status', '地址格式不对，或已存在');
    }
  });

  document.getElementById('overlay-back').addEventListener('click', hideOverlay);

  renderSources();
  renderHistory();
}

document.addEventListener('DOMContentLoaded', init);
