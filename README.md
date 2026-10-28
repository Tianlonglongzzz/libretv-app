# LibreTV iOS（自包含版）

把 [LibreSpark/LibreTV](https://github.com/LibreSpark/LibreTV) 做成一个**不依赖任何服务器**的 iOS App。

> ⚠️ 和上一版的关键区别：上一版是「远程壳」，加载别人的网站，站一挂就白屏。
> 这一版把客户端**打包进 App 内部**，源自己配，任何人的服务器挂了都跟你无关。

---

## 它是怎么工作的

```
┌──────────────────────────────┐
│  LibreTV App（原生壳）         │
│  ┌────────────────────────┐  │
│  │ 内置客户端 (www/)        │  │
│  │  源管理 → 搜索 → 播放     │  │
│  └────────────────────────┘  │
│        │ 原生 HTTP（绕过CORS） │
└────────┼─────────────────────┘
         ▼
   你添加的第三方采集接口（Apple CMS）
```

- **内容不打包、不内置**：App 里没有任何影视内容，只有「搜索 + 播放」能力。
- **源由你自己添加**：这是这类工具的本质，源决定你能看到什么。
- **播放走 iOS 原生 HLS**：`<video>` 直接播 m3u8，不经第三方播放器。
- **数据全在本地**：源列表和观看历史存本机 localStorage。

---

## 功能

| 模块 | 说明 |
|---|---|
| 源管理 | 支持 **TVBox 多仓清单**、**单仓配置**、**LibreTV 源列表**、**单个采集接口** 四种导入方式 |
| 搜索 | 并发请求所有已启用源，合并结果；单源失败不影响其他 |
| 详情 | 自动拉取剧集列表，支持多线路（取第一条）、过滤非法地址 |
| 播放 | iOS 原生 HLS，支持全屏、进度 |
| 历史 | 自动记录最近 100 条，可一键重播 |

---

## 打包（GitHub Actions，Windows 也能做）

1. 把本目录推到 GitHub（新建空仓库）：

```bash
cd libretv-app
git init
git add .
git commit -m "init: self-contained LibreTV iOS app"
git branch -M main
git remote add origin https://github.com/<你的用户名>/libretv-app.git
git push -u origin main
```

2. 仓库 **Actions** → **Build iOS IPA** → **Run workflow**
3. 跑完在 **Artifacts** 下载 `LibreTV-unsigned-ipa`

> Capacitor 8 要求 Xcode 26+，所以 runner 必须用 `macos-26`。

---

## 装到 iPhone

用 **AltStore / SideStore** 装（免费 Apple ID 即可）：

1. 下载的 `.ipa` 传到手机
2. AltStore → **My Apps** → **+** → 选中 IPA → 用 Apple ID 签名安装
3. 免费签名 **7 天**有效，AltStore 会自动续签（需电脑与手机同一 WiFi）

---

## 第一次使用

1. 打开 App → **源管理**
2. 粘贴一个订阅地址（TVBox 配置 / 多仓清单 / 采集接口都行）→ 导入
3. 回 **搜索** 输片名 → 点结果 → 选剧集播放

> 多仓清单（`{ "urls": [...] }`）会自动把每个子配置都拉一遍，把里面**可直接用的采集接口**全部导入。
> 蜘蛛源（drpy / python）会被自动跳过——LibreTV 只能用它这种直连 API。

---

## 免责声明

- 本 App 不存储、不制作、不分发任何视频内容，仅提供第三方公开接口的搜索与播放能力。
- 你添加的源及内容合法性由对应数据源负责；请仅用于观看你有权访问的内容。
- LibreTV 本体为 AGPL-3.0；本项目是独立实现的客户端，未复制其代码。
