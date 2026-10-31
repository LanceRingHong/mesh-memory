import { writeSessionDraft } from './inbox.js'
import { scheduleSnapshot } from './backup.js'

const MAX_MESSAGES = 60
const MAX_TEXT = 4000

/** Per-session in-memory buffer; the event handler never does IO. */
const buffers = new Map()

export function createBuffer(session) {
  return {
    id: String(session?.id || 'session'),
    title: String(session?.header?.title || ''),
    cwd: String(session?.header?.cwd || ''),
    startedAt: Date.now(),
    updatedAt: Date.now(),
    turns: 0,
    messages: [],
    tools: new Map(),
    files: new Set(),
    session: session ?? null,
  }
}

/**
 * 插件在会话中途热加载时，事件缓冲是空的；flush 前从会话历史补一次，
 * 保证草稿仍然完整（导出供测试）。
 */
export async function hydrateFromSession(buffer) {
  const session = buffer?.session
  if (!session || typeof session.deriveMessages !== 'function') return buffer
  if (buffer.messages.some((item) => item.role === 'user')) return buffer
  try {
    const derived = session.deriveMessages()
    const messages = [...(derived && typeof derived.then === 'function' ? await derived : derived)]
    for (const message of messages.slice(-40)) {
      const role = message?.role
      if (role !== 'user' && role !== 'assistant') continue
      if (role === 'user' && message?.source?.kind !== undefined && message.source.kind !== 'user') continue
      pushMessage(buffer, role, textOf(message?.content))
    }
    const users = buffer.messages.filter((item) => item.role === 'user').length
    buffer.turns = Math.max(buffer.turns, users)
    if (!buffer.title) {
      const first = buffer.messages.find((item) => item.role === 'user')
      if (first) buffer.title = first.text.slice(0, 40)
    }
  } catch {}
  return buffer
}

function textOf(content) {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part?.type === 'text')
    .map((part) => String(part.text || ''))
    .join('\n')
    .trim()
}

function pushMessage(buffer, role, text) {
  const value = String(text || '').trim().slice(0, MAX_TEXT)
  if (!value) return
  const last = buffer.messages[buffer.messages.length - 1]
  if (last && last.role === role && last.text === value) return
  buffer.messages.push({ role, text: value })
  if (buffer.messages.length > MAX_MESSAGES) buffer.messages.shift()
} 

function collectFiles(buffer, rawArguments) {
  let args
  try {
    args = typeof rawArguments === 'string' ? JSON.parse(rawArguments) : rawArguments
  } catch {
    return
  }
  if (!args || typeof args !== 'object') return
  const keys = ['path', 'file_path', 'filePath', 'notebook_path', 'localPath']
  for (const key of keys) {
    if (typeof args[key] === 'string' && args[key].trim()) buffer.files.add(args[key].trim())
  }
  if (Array.isArray(args.paths)) {
    for (const item of args.paths) if (typeof item === 'string' && item.trim()) buffer.files.add(item.trim())
  }
}

/** Applies one `session/event` payload to its buffer. Pure, IO-free. */
export function observeEvent(buffer, event) {
  const type = String(event?.type || '')
  const data = event?.data || {}
  buffer.updatedAt = Date.now()
  switch (type) {
    case 'user/message': {
      // 只记真正的用户输入：harness 的运行时上下文也以 user 角色注入，
      // 但 source.kind 不是 'user'（与自动召回同一口径）。
      const source = data?.source?.kind
      if (source !== undefined && source !== 'user') break
      const text = textOf(data?.content)
      pushMessage(buffer, 'user', text)
      if (text) {
        buffer.turns = Math.max(buffer.turns, buffer.messages.filter((item) => item.role === 'user').length)
        if (!buffer.title) buffer.title = text.slice(0, 40)
      }
      break
    }
    case 'assistant/message': {
      const content = data?.message?.content
      pushMessage(buffer, 'assistant', textOf(content))
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part?.type === 'tool-call' && part.name) buffer.tools.set(String(part.name), true)
        }
      }
      break
    }
    case 'tool/call': {
      if (data?.name) buffer.tools.set(String(data.name), true)
      collectFiles(buffer, data?.arguments)
      break
    }
    case 'turn/start': {
      const turn = Number(data?.turn)
      if (Number.isFinite(turn)) buffer.turns = Math.max(buffer.turns, turn)
      break
    }
    case 'session/title': {
      const title = typeof data?.title === 'string' ? data.title : ''
      if (title) buffer.title = title
      break
    }
    default:
      break
  }
  return buffer
}

async function flush(settings, id, reason) {
  const buffer = buffers.get(id)
  if (!buffer) return null
  buffers.delete(id)
  await hydrateFromSession(buffer)
  if (!buffer.title) buffer.title = String(buffer.session?.header?.title || '')
  const minTurns = Math.max(1, Number(settings.captureMinTurns) || 2)
  // 压缩过的长会话可能已经没有用户消息，用消息条数兜底，避免永远不触发。
  if (reason !== 'manual' && reason !== 'disposed' && buffer.turns < minTurns && buffer.messages.length < 4) return null
  if (!buffer.messages.length) return null
  const out = await writeSessionDraft(settings, buffer)
  await scheduleSnapshot(settings, `capture:${reason}`)
  return { ...out, sessionId: id, turns: buffer.turns, messages: buffer.messages.length }
}

export async function flushSession(settings, id, reason = 'manual') {
  return await flush(settings, id, reason)
}

export async function flushAllSessions(settings, reason = 'manual') {
  const out = []
  for (const id of [...buffers.keys()]) {
    const result = await flush(settings, id, reason).catch(() => null)
    if (result) out.push(result)
  }
  return out
}

/** 手动整理当前会话：即使本 turn 的事件还没提交，也从会话历史补全后落草稿。 */
export async function flushCurrent(settings, session, reason = 'manual') {
  if (!session?.id) return []
  const id = String(session.id)
  if (!buffers.has(id)) buffers.set(id, createBuffer(session))
  const result = await flush(settings, id, reason).catch(() => null)
  return result ? [result] : []
}

export function bufferedSessions() {
  return [...buffers.keys()]
}

/**
 * Subscribes to the host's session events and turns finished turns into
 * mechanical drafts in the local inbox. No model calls, no shared-dir writes.
 */
export function registerCapture(ctx, settings) {
  if (settings.captureEnabled !== true || typeof ctx.on !== 'function') return () => {}
  const idleMs = Math.max(1, Number(settings.captureIdleMinutes) || 5) * 60_000
  const timers = new Map()

  const scheduleIdle = (id) => {
    const prev = timers.get(id)
    if (prev) clearTimeout(prev)
    const timer = setTimeout(() => {
      timers.delete(id)
      flush(settings, id, 'idle').catch(() => {})
    }, idleMs)
    timer.unref?.()
    timers.set(id, timer)
  }

  const onEvent = (session, event) => {
    try {
      const id = String(session?.id || '')
      if (!id || !event) return
      let buffer = buffers.get(id)
      if (!buffer) {
        buffer = createBuffer(session)
        buffers.set(id, buffer)
      }
      observeEvent(buffer, event)
      scheduleIdle(id)
    } catch {}
  }

  const onDisposed = (session) => {
    const id = String(session?.id || '')
    if (!id) return
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
    flush(settings, id, 'disposed').catch(() => {})
  }

  const offEvent = ctx.on('session/event', onEvent)
  const offDisposed = typeof ctx.on === 'function' ? ctx.on('session/disposed', onDisposed) : null

  return () => {
    try {
      offEvent?.()
    } catch {}
    try {
      offDisposed?.()
    } catch {}
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    buffers.clear()
  }
}
