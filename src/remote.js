import { randomUUID } from 'node:crypto'

export function operationId(prefix = 'mesh') {
  return `${prefix}-${randomUUID()}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 96)
}

function parseJson(value) {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text.startsWith('{') && !text.startsWith('[')) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export function asObject(value) {
  if (value == null) return {}
  if (typeof value === 'object') {
    if (value.value !== undefined) {
      const inner = parseJson(value.value)
      return inner ?? (value.value && typeof value.value === 'object' ? value.value : { text: String(value.value) })
    }
    if (Array.isArray(value?.content)) {
      const text = value.content
        .map((item) => (typeof item?.text === 'string' ? item.text : ''))
        .filter(Boolean)
        .join('\n')
      return parseJson(text) ?? { text }
    }
    return value
  }
  const parsed = parseJson(value)
  if (parsed) return parsed
  return { text: String(value) }
}

export function textOf(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    if (Array.isArray(value?.content)) {
      return value.content
        .map((item) => (typeof item?.text === 'string' ? item.text : ''))
        .filter(Boolean)
        .join('\n')
    }
    if (typeof value?.text === 'string') return value.text
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

export function findKey(value, key, depth = 0) {
  if (value == null || depth > 6) return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findKey(item, key, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (typeof value !== 'object') return undefined
  if (value[key] !== undefined) return value[key]
  for (const child of Object.values(value)) {
    const found = findKey(child, key, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

export async function callRemote(ctx, exec, name, args = {}) {
  const tool = ctx.tools.get(name)
  if (!tool) {
    throw new Error(`Remote 工具 ${name} 不可用：请确认 ds-harness-remote 已安装、已登录且 Remote Tools 已开启`)
  }
  const raw = await tool.execute(args, exec)
  return raw
}

export async function listHosts(ctx, exec) {
  const raw = await callRemote(ctx, exec, 'remote_list_hosts', {})
  return asObject(raw)
}

export async function listWorkspaces(ctx, exec, hostId) {
  const raw = await callRemote(ctx, exec, 'remote_list_workspaces', { hostId })
  return asObject(raw)
}

function parseDeep(value) {
  let current = value
  for (let i = 0; i < 4; i += 1) {
    if (typeof current !== 'string') return current
    try {
      current = JSON.parse(current)
    } catch {
      return value
    }
  }
  return current
}
export { parseDeep }

function decodeJsonString(value) {
  try {
    return JSON.parse(`"${value}"`)
  } catch {
    return value
  }
}

function extractTextBlocks(raw) {
  const out = []
  const re = /"type":"text","text":"((?:[^"\\]|\\.)*)"/g
  let match
  while ((match = re.exec(raw))) out.push(decodeJsonString(match[1]))
  return out
}

function extractToolCalls(raw) {
  const out = []
  const re = /"type":"tool-call"[^{}]*?"name":"([^"]+)"/g
  let match
  while ((match = re.exec(raw))) out.push(decodeJsonString(match[1]))
  return out
}

function extractQuoted(raw, key) {
  const re = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`)
  const match = re.exec(raw)
  return match ? decodeJsonString(match[1]) : ''
}

export function summarizeSession(raw) {
  const data = asObject(raw)
  const records = Array.isArray(data.records) ? data.records : []
  const messages = []
  const approvals = []
  let title = ''
  for (const record of records) {
    const parsed = parseDeep(record?.json ?? record)
    if (typeof parsed === 'string') {
      // 大记录（含 reasoning/stream）可能被远端截断，JSON.parse 失败；用容错提取。
      if (record?.type === 'assistant/message') {
        const texts = extractTextBlocks(parsed)
        const tools = extractToolCalls(parsed)
        if (texts.length || tools.length) {
          messages.push({ role: 'assistant', text: texts.join('\n').trim(), tools })
        }
      }
      if (record?.type === 'session/title') {
        const t = extractQuoted(parsed, 'title')
        if (t) title = t
      }
      if (record?.type === 'approval/asked') {
        approvals.push({ tool: extractQuoted(parsed, 'toolName'), reason: extractQuoted(parsed, 'reason') })
      }
      continue
    }
    const event = parsed?.event ?? parsed
    if (!event || typeof event !== 'object') continue
    if (event.type === 'session/title' && event.data?.title) title = String(event.data.title)
    if (event.type === 'assistant/message') {
      const content = event.data?.message?.content
      if (!Array.isArray(content)) continue
      const text = content.filter((c) => c?.type === 'text').map((c) => String(c.text || '')).join('\n').trim()
      const tools = content.filter((c) => c?.type === 'tool-call').map((c) => String(c.name || '')).filter(Boolean)
      if (text || tools.length) messages.push({ role: 'assistant', text, tools })
    }
    if (event.type === 'user/message') {
      const content = event.data?.message?.content
      if (!Array.isArray(content)) continue
      const text = content.filter((c) => c?.type === 'text').map((c) => String(c.text || '')).join('\n').trim()
      if (text) messages.push({ role: 'user', text })
    }
    if (event.type === 'approval/asked') {
      approvals.push({ tool: String(event.data?.toolName || ''), reason: String(event.data?.reason || '') })
    }
  }
  const lines = []
  if (title) lines.push(`标题：${title}`)
  for (const message of messages) {
    const label = message.role === 'user' ? '用户' : '助手'
    if (message.text) lines.push(`${label}：${message.text}`)
    if (message.tools?.length) lines.push(`${label}工具：${message.tools.join(', ')}`)
  }
  for (const approval of approvals) lines.push(`待审批：${approval.tool} — ${approval.reason}`)
  const text = lines.join('\n').slice(0, 6000)
  return {
    status: data.status,
    title,
    messages,
    approvals,
    lastSeq: data.nextCursor?.throughSeq ?? null,
    text,
  }
}

export async function runOnHost(ctx, exec, { hostId, workspaceId, workspacePath, task, waitMs = 30000, readMessages = 20 }) {
  let workspace = workspaceId
  if (!workspace) {
    const catalog = await listWorkspaces(ctx, exec, hostId)
    const list = Array.isArray(catalog.workspaces) ? catalog.workspaces : []
    const harness = list.filter((item) => item?.backend === 'harness')
    const byPath = workspacePath
      ? harness.find((item) => String(item.path || '') === workspacePath || String(item.title || '') === workspacePath)
      : undefined
    workspace = (byPath || harness[0])?.workspaceId
    if (!workspace) throw new Error('目标主机没有可用的 harness 工作区')
  }

  const createdRaw = await callRemote(ctx, exec, 'remote_create_session', {
    hostId,
    backend: 'harness',
    workspaceId: workspace,
    operationId: operationId('create'),
  })
  const created = asObject(createdRaw)
  const sessionId = created.sessionId || findKey(created, 'sessionId')
  if (!sessionId) throw new Error('创建远程会话失败：没有返回 sessionId')

  const guardedTask = [
    '[dsh-mesh 委托任务]',
    String(task || '').trim(),
    '',
    '执行约束：这是跨设备委托。优先使用只读工具/文件读取工具，不要为了只读操作申请 danger-full-access；',
    '如果确实需要审批或危险操作，请在回复里说明原因，不要静默等待。',
  ].join('\n')

  await callRemote(ctx, exec, 'remote_send_message', {
    hostId,
    backend: 'harness',
    workspaceId: workspace,
    sessionId,
    operationId: operationId('send'),
    message: guardedTask,
  })

  await callRemote(ctx, exec, 'remote_wait_sessions', {
    targets: [{ hostId, backend: 'harness', workspaceId: workspace, sessionId }],
    timeoutMs: Math.min(60000, Math.max(1000, Number(waitMs) || 30000)),
  })

  let summary = { status: undefined, title: '', messages: [], approvals: [], lastSeq: null, text: '' }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const readRaw = await callRemote(ctx, exec, 'remote_read_session', {
      hostId,
      backend: 'harness',
      workspaceId: workspace,
      sessionId,
      maxMessages: Math.min(50, Math.max(1, Number(readMessages) || 20)),
    })
    summary = summarizeSession(readRaw)
    if (summary.messages.length > 0 || summary.approvals.length > 0 || summary.title) break
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }

  return {
    hostId,
    workspaceId: workspace,
    sessionId,
    status: summary.status,
    title: summary.title,
    messages: summary.messages,
    approvals: summary.approvals,
    lastSeq: summary.lastSeq,
    text: summary.text,
  }
}

export async function readSession(ctx, exec, { hostId, workspaceId, sessionId, maxMessages = 20 }) {
  const raw = await callRemote(ctx, exec, 'remote_read_session', {
    hostId,
    backend: 'harness',
    workspaceId,
    sessionId,
    maxMessages: Math.min(50, Math.max(1, Number(maxMessages) || 20)),
  })
  return summarizeSession(raw)
}

export async function interruptSession(ctx, exec, { hostId, workspaceId, sessionId }) {
  const raw = await callRemote(ctx, exec, 'remote_interrupt_session', {
    hostId,
    backend: 'harness',
    workspaceId,
    sessionId,
    operationId: operationId('interrupt'),
  })
  return asObject(raw)
}

export async function downloadFile(ctx, exec, { hostId, workspaceId, sessionId, path }) {
  const raw = await callRemote(ctx, exec, 'remote_download_file', {
    hostId,
    backend: 'harness',
    workspaceId,
    sessionId,
    path,
  })
  const result = asObject(raw)
  if (result.operationId) return await waitOperation(ctx, exec, result.operationId)
  return result
}

export async function uploadFile(ctx, exec, { hostId, workspaceId, sessionId, localPath, name }) {
  const raw = await callRemote(ctx, exec, 'remote_upload_file', {
    hostId,
    backend: 'harness',
    workspaceId,
    sessionId,
    operationId: operationId('upload'),
    localPath,
    ...(name ? { name } : {}),
  })
  const result = asObject(raw)
  if (result.operationId) return await waitOperation(ctx, exec, result.operationId)
  return result
}

async function waitOperation(ctx, exec, id, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  let last = {}
  while (Date.now() < deadline) {
    const raw = await callRemote(ctx, exec, 'remote_get_operation', { operationId: id })
    last = asObject(raw)
    const status = String(last.status || '')
    if (status === 'accepted' && (last.path || last.bytes || last.name)) return last
    if (status && !['unknown', 'pending', 'accepted', 'in_progress'].includes(status)) return last
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return last
}
