import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as store from '../src/store.js'
import * as agents from '../src/agents.js'
import { makeSettings, writeMemoryFile, trySymlink, tryJunction } from './helpers.js'

test('safeRel 拒绝词法逃逸', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  assert.throws(() => store.safeRel(settings, '../outside.md'), /escape/)
  assert.throws(() => store.safeRel(settings, '../../AGENTS.shared.md'), /escape/)
  assert.equal(store.safeRel(settings, 'memory/facts/a.md'), path.join(settings.memoryDir, 'memory', 'facts', 'a.md'))
})

// P0-1：sessionId 曾经可以拼出任意 .md 路径。
test('sessionsFile 只接受安全 sessionId（P0-1）', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  assert.equal(typeof store.sessionsFile, 'function', 'store.sessionsFile 必须存在')

  const id = 'session-abc_123'
  assert.equal(
    store.sessionsFile(settings, id),
    path.join(settings.memoryDir, 'sessions', settings.deviceSlug, `${id}.md`),
  )
  for (const bad of ['../../AGENTS.shared', '../../../tmp/escape', 'a/b', 'a\\b', '', '   ', '.', '..', 'x'.repeat(129)]) {
    assert.throws(() => store.sessionsFile(settings, bad), /sessionId/, `应拒绝 ${JSON.stringify(bad)}`)
  }
})

// P0-2：符号链接可以把任意本机文件读进模型上下文。
test('readMemory 拒绝符号链接（P0-2）', async (t) => {
  const { settings, cleanup, root } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  const secret = path.join(root, 'secret.txt')
  await fs.writeFile(secret, 'TOP-SECRET-TOKEN', 'utf8')
  const link = path.join(settings.memoryDir, 'memory', 'facts', 'leak.md')
  await fs.mkdir(path.dirname(link), { recursive: true })
  if (!(await trySymlink(t, secret, link))) return

  await assert.rejects(() => store.readMemory(settings, 'memory/facts/leak.md'), /符号链接|symlink|拒绝/)
})

test('readInside 统一拒绝越界/符号链接/超大文件（P0-2）', async (t) => {
  const { settings, cleanup, root } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  assert.equal(typeof store.readInside, 'function', 'store.readInside 必须存在')

  await writeMemoryFile(settings.memoryDir, 'memory/facts/ok.md', 'hello')
  assert.equal(await store.readInside(settings, 'memory/facts/ok.md'), 'hello')

  await assert.rejects(() => store.readInside(settings, '../secret.txt'), /escape/)

  const big = path.join(settings.memoryDir, 'memory', 'facts', 'big.md')
  await fs.writeFile(big, 'x'.repeat(5000), 'utf8')
  await assert.rejects(() => store.readInside(settings, 'memory/facts/big.md', { maxBytes: 1000 }), /too large/)

  const secret = path.join(root, 'secret2.txt')
  await fs.writeFile(secret, 'SECRET', 'utf8')
  const link = path.join(settings.memoryDir, 'memory', 'facts', 'leak2.md')
  if (!(await trySymlink(t, secret, link))) return
  await assert.rejects(() => store.readInside(settings, 'memory/facts/leak2.md'), /符号链接|symlink|拒绝/)
})

test('AGENTS.shared.md 读失败不能被当成空文件（P1-11）', async (t) => {
  const { settings, cleanup, memoryDir } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)

  // 把共享规则换成一个目录：读取必然失败（EISDIR），不是“不存在”。
  await fs.rm(path.join(memoryDir, 'AGENTS.shared.md'), { force: true })
  await fs.mkdir(path.join(memoryDir, 'AGENTS.shared.md'))

  await assert.rejects(() => store.readSharedAgents(settings), /读取 AGENTS\.shared\.md 失败/)
})

test('源文件不存在时 materializeAgents 拒绝清空托管块（P1-11）', async (t) => {
  const { settings, cleanup, memoryDir, dshHome } = await makeSettings()
  t.after(cleanup)
  await fs.mkdir(memoryDir, { recursive: true })
  await fs.writeFile(path.join(dshHome, 'AGENTS.md'), '# 用户自己的规则\n', 'utf8')
  await assert.rejects(() => agents.materializeAgents(settings), /不存在|拒绝/)
})

test('readInside 阻止经由目录联接（junction）逃逸（P0-2）', async (t) => {
  const { settings, cleanup, root } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)

  const outsideDir = path.join(root, 'outside-dir')
  await fs.mkdir(outsideDir, { recursive: true })
  await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'TOP-SECRET', 'utf8')
  const junction = path.join(settings.memoryDir, 'memory', 'facts', 'linkeddir')
  await fs.mkdir(path.dirname(junction), { recursive: true })
  if (!(await tryJunction(t, outsideDir, junction))) return

  await assert.rejects(
    () => store.readInside(settings, 'memory/facts/linkeddir/secret.txt'),
    /escape|拒绝/,
  )
})

// P1-7：同一秒、同一标题的两次写入曾互相覆盖。
test('writeNote 同秒同标题不覆盖（P1-7）', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)

  const first = await store.writeNote(settings, { kind: 'facts', title: 'Same Title', content: 'first' })
  const second = await store.writeNote(settings, { kind: 'facts', title: 'Same Title', content: 'second' })
  assert.notEqual(first, second)
  assert.equal(await fs.readFile(first, 'utf8').then((x) => x.includes('first')), true)
  assert.equal(await fs.readFile(second, 'utf8').then((x) => x.includes('second')), true)

  const files = (await fs.readdir(path.join(settings.memoryDir, 'memory', 'facts'))).filter((f) => f.endsWith('.md'))
  assert.equal(files.length, 2)
})

test('writeNote 写入 id 且为原子写（P1-7）', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  const file = await store.writeNote(settings, { kind: 'facts', title: 'atomic', content: 'body' })
  const text = await fs.readFile(file, 'utf8')
  assert.match(text, /^id: .+/m)
  const leftovers = (await fs.readdir(path.dirname(file))).filter((f) => f.includes('.tmp'))
  assert.deepEqual(leftovers, [])
})

test('并发 publishNativeManifest 不产生 ENOENT（P2-3）', async (t) => {
  const { settings, cleanup, dshHome } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  await writeMemoryFile(settings.memoryDir, 'memory/facts/a.md', 'body')

  await Promise.all([
    store.publishNativeManifest(settings),
    store.publishNativeManifest(settings),
    store.publishNativeManifest(settings),
  ])
  const manifest = JSON.parse(await fs.readFile(path.join(dshHome, 'dsh-go', 'dsh-mesh.json'), 'utf8'))
  assert.equal(manifest.version, 1)
  assert.ok(Array.isArray(manifest.files))
})

test('parseFrontmatter 处理 BOM/折叠块/流式数组/缺尾换行（P2-4）', async () => {
  const withBom = store.parseFrontmatter('\uFEFF---\ntitle: "带BOM"\n---\nbody')
  assert.equal(withBom.attrs.title, '带BOM')

  const folded = store.parseFrontmatter('---\ndescription: >\n  第一行\n  第二行\n---\nbody')
  assert.equal(folded.attrs.description, '第一行 第二行')

  const flow = store.parseFrontmatter('---\ntags: [alpha, beta]\n---\nbody')
  assert.deepEqual(flow.attrs.tags, ['alpha', 'beta'])

  const noTail = store.parseFrontmatter('---\ntitle: t\n---')
  assert.equal(noTail.attrs.title, 't')
  assert.equal(noTail.body, '')

  const empty = store.parseFrontmatter('')
  assert.deepEqual(empty, { attrs: {}, body: '' })
})

test('updateNote 保留 id/createdAt，未传字段不变（P2-16）', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  const file = await store.writeNote(settings, {
    kind: 'facts',
    title: 'old title',
    description: 'old desc',
    content: 'body one',
  })
  const rel = path.relative(settings.memoryDir, file).replace(/\\/g, '/')
  const before = store.parseFrontmatter(await fs.readFile(file, 'utf8')).attrs

  const out = await store.updateNote(settings, rel, { title: 'new title', content: 'body two', tags: ['a'] })
  assert.equal(out.path, rel)

  const after = store.parseFrontmatter(await fs.readFile(file, 'utf8'))
  assert.equal(after.attrs.id, before.id)
  assert.equal(after.attrs.createdAt, before.createdAt)
  assert.equal(after.attrs.title, 'new title')
  assert.equal(after.attrs.description, 'old desc')
  assert.deepEqual(after.attrs.tags, ['a'])
  assert.ok(after.attrs.updatedAt)
  assert.match(after.body, /body two/)

  await assert.rejects(() => store.updateNote(settings, 'AGENTS.shared.md', { title: 'x' }), /只允许更新/)
})

test('软删除进回收站并可恢复（P2-16）', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  const file = await store.writeNote(settings, { kind: 'facts', title: 'trash me', content: 'x' })
  const rel = path.relative(settings.memoryDir, file).replace(/\\/g, '/')

  const moved = await store.trashNote(settings, rel)
  assert.match(moved.trash, /^\.trash\/memory\/facts\//)
  assert.equal(await fs.stat(file).then(() => true).catch(() => false), false)

  const items = await store.listTrash(settings)
  assert.equal(items.length, 1)
  assert.ok(items[0].trash.endsWith('.md'))

  const restored = await store.restoreTrash(settings, items[0].trash)
  assert.equal(restored.restored, rel)
  assert.ok(await fs.stat(file).then(() => true).catch(() => false))

  // 目标已存在时拒绝覆盖：先回收，再在原路径重建同名文件
  await store.trashNote(settings, rel)
  await fs.writeFile(file, 'rebuilt\n', 'utf8')
  const items2 = await store.listTrash(settings)
  await assert.rejects(() => store.restoreTrash(settings, items2[0].trash), /拒绝覆盖/)
})

test('listConflicts 与 counts.conflicts 识别冲突副本（P2-1）', async (t) => {
  const { settings, cleanup, memoryDir } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  await writeMemoryFile(
    memoryDir,
    'memory/facts/a.sync-conflict-20260101-000000-AAAAAAA.md',
    '---\ntitle: conflict copy\n---\nstale\n',
  )
  const items = await store.listConflicts(settings)
  assert.equal(items.length, 1)
  assert.match(items[0].path, /sync-conflict/)

  const c = await store.counts(settings)
  assert.equal(c.conflicts, 1)
})

test('树标记冲突文件并隐藏 .mesh 内部文件（P2-11）', async (t) => {
  const { settings, cleanup, memoryDir } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  await writeMemoryFile(memoryDir, 'memory/facts/a.sync-conflict-20260101-000000-AAAAAAA.md', 'x')
  await writeMemoryFile(memoryDir, '.mesh/skills.json', '{}')

  const tree = await store.treeMemory(settings)
  const memory = tree.root.find((node) => node.path === 'memory')
  const facts = memory.children.find((node) => node.path === 'memory/facts')
  const conflict = facts.children.find((node) => node.name.includes('sync-conflict'))
  assert.equal(conflict.conflict, true)

  const mesh = tree.root.find((node) => node.path === '.mesh')
  assert.deepEqual(mesh.children, [])
  assert.equal(mesh.hiddenChildren, true)
  assert.equal(tree.truncated, false)
  assert.equal(tree.treeLimit, 300)
})

test('树在超过 300 项时标记 truncated（P2-11）', async (t) => {
  const { settings, cleanup, memoryDir } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  await fs.mkdir(path.join(memoryDir, 'memory', 'notes'), { recursive: true })
  await Promise.all(
    Array.from({ length: 305 }, (_, i) =>
      fs.writeFile(path.join(memoryDir, 'memory', 'notes', `n${String(i).padStart(3, '0')}.md`), 'x', 'utf8'),
    ),
  )
  const tree = await store.treeMemory(settings)
  assert.equal(tree.truncated, true)
})

test('搜索与召回同口径：失效条目不进搜索，skills 可搜（P2-1）', async (t) => {
  const { settings, cleanup, memoryDir } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)

  await writeMemoryFile(
    memoryDir,
    'memory/facts/old.md',
    '---\ntitle: old\ndescription: ""\nsupersededBy: "memory/facts/new.md"\n---\nthe searchneedle old\n',
  )
  await writeMemoryFile(
    memoryDir,
    'memory/facts/new.md',
    '---\ntitle: new\ndescription: ""\n---\nthe searchneedle new\n',
  )
  await writeMemoryFile(memoryDir, 'skills/demo/SKILL.md', '# demo\n\nthe searchneedle skill\n')

  const results = await store.searchMemory(settings, 'searchneedle', 20)
  const paths = results.map((item) => item.path)
  assert.equal(paths.includes('memory/facts/old.md'), false, '被取代的条目不进搜索')
  assert.ok(paths.includes('memory/facts/new.md'))
  assert.ok(paths.includes('skills/demo/SKILL.md'), 'skills 应可搜索')
})

test('搜索结果标记冲突副本（P2-1）', async (t) => {
  const { settings, cleanup, memoryDir } = await makeSettings()
  t.after(cleanup)
  await store.ensureLayout(settings)
  await writeMemoryFile(
    memoryDir,
    'memory/facts/a.sync-conflict-20260101-000000-AAAAAAA.md',
    '---\ntitle: conflict\n---\nthe conflicttoken copy\n',
  )
  const results = await store.searchMemory(settings, 'conflicttoken', 10)
  assert.equal(results.length, 1)
  assert.equal(results[0].conflict, true)
})
