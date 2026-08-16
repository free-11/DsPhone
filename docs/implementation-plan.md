# DeepSeek Harness 手机远程控制 — 实施方案

> 调研完成时间：本次会话。目标：让用户从手机安全、完整地远程控制运行在自己服务器上的 DSH。

## 1. 类似项目调研结论

| 项目 | 形态 | 对我们的参考价值 |
|---|---|---|
| [AgentFlow](https://github.com/714307168/AgentFlow) | 安卓 App 远程控制本地 CLI；公网 Relay Server 最小化中转 + 端到端加密；[WS 稳定性设计](https://github.com/714307168/AgentFlow/blob/master/docs/ws-stability-and-recovery-plan.md) | 架构思路最接近（手机 ↔ 中转 ↔ 本地 CLI）。但它要做**消息级**中继 + 端到端加密，是因为其 CLI 没有自带 Web 界面且要防中转服务器偷看。我们的 DSH 自带完整 Web GUI，且自用场景下**传输安全由 Tailscale 网络层承担**，不需要消息级加密中转，架构可以大幅简化 |
| [ghost-in-the-droid/android-agent](https://github.com/ghost-in-the-droid/android-agent) | AI 驱动真手机（ADB / WebDriverAgent，62 个 MCP 工具） | 方向相反（AI 控制手机），但其"后端桥接 + 前端面板"分层可借鉴；如未来要做原生 App 壳可参考其面板设计 |
| [智谱 AutoGLM](https://huggingface.co/zai-org/AutoGLM-Phone-9B)、[react-native-device-agent](https://github.com/bedda-tech/react-native-device-agent) | AI 手机 agent | 研究向，与"远程控制"场景关系不大 |

**结论**：不采用 AgentFlow 式自建 Relay + 端到端加密（复杂度高）；采用 **Tailscale Serve 反向代理** 方案——同一效果（手机远程、加密、私密）但零自研基础设施，全部用成熟组件。

## 2. DSH 架构事实（读源码确认，决定方案可行性的关键）

| 事实 | 出处 | 影响 |
|---|---|---|
| GUI 由 `dsh web`（内部 `--profile web`）服务，默认监听 `127.0.0.1:3080` | `start-dsh.ps1`、`packages/host/webserver` | 服务器上保持 loopback 绑定即可，配合反向代理 |
| 浏览器 ↔ Host 通信 = `POST /api/<ns>/<method>` RPC + WebSocket/SSE 事件流 | `docs/api-gateway.md` | 手机只要跑浏览器，就能使用全部能力（会话、工具、审批、事件流） |
| **无 TLS、无鉴权**：webserver 文档明说 *"there is no TLS, auth, or origin policy"*；信任围栏注释明说 *"DNS-rebinding fence, explicitly not authentication"* | `docs/subsystems/web-server.md`、`packages/client/connection/src/index.ts` | **绝不能裸暴露公网**；必须由传输层（Tailscale）提供认证与加密 |
| CLI **故意封禁** `--host 0.0.0.0`（"would expose remote code execution to the network"） | `packages/bundle/web-app/src/startup.ts:69` | 不靠改绑定地址暴露；反向代理是正道 |
| `dsh web --trusted-host <host[:port]>` 可重复传入，信任围栏放行该 Host 头的请求 | `startup.ts:50`、`packages/client/connection/src/api-request-trust.ts` | **本方案的关键开关**：把 tailnet 主机名加入 trusted-host，代理请求即被放行 |
| 已带 PWA manifest（fullscreen）但**无 Service Worker**；前端桌面优先、无移动端媒体查询 | `apps/web/public/manifest.webmanifest`、grep 结果 | 手机可用但体验局促；「添加到主屏幕」需要补 Service Worker（见第 6 节后续阶段） |

## 3. 选定架构

```
手机/PC ── Tailscale 客户端（设备认证 + WireGuard 加密）
   └─ HTTPS https://<主机名>.ts.net  （Tailscale 自动签发有效证书）
        └─ Tailscale Serve（服务器 443 端口，仅 tailnet 可达）
             └─ 127.0.0.1:3080  dsh web（systemd 托管）
```

### 为什么选 Tailscale（而不是域名 + Caddy / frp / cloudflared）

- 用户**没有域名**：Let's Encrypt 无法为裸 IP 签证书；Tailscale 免费提供 `*.ts.net` 有效证书，手机端无任何证书告警。
- **个人自用**：Tailscale 的设备认证 = 天然的"只允许我自己的设备访问"，无需自建账号体系。
- **零公网暴露**：服务器不需要开任何公网端口，攻击面最小。
- 备选方案（若未来不用 Tailscale）见第 7 节。

## 4. 部署步骤（由 `server/setup-dsh-server.sh` 自动完成）

1. 安装系统依赖：`curl git jq ca-certificates build-essential python3`
2. 安装 Node.js 22（NodeSource）+ corepack（pnpm 版本由仓库 `packageManager: pnpm@11.7.0` 决定）
3. 安装并登录 Tailscale（`tailscale up`，打印登录链接）
4. 取得 tailnet 主机名：`tailscale status --json | jq -r '.Self.DNSName'`（如 `myserver.tailxxxx.ts.net`）
5. `git clone https://github.com/deepseek-ai/deepseek-harness.git`（公开仓库，master 分支）
6. 以专用系统用户 `dsh` 运行 `pnpm install --frozen-lockfile && pnpm run build`
7. 安装 systemd 服务 `dsh-web.service`：
   `ExecStart=corepack pnpm dsh web --host 127.0.0.1 --trusted-host <主机名>.ts.net`
   `DSH_HOME=/var/lib/dsh`（数据目录固定、可写）
8. `tailscale serve --bg http://127.0.0.1:3080` → 手机/PC 访问 `https://<主机名>.ts.net`

### 关键点：为什么 `--trusted-host` 能让一切工作

手机浏览器打开 `https://myserver.tailxxxx.ts.net` 后，页面的 fetch/WebSocket 请求都发往同源，即 Host 头 = `myserver.tailxxxx.ts.net`。DSH 的 `/api` 信任围栏检查 Host：

- 不是 loopback → 不在 `trustedHosts` → **拒绝**；
- 在 `trustedHosts`（我们传了 `--trusted-host myserver.tailxxxx.ts.net`）→ **放行**。

Tailscale Serve 转发时保留原 Host 头，所以围栏判断的是真实域名。围栏还会校验浏览器 Origin 与 Host 同源（防 DNS rebinding），正常浏览器访问天然满足。

## 5. 安全模型

| 层 | 机制 | 说明 |
|---|---|---|
| 设备认证 | Tailscale（账号 + 设备注册） | 只有你账号下的设备能进 tailnet；建议开启账号 2FA |
| 传输加密 | WireGuard（tailnet 内）+ TLS（`*.ts.net` 证书） | 端到端加密到服务器 |
| 网络暴露 | 服务器无任何公网监听端口（DSH 仅 127.0.0.1） | 公网扫描不到 |
| DSH 信任围栏 | `--trusted-host` + Origin 同源校验 | 防 DNS rebinding 的围栏，**不是**认证（DSH 设计如此） |
| 可选加固 | Tailscale ACL | 可限制仅特定设备访问 3080 端口（见 `server/README.md`） |

> ⚠️ 注意：DSH 本身**零鉴权**——任何能连上 3080 的人都能让 AI 执行代码。所以**永远不要**把 3080 暴露到公网或不可信网络；本方案的安全性完全建立在"只有你的设备能进 tailnet"之上。

## 6. 后续阶段规划

### 已完成（本工具包包含）

**PWA 移动端基础适配**（改 DSH 前端，见 [mobile-adaptation.md](mobile-adaptation.md)）：
- Service Worker（`apps/web/public/sw.js` + `main.ts` 注册）：满足 Chrome 安装条件 → 手机「安装应用」可用；`/assets` 缓存加速、`/api` 与事件流绝不缓存
- 移动端基础样式（`packages/client/web/src/mobile.css`）：横向溢出防护、iOS 输入缩放修复、刘海屏安全区、触摸点击延迟优化
- `viewport-fit=cover`（`apps/web/index.html`）

### 待办（需真机视觉迭代或后续立项）

1. **组件级响应式布局**：侧栏抽屉化、输入栏手机优先布局（组件层已有部分断点，需真机逐屏调校）
2. **推送通知**：审批请求 / goal 完成 / agent 汇报推送到手机（Web Push 或 Capacitor 壳）
3. **Capacitor 原生壳**：把 PWA 包成原生 App，加生物识别锁
4. **服务器资源提醒**：DSH 构建与运行需要内存（建议 ≥ 4GB），可加 systemd 资源限制

## 7. 备选方案（不选 Tailscale 时）

| 方案 | 优点 | 缺点 |
|---|---|---|
| **SSH 隧道**（手机 Termius `-L 3080:127.0.0.1:3080`） | 零新增服务，trust fence 因 loopback 自动放行 | 无 HTTPS（PWA 不可装、部分浏览器特性受限）；每次要手开隧道 |
| **cloudflared quick tunnel + 密码** | 公网可达、有效证书 | URL 每次随机变化；需在服务器再加一层 Basic Auth（Caddy）；有公网暴露面 |
| **frp + Caddy（自建中转）** | 用自己的服务器做中转，可做域名 | 无域名时 HTTPS 仍难解；复杂度高 |

## 8. 验证清单（部署后）

- [ ] 手机安装 Tailscale 并登录同一账号
- [ ] 手机浏览器打开 `https://<主机名>.ts.net`，无证书告警
- [ ] 能看到 DSH GUI，能新建会话并发送消息（验证 `/api` RPC 放行）
- [ ] 运行一个会执行工具的任务，手机端能看到工具调用与输出流（验证 WebSocket/SSE 事件流）
- [ ] 手机「添加到主屏幕」/「安装应用」（PWA 增强完成后）
- [ ] 未登录 Tailscale 的设备访问该 URL 超时/拒绝（验证不可达）
