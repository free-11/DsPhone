# 服务器端操作手册

## 一、部署

```bash
# 把整个 DsPhone 目录传到服务器（任选其一）
rsync -av ./DsPhone/ user@server:/root/DsPhone/
# 或 scp

cd /root/DsPhone/server
sudo bash setup-dsh-server.sh
```

首次运行约 10-20 分钟（依赖安装 + DSH 全量构建）。中间会：

1. 安装系统依赖与 Node.js 22
2. 安装 Tailscale 并打印**登录链接**——在浏览器/手机打开并登录你的 Tailscale 账号
3. clone 官方 DSH 仓库到 `/opt/deepseek-harness`
4. `pnpm install` + `pnpm run build`
5. 注册 systemd 服务 `dsh-web` 并启动
6. 执行 `tailscale serve`，输出形如：

```
完成！手机/PC 安装 Tailscale 并登录同一账号后访问:
   https://myserver.tailxxxx.ts.net
```

## 二、验证

```bash
systemctl status dsh-web          # 服务状态
journalctl -u dsh-web -n 50       # 最近日志（应能看到: dsh web: http://127.0.0.1:3080）
tailscale serve status            # Serve 配置（--bg 模式）
curl -s http://127.0.0.1:3080 | head -c 200   # 本地可达性
```

> 若浏览器提示证书问题：进入 [Tailscale 管理后台](https://login.tailscale.com/admin/dns) → 该 tailnet 的 **HTTPS Certificates** 需为 Enabled（个人 tailnet 默认开启；使用 MagicDNS 域名时自动签发）。

## 三、日常运维

| 操作 | 命令 |
|---|---|
| 查看日志 | `journalctl -u dsh-web -f` |
| 重启 DSH | `sudo systemctl restart dsh-web` |
| 关闭远程访问 | `sudo tailscale serve --https=443 off` |
| 重新开启 | `sudo tailscale serve --bg http://127.0.0.1:3080` |
| 升级 DSH | `cd /opt/deepseek-harness && sudo -u dsh git pull && sudo -u dsh pnpm install --frozen-lockfile && sudo -u dsh pnpm run build && sudo systemctl restart dsh-web` |
| 完全卸载 | `sudo systemctl disable --now dsh-web && sudo rm /etc/systemd/system/dsh-web.service && sudo systemctl daemon-reload`（Tailscale/仓库保留与否自定） |

DSH 数据目录：`/var/lib/dsh`（配置、会话等，备份此目录即可）。

## 四、安全加固（可选）

Tailscale 默认允许同账号所有设备互相访问。只想让**自己的手机和 PC** 访问：

1. [管理后台](https://login.tailscale.com/admin/acls) → ACL 增加：

```json
{
  "action": "accept",
  "src": ["your-phone-ip", "your-pc-ip"],
  "dst": ["myserver.tailxxxx.ts.net:443"]
}
```

2. 服务器开启 UFW 默认拒绝入站（Tailscale 接口不受影响）：

```bash
sudo ufw default deny incoming
sudo ufw enable
```

> DSH 自身无鉴权，安全性完全依赖 tailnet 设备认证——请务必开启 Tailscale 账号 2FA，并只把设备加入自己的账号。

## 五、常见问题

- **`dsh web` 启动失败（端口占用）**：`ss -ltnp | grep 3080` 排查；改端口需同步改 systemd ExecStart 与 `tailscale serve` 目标。
- **内存不足构建失败**：DSH 构建建议 ≥4GB 内存；可 `DSH_BUILD=0` 跳过构建后重跑（dev 模式），或用 swap。
- **tailscale serve 报 HTTPS 未启用**：见上文管理后台设置。
