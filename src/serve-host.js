import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * 宿主托管 serve（0.24.0）。
 *
 * 终态要求「入口在应用里」：DSH 的 conversation.view 直接嵌 `/dsh-mesh/app/`。
 * 但那个页面由 mm-serve 托管；serve 没起就会 502/空白。所以插件加载时自己探测 + 拉起，
 * 不要求用户手动 `npm run serve`。退出时只杀自己拉起的那个进程（外部已在跑的不动）。
 */

export const DEFAULT_SERVE_PORT = 8767

function packageRoot() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
}

export function serveScriptPath(root = packageRoot()) {
  return path.join(root, 'bin', 'mm-serve.mjs')
}

/** serve 是否已在监听：只看 /api/health 是否 200，不解析内容。 */
export function probeServe(port = DEFAULT_SERVE_PORT, timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: timeoutMs }, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
  })
}

function waitForServe(port, deadlineMs = 8000, stepMs = 150) {
  const startedAt = Date.now()
  return new Promise((resolve) => {
    const tick = async () => {
      if (await probeServe(port, 400)) return resolve(true)
      if (Date.now() - startedAt > deadlineMs) return resolve(false)
      // 不用 unref：这里必须等到结果，否则调用方（宿主初始化）会拿到未 settled 的 promise。
      setTimeout(tick, stepMs)
    }
    void tick()
  })
}

/**
 * 当前宿主能不能直接 spawn 一个 node 子进程。
 * - Electron（桌面版）：execPath 是 App 本体，靠 ELECTRON_RUN_AS_NODE 当 Node 用；
 * - 原生 node（serve/CLI）：文件名里带 node；
 * - Android/未知运行时（比如 DSH Go 里 execPath 是 App 进程）：**不猜**，直接放弃自启，
 *   否则可能把 App 再拉起来一次。
 */
export function canSpawnNode() {
  if (process.versions?.electron) return true
  const base = path.basename(process.execPath || '').toLowerCase()
  return base.includes('node')
}

export function isAndroidRuntime() {
  return process.platform === 'android' || Boolean(process.env.ANDROID_ROOT || process.env.ANDROID_DATA)
}

/**
 * 确保 serve 在跑。
 * - 已在跑：`{ started:false }`，退出时不会去杀别人的进程；
 * - 没在跑且允许自启：拉起 `bin/mm-serve.mjs`，等端口就绪后返回 `{ started:true, child }`；
 * - 关闭自启 / 运行时不允许：返回 `reason`。
 */
export async function ensureServe(settings, options = {}) {
  const port = Number(options.port || DEFAULT_SERVE_PORT)
  const autostart = options.autostart !== false && !/^(0|false|off)$/i.test(String(process.env.MESH_SERVE_AUTOSTART ?? ''))
  if (await probeServe(port)) return { started: false, port, child: null, stop() {} }
  if (!autostart) return { started: false, port, child: null, reason: 'disabled', stop() {} }
  if (!canSpawnNode()) {
    return { started: false, port, child: null, reason: 'unknown-runtime', stop() {} }
  }

  const env = {
    ...process.env,
    MESH_PORT: String(port),
    DSH_HOME: settings.dshHome,
    DSH_MESH_DIR: settings.memoryDir,
    DSH_MESH_DEVICE: settings.deviceName,
    DSH_MESH_AGENT: settings.agentName || 'serve',
  }
  // 桌面版的宿主进程是 Electron：直接 spawn execPath 会再开一个 App，必须显式当 Node 用。
  if (process.versions?.electron) env.ELECTRON_RUN_AS_NODE = '1'

  let child
  try {
    child = spawn(process.execPath, [serveScriptPath(options.packageRoot)], {
      env,
      stdio: 'ignore',
      windowsHide: true,
      detached: false,
    })
  } catch (error) {
    return { started: false, port, child: null, error: String(error?.message || error), stop() {} }
  }
  child.on('error', () => {})
  child.unref?.()

  const ready = await waitForServe(port)
  const stop = () => {
    try {
      child.kill()
    } catch {}
  }
  return { started: true, ready, port, child, stop }
}
