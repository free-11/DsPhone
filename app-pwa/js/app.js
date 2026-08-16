/**
 * DSH Remote 启动器逻辑：
 * 本页由 DSH 服务器自身提供（/app/），与工作台同源。
 * 连接 = 探测根路径可达后跳转到工作台（/）。
 * 状态：就绪 → 连接中（进度条）→ 成功跳转 / 失败内联报错 + 重试。
 */
(function () {
  'use strict'

  // PWA 可安装性：注册根作用域 Service Worker（覆盖 /app/），失败不阻塞
  if (window.isSecureContext && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function () {})
  }

  var formView = document.getElementById('form-view')
  var connectingView = document.getElementById('connecting-view')
  var host = document.getElementById('host')
  var form = document.getElementById('connect-form')
  var error = document.getElementById('error')
  var button = document.getElementById('go')

  host.textContent = window.location.host

  function setState(connecting) {
    formView.hidden = connecting
    connectingView.hidden = !connecting
    error.hidden = true
    if (!connecting) button.disabled = false
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault()
    button.disabled = true
    setState(true)
    var controller = new AbortController()
    var timer = setTimeout(function () { controller.abort() }, 8000)
    fetch('/', { method: 'HEAD', cache: 'no-store', signal: controller.signal })
      .then(function (r) {
        clearTimeout(timer)
        if (!r.ok) throw new Error('bad status ' + r.status)
        window.location.href = '/'
      })
      .catch(function () {
        clearTimeout(timer)
        setState(false)
        error.hidden = false
        button.disabled = false
      })
  })
})()
