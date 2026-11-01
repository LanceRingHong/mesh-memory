import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  ensureLayout,
  writeNote,
  searchMemory,
  readMemory,
  appendJsonl,
  counts,
  publishNativeManifest,
  sessionsFile,
  writeFileAtomic,
  updateNote,
  trashNote,
  listTrash,
  restoreTrash,
  listConflicts,
  updateDevices,
  listDevices,
} from './store.js'
import { materializeAgents, previewAgents, previewSkills, syncSkills } from './agents.js'
import { resolveUploadPath } from './policy.js'
import { listInbox, readInbox, acceptInbox, rejectInbox } from './inbox.js'
import { flushAllSessions, flushCurrent } from './capture.js'
import { snapshot, listSnapshots, restoreSnapshot, scheduleSnapshot } from './backup.js'
import { doctor, duplicates, reflectBrief, onboardBlueprint, applyOnboarding } from './maintenance.js'
import { queryMemory, statusCounts, collectionCounts } from './query.js'
import { ensureProfile, writeProfile, ensureCollectionDirs } from './profile.js'
import { archiveNote, unarchiveNote } from './lifecycle.js'
import { contextFor, buildLinkGraph } from './links.js'
import { createTask, updateTask, listTasks, getTask, cancelTask, taskSummary } from './tasks.js'
import {
  asObject,
  listHosts,
  listWorkspaces,
  runOnHost,
  readSession,
  interruptSession,
  downloadFile,
  uploadFile,
  waitSessions,
  sendMessage,
  completionOf,
  transferOutcome,
} from './remote.js'

/**
 * 桌面 profile 能从 ~/.dsh/profiles/node_modules 解析到 dsh-tools；
 * DSH Go 的 web profile 只把 dsh-tools 放在实现 checkout（/opt/dsh/node_modules）。
 * 因此这里做一次带兜底的动态解析，避免在平板上静态 import 直接失败。
 */
async function loadDefineTool() {
  try {
    return (await import('@deepseek-ai/dsh-tools')).defineTool
  } catch (original) {
    const candidates = [
      process.env.DSH_TOOLS_PATH,
      '/opt/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
      '/opt/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.mjs',
    ].filter(Boolean)
    for (const candidate of candidates) {
      try {
        return (await import(pathToFileURL(candidate).href)).defineTool
      } catch {}
    }
    throw original
  }
}

const defineTool = await loadDefineTool()

/**
 * DSH 的参数 DSL 只支持 type/enum/const/required/default/title/examples/description，
 * 不支持 minimum/maximum —— 数值范围必须在 execute 里钳制（P2-10）。
 */
const SUPPORTED_KEYS = new Set(['enum', 'required', 'default', 'title', 'examples'])
function withExtras(base, extra) {
  const out = { ...base }
  for (const [key, value] of Object.entries(extra || {})) {
    if (SUPPORTED_KEYS.has(key)) out[key] = value
  }
  return out
}

const str = (description, extra = {}) => withExtras({ type: 'string', description }, extra)
const num = (description, extra = {}) => withExtras({ type: 'number', description }, extra)
const bool = (description, extra = {}) => withExtras({ type: 'boolean', description }, extra)

/** 所有 mesh 工具都返回文本（JSON 或 Markdown）。 */
const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : json(value) }],
}

function json(value) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function relOf(settings, file) {
  return path.relative(settings.memoryDir, file).replace(/\\/g, '/')
}

function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

export function registerTools(ctx, settings) {
  const disposers = []
  // 统一错误形状（P3）：任何工具抛错都变成 { ok:false, error, tool }，不再让调用方猜。
  const add = (definition) => {
    const run = definition.execute
    disposers.push(
      ctx.tools.register(
        defineTool({
          ...definition,
          output: TEXT_OUTPUT,
          async execute(args, exec) {
            try {
              return await run(args, exec)
            } catch (error) {
              return json({ ok: false, tool: definition.name, error: String(error?.message || error) })
            }
          },
        }),
      ),
    )
  }

  add({
    name: 'mesh_status',
    description: '查看 dsh-mesh 的共享记忆目录、设备名、条目计数，以及 Remote 工具是否可用。',
    parameters: {},
    async execute() {
      await ensureLayout(settings)
      const [c, devices, inbox] = await Promise.all([counts(settings), updateDevices(settings), listInbox(settings)])
      return json({
        device: settings.deviceName,
        deviceSlug: settings.deviceSlug,
        agent: settings.agentName,
        memoryDir: settings.memoryDir,
        dshHome: settings.dshHome,
        counts: { ...c, inbox: inbox.length },
        devices: devices.map((item) => item.name || item.deviceSlug),
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
        remoteTools: Boolean(ctx.tools.get('remote_list_hosts')),
        autoSyncAgents: settings.autoSyncAgents,
        syncSkills: settings.syncSkills,
        dashboardPort: settings.dashboardPort,
        dashboardUrl: `http://127.0.0.1:${settings.dashboardPort}/`,
        recall: {
          maxFiles: settings.maxRecallFiles,
          maxFileBytes: settings.maxRecallFileBytes,
          minScore: settings.recallMinScore,
        },
        allowedUploadRoots: settings.allowedUploadRoots,
      })
    },
  })

  add({
    name: 'mesh_memory_write',
    description: '向共享记忆写入一条事实/决策/项目笔记（Markdown，带 frontmatter）。只写 memoryDir 内部，不写原始会话日志。',
    parameters: {
      kind: str('目录分类：facts/decisions/projects/notes，或 profile 里声明的自定义 collection'),
      memoryType: str('语义类型', { enum: ['user', 'feedback', 'project', 'reference'] }),
      title: str('标题'),
      description: str('一句话描述（检索靠它，务必写准）'),
      content: str('正文（Markdown）', { required: true }),
      tags: { type: 'array', items: { type: 'string' }, description: '标签（可选）' },
      aliases: { type: 'array', items: { type: 'string' }, description: '别名/换一种说法（可选）' },
      baseline: { type: 'boolean', description: '是否每场会话开场注入（默认 false）' },
      baselinePriority: { type: 'number', description: 'baseline 排序，越大越前' },
      validAt: str('从何时成立（ISO 时间，可选）'),
      invalidAt: str('从何时失效（ISO 时间，可选）'),
      supersededBy: str('现行口径所在文件（可选）'),
    },
    async execute(args) {
      await ensureLayout(settings)
      const file = await writeNote(settings, {
        kind: args.kind,
        memoryType: args.memoryType,
        title: args.title,
        description: args.description,
        content: args.content,
        tags: args.tags || [],
        aliases: args.aliases || [],
        baseline: args.baseline === true,
        baselinePriority: args.baselinePriority,
        validAt: args.validAt,
        invalidAt: args.invalidAt,
        supersededBy: args.supersededBy,
        device: settings.deviceName,
        agent: settings.agentName,
        source: 'manual',
      })
      // 只返回相对路径：不把宿主绝对路径写进模型上下文（P0-1/P3）。
      scheduleSnapshot(settings, 'memory:write')
      return json({ ok: true, path: relOf(settings, file) })
    },
  })

  add({
    name: 'mesh_memory_search',
    description: '在共享的 AGENTS.shared.md、memory/ 和 sessions/ 摘要里做关键词检索，返回命中片段与相对路径。',
    parameters: {
      query: str('关键词，空格分隔多个词', { required: true }),
      limit: num('最多返回条数，默认 20（1-100）'),
    },
    async execute(args) {
      await ensureLayout(settings)
      const limit = clampInt(args.limit, 1, 100, settings.maxSearchResults)
      const results = await searchMemory(settings, args.query, limit)
      return json({ ok: true, count: results.length, results })
    },
  })

  add({
    name: 'mesh_memory_read',
    description: '读取共享记忆目录内的一个相对路径（Markdown/文本），用于查看检索命中的原文。',
    parameters: { path: str('相对 memoryDir 的路径，如 memory/facts/x.md', { required: true }) },
    async execute(args) {
      await ensureLayout(settings)
      const text = await readMemory(settings, args.path)
      return text.length > 20000 ? `${text.slice(0, 20000)}\n\n…（已截断）` : text
    },
  })

  add({
    name: 'mesh_memory_update',
    description: '就地更新一条记忆（保留 id/createdAt/device，写入 updatedAt）。只允许 memory/<kind>/<file>.md。',
    parameters: {
      path: str('相对 memoryDir 的路径，如 memory/facts/x.md', { required: true }),
      content: str('新正文（Markdown）；不传则保留原正文'),
      title: str('新标题'),
      description: str('新的一句话描述'),
      tags: { type: 'array', items: { type: 'string' }, description: '新标签（整体替换）' },
      aliases: { type: 'array', items: { type: 'string' }, description: '新别名（整体替换）' },
      baseline: { type: 'boolean', description: '是否每场开场注入' },
      baselinePriority: num('baseline 排序，越大越前'),
      validAt: str('从何时成立（ISO 时间）'),
      invalidAt: str('从何时失效（ISO 时间）'),
      supersededBy: str('现行口径所在文件'),
    },
    async execute(args) {
      await ensureLayout(settings)
      const patch = {}
      for (const key of [
        'content', 'title', 'description', 'tags', 'aliases', 'baseline',
        'baselinePriority', 'validAt', 'invalidAt', 'supersededBy',
      ]) {
        if (args[key] !== undefined) patch[key] = args[key]
      }
      const result = await updateNote(settings, args.path, patch)
      scheduleSnapshot(settings, 'memory:update')
      return json({ ok: true, ...result })
    },
  })

  add({
    name: 'mesh_memory_doctor',
    description: '只读体检：检查缺失 permalink/checksum、重复、冲突副本、失效时间、收件箱积压，返回带修复建议的清单。',
    parameters: {},
    async execute() {
      await ensureLayout(settings)
      return json(await doctor(settings))
    },
  })

  add({
    name: 'mesh_memory_duplicates',
    description: '查找重复记忆：正文 checksum 相同或标题归一化后相同，返回簇与建议（不自动删除）。',
    parameters: {},
    async execute() {
      await ensureLayout(settings)
      return json(await duplicates(settings))
    },
  })

  add({
    name: 'mesh_memory_reflect',
    description: '反思简报：列出上次反思（或 N 天）以来变化的记忆，供整理与折回。',
    parameters: {
      since: str('起始时间（ISO，可选）'),
      days: num('没有历史反思时回看的天数，默认 7'),
    },
    async execute(args) {
      await ensureLayout(settings)
      return json(await reflectBrief(settings, { since: args.since, days: args.days }))
    },
  })

  add({
    name: 'mesh_memory_onboard',
    description: '入门蓝图：按领域生成记忆结构建议；apply + confirm 时写一条蓝图笔记（不伪造用户偏好）。',
    parameters: {
      domains: { type: 'array', items: { type: 'string' }, description: '想跟踪的领域（建议 2-3 个）' },
      volume: str('使用强度：light / heavy'),
      project: str('项目名，默认 my-memory'),
      apply: bool('是否写一条蓝图笔记（默认 false）'),
      confirm: bool('apply 时必须为 true'),
    },
    async execute(args) {
      await ensureLayout(settings)
      const blueprint = onboardBlueprint({
        domains: args.domains || [],
        volume: args.volume || 'light',
        project: args.project || 'my-memory',
      })
      if (args.apply !== true) return json({ ok: true, mode: 'preview', blueprint })
      const result = await applyOnboarding(settings, blueprint, { confirm: args.confirm === true })
      scheduleSnapshot(settings, 'onboard:apply')
      return json({ ok: true, mode: 'apply', ...result })
    },
  })

  add({
    name: 'mesh_memory_query',
    description: '按 frontmatter 元数据过滤记忆（kind/memoryType/status/device/agent/tag/title/更新时间），不是全文检索。',
    parameters: {
      kind: str('目录分类 facts/decisions/projects/notes'),
      memoryType: str('语义类型 user/feedback/project/reference'),
      status: str('active/archived/superseded/draft'),
      device: str('设备名'),
      agent: str('agent 名'),
      tag: str('单个标签'),
      title: str('标题包含'),
      updatedAfter: str('ISO 时间下限'),
      updatedBefore: str('ISO 时间上限'),
      includeInvalid: bool('包含失效/归档（默认 false）'),
      limit: num('最多返回，默认 100'),
    },
    async execute(args) {
      await ensureLayout(settings)
      const filters = {}
      for (const key of ['kind', 'memoryType', 'status', 'device', 'agent', 'tag', 'title', 'updatedAfter', 'updatedBefore']) {
        if (args[key] !== undefined && args[key] !== '') filters[key] = args[key]
      }
      return json(await queryMemory(settings, filters, {
        limit: clampInt(args.limit, 1, 500, 100),
        includeInvalid: args.includeInvalid === true,
      }))
    },
  })

  add({
    name: 'mesh_memory_context',
    description: '围绕一条记忆或一个主题，沿 [[wikilink]] 取 1 跳上下文（种子 + 入链/出链），返回可读片段。',
    parameters: {
      path: str('种子文件相对路径（与 query 二选一）'),
      query: str('主题词，用搜索选种子（与 path 二选一）'),
      depth: num('1 或 2，默认 1'),
      limit: num('最多条目，默认 8'),
    },
    async execute(args) {
      await ensureLayout(settings)
      if (!args.path && !args.query) throw new Error('path 或 query 至少给一个')
      return json(await contextFor(settings, {
        path: args.path,
        query: args.query,
        depth: clampInt(args.depth, 1, 2, 1),
        limit: clampInt(args.limit, 1, 30, 8),
      }))
    },
  })

  add({
    name: 'mesh_memory_archive',
    description: '归档一条记忆（status=archived，不再参与搜索/召回；文件保留，可 unarchive）。',
    parameters: {
      path: str('相对 memoryDir 的路径', { required: true }),
      confirm: bool('必须为 true：归档会把它移出搜索/召回'),
    },
    async execute(args) {
      if (args.confirm !== true) throw new Error('归档需要 confirm:true')
      await ensureLayout(settings)
      const result = await archiveNote(settings, args.path, { confirm: true })
      scheduleSnapshot(settings, 'memory:archive')
      return json({ ok: true, ...result })
    },
  })

  add({
    name: 'mesh_memory_unarchive',
    description: '恢复一条归档记忆（status=active，清掉归档时写入的 invalidAt）。',
    parameters: { path: str('相对 memoryDir 的路径', { required: true }) },
    async execute(args) {
      await ensureLayout(settings)
      const result = await unarchiveNote(settings, args.path)
      scheduleSnapshot(settings, 'memory:unarchive')
      return json({ ok: true, ...result })
    },
  })

  add({
    name: 'mesh_memory_delete',
    description: '把一条记忆移入 .trash/（软删除，可恢复）。必须显式 confirm:true。',
    parameters: {
      path: str('相对 memoryDir 的路径', { required: true }),
      confirm: bool('必须为 true：表示确认移入回收站（不物理删除）'),
    },
    async execute(args) {
      if (args.confirm !== true) throw new Error('删除需要 confirm:true（这是软删除，文件会进 .trash/）')
      await ensureLayout(settings)
      const result = await trashNote(settings, args.path)
      scheduleSnapshot(settings, 'memory:delete')
      return json({ ok: true, ...result, hint: '已移入回收站，可用 mesh_memory_restore 恢复。' })
    },
  })

  add({
    name: 'mesh_memory_trash',
    description: '列出回收站（.trash/）里的记忆，用于恢复或确认删除范围。',
    parameters: {},
    async execute() {
      await ensureLayout(settings)
      const items = await listTrash(settings)
      return json({ ok: true, count: items.length, items })
    },
  })

  add({
    name: 'mesh_memory_restore',
    description: '把回收站里的文件恢复到原路径；目标已存在时拒绝覆盖。',
    parameters: { path: str('.trash/ 下的相对路径（来自 mesh_memory_trash）', { required: true }) },
    async execute(args) {
      await ensureLayout(settings)
      const result = await restoreTrash(settings, args.path)
      scheduleSnapshot(settings, 'memory:restore')
      return json({ ok: true, ...result })
    },
  })

  add({
    name: 'mesh_memory_inbox',
    description:
      '自动记录的会话摘要收件箱（本机，未确认前不进入正式记忆）。action=list 查看、read 读原文、accept 转正、reject 忽略、flush 立即整理当前缓冲。',
    parameters: {
      action: str('操作', { enum: ['list', 'read', 'accept', 'reject', 'flush'], required: true }),
      path: str('草稿相对路径（read/accept/reject 用，来自 list 的 path）'),
      kind: str('accept 时的目录分类', { enum: ['notes', 'facts', 'decisions', 'projects'] }),
      title: str('accept 时的标题（默认用草稿标题）'),
    },
    async execute(args, exec) {
      await ensureLayout(settings)
      const action = String(args.action || 'list')
      if (action === 'flush') {
        const flushed = await flushAllSessions(settings, 'manual')
        // 本 turn 的事件尚未提交时，从当前会话历史补全一份。
        const current = exec?.agent?.session
        if (current?.id && !flushed.some((item) => item.sessionId === current.id)) {
          flushed.push(...(await flushCurrent(settings, current, 'manual')))
        }
        return json({ ok: true, flushed: flushed.length, items: flushed })
      }
      if (action === 'list') {
        const items = await listInbox(settings)
        return json({
          ok: true,
          count: items.length,
          items,
          hint: items.length
            ? '用 read 看内容，accept 转成正式记忆（默认 notes），reject 忽略。'
            : '暂无待确认的自动记录。会话结束或空闲后会自动出现。',
        })
      }
      if (!args.path) throw new Error(`${action} 需要 path`)
      if (action === 'read') {
        const text = await readInbox(settings, args.path)
        return json({ ok: true, path: args.path, text })
      }
      if (action === 'accept') {
        const result = await acceptInbox(settings, args.path, {
          kind: args.kind || 'notes',
          title: args.title,
        })
        scheduleSnapshot(settings, 'inbox:accept')
        return json({ ok: true, ...result })
      }
      if (action === 'reject') {
        const result = await rejectInbox(settings, args.path)
        scheduleSnapshot(settings, 'inbox:reject')
        return json({ ok: true, ...result })
      }
      throw new Error(`未知 action：${action}`)
    },
  })

  add({
    name: 'mesh_memory_backup',
    description: '共享记忆目录的本机 git 快照：snapshot 立刻快照、list 看历史、restore 还原到某个提交（需 confirm）。',
    parameters: {
      action: str('操作', { enum: ['snapshot', 'list', 'restore'], required: true }),
      commit: str('restore 用的提交号（来自 list）'),
      confirm: bool('restore 时必须为 true'),
      limit: num('list 返回条数，默认 20'),
    },
    async execute(args) {
      const action = String(args.action || 'snapshot')
      if (action === 'snapshot') {
        const result = await snapshot(settings, 'manual')
        return json({ ok: true, ...result })
      }
      if (action === 'list') {
        const items = await listSnapshots(settings, args.limit)
        return json({ ok: true, count: items.length, items, dir: 'dsh-mesh-backups.git（$DSH_HOME 下，不同步）' })
      }
      if (action === 'restore') {
        const result = await restoreSnapshot(settings, args.commit, { confirm: args.confirm === true })
        return json({ ok: true, ...result })
      }
      throw new Error(`未知 action：${action}`)
    },
  })

  add({
    name: 'mesh_conflicts',
    description: '列出共享目录里的 Syncthing 冲突副本（.sync-conflict-*），用于人工裁决。',
    parameters: {},
    async execute() {
      await ensureLayout(settings)
      const items = await listConflicts(settings)
      return json({
        ok: true,
        count: items.length,
        items,
        hint: items.length
          ? '冲突文件不会进入自动召回；用 mesh_memory_read 查看内容后再决定保留哪个（可用 mesh_memory_update/mesh_memory_delete 处理）。'
          : '没有冲突副本。',
      })
    },
  })

  add({
    name: 'mesh_memory_sync',
    description:
      '把 AGENTS.shared.md 物化到本机设备级 AGENTS.md，并可把共享 skills 复制到本机技能目录。默认只预览（返回 diff），确认后才写入。',
    parameters: {
      mode: str('preview = 只读预览（默认）；apply = 应用', { enum: ['preview', 'apply'] }),
      confirm: bool('apply 时必须显式传 true（表示用户已看过 diff 并同意）'),
      expectedSha256: str('apply 时必填：预览返回的 agents.sourceSha256，防止预览后源文件已变化'),
      force: bool('覆盖已存在的同名 skill（默认 false）'),
    },
    async execute(args) {
      await ensureLayout(settings)
      const agents = await previewAgents(settings)
      const skills = await previewSkills(settings)

      if (args.mode !== 'apply') {
        return json({
          ok: true,
          mode: 'preview',
          agents,
          skills,
          next:
            '把 agents.diff 与 skills.copy 展示给用户；得到明确同意后，用 mode:"apply"、confirm:true、' +
            'expectedSha256=<agents.sourceSha256> 再调用（需要覆盖同名 skill 时再加 force:true）。',
        })
      }
      // P1-2：应用是“指令类”改动，必须有确认与预览哈希，不能盲写。
      if (args.confirm !== true) throw new Error('apply 需要 confirm:true：先把 diff 给用户看，得到同意后再应用')
      if (!args.expectedSha256) throw new Error('apply 需要 expectedSha256（取自预览返回的 agents.sourceSha256）')

      const applied = await materializeAgents(settings, { expectedSha256: args.expectedSha256 })
      let skillsApplied = null
      if (args.force === true || settings.syncSkills) {
        skillsApplied = await syncSkills(settings, { force: args.force === true })
      }
      scheduleSnapshot(settings, 'sync:apply')
      return json({ ok: true, mode: 'apply', agents: applied, skills: skillsApplied })
    },
  })

  add({
    name: 'mesh_digest',
    description: '把一段会话摘要写入共享 sessions/<device>/ 并登记索引。摘要由你（Agent）根据会话内容生成，不读取原始 zstd 日志。',
    parameters: {
      sessionId: str('本机会话 id（只允许字母/数字/点/下划线/短横线）', { required: true }),
      title: str('标题'),
      summary: str('摘要正文（用户诉求、结论、涉及文件、待办）', { required: true }),
      tags: { type: 'array', items: { type: 'string' }, description: '标签（可选）' },
    },
    async execute(args) {
      await ensureLayout(settings)
      const sessionId = String(args.sessionId || '').trim()
      // 白名单 + safeRel：sessionId 来自模型参数，绝不能直接拼路径（P0-1）。
      const file = sessionsFile(settings, sessionId)
      const sessions = ctx.get('sessions')
      let header = null
      try {
        header = sessions?.get?.(sessionId)?.header ?? null
      } catch {}
      const title = String(args.title || header?.title || '').trim() || sessionId
      const body = [
        '---',
        `sessionId: ${JSON.stringify(sessionId)}`,
        `device: ${JSON.stringify(settings.deviceName)}`,
        `agent: ${JSON.stringify(settings.agentName)}`,
        `title: ${JSON.stringify(title)}`,
        `updatedAt: ${new Date().toISOString()}`,
        `cwd: ${JSON.stringify(header?.cwd || '')}`,
        `tags: ${JSON.stringify(args.tags || [])}`,
        '---',
        '',
        String(args.summary || '').trim() || '（未提供摘要）',
        '',
      ].join('\n')
      await writeFileAtomic(file, body)
      await appendJsonl(settings, path.join('sessions', `${settings.deviceSlug}.jsonl`), {
        device: settings.deviceName,
        deviceSlug: settings.deviceSlug,
        sessionId,
        title,
        cwd: header?.cwd || '',
        updatedAt: new Date().toISOString(),
        path: relOf(settings, file),
        tags: args.tags || [],
      })
      await publishNativeManifest(settings).catch(() => {})
      scheduleSnapshot(settings, 'memory:digest')
      return json({ ok: true, path: relOf(settings, file) })
    },
  })

  add({
    name: 'mesh_task_create',
    description: '创建一个跨设备任务记录（只登记，不执行）。任务文件在共享目录 tasks/<device>/ 下，其他设备可见。',
    parameters: {
      title: str('任务标题（默认取 prompt 前 200 字）'),
      prompt: str('要执行的任务文本', { required: true }),
      hostId: str('目标 Host id（可选，先登记后执行）'),
      workspaceId: str('目标工作区 id（可选）'),
      workspacePath: str('目标工作区路径/标题（可选）'),
    },
    async execute(args) {
      await ensureLayout(settings)
      const task = await createTask(settings, {
        title: args.title || args.prompt,
        prompt: args.prompt,
        hostId: args.hostId,
        workspaceId: args.workspaceId,
        workspacePath: args.workspacePath,
      })
      return json({ ok: true, task })
    },
  })

  add({
    name: 'mesh_task_run',
    description: '创建任务并委托执行：登记 → 调 mesh_run → 把状态/结果写回任务。running 不等于成功。',
    parameters: {
      hostId: str('目标 Host id', { required: true }),
      task: str('要委托的任务文本', { required: true }),
      title: str('任务标题（可选）'),
      workspaceId: str('目标工作区 id（可选）'),
      workspacePath: str('目标工作区路径/标题（可选）'),
      waitMs: num('等待毫秒，默认 30000（1000-60000）'),
      readMessages: num('读回消息条数，默认 20（1-50）'),
    },
    async execute(args, exec) {
      await ensureLayout(settings)
      const record = await createTask(settings, {
        title: args.title || args.task,
        prompt: args.task,
        hostId: args.hostId,
        workspaceId: args.workspaceId,
        workspacePath: args.workspacePath,
      })
      await updateTask(settings, record.id, { status: 'running' })
      try {
        const result = await runOnHost(ctx, exec, {
          hostId: args.hostId,
          workspaceId: args.workspaceId,
          workspacePath: args.workspacePath,
          task: args.task,
          waitMs: clampInt(args.waitMs, 1000, 60000, 30000),
          readMessages: clampInt(args.readMessages, 1, 50, 20),
        })
        const completion = completionOf(result.status)
        const status = completion.finished ? (completion.failed ? 'failed' : 'done') : 'running'
        const task = await updateTask(settings, record.id, {
          status,
          sessionId: result.sessionId || '',
          workspaceId: result.workspaceId || '',
          result: {
            ok: result.ok === true,
            finished: result.finished === true,
            remoteStatus: result.status || '',
            text: String(result.text || '').slice(0, 2000),
          },
          error: completion.failed ? String(result.text || '').slice(0, 500) : null,
        })
        return json({ ok: completion.finished && !completion.failed, task, result })
      } catch (error) {
        await updateTask(settings, record.id, { status: 'failed', error: String(error?.message || error) }).catch(() => {})
        throw error
      }
    },
  })

  add({
    name: 'mesh_task_list',
    description: '列出任务（可按 status / hostId 过滤），按创建时间倒序。',
    parameters: {
      status: str('queued/running/done/failed/cancelled'),
      hostId: str('按目标 Host 过滤'),
      limit: num('最多返回，默认 50'),
    },
    async execute(args) {
      await ensureLayout(settings)
      return json(await listTasks(settings, {
        status: args.status,
        hostId: args.hostId,
        limit: clampInt(args.limit, 1, 200, 50),
      }))
    },
  })

  add({
    name: 'mesh_task_get',
    description: '读取一个任务的状态、结果与会话 id。',
    parameters: { id: str('任务 id', { required: true }) },
    async execute(args) {
      const task = await getTask(settings, args.id)
      if (!task) throw new Error(`找不到任务：${args.id}`)
      return json({ ok: true, task })
    },
  })

  add({
    name: 'mesh_task_cancel',
    description: '取消任务记录；如果任务已有远端会话，会尝试中断它（不保证远端一定停）。',
    parameters: { id: str('任务 id', { required: true }) },
    async execute(args, exec) {
      const task = await getTask(settings, args.id)
      if (!task) throw new Error(`找不到任务：${args.id}`)
      let interrupted = false
      if (task.hostId && task.workspaceId && task.sessionId) {
        try {
          await interruptSession(ctx, exec, { hostId: task.hostId, workspaceId: task.workspaceId, sessionId: task.sessionId })
          interrupted = true
        } catch {}
      }
      const updated = await cancelTask(settings, args.id)
      return json({ ok: true, interrupted, task: updated })
    },
  })

  add({
    name: 'mesh_profile',
    description: '读取/更新仓库结构 profile（collections / groups / 配色）；记忆界面按它渲染。',
    parameters: {
      action: str('get（默认）或 set'),
      json: str('set 时的完整 profile JSON 字符串'),
      confirm: bool('set 必须为 true'),
    },
    async execute(args) {
      await ensureLayout(settings)
      if (String(args.action || 'get') === 'get') {
        return json({ ok: true, profile: await ensureProfile(settings) })
      }
      if (args.confirm !== true) throw new Error('更新 profile 需要 confirm:true')
      let parsed
      try {
        parsed = typeof args.json === 'string' ? JSON.parse(args.json) : args.json
      } catch (error) {
        throw new Error(`json 解析失败：${error?.message || error}`)
      }
      const profile = await writeProfile(settings, parsed)
      await ensureCollectionDirs(settings, profile)
      return json({ ok: true, profile })
    },
  })

  add({
    name: 'mesh_topology',
    description: '给界面用的拓扑快照：设备、计数、状态分布、任务、wikilink 图规模、收件箱。',
    parameters: {},
    async execute() {
      await ensureLayout(settings)
      const [devices, c, statuses, tasks, graph, inbox, collections] = await Promise.all([
        listDevices(settings),
        counts(settings),
        statusCounts(settings),
        taskSummary(settings),
        buildLinkGraph(settings),
        listInbox(settings),
        collectionCounts(settings),
      ])
      return json({
        ok: true,
        generatedAt: new Date().toISOString(),
        local: { device: settings.deviceName, deviceSlug: settings.deviceSlug, agent: settings.agentName, memoryDir: settings.memoryDir },
        counts: { ...c, inbox: inbox.length },
        collections,
        statuses,
        tasks,
        graph: { nodes: graph.nodes.length, edges: graph.edges.length, broken: graph.broken.length },
        devices: devices.map((item) => ({
          name: item.name,
          deviceSlug: item.deviceSlug,
          platform: item.platform || '',
          hostId: item.hostId || '',
          role: item.role || '',
          aliases: item.aliases || [],
          lastSeen: item.lastSeen || '',
        })),
      })
    },
  })

  add({
    name: 'mesh_peers',
    description: '列出当前 Remote 账号下在线的其他设备（Host）。失败时返回登录/插件检查提示。',
    parameters: {},
    async execute(args, exec) {
      try {
        const raw = await listHosts(ctx, exec)
        return json({ ok: true, ...asObject(raw) })
      } catch (error) {
        return json({
          ok: false,
          error: String(error?.message || error),
          hint: '确认 ds-harness-remote 已安装并登录，Remote Tools 已开启；也可以让 Agent 直接调用 remote_list_hosts。',
        })
      }
    },
  })

  add({
    name: 'mesh_workspaces',
    description: '列出某台 Remote Host 的工作区（后台 harness），用于选择委托目标。',
    parameters: { hostId: str('remote_list_hosts / mesh_peers 返回的 hostId', { required: true }) },
    async execute(args, exec) {
      await ensureLayout(settings)
      const raw = await listWorkspaces(ctx, exec, args.hostId)
      return json({ ok: true, ...asObject(raw) })
    },
  })

  add({
    name: 'mesh_run',
    description:
      '在一台 Remote Host 的 harness 工作区里新建会话、发送任务、等待并读回结果。用于把任务委托给其他设备的 DSH；目标端按自己的权限执行。',
    parameters: {
      hostId: str('目标 Host id', { required: true }),
      task: str('要委托的任务文本', { required: true }),
      workspaceId: str('目标工作区 id（可选；不填则选第一个 harness 工作区）'),
      workspacePath: str('按工作区路径/标题选择（可选，如 /sdcard）'),
      waitMs: num('等待结果的毫秒数，默认 30000（1000-60000）'),
      readMessages: num('读回的消息条数，默认 20（1-50）'),
      operationId: str('调用方提供的幂等键（可选）：同一键重试不会重复建会话/发消息'),
    },
    async execute(args, exec) {
      await ensureLayout(settings)
      const result = await runOnHost(ctx, exec, {
        hostId: args.hostId,
        workspaceId: args.workspaceId,
        workspacePath: args.workspacePath,
        task: args.task,
        waitMs: clampInt(args.waitMs, 1000, 60000, 30000),
        readMessages: clampInt(args.readMessages, 1, 50, 20),
        operationId: args.operationId,
      })
      const completion = completionOf(result.status)
      const hints = []
      if (completion.finished && !completion.failed) hints.push('目标会话已完成。')
      if (completion.failed) hints.push('目标会话以失败状态结束，用 mesh_read 查看详情。')
      if (!completion.finished && completion.waitingFor === 'approval') {
        hints.push('目标端有待审批操作：需要在目标设备上确认，或用 mesh_interrupt 取消；确认后用 mesh_wait 继续。')
      } else if (!completion.finished) {
        hints.push('目标仍在运行：用 mesh_wait 等待，或 mesh_read 读取当前进度。')
      }
      if (result.workspaceFallback) {
        const candidates = (result.workspaceCandidates || [])
          .map((item) => `${item.title || '未命名'}${item.path ? ` @ ${item.path}` : ''}`)
          .join('；')
        hints.push(`没有指定工作区，已回退到第一个（可能不是你要的）。候选：${candidates}。建议显式传 workspaceId 或 workspacePath。`)
      }
      // P1-4：只有明确完成才算 ok；running/accepted 不等于成功。
      return json({
        ok: completion.finished && !completion.failed,
        finished: completion.finished,
        ...result,
        ...(hints.length ? { hint: hints.join(' ') } : {}),
      })
    },
  })

  add({
    name: 'mesh_wait',
    description: '等待某台 Remote Host 上的会话进入完成/审批状态，并返回最新摘要。用于 mesh_run 还在运行时的续等。',
    parameters: {
      hostId: str('目标 Host id', { required: true }),
      workspaceId: str('工作区 id', { required: true }),
      sessionId: str('会话 id', { required: true }),
      timeoutMs: num('等待毫秒数，默认 30000（0-60000；0 表示只看当前状态）'),
      readMessages: num('读回的消息条数，默认 20（1-50）'),
    },
    async execute(args, exec) {
      await ensureLayout(settings)
      await waitSessions(ctx, exec, {
        hostId: args.hostId,
        workspaceId: args.workspaceId,
        sessionId: args.sessionId,
        timeoutMs: clampInt(args.timeoutMs, 0, 60000, 30000),
      })
      const result = await readSession(ctx, exec, {
        hostId: args.hostId,
        workspaceId: args.workspaceId,
        sessionId: args.sessionId,
        maxMessages: clampInt(args.readMessages, 1, 50, 20),
      })
      const completion = completionOf(result.status)
      return json({
        ok: completion.finished && !completion.failed,
        ...result,
        finished: completion.finished,
        ...(completion.waitingFor ? { waitingFor: completion.waitingFor } : {}),
        ...(completion.failed ? { hint: '目标会话失败，用 mesh_read 查看详情。' } : {}),
      })
    },
  })

  add({
    name: 'mesh_send',
    description: '向某台 Remote Host 上已存在的会话追加一条消息（同一 operationId 重试是幂等的）。',
    parameters: {
      hostId: str('目标 Host id', { required: true }),
      workspaceId: str('工作区 id', { required: true }),
      sessionId: str('会话 id', { required: true }),
      message: str('要发送的消息', { required: true }),
      operationId: str('幂等键（可选）：重试时传同一个值，避免重复投递'),
    },
    async execute(args, exec) {
      await ensureLayout(settings)
      const result = await sendMessage(ctx, exec, {
        hostId: args.hostId,
        workspaceId: args.workspaceId,
        sessionId: args.sessionId,
        message: args.message,
        operationId: args.operationId,
      })
      return json({ ok: true, ...result })
    },
  })

  add({
    name: 'mesh_read',
    description: '读取某台 Remote Host 上一个 harness 会话的有界历史（分页由 Remote 处理）。',
    parameters: {
      hostId: str('目标 Host id', { required: true }),
      workspaceId: str('工作区 id', { required: true }),
      sessionId: str('会话 id', { required: true }),
      maxMessages: num('最多消息数，默认 20（1-50）'),
      beforeSeq: num('只读取该序号之前的历史（可选，用于分页）'),
      throughSeq: num('读到该序号为止（可选，用于分页）'),
    },
    async execute(args, exec) {
      await ensureLayout(settings)
      const cursor =
        Number.isFinite(Number(args.beforeSeq)) || Number.isFinite(Number(args.throughSeq))
          ? {
              ...(Number.isFinite(Number(args.beforeSeq)) ? { beforeSeq: Number(args.beforeSeq) } : {}),
              ...(Number.isFinite(Number(args.throughSeq)) ? { throughSeq: Number(args.throughSeq) } : {}),
            }
          : undefined
      const result = await readSession(ctx, exec, {
        hostId: args.hostId,
        workspaceId: args.workspaceId,
        sessionId: args.sessionId,
        maxMessages: clampInt(args.maxMessages, 1, 50, 20),
        cursor,
      })
      return json({ ok: true, ...result })
    },
  })

  add({
    name: 'mesh_interrupt',
    description: '请求中断某台 Remote Host 上一个会话的当前执行（不撤销已做的修改，不删除排队的消息）。',
    parameters: {
      hostId: str('目标 Host id', { required: true }),
      workspaceId: str('工作区 id', { required: true }),
      sessionId: str('会话 id', { required: true }),
    },
    async execute(args, exec) {
      const result = await interruptSession(ctx, exec, {
        hostId: args.hostId,
        workspaceId: args.workspaceId,
        sessionId: args.sessionId,
      })
      return json({ ok: true, ...result })
    },
  })

  add({
    name: 'mesh_fetch_file',
    description: '从某台 Remote Host 的会话工作区下载一个文件到本机 Downloads（受 Remote 50 MiB 限制）。',
    parameters: {
      hostId: str('目标 Host id', { required: true }),
      workspaceId: str('工作区 id', { required: true }),
      sessionId: str('会话 id', { required: true }),
      path: str('工作区相对路径', { required: true }),
    },
    async execute(args, exec) {
      try {
        const result = await downloadFile(ctx, exec, {
          hostId: args.hostId,
          workspaceId: args.workspaceId,
          sessionId: args.sessionId,
          path: args.path,
        })
        const outcome = transferOutcome(result)
        if (!outcome.ok) {
          return json({
            ok: false,
            reason: outcome.reason,
            ...result,
            hint: '下载回执里没有落盘信息（accepted/pending/timeout 不等于成功）。可重试或改用 /root/workspace。',
          })
        }
        return json({ ok: true, ...result })
      } catch (error) {
        return json({
          ok: false,
          error: String(error?.message || error),
          hint: 'Android 上 /sdcard 工作区可能不支持 Remote 上传/下载；改用 /root/workspace，或让目标端 Agent 直接操作 /sdcard。',
        })
      }
    },
  })

  add({
    name: 'mesh_send_file',
    description:
      '把一个本机文件上传到某台 Remote Host 的会话工作区根目录（中继 ≤20 MiB，P2P ≤1 GiB，不覆盖同名文件）。只允许上传配置目录内的文件。',
    parameters: {
      hostId: str('目标 Host id', { required: true }),
      workspaceId: str('工作区 id', { required: true }),
      sessionId: str('会话 id', { required: true }),
      localPath: str('本机绝对路径（必须在 allowedUploadRoots 内）', { required: true }),
      name: str('目标文件名（可选）'),
    },
    async execute(args, exec) {
      try {
        // 白名单 + 敏感文件拒绝 + realpath 校验，再交给 Remote（P0-3）。
        const resolved = await resolveUploadPath(settings, args.localPath)
        const result = await uploadFile(ctx, exec, {
          hostId: args.hostId,
          workspaceId: args.workspaceId,
          sessionId: args.sessionId,
          localPath: resolved.path,
          name: args.name,
        })
        const outcome = transferOutcome(result)
        if (!outcome.ok) {
          return json({
            ok: false,
            reason: outcome.reason,
            ...result,
            hint: '上传回执里没有落盘信息（accepted/pending/timeout 不等于成功）。Android 上 /sdcard 工作区常见；改用 /root/workspace 重试。',
          })
        }
        return json({ ok: true, local: { path: resolved.path, size: resolved.size }, ...result })
      } catch (error) {
        return json({
          ok: false,
          error: String(error?.message || error),
          hint: '上传只允许配置的目录（默认：共享记忆目录与 Downloads）。若确需其他目录，请让用户在插件配置 allowedUploadRoots 中显式添加；Android 上 /sdcard 工作区可能不支持上传，改用 /root/workspace。',
        })
      }
    },
  })

  return disposers
}
