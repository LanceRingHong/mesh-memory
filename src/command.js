import { listInbox, acceptInbox, rejectInbox } from './inbox.js'
import { flushAllSessions } from './capture.js'
import { trashNote } from './store.js'
import { snapshot } from './backup.js'

const KINDS = new Set(['notes', 'facts', 'decisions', 'projects'])

const USAGE = [
  '/mesh-memory list',
  '/mesh-memory flush',
  '/mesh-memory accept <草稿路径> [notes|facts|decisions|projects]',
  '/mesh-memory reject <草稿路径>',
  '/mesh-memory delete <memory/... 路径>',
  '/mesh-memory snapshot',
].join('\n')

/**
 * 斜杠命令的纯函数实现：Go 原生页（以及任何 UI）通过 `commands/execute`
 * 在 Host 上直接调用，不需要额外 RPC 或局域网暴露。
 */
export async function runMeshCommand(settings, rawInput) {
  const input = String(rawInput || '').trim()
  if (!input || input === 'help') return { kind: 'success', text: USAGE }
  const parts = input.split(/\s+/)
  const verb = (parts.shift() || '').toLowerCase()
  try {
    switch (verb) {
      case 'list': {
        const items = await listInbox(settings)
        if (!items.length) return { kind: 'success', text: '收件箱为空。' }
        return {
          kind: 'success',
          text: items
            .map((item) => `${item.title} · ${item.turns} 轮 · ${item.updatedAt || item.createdAt}\n  ${item.path}`)
            .join('\n'),
        }
      }
      case 'flush': {
        const flushed = await flushAllSessions(settings, 'command')
        return { kind: 'success', text: flushed.length ? `已整理 ${flushed.length} 条：\n${flushed.map((f) => f.path).join('\n')}` : '没有可整理的会话。' }
      }
      case 'accept': {
        const path = parts.shift() || ''
        if (!path) return { kind: 'error', text: '用法：/mesh-memory accept <草稿路径> [kind]' }
        const requested = (parts.shift() || 'notes').toLowerCase()
        const kind = KINDS.has(requested) ? requested : 'notes'
        const result = await acceptInbox(settings, path, { kind })
        return { kind: 'success', text: `已接受 → ${result.memory}` }
      }
      case 'reject': {
        const path = parts.join(' ').trim()
        if (!path) return { kind: 'error', text: '用法：/mesh-memory reject <草稿路径>' }
        await rejectInbox(settings, path)
        return { kind: 'success', text: '已忽略。' }
      }
      case 'delete': {
        const path = parts.join(' ').trim()
        if (!path) return { kind: 'error', text: '用法：/mesh-memory delete <memory/... 路径>' }
        const result = await trashNote(settings, path)
        return { kind: 'success', text: `已移入回收站：${result.trash}` }
      }
      case 'snapshot': {
        const result = await snapshot(settings, 'command')
        return { kind: 'success', text: result.changed ? `已快照 ${result.commit}` : '没有变化，无需快照。' }
      }
      default:
        return { kind: 'error', text: `未知操作：${verb}\n${USAGE}` }
    }
  } catch (error) {
    return { kind: 'error', text: String(error?.message || error) }
  }
}

/** 注册到 DSH 命令表；Go 原生记忆页用 commands/execute 调用。 */
export function registerCommands(ctx, settings) {
  if (typeof ctx.inject !== 'function') return () => {}
  return ctx.inject(['commands'], (sub) => {
    const commands = sub.commands
    if (!commands || typeof commands.register !== 'function') return
    sub.effect?.(() =>
      commands.register({
        name: 'mesh-memory',
        description: 'dsh-mesh 记忆操作：list / flush / accept / reject / delete / snapshot',
        handler: (invocation) => runMeshCommand(settings, invocation.rawInput),
      }),
    )
  })
}
