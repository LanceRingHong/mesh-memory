import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { stamp } from './config.js'
import { writeFileAtomic } from './store.js'

const STATUS = new Set(['queued', 'running', 'done', 'failed', 'cancelled'])

function tasksRoot(settings) {
  return path.join(settings.memoryDir, 'tasks', settings.deviceSlug)
}

function taskFile(settings, id) {
  return path.join(tasksRoot(settings), `${id}.json`)
}

function newId() {
  return `task-${stamp()}-${randomBytes(2).toString('hex')}`
}

/**
 * 任务对象（0.12.0）：把一次跨设备委托变成可追踪的记录。
 * 只由创建者写自己的 tasks/<deviceSlug>/，避免多设备写同一文件。
 */
export async function createTask(settings, input = {}) {
  const now = new Date().toISOString()
  const task = {
    id: newId(),
    title: String(input.title || input.prompt || 'untitled').slice(0, 200),
    prompt: String(input.prompt || ''),
    status: 'queued',
    hostId: input.hostId ? String(input.hostId) : '',
    hostName: input.hostName ? String(input.hostName) : '',
    workspaceId: input.workspaceId ? String(input.workspaceId) : '',
    workspacePath: input.workspacePath ? String(input.workspacePath) : '',
    sessionId: input.sessionId ? String(input.sessionId) : '',
    operationId: input.operationId ? String(input.operationId) : '',
    createdBy: { device: settings.deviceName, agent: settings.agentName },
    createdAt: now,
    updatedAt: now,
    result: null,
    error: null,
  }
  await fs.mkdir(tasksRoot(settings), { recursive: true })
  await writeFileAtomic(taskFile(settings, task.id), `${JSON.stringify(task, null, 2)}\n`)
  return task
}

export async function updateTask(settings, id, patch = {}) {
  const task = await readTask(settings, id)
  if (!task) throw new Error(`找不到任务：${id}`)
  if (patch.status && !STATUS.has(patch.status)) throw new Error(`status 只接受 ${[...STATUS].join(' / ')}`)
  const next = {
    ...task,
    ...patch,
    id: task.id,
    createdAt: task.createdAt,
    updatedAt: new Date().toISOString(),
  }
  await writeFileAtomic(taskFile(settings, task.id), `${JSON.stringify(next, null, 2)}\n`)
  return next
}

async function readTask(settings, id) {
  try {
    return JSON.parse(await fs.readFile(taskFile(settings, id), 'utf8'))
  } catch {}
  const dir = path.join(settings.memoryDir, 'tasks')
  let devices = []
  try {
    devices = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of devices) {
    if (!entry.isDirectory()) continue
    try {
      return JSON.parse(await fs.readFile(path.join(dir, entry.name, `${id}.json`), 'utf8'))
    } catch {}
  }
  return null
}

export async function getTask(settings, id) {
  return await readTask(settings, id)
}

export async function listTasks(settings, { status, hostId, limit = 50 } = {}) {
  const root = path.join(settings.memoryDir, 'tasks')
  const out = []
  let devices = []
  try {
    devices = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return { count: 0, items: [] }
  }
  for (const entry of devices) {
    if (!entry.isDirectory()) continue
    let names = []
    try {
      names = await fs.readdir(path.join(root, entry.name))
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.endsWith('.json') || name.includes('.sync-conflict-')) continue
      try {
        const task = JSON.parse(await fs.readFile(path.join(root, entry.name, name), 'utf8'))
        if (status && task.status !== status) continue
        if (hostId && String(task.hostId) !== String(hostId)) continue
        out.push(task)
      } catch {}
    }
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { count: out.length, items: out.slice(0, Math.max(1, Number(limit) || 50)) }
}

export async function cancelTask(settings, id) {
  const task = await readTask(settings, id)
  if (!task) throw new Error(`找不到任务：${id}`)
  if (task.status === 'done' || task.status === 'failed') return task
  return await updateTask(settings, id, { status: 'cancelled' })
}

export async function taskSummary(settings) {
  const { items } = await listTasks(settings, { limit: 10000 })
  const counts = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0, total: items.length }
  for (const task of items) {
    if (counts[task.status] !== undefined) counts[task.status] += 1
  }
  return counts
}
