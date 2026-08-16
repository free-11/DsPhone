# app-pwa — DSH Remote 启动器（纯 Web，零原生代码）

这是 **DSH Remote** 启动器的源码：一个扁平、克制的移动端 PWA 入口页，由 DSH 服务器自身提供（`/app/index.html`），连接后跳转到 DSH 工作台（`/`）。

- **零原生代码**：纯 HTML/CSS/JS，无 Android 工程、无 Gradle、无 Kotlin
- **设计规范**：遵循 taste-skill（无渐变、无毛玻璃、中性底 + 单一强调色、形状一致、完整交互状态、克制动效）
- **安装形态**：手机浏览器打开 `https://<主机名>.ts.net/app/index.html` → 添加到主屏幕（PWA，独立图标 + 全屏）

## 文件

| 文件 | 说明 |
|---|---|
| `index.html` | 启动器页面（品牌区 + 连接面板 + 连接中/错误状态） |
| `css/style.css` | 扁平深色主题，10px 圆角统一，`prefers-reduced-motion` 支持 |
| `js/app.js` | 探测根路径可达后跳转工作台；注册根作用域 SW（PWA 可安装）；8s 超时内联报错 + 重试 |
| `manifest.webmanifest` | PWA 清单（standalone，图标 192/512 + maskable） |
| `icons/icon-192.png` `icon-512.png` | 扁平图标（纯色底 + 终端提示符图形），System.Drawing 程序化生成 |

## 部署到 DSH

启动器随 DSH 前端发布：把本目录内容放入 DSH 仓库 `apps/web/public/app/`，然后重建前端：

```bash
# 在 DSH 仓库根目录
cp -r app-pwa/* apps/web/public/app/
pnpm run build:web
```

或直接应用仓库中的补丁 `patches/dsh-frontend-mobile.patch`（已包含启动器）。

## 使用

1. 手机浏览器打开 `https://<主机名>.ts.net/app/index.html`
2. 点击"连接" → 跳转 DSH 工作台
3. 菜单"添加到主屏幕" → 桌面出现 DSH Remote 图标（全屏启动）

## 说明

- 启动器与 DSH 工作台同源，因此不需要输入服务器地址（显示当前主机）
- 离线/服务器不可达时显示内联错误与"重试"，不会进入浏览器错误页
