import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { parseFrontmatter, writeFileAtomic, writeNote, safeRel, readInside } from './store.js'
import { stamp } from './config.js'

/**
 * 自动记录的会话摘要先落到本机收件箱（$DSH_HOME/dsh-mesh/inbox），
 * 不写共享目录、不参与召回；用户 accept 之后才成为正式记忆。
 */
export function inboxRoot(settings) {
  return path.join(settings.dshHome, 'dsh-mesh', 'inbox')
}

function sessionDir(settings) {
  return path.join(inboxRoot(settings), 'sessions')
}

function archiveDir(settings, bucket) {
  return path.join(inboxRoot(settings), bucket)
}

function safeName(value) {
  return String(value || 'session').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120) || 'session'
}

export async function writeSessionDraft(settings, buffer) {
  const dir = sessionDir(settings)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${safeName(buffer.id)}.md`)
  await writeFileAtomic(file, renderSessionDraft(buffer, settings))
  return { path: path.relative(inboxRoot(settings), file).replace(/\\/g, '/'), file }
}

/** 机械摘要：不调模型，只把缓冲区里确定的事实写成可读的一段。 */
export function renderSessionDraft(buffer, settings, now = new Date()) {
  const messages = Array.isArray(buffer.messages) ? buffer.messages : []
  const firstUser = messages.find((item) => item.role === 'user')?.text || ''
  const lastAssistant = [...messages].reverse().find((item) => item.role === 'assistant')?.text || ''
  const tools = [...(buffer.tools?.keys?.() ?? [])].sort()
  const files = [...(buffer.files ?? [])].slice(0, 30)
  const created = new Date(buffer.startedAt || Date.now()).toISOString()
  const updated = new Date(buffer.updatedAt || now.getTime()).toISOString()
  const fallbackTitle = firstUser ? firstUser.replace(/\s+/g, ' ').trim().slice(0, 30) : ''
  const title = String(buffer.title || '').trim() || fallbackTitle || `会话 ${String(buffer.id || '').slice(0, 16)}`

  const clip = (text, max) => {
    const value = String(text || '').replace(/\r\n/g, '\n').trim()
    return value.length > max ? `${value.slice(0, max)}…` : value
  }

  const lines = [
    '---',
    'kind: session-draft',
    `sessionId: ${JSON.stringify(String(buffer.id || ''))}`,
    `device: ${JSON.stringify(settings.deviceName)}`,
    `title: ${JSON.stringify(title)}`,
    `createdAt: ${created}`,
    `updatedAt: ${updated}`,
    `turns: ${Number(buffer.turns) || 0}`,
    `tools: ${JSON.stringify(tools)}`,
    'status: draft',
    '---',
    '',
    '## 用户诉求',
    '',
    clip(firstUser, 600) || '（未捕获到用户消息）',
    '',
    '## 最后结论',
    '',
    clip(lastAssistant, 1200) || '（没有助手文本；可能只做了工具调用，请人工确认）',
    '',
    '## 涉及文件',
    '',
    ...(files.length ? files.map((file) => `- \`${file}\``) : ['- （无）']),
    '',
    '## 工具',
    '',
    tools.length ? tools.map((tool) => `- ${tool}`).join('\n') : '- （无）',
    '',
  ]
  return lines.join('\n')
}

export async function listInbox(settings) {
  const dir = sessionDir(settings)
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const items = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('.')) continue
    const file = path.join(dir, entry.name)
    try {
      const text = await fs.readFile(file, 'utf8')
      const parsed = parseFrontmatter(text)
      const stat = await fs.stat(file)
      items.push({
        path: path.relative(inboxRoot(settings), file).replace(/\\/g, '/'),
        sessionId: String(parsed.attrs.sessionId || ''),
        title: String(parsed.attrs.title || entry.name),
        turns: Number(parsed.attrs.turns) || 0,
        createdAt: String(parsed.attrs.createdAt || ''),
        updatedAt: String(parsed.attrs.updatedAt || ''),
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      })
    } catch {}
  }
  return items.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

function resolveInboxPath(settings, rel) {
  const root = inboxRoot(settings)
  let value = String(rel || '').replace(/\\/g, '/').trim()
  // 兼容 writeSessionDraft / flush 返回的“相对 dshHome”写法。
  if (value.startsWith('dsh-mesh/inbox/')) value = value.slice('dsh-mesh/inbox/'.length)
  const parts = value.split('/')
  if (!value.startsWith('sessions/') || parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error('只允许访问 sessions/ 下的草稿')
  }
  return safeRel({ memoryDir: root }, value)
}

export async function readInbox(settings, rel) {
  const root = inboxRoot(settings)
  const file = resolveInboxPath(settings, rel)
  return await readInside({ memoryDir: root, maxFileBytes: 2_000_000 }, path.relative(root, file).replace(/\\/g, '/'))
}

export async function acceptInbox(settings, rel, { kind = 'notes', title, description } = {}) {
  const root = inboxRoot(settings)
  const file = resolveInboxPath(settings, rel)
  const text = await readInside({ memoryDir: root, maxFileBytes: 2_000_000 }, path.relative(root, file).replace(/\\/g, '/'))
  const parsed = parseFrontmatter(text)
  const finalTitle = String(title || parsed.attrs.title || '会话摘要').slice(0, 120)
  const finalDescription = String(description || `自动记录的会话摘要（${parsed.attrs.turns || 0} 轮）`).slice(0, 240)
  const memory = await writeNote(settings, {
    kind,
    memoryType: 'reference',
    title: finalTitle,
    description: finalDescription,
    content: parsed.body.trim(),
    tags: ['auto-capture', 'session'],
    device: settings.deviceName,
  })
  await moveToArchive(settings, file, 'accepted')
  await maybeSummarize(settings)
  return { memory: path.relative(settings.memoryDir, memory).replace(/\\/g, '/'), accepted: rel }
}

export async function rejectInbox(settings, rel) {
  const file = resolveInboxPath(settings, rel)
  await moveToArchive(settings, file, 'rejected')
  return { rejected: rel }
}

async function moveToArchive(settings, file, bucket) {
  const dir = archiveDir(settings, bucket)
  await fs.mkdir(dir, { recursive: true })
  const name = `${stamp()}-${randomBytes(3).toString('hex')}-${path.basename(file)}`
  await fs.rename(file, path.join(dir, name))
}

/** 收件箱非空时给出一行简短提醒（供系统提示使用）。 */
export async function inboxNudge(settings) {
  const items = await listInbox(settings)
  if (!items.length) return ''
  return `共享记忆有 ${items.length} 条自动记录的会话摘要待确认（设备 ${settings.deviceName}）；用 mesh_memory_inbox 查看，accept 后才进入正式记忆。`
}

async function maybeSummarize(settings) {
  // 占位：汇总文件留到 P2（Organize）再生成。
  return null
}
