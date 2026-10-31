import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Local git snapshots of the shared memory directory.
 *
 * The git directory lives under `$DSH_HOME` (NOT inside the synced folder), so
 * each device keeps its own history and Syncthing never sees `.git`.
 */
export function backupDir(settings) {
  return path.join(settings.dshHome, 'dsh-mesh-backups.git')
}

let queue = Promise.resolve()
const pendingTimers = new Map()

function runGit(settings, args, { allowFail = false } = {}) {
  const env = {
    ...process.env,
    GIT_DIR: backupDir(settings),
    GIT_WORK_TREE: settings.memoryDir,
    GIT_TERMINAL_PROMPT: '0',
  }
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['--no-pager', ...args],
      { cwd: settings.memoryDir, env, timeout: 30_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error && !allowFail) {
          reject(new Error(String(stderr || error.message || error).trim()))
          return
        }
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), failed: Boolean(error) })
      },
    )
  })
}

async function exists(file) {
  try {
    await fs.stat(file)
    return true
  } catch {
    return false
  }
}

async function ensureRepo(settings) {
  const dir = backupDir(settings)
  await fs.mkdir(dir, { recursive: true })
  if (await exists(path.join(dir, 'HEAD'))) return
  // An empty directory left by an interrupted init would confuse `git init`.
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })
  await runGit(settings, ['init', '--quiet'])
  await runGit(settings, ['config', 'user.name', 'dsh-mesh'])
  await runGit(settings, ['config', 'user.email', 'mesh@localhost'])
  await runGit(settings, ['config', 'core.autocrlf', 'false'])
  await runGit(settings, ['config', 'core.quotepath', 'false'])
}

async function doSnapshot(settings, reason) {
  if (settings.backupEnabled !== true) return { changed: false, skipped: 'disabled' }
  await ensureRepo(settings)
  await runGit(settings, ['add', '-A'])
  const status = await runGit(settings, ['status', '--porcelain'], { allowFail: true })
  if (!status.stdout.trim()) return { changed: false, skipped: 'no-changes' }
  const message = `snapshot: ${settings.deviceName} ${reason} ${new Date().toISOString()}`
  await runGit(settings, ['commit', '-m', message, '--quiet'])
  const head = await runGit(settings, ['rev-parse', '--short', 'HEAD'], { allowFail: true })
  return { changed: true, commit: head.stdout.trim(), message }
}

/** Serialized snapshot; safe to call from tool handlers and the capture flush. */
export function snapshot(settings, reason = 'manual') {
  const task = () => doSnapshot(settings, reason)
  const run = queue.then(task, task)
  queue = run.then(
    () => {},
    () => {},
  )
  return run
}

/** Debounced snapshot after writes (one commit per burst of edits). */
export function scheduleSnapshot(settings, reason = 'change') {
  if (settings.backupEnabled !== true) return
  const key = String(settings.dshHome || '')
  const prev = pendingTimers.get(key)
  if (prev) clearTimeout(prev)
  const waitMs = Math.max(5, Number(settings.backupDebounceSeconds) || 60) * 1000
  const timer = setTimeout(() => {
    pendingTimers.delete(key)
    snapshot(settings, reason).catch(() => {})
  }, waitMs)
  timer.unref?.()
  pendingTimers.set(key, timer)
}

export async function listSnapshots(settings, limit = 20) {
  await ensureRepo(settings)
  const out = await runGit(
    settings,
    ['log', `-n`, String(Math.max(1, Math.min(100, Number(limit) || 20))), '--format=%h\t%ad\t%s', '--date=iso'],
    { allowFail: true },
  )
  if (out.failed) return []
  return out.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [commit, date, ...rest] = line.split('\t')
      return { commit, date, message: rest.join('\t') }
    })
}

export async function restoreSnapshot(settings, commit, { confirm } = {}) {
  if (confirm !== true) throw new Error('还原需要 confirm:true（会覆盖当前记忆文件）')
  const sha = String(commit || '').trim()
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) throw new Error('commit 只接受 4-40 位十六进制')
  const before = await snapshot(settings, `before-restore:${sha}`)
  await runGit(settings, ['checkout', sha, '--', '.'])
  const after = await snapshot(settings, `restore:${sha}`)
  return { restored: sha, before, after }
}
