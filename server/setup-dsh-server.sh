#!/usr/bin/env bash
#
# setup-dsh-server.sh — 在裸机 Linux 服务器上部署 DeepSeek Harness Web GUI，
#   并通过 Tailscale Serve 提供 tailnet 内 HTTPS 访问（手机远程控制）。
#
# 用法:
#   sudo bash setup-dsh-server.sh
#
# 可选环境变量:
#   DSH_REPO_DIR=/opt/deepseek-harness   仓库安装位置（默认如上）
#   DSH_BUILD=1                          是否执行生产构建（默认 1；=0 跳过）
#   DSH_USER=dsh                         运行 DSH 的专用系统用户（默认 dsh）
#
# 前置:
#   - Debian/Ubuntu 或 RHEL/Fedora 系（apt/dnf）
#   - 服务器可访问外网（安装依赖、clone 仓库、Tailscale）
#   - 已有 Tailscale 账号（登录时会打印链接）
#   - 建议内存 >= 4GB（DSH 构建较吃内存）
set -euo pipefail

REPO_DIR="${DSH_REPO_DIR:-/opt/deepseek-harness}"
BUILD="${DSH_BUILD:-1}"
DSH_USER="${DSH_USER:-dsh}"
DATA_DIR="${DSH_DATA_DIR:-/var/lib/dsh}"

log()  { printf '\033[1;34m[setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[setup:warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[setup:error]\033[0m %s\n' "$*" >&2; exit 1; }

# 小内存服务器（1-2G RAM）构建 DSH 时给 node 一个明确堆上限：太低会
# "heap out of memory"，太高会把整机内存吃穿触发 OOM killer（这台机器可能
# 还跑着 mysql 等服务）。3G 配合 swap 可在 2 核小机器上完成全量构建。
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=3072"

[[ $EUID -eq 0 ]] || die "请用 root 运行: sudo bash setup-dsh-server.sh"

# ---------- 0. 检测发行版 ----------
if command -v apt-get >/dev/null 2>&1; then
  PKG_MGR=apt
elif command -v dnf >/dev/null 2>&1; then
  PKG_MGR=dnf
else
  die "仅支持 apt/dnf 发行版（Debian/Ubuntu/RHEL/Fedora 系）"
fi

install_pkgs() {
  log "安装系统依赖: $*"
  if [[ $PKG_MGR == apt ]]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq "$@"
  else
    dnf install -y -q "$@"
  fi
}

# ---------- 1. 基础依赖 ----------
install_pkgs curl git jq ca-certificates build-essential python3

# ---------- 2. Node.js 22 + corepack(pnpm) ----------
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) < 22 ? 1 : 0)' 2>/dev/null; then
  log "安装 Node.js 22 (NodeSource)"
  if [[ $PKG_MGR == apt ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    export DEBIAN_FRONTEND=noninteractive
    apt-get install -y -qq nodejs
  else
    die "RHEL 系请先手动安装 Node.js >= 22.19（https://nodejs.org），再重跑本脚本"
  fi
fi
log "node: $(node -v)"
if command -v corepack >/dev/null 2>&1; then
  corepack enable
else
  warn "系统未自带 corepack，改用 npm 安装"
  npm install -g corepack
  corepack enable
fi
log "corepack 已启用（pnpm 版本由仓库 packageManager 字段决定: pnpm@11.7.0）"

# ---------- 3. Tailscale ----------
if ! command -v tailscale >/dev/null 2>&1; then
  log "安装 Tailscale"
  curl -fsSL https://tailscale.com/install.sh | sh
fi
systemctl enable --now tailscaled >/dev/null 2>&1 || true
if ! tailscale status >/dev/null 2>&1; then
  log "本机尚未登录 Tailscale，即将打印登录链接（浏览器/手机打开并登录同一账号）"
  tailscale up
fi
DNS_NAME="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
[[ -n "$DNS_NAME" && "$DNS_NAME" != "null" ]] || die "无法取得 tailnet 主机名，请确认已执行 tailscale up"
log "tailnet 主机名: $DNS_NAME"

# ---------- 4. DSH 仓库 ----------
# 已有源码（含 package.json，例如通过 deploy 工具直传）则跳过 clone——
# 大陆服务器常无法直连 github.com，直传源码是可靠路径。
if [[ ! -f "$REPO_DIR/package.json" ]]; then
  log "克隆 DeepSeek Harness -> $REPO_DIR"
  mkdir -p "$(dirname "$REPO_DIR")"
  git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git "$REPO_DIR"
else
  log "检测到已有 DSH 源码于 $REPO_DIR，跳过 clone"
fi

id -u "$DSH_USER" >/dev/null 2>&1 \
  || useradd --system --create-home --home-dir "$REPO_DIR" --shell /usr/sbin/nologin "$DSH_USER"
mkdir -p "$DATA_DIR"
chown -R "$DSH_USER":"$DSH_USER" "$REPO_DIR" "$DATA_DIR"

log "安装依赖（pnpm install --frozen-lockfile）"
# 大陆服务器可设 DSH_NPM_REGISTRY=https://registry.npmmirror.com 加速；为空则用 npm 默认源
export npm_config_registry="${DSH_NPM_REGISTRY:-}"
su -s /bin/bash "$DSH_USER" -c "cd '$REPO_DIR' && pnpm install --frozen-lockfile"
if [[ "$BUILD" == "1" ]]; then
  log "生产构建（pnpm run build，首次约 5-15 分钟）"
  su -s /bin/bash "$DSH_USER" -c "cd '$REPO_DIR' && pnpm run build"
else
  warn "DSH_BUILD=0：跳过构建，将使用 dev 模式（仍需要至少一次 build:web 以生成前端 dist）"
fi

# ---------- 5. systemd 服务 ----------
UNIT=/etc/systemd/system/dsh-web.service
log "安装 systemd 服务 -> $UNIT"
sed -e "s|__REPO__|$REPO_DIR|g" \
    -e "s|__USER__|$DSH_USER|g" \
    -e "s|__DATA_DIR__|$DATA_DIR|g" \
    -e "s|__TRUSTED_HOST__|$DNS_NAME|g" \
    "$(dirname "$0")/dsh-web.service" > "$UNIT"
systemctl daemon-reload
systemctl enable --now dsh-web

# ---------- 6. Tailscale Serve ----------
log "启用 Tailscale Serve: https://$DNS_NAME -> http://127.0.0.1:3080"
tailscale serve --bg "http://127.0.0.1:3080" \
  || tailscale serve --bg 3080

# ---------- 7. 收尾检查 ----------
sleep 3
if systemctl is-active --quiet dsh-web; then
  log "DSH 服务运行中: systemctl status dsh-web"
else
  warn "dsh-web 服务未正常运行，请查看: journalctl -u dsh-web -n 50 --no-pager"
fi
log "------------------------------------------------------------"
log "完成！手机/PC 安装 Tailscale 并登录同一账号后访问:"
log "   https://$DNS_NAME"
log "常用命令:"
log "   journalctl -u dsh-web -f         # 实时日志"
log "   tailscale serve status           # 查看 Serve 配置"
log "   tailscale serve --https=443 off  # 关闭远程访问"
log "   systemctl restart dsh-web        # 重启 DSH"
log "------------------------------------------------------------"
