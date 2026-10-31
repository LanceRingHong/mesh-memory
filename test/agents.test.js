import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { makeSettings } from './helpers.js'
import { ensureLayout } from '../src/store.js'
import {
  lineDiff,
  materializeAgents,
  previewAgents,
  previewSkills,
  syncSkills,
} from '../src/agents.js'

async function setup(shared = '# Shared\n\n- rule A\n') {
  const made = await makeSettings()
  await ensureLayout(made.settings)
  await fs.writeFile(path.join(made.memoryDir, 'AGENTS.shared.md'), shared, 'utf8')
  return made
}

test('预览不落盘，返回 diff 与源哈希（P1-2）', async (t) => {
  const { settings, cleanup, dshHome } = await setup()
  t.after(cleanup)

  const preview = await previewAgents(settings)
  assert.equal(preview.available, true)
  assert.equal(preview.changed, true)
  assert.equal(preview.replaced, false)
  assert.match(preview.sourceSha256, /^[0-9a-f]{64}$/)
  assert.ok(preview.diff.lines.some((line) => line.op === '+'))
  assert.ok(preview.diff.lines.some((line) => line.line.includes('rule A')))
  assert.equal(existsSync(path.join(dshHome, 'AGENTS.md')), false, '预览不能写 AGENTS.md')
})

test('应用需要匹配的预览哈希；应用后再次预览为无变化（P1-2）', async (t) => {
  const { settings, cleanup, dshHome } = await setup()
  t.after(cleanup)

  await assert.rejects(() => materializeAgents(settings, { expectedSha256: 'deadbeef' }), /已变化/)

  const preview = await previewAgents(settings)
  const applied = await materializeAgents(settings, { expectedSha256: preview.sourceSha256 })
  assert.equal(applied.changed, true)

  const text = await fs.readFile(path.join(dshHome, 'AGENTS.md'), 'utf8')
  assert.ok(text.includes('<!-- dsh-mesh:begin -->'))
  assert.ok(text.includes('<!-- dsh-mesh:end -->'))
  assert.ok(text.includes('来源：AGENTS.shared.md · sha256:'))
  assert.ok(text.includes('rule A'))

  const again = await previewAgents(settings)
  assert.equal(again.changed, false)
})

test('共享内容里的托管块标记会被转义，不会提前闭合（P1-3）', async (t) => {
  const { settings, cleanup, dshHome } = await setup('# Shared\n<!-- dsh-mesh:end -->\nEVIL\n')
  t.after(cleanup)

  const preview = await previewAgents(settings)
  assert.equal(preview.sanitized, true)
  assert.ok(preview.warnings.some((item) => item.includes('转义')))

  await materializeAgents(settings, { expectedSha256: preview.sourceSha256 })
  const text = await fs.readFile(path.join(dshHome, 'AGENTS.md'), 'utf8')
  assert.equal(text.split('<!-- dsh-mesh:end -->').length - 1, 1, '只能有一个真实的结束标记')
  assert.ok(text.includes('&lt;!-- dsh-mesh:end -->'), '注入的标记应被转义')

  // 再物化一次不应重复追加
  const preview2 = await previewAgents(settings)
  await materializeAgents(settings, { expectedSha256: preview2.sourceSha256 })
  const text2 = await fs.readFile(path.join(dshHome, 'AGENTS.md'), 'utf8')
  assert.equal(text2.split('<!-- dsh-mesh:begin -->').length - 1, 1)
  assert.equal(text2.split('EVIL').length - 1, 1)
})

test('共享文件为空时拒绝覆盖已有托管块（P1-11）', async (t) => {
  const { settings, cleanup, dshHome } = await setup('')
  t.after(cleanup)

  const existing = [
    '# 我的规则',
    '',
    '<!-- dsh-mesh:begin -->',
    '## 共享记忆（dsh-mesh 自动生成，请勿手改本块）',
    '',
    '旧的共享规则',
    '<!-- dsh-mesh:end -->',
    '',
  ].join('\n')
  await fs.mkdir(dshHome, { recursive: true })
  await fs.writeFile(path.join(dshHome, 'AGENTS.md'), existing, 'utf8')

  const preview = await previewAgents(settings)
  assert.ok(preview.warnings.some((item) => item.includes('为空')))

  await assert.rejects(() => materializeAgents(settings), /为空，拒绝/)
  assert.equal(await fs.readFile(path.join(dshHome, 'AGENTS.md'), 'utf8'), existing)
})

test('共享文件缺失时预览给出原因、应用报错（P1-11）', async (t) => {
  const { settings, cleanup, memoryDir } = await makeSettings()
  t.after(cleanup)
  await ensureLayout(settings)
  await fs.rm(path.join(memoryDir, 'AGENTS.shared.md'), { force: true })

  const preview = await previewAgents(settings)
  assert.equal(preview.available, false)
  assert.match(preview.reason, /不存在/)
  await assert.rejects(() => materializeAgents(settings), /不存在/)
})

test('skills 预览区分“将复制”和“需 force”（P1-2）', async (t) => {
  const { settings, cleanup, memoryDir, dshHome } = await setup()
  t.after(cleanup)

  await fs.mkdir(path.join(memoryDir, 'skills', 'demo'), { recursive: true })
  await fs.writeFile(path.join(memoryDir, 'skills', 'demo', 'SKILL.md'), '# demo\n', 'utf8')
  await fs.mkdir(path.join(memoryDir, 'skills', 'broken'), { recursive: true })

  const preview = await previewSkills(settings)
  assert.ok(preview.copy.some((item) => item.name === 'demo' && item.files === 1))
  assert.ok(preview.skip.some((item) => item.name === 'broken'))
  assert.equal(existsSync(path.join(dshHome, 'skills', 'demo')), false, '预览不能复制 skill')

  await fs.mkdir(path.join(dshHome, 'skills', 'demo'), { recursive: true })
  const second = await previewSkills(settings)
  assert.deepEqual(second.forceRequired, ['demo'])
})

test('lineDiff 基本行为', () => {
  assert.deepEqual(lineDiff('a\nb', 'a\nc'), [
    { op: '-', line: 'b' },
    { op: '+', line: 'c' },
  ])
  assert.deepEqual(lineDiff('', 'x'), [{ op: '+', line: 'x' }])
  assert.deepEqual(lineDiff('same', 'same'), [])
})

test('skills 超过 maxSkillBytes 时拒绝同步（P2-6）', async (t) => {
  const { settings, cleanup, memoryDir, dshHome } = await setup()
  t.after(cleanup)
  settings.maxSkillBytes = 100
  await fs.mkdir(path.join(memoryDir, 'skills', 'big'), { recursive: true })
  await fs.writeFile(path.join(memoryDir, 'skills', 'big', 'SKILL.md'), 'x'.repeat(500), 'utf8')

  const preview = await previewSkills(settings)
  assert.ok(preview.skip.some((item) => item.name === 'big' && item.reason.includes('maxSkillBytes')))

  const applied = await syncSkills(settings, { force: true })
  assert.ok(applied.skipped.some((item) => item.includes('too large')))
  assert.equal(existsSync(path.join(dshHome, 'skills', 'big')), false)
})
