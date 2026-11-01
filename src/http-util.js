/**
 * HTTP 写响应的兜底（0.25.0）。
 *
 * 背景：2026-11-01 23:33 DSH 宿主整个崩了一次，栈是
 *   writeText(dashboard.js) ← writeJson ← proxyToServe 的 upstream error 回调
 *   → ERR_HTTP_HEADERS_SENT → 未捕获异常。
 * 原因：反代把上游响应头写出去之后，上游进程被杀，错误回调又写了一次头。
 * 这类"异步回调里二次写头"在 Node 里是**未捕获异常**，宿主会直接退出。
 *
 * 这里统一保证：头一旦发出去，就只做收尾，绝不第二次 writeHead。
 */

export function writeText(res, status, type, text) {
  const body = String(text ?? '')
  if (res.writableEnded) return
  if (res.headersSent) {
    // 已经发过头（典型：上游中途断开）：不能再写头，只能收尾。
    try {
      res.end()
    } catch {}
    return
  }
  res.writeHead(status, {
    'content-type': `${type}; charset=utf-8`,
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

export function writeJson(res, status, value) {
  writeText(res, status, 'application/json', JSON.stringify(value))
}

/** 中途失败的连接直接断掉，比尝试补一个响应体更安全。 */
export function destroyQuietly(res) {
  try {
    if (!res.writableEnded) res.destroy()
  } catch {}
}
