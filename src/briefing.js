import { counts, recentFiles } from './store.js'
import { listInbox } from './inbox.js'
import { maintenanceHint } from './maintenance.js'

/**
 * 会话开场简报（0.11.0）：每个会话第一次装配系统提示时注入一次，
 * 对应 Basic Memory 的 SessionStart hook。失败只降级，不影响宿主。
 */
export function registerBriefing(ctx, settings) {
  if (typeof ctx.on !== 'function') return () => {}
  const seen = new Set()
  const handler = async (assembly, context, next) => {
    const out = await next()
    try {
      const session = context?.agent?.session
      const id = String(session?.id || '')
      if (!id || seen.has(id)) return out
      seen.add(id)
      if (seen.size > 500) seen.delete(seen.values().next().value)

      const [c, decisions, inbox] = await Promise.all([
        counts(settings),
        recentFiles(settings, 'memory/decisions', 3),
        listInbox(settings),
      ])
      const lines = [
        '<mesh-briefing>',
        `设备：${settings.deviceName} · Agent：${settings.agentName}`,
        `记忆：facts ${c.facts} / decisions ${c.decisions} / notes ${c.notes}；待确认 ${inbox.length}`,
      ]
      if (decisions.length) {
        lines.push('最近决策：')
        for (const item of decisions) lines.push(`- ${item.title}（${item.path}）`)
      }
      const hint = await maintenanceHint(settings).catch(() => null)
      if (hint) lines.push(`维护：${hint.text}；建议调用 ${hint.skills.join(' / ')}。`)
      lines.push('需要更多时用 mesh_memory_search / mesh_memory_read；重要结论用 mesh_memory_write 写回。', '</mesh-briefing>')
      return {
        ...out,
        contexts: [
          ...(Array.isArray(out?.contexts) ? out.contexts : []),
          { name: 'mesh-memory:briefing', order: 999, text: lines.join('\n') },
        ],
      }
    } catch {
      return out
    }
  }
  const off = ctx.on('system-prompt/assemble', handler)
  return typeof off === 'function' ? off : () => {}
}
