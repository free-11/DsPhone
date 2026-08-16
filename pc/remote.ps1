# remote.ps1 — PC 端助手：测试并打开服务器上的 DSH 远程地址
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File .\remote.ps1            # 仅测试连通性
#   powershell -ExecutionPolicy Bypass -File .\remote.ps1 -Open      # 测试并打开浏览器
#   powershell -ExecutionPolicy Bypass -File .\remote.ps1 -Server myserver.tailxxxx.ts.net
#
# 地址来源优先级: -Server 参数 > 本目录 server.txt（一行一个地址）> 手动输入
param(
    [string]$Server = "",
    [switch]$Open
)
$ErrorActionPreference = 'Stop'

$config = Join-Path $PSScriptRoot 'server.txt'
if (-not $Server -and (Test-Path $config)) {
    $Server = (Get-Content $config -Raw).Trim()
}
if (-not $Server) {
    $Server = Read-Host "服务器 tailnet 地址（如 myserver.tailxxxx.ts.net）"
}

$url = "https://$Server"
Write-Host "DSH 远程地址: $url"

# 若本机装了 Tailscale，顺带显示连接状态
if (Get-Command tailscale -ErrorAction SilentlyContinue) {
    try { tailscale status --peers=false | Select-Object -First 3 } catch { }
}

try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10
    Write-Host ("HTTP {0} — DSH 服务可达 ✓" -f [int]$r.StatusCode) -ForegroundColor Green
} catch {
    Write-Host "连接失败: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "请检查: 1) 服务器已运行 setup-dsh-server.sh; 2) 本机已安装并登录 Tailscale（同一账号）; 3) 地址拼写"
}

if ($Open) { Start-Process $url }
