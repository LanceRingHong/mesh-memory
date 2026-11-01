import fs from 'node:fs'
import path from 'node:path'

/**
 * 多技能包（0.11.0）：从包内 `skills/<name>/SKILL.md` 读取并逐个注册。
 * 用同步 IO 是因为插件 apply() 是同步的；目录很小（<10 个文件）。
 * 读不到就跳过，绝不因为技能目录缺失影响宿主启动。
 */
export function loadSkillPack(dir) {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const skills = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const file = path.join(dir, entry.name, 'SKILL.md')
    let text = ''
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const parsed = parseSkill(text)
    if (!parsed.name || !parsed.body.trim()) continue
    skills.push({ ...parsed, file })
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

function parseSkill(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const attrs = {}
  let body = raw
  if (raw.startsWith('---\n')) {
    const end = raw.indexOf('\n---', 4)
    if (end > 0) {
      for (const line of raw.slice(4, end).split('\n')) {
        const idx = line.indexOf(':')
        if (idx <= 0) continue
        const key = line.slice(0, idx).trim()
        let value = line.slice(idx + 1).trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        attrs[key] = value
      }
      body = raw.slice(end + 4)
    }
  }
  return { name: String(attrs.name || '').trim(), description: String(attrs.description || '').trim(), body: body.trim() }
}

export function registerSkillPack(ctx, skills, { source = 'bundled' } = {}) {
  const registry = ctx.get('skills')
  if (!registry || typeof registry.register !== 'function') return () => {}
  const disposers = []
  for (const skill of skills) {
    try {
      const off = registry.register({
        name: skill.name,
        description: skill.description || skill.name,
        content: skill.body,
        source,
      })
      if (typeof off === 'function') disposers.push(off)
    } catch {}
  }
  return () => {
    for (const off of disposers) {
      try {
        off()
      } catch {}
    }
  }
}
