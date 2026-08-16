# DSH 前端移动端适配补丁

`dsh-frontend-mobile.patch` 是 DeepSeek Harness 前端移动端适配的完整改动（Service Worker + 移动端基础样式 + viewport 调整），可应用到官方 DSH 仓库（`github.com/deepseek-ai/deepseek-harness`，master 分支）。

## 包含的改动

| 文件 | 改动 |
|---|---|
| `apps/web/public/sw.js` | 新增 Service Worker（PWA 安装 + 静态资源缓存；`/api` 与事件流不缓存） |
| `apps/web/src/main.ts` | 注册 Service Worker（HTTPS 守卫） |
| `apps/web/index.html` | viewport 增加 `viewport-fit=cover` |
| `packages/client/web/src/mobile.css` | 新增移动端基础样式（溢出防护、iOS 输入缩放、安全区、触摸延迟） |
| `packages/client/web/src/boot.tsx` | 引入 mobile.css |

## 应用方法

```bash
# 在 DSH 仓库根目录（干净的 master 工作区）
git apply patches/dsh-frontend-mobile.patch
# 或
git apply /path/to/dsh-frontend-mobile.patch

# 应用后重建前端
pnpm run build:web
```

## 验证

补丁与已验证的构建状态完全一致（`git apply --reverse --check` 通过），应用后无需额外适配。

## 重新生成

```bash
# 在已应用改动的 DSH 仓库中：
git add -N apps/web/public/sw.js packages/client/web/src/mobile.css
git diff -- apps/web/index.html apps/web/src/main.ts packages/client/web/src/boot.tsx \
  apps/web/public/sw.js packages/client/web/src/mobile.css > dsh-frontend-mobile.patch
git reset -q
```
