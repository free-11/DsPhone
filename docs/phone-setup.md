# 手机端接入指南

## 1. 安装 Tailscale

- **iOS**：App Store 搜 "Tailscale"
- **Android**：Google Play / 应用商店搜 "Tailscale"

打开 App → 用**与服务器同一个账号**登录（与服务器 `tailscale up` 时登录的账号一致）。

## 2. 访问 DSH

服务器部署完成后会得到地址：`https://<主机名>.ts.net`（例如 `https://myserver.tailxxxx.ts.net`）

手机浏览器（Safari / Chrome）直接打开即可。首次打开：

- 浏览器会询问是否允许——允许
- 若提示证书问题，请先按 [server/README.md](../server/README.md) 确认 tailnet 已开启 HTTPS Certificates

## 3. 添加到主屏幕（变成"App"）

DSH 已内置 PWA manifest（全屏显示），iOS 与 Android 均可：

- **iPhone / iPad（Safari）**：分享按钮 → 「添加到主屏幕」→ 命名后即可。之后从桌面图标打开，全屏无地址栏。
- **Android（Chrome）**：右上角菜单 → 「安装应用」或「添加到主屏幕」。

> 注：DSH 前端暂未注册 Service Worker，Android Chrome 的"安装应用"入口可能不出现；此时用「添加到主屏幕」即可获得同样效果。下一阶段我们会给 DSH 补 Service Worker，让 PWA 安装完全达标。

## 4. 使用建议

- **网络**：Tailscale 流量走加密隧道，Wi-Fi / 4G / 5G 均可
- **后台运行**：切到后台再回来，页面会通过事件流自动恢复最新状态
- **审批操作**：DSH 需要你确认的操作（审批、提问）会出现在会话流里，手机上直接点即可
- **断线重连**：Tailscale 客户端保持登录即可；DSH 会话状态持久化在服务器 `/var/lib/dsh`

## 5. 常见问题

| 问题 | 处理 |
|---|---|
| 打不开地址 | 手机 Tailscale 是否已连接？服务器 `tailscale serve status` 是否正常？ |
| 证书告警 | tailnet HTTPS 未开启，见 server/README.md |
| 页面能开但发消息报错 | 多半是信任围栏拒绝：确认服务器 systemd 里 `--trusted-host <主机名>.ts.net` 与访问域名一致，`journalctl -u dsh-web` 查日志 |
| 想彻底断开 | 手机 Tailscale App 里关闭连接即可，服务器不受影响 |
