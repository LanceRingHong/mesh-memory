import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { probeServe, serveScriptPath, DEFAULT_SERVE_PORT, canSpawnNode, isAndroidRuntime } from '../src/serve-host.js'

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

test('serve 探测：健康检查 200 视为在跑', async (t) => {
  const { server, port } = await listen((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
      return
    }
    res.writeHead(404)
    res.end()
  })
  t.after(() => server.close())

  assert.equal(await probeServe(port), true)
})

test('serve 探测：非 200 / 无服务都为 false', async (t) => {
  const { server, port } = await listen((req, res) => {
    res.writeHead(503)
    res.end('down')
  })
  t.after(() => server.close())
  assert.equal(await probeServe(port), false)

  // 关掉后再探测：连接被拒 → false（不能抛错）。
  await new Promise((resolve) => server.close(resolve))
  assert.equal(await probeServe(port, 400), false)
})

test('serve 探测：连通性超时返回 false（不能挂住宿主启动）', async (t) => {
  const { server, port } = await listen(() => {
    // 永不响应
  })
  t.after(() => server.close())
  const startedAt = Date.now()
  assert.equal(await probeServe(port, 300), false)
  assert.ok(Date.now() - startedAt < 2_000, '超时应该很快返回')
})

test('默认端口与脚本路径', () => {
  assert.equal(DEFAULT_SERVE_PORT, 8767)
  assert.match(serveScriptPath(), /bin[\\/]mm-serve\.mjs$/)
})

test('运行时判定：Electron 或 node 可自启，其它运行时放弃', () => {
  // 测试进程就是 node，文件名必然带 node；Electron 分支不好在本机模拟，只断言 node 分支。
  assert.equal(canSpawnNode(), true)
  assert.equal(isAndroidRuntime(), process.platform === 'android' || Boolean(process.env.ANDROID_ROOT || process.env.ANDROID_DATA))
})

