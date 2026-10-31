import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function clamp(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function defaultMemoryDir() {
  const env = (process.env.DSH_MESH_DIR || '').trim()
  if (env) return path.resolve(env)
  // Android 的本机引擎里 /sdcard 是可共享存储；桌面/其他 Linux 用家目录。
  if (process.platform !== 'win32') {
    try {
      if (fs.existsSync('/sdcard')) return '/sdcard/DSH-mesh'
    } catch {}
  }
  return path.join(os.homedir(), 'DSH-mesh')
}

/**
 * 上传白名单的默认值：共享记忆目录 + 用户下载目录。
 * 其余路径必须在插件配置 allowedUploadRoots 里显式声明（0.4.6 起，P0-3）。
 */
export function defaultUploadRoots(memoryDir) {
  const roots = [path.resolve(memoryDir)]
  try {
    roots.push(path.join(os.homedir(), 'Downloads'))
  } catch {}
  return [...new Set(roots)]
}

export function slugify(value) {
  const text = String(value || '').trim().toLowerCase()
  const ascii = text.replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '')
  return (ascii || 'device').slice(0, 48)
}

export function settingsOf(config = {}) {
  const memoryDir = path.resolve(((config.memoryDir || '').trim()) || defaultMemoryDir())
  const deviceName = ((config.deviceName || '').trim()) || (process.env.DSH_MESH_DEVICE || '').trim() || os.hostname() || 'device'
  const dshHome = (process.env.DSH_HOME || '').trim()
    ? path.resolve(process.env.DSH_HOME)
    : path.join(os.homedir(), '.dsh')
  const configuredRoots = Array.isArray(config.allowedUploadRoots)
    ? config.allowedUploadRoots.map((item) => String(item || '').trim()).filter(Boolean).map((item) => path.resolve(item))
    : []
  return {
    memoryDir,
    deviceName,
    deviceSlug: slugify(deviceName),
    dshHome,
    autoSyncAgents: config.autoSyncAgents === true,
    syncSkills: config.syncSkills === true,
    autoRecall: config.autoRecall !== false,
    dashboardPort: clamp(config.dashboardPort, 1024, 65535, 8765),
    maxSearchResults: clamp(config.maxSearchResults, 1, 100, 20),
    maxFileBytes: clamp(config.maxFileBytes, 1_000, 5_000_000, 200_000),
    // 召回：候选文件数、单文件大小、最低分、注入预算（0.4.6 起可配，P1-5/P1-6/P1-10）
    maxRecallFiles: clamp(config.maxRecallFiles, 1, 20_000, 1000),
    maxRecallFileBytes: clamp(config.maxRecallFileBytes, 10_000, 10_000_000, 1_000_000),
    recallMinScore: clamp(config.recallMinScore, 0, 1000, 0),
    recallMaxChars: clamp(config.recallMaxChars, 1000, 20_000, 6000),
    // 上传白名单（P0-3）：默认只允许共享目录与 Downloads，其余显式配置。
    allowedUploadRoots: configuredRoots.length ? configuredRoots : defaultUploadRoots(memoryDir),
  }
}

export function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
