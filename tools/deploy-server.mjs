#!/usr/bin/env node
/**
 * tools/deploy-server.mjs — SSH 部署助手
 *
 * 凭据只从环境变量读取（DEPLOY_HOST / DEPLOY_USER / DEPLOY_PASS），绝不写入
 * 任何文件；首次连接接受主机指纹（TOFU，输出里会打印提示）。
 *
 * 用法（PowerShell）:
 *   $env:DEPLOY_HOST='<ip>'; $env:DEPLOY_USER='root'; $env:DEPLOY_PASS='<pwd>'
 *   node tools/deploy-server.mjs probe            # 只探测服务器信息
 *   node tools/deploy-server.mjs prep             # 低内存时确保 >=4G swap（幂等）
 *   node tools/deploy-server.mjs exec '<cmd>'     # 在服务器上执行任意命令（流式输出）
 *   node tools/deploy-server.mjs upload <本地目录> <远端目录>   # 递归上传（自动排除 node_modules/.git/lib/dist 等）
 *   node tools/deploy-server.mjs deploy [--no-build] [--env K=V] [--env K2=V2]  # 上传工具包并执行部署
 *   node tools/deploy-server.mjs cleanup          # 完整还原：删除部署添加的一切，保留原有服务
 */
import { Client } from 'ssh2'
import { readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const HOST = process.env.DEPLOY_HOST
const USER = process.env.DEPLOY_USER
const PASS = process.env.DEPLOY_PASS
const mode = process.argv[2] ?? 'probe'
const noBuild = process.argv.includes('--no-build')
const envs = []
for (let i = 3; i < process.argv.length; i++) {
  if (process.argv[i] === '--env') envs.push(process.argv[++i])
}

if (!HOST || !USER || !PASS) {
  console.error('缺少环境变量: DEPLOY_HOST / DEPLOY_USER / DEPLOY_PASS')
  process.exit(2)
}

const UPLOADS = [
  join(__dir, '..', 'server', 'setup-dsh-server.sh'),
  join(__dir, '..', 'server', 'dsh-web.service'),
]

function connect() {
  return new Promise((resolve, reject) => {
    const c = new Client()
    c.on('ready', () => resolve(c))
    c.on('error', reject)
    c.connect({
      host: HOST,
      port: 22,
      username: USER,
      password: PASS,
      readyTimeout: 60000,
      keepaliveInterval: 15000,
      hostVerifier: (key, cb) => {
        console.log('[hostkey] 首次连接，按 TOFU 接受服务器指纹')
        cb(true)
      },
    })
  })
}

function execStream(c, command) {
  return new Promise((resolve) => {
    let hadError = false
    // 连接中途断开必须上报失败（否则断连会被误判为退出码 0）
    const onClientClose = () => {
      if (!settled) {
        settled = true
        console.error('[ssh] 连接在命令执行中断开')
        resolve(1)
      }
    }
    let settled = false
    c.once('close', onClientClose)
    c.exec(command, (err, stream) => {
      if (err) {
        c.removeListener('close', onClientClose)
        console.error('[exec error]', err.message)
        resolve(1)
        return
      }
      stream.on('close', (code) => {
        c.removeListener('close', onClientClose)
        if (!settled) {
          settled = true
          resolve(hadError ? 1 : (code ?? 0))
        }
      })
      stream.on('error', (e) => {
        hadError = true
        console.error('[stream error]', e.message)
      })
      stream.on('data', (d) => process.stdout.write(d))
      stream.stderr.on('data', (d) => process.stdout.write(d))
    })
  })
}

function sftpPut(c, local, remote) {
  return new Promise((resolve, reject) => {
    c.sftp((err, sftp) => {
      if (err) return reject(err)
      sftp.fastPut(local, remote, (e) => (e ? reject(e) : resolve()))
    })
  })
}

async function main() {
  console.log(`连接 ${HOST} (${USER}) ...`)
  const c = await connect()
  console.log('已连接')

  if (mode === 'probe') {
    const code = await execStream(c, [
      'uname -a',
      'cat /etc/os-release | head -4',
      'echo "cores=$(nproc)  ram:"; free -h | head -2',
      'df -h / | tail -1',
      'ss -ltnp | head -12',
    ].join('; echo ---; '))
    c.end()
    process.exit(code)
  }

  if (mode === 'prep') {
    // 确保服务器至少有 4G swap（幂等）；低内存机器构建 DSH 时需要。
    // 注意：多行 shell 用换行拼接（分号会破坏 if/else 结构）。
    const code = await execStream(c, [
      'cur=$(free -m | awk \'/^Swap:/{print $2}\')',
      'echo "当前 swap: ${cur} MiB"',
      'if [ "${cur:-0}" -ge 4096 ]; then',
      '  echo "swap >= 4G，跳过"',
      'else',
      '  fallocate -l 4G /swapfile2 && chmod 600 /swapfile2 && mkswap /swapfile2 && swapon /swapfile2',
      '  grep -q "/swapfile2" /etc/fstab || echo "/swapfile2 none swap sw 0 0" >> /etc/fstab',
      '  echo "已补充 4G swapfile2，当前: $(free -m | awk \'/^Swap:/{print $2}\') MiB"',
      'fi',
      'free -h',
    ].join('\n'))
    c.end()
    process.exit(code)
  }

  if (mode === 'exec') {
    const command = process.argv.slice(3).join(' ')
    if (!command) {
      console.error('用法: node deploy-server.mjs exec "<command>"')
      process.exit(2)
    }
    console.log(`$ ${command}`)
    const code = await execStream(c, command)
    c.end()
    process.exit(code)
  }

  if (mode === 'upload') {
    const localDir = process.argv[3]
    const remoteDir = process.argv[4]
    if (!localDir || !remoteDir) {
      console.error('用法: node deploy-server.mjs upload <本地目录> <远端目录>')
      process.exit(2)
    }
    // 排除规则：目录段黑名单 + 文件名/后缀黑名单
    const DIR_EXCLUDE = new Set(['node_modules', '.git', 'lib', 'dist', '.turbo', 'coverage'])
    const FILE_EXCLUDE = /\.(tsbuildinfo|log|map)$|^\.DS_Store$|^Thumbs\.db$/
    const sftp = await new Promise((resolve, reject) => c.sftp((e, s) => (e ? reject(e) : resolve(s))))
    const put = (local, remote) => new Promise((resolve, reject) =>
      sftp.fastPut(local, remote, (e) => (e ? reject(e) : resolve())))
    const mkdirRec = (dir) => new Promise((resolve) =>
      sftp.mkdir(dir, { recursive: true }, () => resolve()))
    const jobs = []
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name)
        const relPath = relative(localDir, abs).split(sep).join('/')
        const segments = relPath.split('/')
        if (entry.isDirectory()) {
          if (segments.some((s) => DIR_EXCLUDE.has(s))) continue
          walk(abs)
        } else {
          if (FILE_EXCLUDE.test(entry.name)) continue
          jobs.push({ abs, remote: `${remoteDir}/${relPath}` })
        }
      }
    }
    walk(localDir)
    let idx = 0
    let count = 0
    let bytes = 0
    const workers = Array.from({ length: 12 }, async () => {
      while (idx < jobs.length) {
        const job = jobs[idx++]
        const parent = job.remote.slice(0, job.remote.lastIndexOf('/'))
        await mkdirRec(parent)
        await put(job.abs, job.remote)
        count++
        bytes += statSync(job.abs).size
      }
    })
    await Promise.all(workers)
    console.log(`上传完成: ${count} 个文件, ${(bytes / 1048576).toFixed(1)} MB -> ${remoteDir}`)
    c.end()
    process.exit(0)
  }

  if (mode === 'cleanup') {
    // 完整还原服务器：删除部署添加的一切，保留原有服务（nginx/mysql/ssh/java）。
    // 注意：DNS 也还原为阿里云内网 DNS（原样），外网域名解析会回到之前的状态。
    const code = await execStream(c, [
      '# 1) 杀残留进程 —— 注意：不要用 pkill -f 匹配本命令文本中的关键字',
      '#    （如 deepseek-harness/pnpm），会误杀正在执行清理的 shell 自身；',
      '#    服务器重启后本无残留进程，此项留空即可',
      'true',
      '# 2) 删除 dsh-web systemd 服务（若存在）',
      'systemctl stop dsh-web 2>/dev/null; systemctl disable dsh-web 2>/dev/null; true',
      'rm -f /etc/systemd/system/dsh-web.service',
      '# 3) 删除 DSH 相关目录、用户、缓存',
      'rm -rf /opt/deepseek-harness /var/lib/dsh /root/DsPhone /root/.cache/node /root/.cache/pnpm',
      'userdel -f dsh 2>/dev/null; true',
      '# 4) 移除 Tailscale',
      'systemctl stop tailscaled 2>/dev/null; true',
      'apt-get purge -y tailscale tailscale-archive-keyring >/dev/null 2>&1; true',
      'rm -f /etc/apt/sources.list.d/tailscale.list /usr/share/keyrings/tailscale-archive-keyring.gpg',
      'rm -rf /var/lib/tailscale /var/cache/tailscale',
      '# 5) 移除 Node.js / NodeSource / corepack 与 pnpm shims',
      'apt-get purge -y nodejs >/dev/null 2>&1; true',
      'rm -f /etc/apt/sources.list.d/nodesource.list /usr/share/keyrings/nodesource.gpg',
      'rm -f /usr/bin/corepack /usr/bin/pnpm /usr/bin/pnpx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx',
      '# 6) 移除我添加的 swap（保留原有的 /swapfile）',
      'swapoff /swapfile2 2>/dev/null; rm -f /swapfile2; true',
      "sed -i '\\|/swapfile2|d' /etc/fstab",
      '# 7) 还原 DNS（删除 netplan 覆盖与 resolved.conf 修改，回到阿里内网 DNS）',
      'rm -f /etc/netplan/99-dns.yaml',
      'netplan apply 2>&1 | tail -2',
      "sed -i '/^DNS=223.5.5.5 8.8.8.8$/d' /etc/systemd/resolved.conf",
      'systemctl restart systemd-resolved',
      'resolvectl flush-caches',
      '# 8) 收尾',
      'apt-get -y autoremove >/dev/null 2>&1; true',
      'systemctl daemon-reload',
      'echo ============ CLEANUP DONE ============',
      'systemctl is-active nginx mysql ssh 2>&1',
      'free -h | head -2',
      'echo --- /opt ---; ls /opt 2>/dev/null; echo --- /root ---; ls /root 2>/dev/null',
    ].join('\n'))
    c.end()
    process.exit(code)
  }

  if (mode === 'deploy') {
    const REMOTE_DIR = '/root/DsPhone/server'
    await execStream(c, `mkdir -p ${REMOTE_DIR}`)
    for (const f of UPLOADS) {
      const name = f.split(/[\\/]/).pop()
      console.log(`上传 ${name} -> ${REMOTE_DIR}/${name}`)
      await sftpPut(c, f, `${REMOTE_DIR}/${name}`)
    }
    await execStream(c, `chmod +x ${REMOTE_DIR}/setup-dsh-server.sh`)

    const buildFlag = noBuild ? 'DSH_BUILD=0' : ''
    const envPrefix = envs.length > 0 ? `${envs.join(' ')} ` : ''
    console.log('开始执行 setup-dsh-server.sh（长任务，输出实时回传）...')
    const code = await execStream(c, `cd ${REMOTE_DIR} && ${envPrefix}${buildFlag} bash setup-dsh-server.sh 2>&1`)
    console.log(`\n[deploy] setup 退出码: ${code}`)
    c.end()
    process.exit(code)
  }

  console.error(`未知模式: ${mode}（probe | prep | exec | upload | deploy）`)
  c.end()
  process.exit(2)
}

main().catch((e) => {
  console.error('[deploy] 失败:', e.message)
  process.exit(1)
})
