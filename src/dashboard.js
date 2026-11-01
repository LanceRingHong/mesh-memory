import http from 'node:http'
import path from 'node:path'
import {
  ensureLayout,
  counts,
  searchMemory,
  readMemory,
  recentFiles,
  treeMemory,
  listConflicts,
  updateDevices,
  writeNote,
  updateNote,
  trashNote,
} from './store.js'
import { listInbox, readInbox, acceptInbox, rejectInbox } from './inbox.js'
import { flushAllSessions } from './capture.js'
import { snapshot, listSnapshots, restoreSnapshot, scheduleSnapshot } from './backup.js'

import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** 客户端构建产物：client/ 跑 npm run build 会输出到这里，随插件一起安装。 */
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')
const APP_PREFIX = '/dsh-mesh/app/'

/** 旧页面（三段式原生页）已下线，统一跳到新客户端。 */
const MOVED_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=/dsh-mesh/app/">
<title>记忆 · mesh-memory</title></head>
<body style="font:14px/1.7 system-ui,sans-serif;background:#0b1020;color:#cfd6e6;padding:28px">
<p>记忆界面已迁移到新的客户端。</p>
<p><a style="color:#8fb7ff" href="/dsh-mesh/app/">打开 /dsh-mesh/app/</a>　或　<a style="color:#8fb7ff" href="http://127.0.0.1:8767/">http://127.0.0.1:8767/</a></p>
</body></html>`

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
}

/** 从 root 下取静态文件；找不到返回 false（由调用方决定回退）。防目录穿越。 */
async function serveStatic(res, root, relPath) {
  const rootAbs = path.resolve(root)
  const rel = decodeURIComponent(String(relPath || '')).replace(/^\/+/, '')
  let file = path.resolve(rootAbs, rel || 'index.html')
  if (file !== rootAbs && !file.startsWith(rootAbs + path.sep)) return false
  try {
    const info = await fs.stat(file)
    if (info.isDirectory()) file = path.join(file, 'index.html')
  } catch {
    return false
  }
  let body
  try {
    body = await fs.readFile(file)
  } catch {
    return false
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, {
    'content-type': type,
    'cache-control': path.basename(file) === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable',
    'content-length': body.length,
  })
  res.end(body)
  return true
}

async function serveApp(res, urlPath) {
  const rel = urlPath.startsWith(APP_PREFIX) ? urlPath.slice(APP_PREFIX.length) : ''
  if (await serveStatic(res, PUBLIC_DIR, rel || 'index.html')) return true
  // SPA 回退：未知路径交给前端路由
  return serveStatic(res, PUBLIC_DIR, 'index.html')
}

/** 老页面 / DSH 面板仍在用的接口，必须留在插件进程内处理。 */
const LEGACY_API = new Set([
  '/dsh-mesh/api/status',
  '/dsh-mesh/api/inbox',
  '/dsh-mesh/api/inbox/file',
  '/dsh-mesh/api/inbox/accept',
  '/dsh-mesh/api/inbox/reject',
  '/dsh-mesh/api/inbox/flush',
  '/dsh-mesh/api/memory/write',
  '/dsh-mesh/api/memory/update',
  '/dsh-mesh/api/memory/delete',
  '/dsh-mesh/api/backup',
  '/dsh-mesh/api/backup/snapshot',
  '/dsh-mesh/api/backup/restore',
  '/dsh-mesh/api/conflicts',
  '/dsh-mesh/api/search',
  '/dsh-mesh/api/tree',
  '/dsh-mesh/api/file',
])

const SERVE_PORT = Number(process.env.DSH_MESH_SERVE_PORT || 8767)

/**
 * 新客户端的 REST 契约由 mm-serve 提供。这里同源反代 /dsh-mesh/api/*，
 * 让 `/dsh-mesh/app/` 也能用（插件内托管时不依赖另一个端口的前缀）。
 */
function proxyToServe(req, res, pathname, search) {
  const targetPath = pathname.replace(/^\/dsh-mesh/, '') + (search || '')
  const headers = {}
  for (const key of ['content-type', 'x-mesh-action', 'x-mesh-token']) {
    if (req.headers[key]) headers[key] = req.headers[key]
  }
  const upstream = http.request(
    { host: '127.0.0.1', port: SERVE_PORT, method: req.method, path: targetPath, headers },
    (up) => {
      res.writeHead(up.statusCode || 502, {
        'content-type': up.headers['content-type'] || 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      up.pipe(res)
    },
  )
  upstream.on('error', () => {
    writeJson(res, 503, {
      ok: false,
      error: `mesh-memory serve 未运行（127.0.0.1:${SERVE_PORT}）：在 plugin/ 下执行 npm run serve`,
    })
  })
  req.pipe(upstream)
}

function writeText(res, status, type, text) {
  res.writeHead(status, {
    'content-type': `${type}; charset=utf-8`,
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function writeJson(res, status, body) {
  writeText(res, status, 'application/json', JSON.stringify(body))
}

/**
 * 回环判断（P2-7）：Host 头可以伪造，socket 地址不行——两者都必须指向本机。
 * 导出给测试用。
 */
export function isLoopbackRequest(req) {
  const socket = req?.socket?.remoteAddress || req?.connection?.remoteAddress || ''
  const bare = String(socket).replace(/^::ffff:/, '')
  const socketLoopback = bare === '127.0.0.1' || bare === '::1' || bare === 'localhost'
  if (!socketLoopback) return false
  const host = req?.headers?.host
  if (typeof host !== 'string' || !host) return false
  const name = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]
  return name === '127.0.0.1' || name === 'localhost' || name === '::1'
}

function tokenOk(req, url, settings) {
  const expected = String(settings.dashboardToken || '')
  if (!expected) return true
  const given = url.searchParams.get('token') || req.headers['x-dsh-mesh-token']
  return String(given || '') === expected
}

function readJsonBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8').trim()
        resolve(text ? JSON.parse(text) : {})
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

/** 写操作必须带自定义头且同源：跨站表单/脚本无法伪造。 */
function mutationAllowed(req) {
  if (String(req.headers['x-dsh-mesh-action'] || '') !== '1') return false
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

async function handleMutation(pathname, body, settings) {
  await ensureLayout(settings)
  switch (pathname) {
    case '/dsh-mesh/api/inbox/flush': {
      const flushed = await flushAllSessions(settings, 'manual')
      return { ok: true, flushed: flushed.length, items: flushed }
    }
    case '/dsh-mesh/api/inbox/accept': {
      if (!body.path) throw new Error('path 必填')
      const result = await acceptInbox(settings, body.path, {
        kind: body.kind || 'notes',
        title: body.title,
      })
      scheduleSnapshot(settings, 'ui:accept')
      return { ok: true, ...result }
    }
    case '/dsh-mesh/api/inbox/reject': {
      if (!body.path) throw new Error('path 必填')
      const result = await rejectInbox(settings, body.path)
      scheduleSnapshot(settings, 'ui:reject')
      return { ok: true, ...result }
    }
    case '/dsh-mesh/api/memory/write': {
      if (!body.title || !body.content) throw new Error('title 和 content 必填')
      const file = await writeNote(settings, {
        kind: body.kind || 'notes',
        memoryType: body.memoryType || 'reference',
        title: body.title,
        description: body.description,
        content: body.content,
        tags: Array.isArray(body.tags) ? body.tags : ['ui'],
        device: settings.deviceName,
        agent: settings.agentName,
        source: 'ui',
      })
      scheduleSnapshot(settings, 'ui:write')
      return { ok: true, path: path.relative(settings.memoryDir, file).replace(/\\/g, '/') }
    }
    case '/dsh-mesh/api/memory/update': {
      if (!body.path) throw new Error('path 必填')
      const patch = {}
      for (const key of ['content', 'title', 'description']) {
        if (body[key] !== undefined) patch[key] = body[key]
      }
      const result = await updateNote(settings, body.path, patch)
      scheduleSnapshot(settings, 'ui:update')
      return { ok: true, ...result }
    }
    case '/dsh-mesh/api/memory/delete': {
      if (!body.path) throw new Error('path 必填')
      const result = await trashNote(settings, body.path)
      scheduleSnapshot(settings, 'ui:delete')
      return { ok: true, ...result }
    }
    case '/dsh-mesh/api/backup/snapshot': {
      const result = await snapshot(settings, 'ui')
      return { ok: true, ...result }
    }
    case '/dsh-mesh/api/backup/restore': {
      const result = await restoreSnapshot(settings, body.commit, { confirm: body.confirm === true })
      return { ok: true, ...result }
    }
    default:
      throw new Error('not found')
  }
}

export function registerDashboard(ctx, settings) {
  let dispose = () => {}
  let listening = false
  ctx.inject(['webServer'], (sub) => {
    const buildHandler = (requireToken) => async (req, res) => {
      if (!isLoopbackRequest(req)) {
        writeJson(res, 403, { ok: false, error: 'non-loopback request' })
        return
      }
      const url = new URL(req.url || '/', 'http://dsh.internal')
      const pathname = url.pathname
      // 新客户端的 REST 契约由 mm-serve 提供；这里同源反代，客户端就能挂在 /dsh-mesh/app/ 下。
      if (pathname.startsWith('/dsh-mesh/api/') && !LEGACY_API.has(pathname)) {
        if (requireToken && !tokenOk(req, url, settings)) {
          writeJson(res, 401, { ok: false, error: 'dashboard token required' })
          return
        }
        proxyToServe(req, res, pathname, url.search)
        return
      }
      if (req.method !== 'GET' && req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: 'GET/POST only' })
        return
      }
      if (requireToken && !tokenOk(req, url, settings)) {
        writeJson(res, 401, { ok: false, error: 'dashboard token required' })
        return
      }
      try {
        if (req.method === 'POST') {
          if (!mutationAllowed(req)) {
            writeJson(res, 403, { ok: false, error: '写操作需要 x-dsh-mesh-action 头且必须同源' })
            return
          }
          const body = await readJsonBody(req)
          const result = await handleMutation(pathname, body, settings)
          writeJson(res, 200, result)
          return
        }
        if (pathname === '/' || pathname === '/dsh-mesh' || pathname === '/dsh-mesh/') {
          writeText(res, 200, 'text/html', MOVED_HTML)
          return
        }
        if (pathname === '/dsh-mesh/app') {
          res.writeHead(302, { location: APP_PREFIX })
          res.end()
          return
        }
        if (pathname.startsWith(APP_PREFIX)) {
          if (await serveApp(res, pathname)) return
          writeText(
            res,
            404,
            'text/html',
            '<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;background:#0b1020;color:#cfd6e6;padding:24px">'
              + '<h1>客户端未构建</h1><p>在 <code>D:\\dsh-mesh\\client</code> 跑 <code>npm run build</code>，产物会写到 <code>plugin/public</code>。</p></body>',
          )
          return
        }
        if (pathname === '/dsh-mesh/api/status') {
          await ensureLayout(settings)
          const [c, devices, inbox] = await Promise.all([
            counts(settings),
            updateDevices(settings).catch(() => []),
            listInbox(settings).catch(() => []),
          ])
          const [recentFacts, recentSessions] = await Promise.all([
            recentFiles(settings, 'memory/facts', 10),
            recentFiles(settings, 'sessions', 10),
          ])
          writeJson(res, 200, {
            ok: true,
            device: settings.deviceName,
            deviceSlug: settings.deviceSlug,
            memoryDir: settings.memoryDir,
            dshHome: settings.dshHome,
            counts: { ...c, inbox: inbox.length },
            capture: {
              enabled: settings.captureEnabled,
              idleMinutes: settings.captureIdleMinutes,
              minTurns: settings.captureMinTurns,
            },
            backup: {
              enabled: settings.backupEnabled,
              debounceSeconds: settings.backupDebounceSeconds,
              intervalMinutes: settings.backupIntervalMinutes,
            },
            devices: devices.length ? devices : [{ name: settings.deviceName, deviceSlug: settings.deviceSlug }],
            recentFacts,
            recentSessions,
            loopbackOnly: true,
            dashboardListening: listening,
            tokenRequired: Boolean(settings.dashboardToken),
          })
          return
        }
        if (pathname === '/dsh-mesh/api/inbox') {
          await ensureLayout(settings)
          const items = await listInbox(settings)
          writeJson(res, 200, { ok: true, count: items.length, items })
          return
        }
        if (pathname === '/dsh-mesh/api/inbox/file') {
          const rel = url.searchParams.get('path') || ''
          const text = await readInbox(settings, rel)
          writeJson(res, 200, { ok: true, path: rel, text: text.slice(0, 200000) })
          return
        }
        if (pathname === '/dsh-mesh/api/backup') {
          try {
            const items = await listSnapshots(settings)
            writeJson(res, 200, { ok: true, count: items.length, items, available: true })
          } catch (error) {
            writeJson(res, 200, { ok: true, count: 0, items: [], available: false, reason: String(error?.message || error) })
          }
          return
        }
        if (pathname === '/dsh-mesh/api/conflicts') {
          await ensureLayout(settings)
          const items = await listConflicts(settings)
          writeJson(res, 200, { ok: true, count: items.length, items })
          return
        }
        if (pathname === '/dsh-mesh/api/search') {
          await ensureLayout(settings)
          const q = url.searchParams.get('q') || ''
          const results = await searchMemory(settings, q, 30)
          writeJson(res, 200, { ok: true, results })
          return
        }
        if (pathname === '/dsh-mesh/api/tree') {
          const tree = await treeMemory(settings)
          writeJson(res, 200, { ok: true, ...tree })
          return
        }
        if (pathname === '/dsh-mesh/api/file') {
          const rel = url.searchParams.get('path') || ''
          const text = await readMemory(settings, rel)
          writeJson(res, 200, { ok: true, path: rel, text: text.slice(0, 200000) })
          return
        }
        writeJson(res, 404, { ok: false, error: 'not found' })
      } catch (error) {
        writeJson(res, 500, { ok: false, error: String(error?.message || error) })
      }
    }
    // /dsh-mesh 路由本身受 DSH 登录保护，不额外要求 token；独立端口需要 token（若配置）。
    const routeHandler = buildHandler(false)
    const handler = buildHandler(true)
    const off = sub.webServer.register({ kind: 'prefix', path: '/dsh-mesh', handler: routeHandler })
    let server = null
    try {
      server = http.createServer(handler)
      server.on('error', (error) => {
        listening = false
        console.warn(`[dsh-mesh] dashboard port ${settings.dashboardPort} failed: ${error?.message || error}`)
      })
      server.listen(settings.dashboardPort, '127.0.0.1', () => {
        listening = true
        console.info(`[dsh-mesh] dashboard at http://127.0.0.1:${settings.dashboardPort}/`)
      })
    } catch (error) {
      console.warn(`[dsh-mesh] dashboard server failed: ${error?.message || error}`)
    }
    dispose = () => {
      try {
        off()
      } catch {}
      try {
        server?.close()
      } catch {}
    }
    console.info(`[dsh-mesh] dashboard route at http://127.0.0.1:${sub.webServer.port ?? '?'}/dsh-mesh/`)
    return dispose
  })
  return () => dispose()
}
