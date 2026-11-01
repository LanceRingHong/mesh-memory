import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { parseFrontmatter, writeFileAtomic, writeNote, safeRel, readInside, trashNote, renderNote } from './store.js'
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

/**
 * 从用户第一句话生成标题：优先在句末（。！？）或逗号处断开，
 * 避免出现"请用 web_searc"这种半截词。
 */
export function makeDraftTitle(text, max = 36) {
  const flat = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^#{1,6}\s/.test(line)) // 丢掉 "## 用户诉求" 这类小标题
    .join(' ')
    .replace(/[*_#>]/g, '')
    .replace(/(^|\s)[-*+]\s+/g, ' ') // 列表符号
    .replace(/\s+/g, ' ')
    .trim()
  if (!flat) return ''
  // "你是产品调研员。" 这类开场白太短，单独当标题没信息量，跳到下一句取。
  const afterPersona = flat.match(/^(.{1,12}?[。！？])\s*(.{6,})$/)
  const body = afterPersona ? afterPersona[2].trim() : flat
  if (body.length <= max) return body
  const head = body.slice(0, max)
  const end = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'), head.lastIndexOf('. '))
  if (end >= 8) return head.slice(0, end + 1)
  const soft = Math.max(head.lastIndexOf('，'), head.lastIndexOf('、'), head.lastIndexOf('；'), head.lastIndexOf(','))
  if (soft >= 12) return head.slice(0, soft)
  return `${head.trimEnd().slice(0, max - 1)}…`
}

/** 机械摘要：不调模型，只把缓冲区里确定的事实写成可读的一段。 */
export function renderSessionDraft(buffer, settings, now = new Date()) {  const messages = Array.isArray(buffer.messages) ? buffer.messages : []
  const firstUser = messages.find((item) => item.role === 'user')?.text || ''
  const lastAssistant = [...messages].reverse().find((item) => item.role === 'assistant')?.text || ''
  const tools = [...(buffer.tools?.keys?.() ?? [])].sort()
  const files = [...(buffer.files ?? [])].slice(0, 30)
  const created = new Date(buffer.startedAt || Date.now()).toISOString()
  const updated = new Date(buffer.updatedAt || now.getTime()).toISOString()
  const fallbackTitle = makeDraftTitle(firstUser)
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

export async function acceptInbox(settings, rel, { kind = 'notes', title, description, body } = {}) {
  const root = inboxRoot(settings)
  const file = resolveInboxPath(settings, rel)
  const text = await readInside({ memoryDir: root, maxFileBytes: 2_000_000 }, path.relative(root, file).replace(/\\/g, '/'))
  const parsed = parseFrontmatter(text)
  const finalTitle = String(title || parsed.attrs.title || '会话摘要').slice(0, 120)
  const finalDescription = String(description || `自动记录的会话摘要（${parsed.attrs.turns || 0} 轮）`).slice(0, 240)
  // 「改后接受」：body 传了就用改过的正文，否则用草稿原文。
  const content = String(body ?? parsed.body).trim()
  const memory = await writeNote(settings, {
    kind,
    memoryType: 'reference',
    title: finalTitle,
    description: finalDescription,
    content,
    tags: ['auto-capture', 'session'],
    device: settings.deviceName,
    agent: settings.agentName,
    source: `session:${parsed.attrs.sessionId || 'unknown'}`,
  })
  const memoryRel = path.relative(settings.memoryDir, memory).replace(/\\/g, '/')
  const archived = await moveToArchive(settings, file, 'accepted')
  const undoId = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
  await writeDecision(settings, {
    id: undoId,
    action: 'accept',
    at: new Date().toISOString(),
    draft: rel,
    memory: memoryRel,
    archivePath: archived,
    checksum: String(parseFrontmatter(await fs.readFile(memory, 'utf8')).attrs.checksum || ''),
    bodyHash: hashBody(content),
    edited: body !== undefined,
  })
  await maybeSummarize(settings)
  return { memory: memoryRel, accepted: rel, undoId }
}

export async function rejectInbox(settings, rel) {
  const file = resolveInboxPath(settings, rel)
  const archived = await moveToArchive(settings, file, 'rejected')
  const undoId = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
  await writeDecision(settings, {
    id: undoId,
    action: 'reject',
    at: new Date().toISOString(),
    draft: rel,
    memory: '',
    archivePath: archived,
    checksum: '',
    edited: false,
  })
  return { rejected: rel, undoId }
}

/**
 * 撤销一次「接受」或「忽略」：
 * - 接受 → 目标记忆**没被改过**才回退（否则拒绝，避免覆盖人工编辑）；草稿回到 sessions/；
 * - 忽略 → 草稿从 rejected/ 搬回 sessions/。
 */
export async function undoDecision(settings, id) {
  const file = decisionPath(settings, id)
  let record
  try {
    record = JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    throw new Error('找不到这条撤销记录（可能已撤销或已过期）')
  }
  if (record.action === 'accept') {
    if (!record.memory) throw new Error('记录里没有目标记忆，无法撤销')
    const abs = path.join(settings.memoryDir, record.memory)
    let currentBody = null
    try {
      currentBody = String(parseFrontmatter(await fs.readFile(abs, 'utf8')).body || '')
    } catch {
      throw new Error('目标记忆已不存在（可能被删除），无法撤销')
    }
    // 用正文哈希判断"接受后有没有人改过"：外部编辑器不重算 frontmatter checksum 也能发现。
    if (record.bodyHash && hashBody(currentBody) !== record.bodyHash) {
      throw new Error('这条记忆在接受之后被改过；撤销会覆盖人工编辑，已拒绝。请手动处理。')
    }
    await trashNote(settings, record.memory)
  }
  // 把归档的草稿搬回 sessions/
  if (record.archivePath) {
    const archived = path.join(inboxRoot(settings), record.archivePath)
    const draftFile = resolveInboxPath(settings, record.draft)
    await fs.mkdir(path.dirname(draftFile), { recursive: true })
    try {
      await fs.rename(archived, draftFile)
    } catch (error) {
      throw new Error(`草稿回滚失败：${error?.message || error}`)
    }
  }
  await fs.rm(file, { force: true })
  return { undone: record.action, draft: record.draft, memory: record.memory }
}

/** 批量：逐条执行，返回每条的结果，不因单条失败中断整批。 */
export async function batchInbox(settings, rels, { action = 'accept', kind = 'notes' } = {}) {
  const list = Array.isArray(rels) ? rels.filter((rel) => typeof rel === 'string').slice(0, 100) : []
  const done = []
  for (const rel of list) {
    try {
      const result = action === 'reject' ? await rejectInbox(settings, rel) : await acceptInbox(settings, rel, { kind })
      done.push({ rel, ok: true, ...result })
    } catch (error) {
      done.push({ rel, ok: false, error: String(error?.message || error) })
    }
  }
  return { action, total: list.length, ok: done.filter((item) => item.ok).length, items: done }
}

function decisionsDir(settings) {
  return path.join(inboxRoot(settings), 'decisions')
}

function decisionPath(settings, id) {
  const safe = String(id || '').replace(/[^A-Za-z0-9-]/g, '')
  if (!safe) throw new Error('id 非法')
  return path.join(decisionsDir(settings), `${safe}.json`)
}

async function writeDecision(settings, record) {
  const file = decisionPath(settings, record.id)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await writeFileAtomic(file, `${JSON.stringify(record, null, 2)}\n`)
  return file
}

function tokensOf(text) {
  const set = new Set()
  for (const part of String(text || '').toLowerCase().match(/[a-z0-9_]{2,}|[\u4e00-\u9fff]+/g) || []) {
    if (/^[a-z0-9_]+$/.test(part)) {
      if (part.length >= 3) set.add(part)
      continue
    }
    if (part.length === 1) continue
    // 中文按 bigram 切，和召回同口径：整串比不了，2 字窗口才比得了。
    for (let i = 0; i + 1 < part.length; i += 1) set.add(part.slice(i, i + 2))
  }
  return set
}

function hashBody(body) {
  return createHash('sha256').update(String(body || '').trim()).digest('hex').slice(0, 16)
}

/**
 * 给待确认条目算"证据强度"：与现有记忆的标题/描述有多少词重合。
 * 用来把"明显重复"的草稿排到前面，而不是一味按时间倒序。
 */
export function attachSupport(items, memories = []) {
  const corpus = memories.map((item) => ({
    path: String(item.path || ''),
    title: String(item.title || ''),
    tokens: tokensOf(`${item.title || ''} ${item.description || ''}`),
  }))
  return items.map((item) => {
    const mine = tokensOf(item.title)
    const related = []
    for (const doc of corpus) {
      if (!doc.tokens.size || !mine.size) continue
      let hits = 0
      for (const token of mine) if (doc.tokens.has(token)) hits += 1
      if (hits >= 2) related.push({ path: doc.path, title: doc.title, hits })
    }
    related.sort((a, b) => b.hits - a.hits)
    return { ...item, support: related.length, related: related.slice(0, 3) }
  })
}

/** 把草稿移进 accepted/ 或 rejected/，返回相对 inboxRoot 的路径（撤销时凭它找回）。 */
async function moveToArchive(settings, file, bucket) {
  const root = inboxRoot(settings)
  const dir = archiveDir(settings, bucket)
  await fs.mkdir(dir, { recursive: true })
  const name = `${stamp()}-${randomBytes(3).toString('hex')}-${path.basename(file)}`
  const dest = path.join(dir, name)
  await fs.rename(file, dest)
  return path.relative(root, dest).replace(/\\/g, '/')
}

/**
 * 一次性重算既有草稿的标题（旧草稿是按"前 30 字硬截"写进去的，会出现半截词）。
 * 只改 frontmatter 的 title，不动正文。
 */
export async function retitleDrafts(settings) {
  const dir = sessionDir(settings)
  let entries = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return { updated: 0 }
  }
  let updated = 0
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('.')) continue
    const file = path.join(dir, entry.name)
    let parsed
    try {
      parsed = parseFrontmatter(await fs.readFile(file, 'utf8'))
    } catch {
      continue
    }
    const body = String(parsed.body || '')
    const section = body.match(/##\s*用户诉求\s*\n+([\s\S]*?)(?=\n##\s|$)/)
    const next = makeDraftTitle(section ? section[1] : '')
    if (!next || next === String(parsed.attrs.title || '')) continue
    await writeFileAtomic(file, renderNote({ ...parsed.attrs, title: next }, body))
    updated += 1
  }
  return { updated }
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
