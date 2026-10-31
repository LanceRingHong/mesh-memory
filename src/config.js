import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
  return {
    memoryDir,
    deviceName,
    deviceSlug: slugify(deviceName),
    dshHome,
    autoSyncAgents: config.autoSyncAgents === true,
    syncSkills: config.syncSkills === true,
    autoRecall: config.autoRecall !== false,
    dashboardPort: Math.min(65535, Math.max(1024, Number(config.dashboardPort) || 8765)),
    maxSearchResults: Math.min(100, Math.max(1, Number(config.maxSearchResults) || 20)),
    maxFileBytes: Math.min(5_000_000, Math.max(1_000, Number(config.maxFileBytes) || 200_000)),
  }
}

export function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
