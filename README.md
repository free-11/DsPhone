# DsPhone — DeepSeek Harness 手机远程控制

把运行在你自己服务器上的 **DeepSeek Harness（DSH）** 变成一部随时可以从手机控制的"大模型工作站"。

## 架构

```
┌──────────┐   HTTPS (Tailnet 内有效证书)   ┌─────────────────────────────┐
│ 手机/PC  │ ─────────────────────────────▶ │ 你的 Linux 服务器            │
│ (Tailscale│   https://<主机名>.ts.net      │  Tailscale Serve (443, TLS) │
│  客户端)  │                               │      │                      │
└──────────┘                               │      ▼                      │
                                           │  127.0.0.1:3080             │
                                           │  dsh web (systemd 托管)      │
                                           └─────────────────────────────┘
```

- **DSH 主体跑在服务器上**：控制的是服务器上的文件、工具、代码。
- **传输**：Tailscale 组网，设备认证 + WireGuard 加密 + 自动 HTTPS 证书，**不暴露任何公网端口**。
- **信任围栏**：`dsh web --trusted-host <主机名>.ts.net` 让 `/api` 信任围栏放行来自 tailnet 域名的请求（DSH 自身零鉴权，安全完全由 Tailscale 网络层承担，详见 [docs/implementation-plan.md](docs/implementation-plan.md) 安全模型）。

## 目录结构

| 路径 | 说明 |
|---|---|
| `server/setup-dsh-server.sh` | 服务器一键部署脚本（依赖 → clone DSH → 构建 → systemd → Tailscale Serve） |
| `server/dsh-web.service` | systemd 服务模板（脚本自动填充） |
| `server/README.md` | 服务器端操作手册（部署/验证/升级/日志/卸载） |
| `pc/remote.ps1` | PC 端助手（测试连通性、打开地址） |
| `tools/deploy-server.mjs` | SSH 部署助手（probe/prep/exec/upload/deploy/cleanup 六种模式，凭据走环境变量） |
| `app-pwa/` | **DSH Remote 启动器**（纯 Web PWA，零原生代码）：扁平设计的移动端入口页，随 DSH 前端发布在 `/app/` |
| `patches/dsh-frontend-mobile.patch` | DSH 前端移动端适配补丁（SW + 移动样式 + 启动器，可直接 `git apply`） |
| `docs/phone-setup.md` | 手机端接入指南 |
| `docs/implementation-plan.md` | 完整方案文档（调研结论、选型、备选方案） |
| `docs/mobile-adaptation.md` | DSH 前端移动端适配说明（改动已落入 DSH 仓库） |

## 快速开始（三步）

1. **服务器**：`sudo bash setup-dsh-server.sh`（首次约 10-20 分钟，含 DSH 构建）
2. **手机**：安装 Tailscale App → 登录同一账号 → 打开 `https://<主机名>.ts.net`
3. **PC**：可选，安装 Tailscale 后运行 `pc/remote.ps1 -Open`

详见各文件内的说明。
