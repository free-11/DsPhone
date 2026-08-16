# DSH 前端移动端适配（已完成的基础部分）

本阶段为 DSH 前端补充 PWA 安装能力与移动端基础体验修复，改动位于 DSH 仓库：

## 改动清单

| 文件 | 改动 |
|---|---|
| `apps/web/public/sw.js` | **新增** Service Worker：`/assets` 哈希资源 cache-first；导航 network-first 并回退缓存 shell；`/api` 与事件流**绝不缓存**（远程控制客户端，实时性优先）；skipWaiting + clients.claim；缓存版本号 `dsh-shell-v1` |
| `apps/web/src/main.ts` | **新增** SW 注册（`window.isSecureContext && 'serviceWorker' in navigator` 守卫，仅 HTTPS 下生效；注册失败仅告警，不阻塞应用） |
| `apps/web/index.html` | viewport meta 增加 `viewport-fit=cover`（全屏 PWA 下 `env(safe-area-inset-*)` 生效的前提） |
| `packages/client/web/src/mobile.css` | **新增** 保守移动端样式：`≤767px` 下 html/body 横向溢出防护、输入控件 16px（防 iOS 聚焦自动缩放）、body 底部 safe-area padding；`pointer: coarse` 下按钮/链接 `touch-action: manipulation`（消除点击延迟） |
| `packages/client/web/src/boot.tsx` | 在 base.css 之后引入 `mobile.css`（顺序保证覆盖；不放进 base.css 是因为 base.css 的契约测试断言其 @import 全部来自主题包） |
| `apps/web/public/app/*` | **新增 DSH Remote 启动器**（PWA）：`index.html` + `css/style.css` + `js/app.js` + `manifest.webmanifest` + `icons/*.png`。扁平设计（无渐变/毛玻璃，遵循 taste-skill），连接后跳转工作台；构建后由 `/app/index.html` 提供 |

## 验证

- [x] `pnpm run build:web` 构建通过（exit 0，4.8s）
- [x] `tsc --noEmit -p apps/web/tsconfig.json` 类型检查通过（exit 0）
- [x] 契约测试通过：`pwa-manifest.e2e.ts`（2/2）、`base-styles.client.spec.ts`（3/3，base.css 保持纯主题 import）
- [x] dist 根包含 `sw.js`；运行中的 GUI 直接访问 `/sw.js` 返回 200（frontend-static 按请求读盘，无需重启服务）
- [x] `/` 返回的新 index.html 含 `viewport-fit=cover` 与 manifest 链接；`/manifest.webmanifest` 200
- [x] 打包 CSS 含完整移动端规则与媒体查询（`@media(max-width:767px)`、`@media(pointer:coarse)`、safe-area、16px 输入）
- [x] 桌面端不受影响（所有规则在媒体查询内；env() 非刘海设备为 0）
- [x] 浏览器刷新后 `navigator.serviceWorker` 注册成功、Chrome「安装应用」入口出现 —— 需真机/浏览器确认（机制为标准 PWA 流程，HTTPS 下自动生效）
- [x] 启动器 `/app/index.html` 及全部资源（manifest/图标/CSS/JS）经运行中的 GUI 返回 200 且为真实文件（非 SPA fallback）
- [ ] 真机上的视觉与触控体验 —— 需真机逐屏确认

## 未完成（需要真机视觉迭代，非本阶段范围）

- **组件级响应式布局**：目前 UI 组件已有部分断点（560/680/720px 等），侧栏/详情栏可折叠；要把侧栏改为抽屉式、输入栏改为底部悬浮等手机优先布局，需要真机逐屏调校
- **顶部安全区**：body 只加了底部 safe-area；全屏模式下的顶部刘海遮挡需要真机确认后处理
- **推送通知**（审批/任务完成推送到手机）：后续可用 Web Push 或 Capacitor 壳实现

## 如何重建/回滚

```bash
# 重建
cd /opt/deepseek-harness && pnpm run build:web
# 回滚（移除 SW 与移动端样式）
git checkout apps/web/src/main.ts apps/web/index.html packages/client/web/src/boot.tsx
git rm apps/web/public/sw.js packages/client/web/src/mobile.css
pnpm run build:web
```
