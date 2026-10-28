import type { CapacitorConfig } from '@capacitor/cli';

/**
 * 自包含客户端配置。
 *
 * 注意：这里 **没有** server.url。
 * 上一次的失败就是因为设了 server.url 去加载远程站点——别人的服务器一挂，
 * App 就白屏。现在 App 加载打包在内部的 www/ 客户端，完全自给自足。
 */
const config: CapacitorConfig = {
  appId: 'io.librespark.libretvapp',
  appName: 'LibreTV',
  webDir: 'www',
  plugins: {
    // 关键：用原生 HTTP 请求第三方采集接口，绕过浏览器 CORS 限制
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
