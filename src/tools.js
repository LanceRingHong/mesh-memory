import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ensureLayout, writeNote, searchMemory, readMemory, appendJsonl, counts, publishNativeManifest } from './store.js'
import { materializeAgents, syncSkills } from './agents.js'
import { asObject, listHosts, listWorkspaces, runOnHost, readSession, interruptSession, downloadFile, uploadFile } from './remote.js'

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

const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const num = (description, _extra = {}) => ({ type: 'number', description })
const bool = (description) => ({ type: 'boolean', description })

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

export function registerTools(ctx, settings) {
  const disposers = []
  const add = (definition) => disposers.push(ctx.tools.register(defineTool({ output: TEXT_OUTPUT, ...definition })))

  add({
    name: 'mesh_status',
    description: '查看 dsh-mesh 的共享记忆目录、设备名、条目计数，以及 Remote 工具是否可用。',
    parameters: {},
    async execute() {
      await ensureLayout(settings)
      const c = await counts(settings)
      return json({
        device: settings.deviceName,
        deviceSlug: settings.deviceSlug,
        memoryDir: settings.memoryDir,
        dshHome: settings.dshHome,
        counts: c,
        remoteTools: Boolean(ctx.tools.get('remote_list_hosts')),
        autoSyncAgents: settings.autoSyncAgents,
        syncSkills: settings.syncSkills,
        dashboardPort: settings.dashboardPort,
        dashboardUrl: `http://127.0.0.1:${settings.dashboardPort}/`,
      })
    },
  })

  add({
    name: 'mesh_memory_write',
    description: '向共享记忆写入一条事实/决策/项目笔记（Markdown，带 frontmatter）。只写 memoryDir 内部，不写原始会话日志。',
    parameters: {
      kind: str('目录分类', { enum: ['facts', 'decisions', 'projects', 'notes'] }),
      memoryType: str('语义类型', { enum: ['user', 'feedback', 'project', 'reference'] }),
      title: str('标题'),
      description: str('一句话描述（检索靠它，务必写准）'),
      content: str('正文（Markdown）'),
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
      })
      return json({ ok: true, path: path.relative(settings.memoryDir, file).replace(/\\/g, '/'), file })
    },
  })

  add({
    name: 'mesh_memory_search',
    description: '在共享的 AGENTS.shared.md、memory/ 和 sessions/ 摘要里做关键词检索，返回命中片段与相对路径。',
    parameters: {
      query: str('关键词，空格分隔多个词'),
      limit: num('最多返回条数，默认 20', { minimum: 1, maximum: 100 }),
    },
    async execute(args) {
      await ensureLayout(settings)
      const results = await searchMemory(settings, args.query, args.limit)
      return json({ ok: true, count: results.length, results })
    },
  })

  add({
    name: 'mesh_memory_read',
    description: '读取共享记忆目录内的一个相对路径（Markdown/文本），用于查看检索命中的原文。',
    parameters: { path: str('相对 memoryDir 的路径，如 memory/facts/x.md') },
    async execute(args) {
      await ensureLayout(settings)
      const text = await readMemory(settings, args.path)
      return text.length > 20000 ? `${text.slice(0, 20000)}\n\n…（已截断）` : text
    },
  })

  add({
    name: 'mesh_memory_sync',
    description: '把 AGENTS.shared.md 物化到本机设备级 AGENTS.md（带备份），并可把共享 skills 复制到本机技能目录。',
    parameters: { force: bool('覆盖已存在的同名 skill（默认 false）') },
    async execute(args) {
      await ensureLayout(settings)
      const agents = await materializeAgents(settings)
      let skills = null
      if (args.force === true || settings.syncSkills) {
        skills = await syncSkills(settings, { force: args.force === true })
      }
      return json({ ok: true, agents, skills })
    },
  })

  add({
    name: 'mesh_digest',
    description: '把一段会话摘要写入共享 sessions/<device>/ 并登记索引。摘要由你（Agent）根据会话内容生成，不读取原始 zstd 日志。',
    parameters: {
      sessionId: str('本机会话 id'),
      title: str('标题'),
      summary: str('摘要正文（用户诉求、结论、涉及文件、待办）'),
      tags: { type: 'array', items: { type: 'string' }, description: '标签（可选）' },
    },
    async execute(args) {
      await ensureLayout(settings)
      const sessionId = String(args.sessionId || '').trim()
      if (!sessionId) throw new Error('sessionId 不能为空')
      const sessions = ctx.get('sessions')
      let header = null
      try {
        header = sessions?.get?.(sessionId)?.header ?? null
      } catch {}
      const dir = path.join(settings.memoryDir, 'sessions', settings.deviceSlug)
      const { mkdir, writeFile } = await import('node:fs/promises')
      await mkdir(dir, { recursive: true })
      const title = String(args.title || header?.title || '').trim() || sessionId
      const body = [
        '---',
        `sessionId: ${JSON.stringify(sessionId)}`,
        `device: ${JSON.stringify(settings.deviceName)}`,
        `title: ${JSON.stringify(title)}`,
        `updatedAt: ${new Date().toISOString()}`,
        `cwd: ${JSON.stringify(header?.cwd || '')}`,
        `tags: ${JSON.stringify(args.tags || [])}`,
        '---',
        '',
        String(args.summary || '').trim() || '（未提供摘要）',
        '',
      ].join('\n')
      const file = path.join(dir, `${sessionId}.md`)
      await writeFile(file, body, 'utf8')
      await appendJsonl(settings, 'sessions.jsonl', {
        device: settings.deviceName,
        deviceSlug: settings.deviceSlug,
        sessionId,
        title,
        cwd: header?.cwd || '',
        updatedAt: new Date().toISOString(),
        path: path.relative(settings.memoryDir, file).replace(/\\/g, '/'),
        tags: args.tags || [],
      })
      await publishNativeManifest(settings).catch(() => {})
      return json({ ok: true, path: path.relative(settings.memoryDir, file).replace(/\\/g, '/'), file })
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
    parameters: { hostId: str('remote_list_hosts / mesh_peers 返回的 hostId') },
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
      hostId: str('目标 Host id'),
      task: str('要委托的任务文本'),
      workspaceId: str('目标工作区 id（可选；不填则选第一个 harness 工作区）'),
      workspacePath: str('按工作区路径/标题选择（可选，如 /sdcard）'),
      waitMs: num('等待结果的毫秒数，默认 30000', { minimum: 1000, maximum: 60000 }),
      readMessages: num('读回的消息条数，默认 20', { minimum: 1, maximum: 50 }),
    },
    async execute(args, exec) {
      await ensureLayout(settings)
      const result = await runOnHost(ctx, exec, {
        hostId: args.hostId,
        workspaceId: args.workspaceId,
        workspacePath: args.workspacePath,
        task: args.task,
        waitMs: args.waitMs,
        readMessages: args.readMessages,
      })
      const hint =
        result.status === 'needs_user_input'
          ? '目标端有待审批操作：需要在目标设备上确认，或用 mesh_interrupt 取消。'
          : undefined
      return json({ ok: true, ...result, ...(hint ? { hint } : {}) })
    },
  })

  add({
    name: 'mesh_read',
    description: '读取某台 Remote Host 上一个 harness 会话的有界历史（分页由 Remote 处理）。',
    parameters: {
      hostId: str('目标 Host id'),
      workspaceId: str('工作区 id'),
      sessionId: str('会话 id'),
      maxMessages: num('最多消息数，默认 20', { minimum: 1, maximum: 50 }),
    },
    async execute(args, exec) {
      await ensureLayout(settings)
      const result = await readSession(ctx, exec, {
        hostId: args.hostId,
        workspaceId: args.workspaceId,
        sessionId: args.sessionId,
        maxMessages: args.maxMessages,
      })
      return json({ ok: true, ...result })
    },
  })

  add({
    name: 'mesh_interrupt',
    description: '请求中断某台 Remote Host 上一个会话的当前执行（不撤销已做的修改，不删除排队的消息）。',
    parameters: {
      hostId: str('目标 Host id'),
      workspaceId: str('工作区 id'),
      sessionId: str('会话 id'),
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
      hostId: str('目标 Host id'),
      workspaceId: str('工作区 id'),
      sessionId: str('会话 id'),
      path: str('工作区相对路径'),
    },
    async execute(args, exec) {
      try {
        const result = await downloadFile(ctx, exec, {
          hostId: args.hostId,
          workspaceId: args.workspaceId,
          sessionId: args.sessionId,
          path: args.path,
        })
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
    description: '把一个本机文件上传到某台 Remote Host 的会话工作区根目录（中继 ≤20 MiB，P2P ≤1 GiB，不覆盖同名文件）。',
    parameters: {
      hostId: str('目标 Host id'),
      workspaceId: str('工作区 id'),
      sessionId: str('会话 id'),
      localPath: str('本机绝对路径'),
      name: str('目标文件名（可选）'),
    },
    async execute(args, exec) {
      try {
        const result = await uploadFile(ctx, exec, {
          hostId: args.hostId,
          workspaceId: args.workspaceId,
          sessionId: args.sessionId,
          localPath: args.localPath,
          name: args.name,
        })
        if (result.status === 'unknown') {
          return json({
            ok: false,
            ...result,
            hint: '上传回执为 unknown，文件可能未落盘。Android 上 /sdcard 工作区常见；改用 /root/workspace 重试。',
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

  return disposers
}
