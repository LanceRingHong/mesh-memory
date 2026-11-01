import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { makeSettings, writeMemoryFile, memoryDoc } from './helpers.js'
import { acceptInbox, rejectInbox, undoDecision, batchInbox, attachSupport, listInbox, inboxRoot, makeDraftTitle } from '../src/inbox.js'

/** S2 审阅工作流：改后接受、撤销不覆盖人工编辑、批量、证据强度排序。 */

function draft({ sessionId = 's1', title = 'SSH 配置小结', turns = 3, body = '## 用户诉求\n\n配 ssh\n' } = {}) {
  return [
    '---',
    'kind: session-draft',
    `sessionId: ${JSON.stringify(sessionId)}`,
    'device: "test-device"',
    `title: ${JSON.stringify(title)}`,
    'createdAt: "2026-11-01T10:00:00.000Z"',
    'updatedAt: "2026-11-01T10:00:00.000Z"',
    `turns: ${turns}`,
    'status: draft',
    '---',
    '',
    body,
  ].join('\n')
}

async function seedDraft(dshHome, name, opts) {
  const dir = path.join(dshHome, 'dsh-mesh', 'inbox', 'sessions')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, name), draft(opts), 'utf8')
  return `sessions/${name}`
}

test('改后接受：用编辑过的正文写入，并把草稿移出收件箱', async (t) => {
  const { settings, dshHome, memoryDir, cleanup } = await makeSettings()
  t.after(cleanup)
  const rel = await seedDraft(dshHome, 's1.md')
  const result = await acceptInbox(settings, rel, { kind: 'facts', title: 'SSH 小结', body: '改过的正文' })

  const written = await fs.readFile(path.join(memoryDir, result.memory), 'utf8')
  assert.match(written, /改过的正文/)
  assert.doesNotMatch(written, /配 ssh/)
  assert.equal((await listInbox(settings)).length, 0)
  assert.ok(result.undoId)
})

test('撤销接受：草稿回到 sessions/，记忆进回收站', async (t) => {
  const { settings, dshHome, memoryDir, cleanup } = await makeSettings()
  t.after(cleanup)
  const rel = await seedDraft(dshHome, 's1.md')
  const accepted = await acceptInbox(settings, rel, { kind: 'facts' })
  await undoDecision(settings, accepted.undoId)

  assert.equal((await listInbox(settings)).length, 1, '草稿应回到收件箱')
  await assert.rejects(fs.stat(path.join(memoryDir, accepted.memory)), /ENOENT/)
  // .trash 保留原目录结构（memory/facts/...），所以只数文件总数。
  let trashed = 0
  const walk = async (dir) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(path.join(dir, entry.name))
      else trashed += 1
    }
  }
  await walk(path.join(memoryDir, '.trash'))
  assert.ok(trashed >= 1, '记忆应进 .trash')
})

test('撤销接受：接受后又被改过则拒绝，不覆盖人工编辑', async (t) => {
  const { settings, dshHome, memoryDir, cleanup } = await makeSettings()
  t.after(cleanup)
  const rel = await seedDraft(dshHome, 's1.md')
  const accepted = await acceptInbox(settings, rel, { kind: 'facts' })

  const abs = path.join(memoryDir, accepted.memory)
  const text = await fs.readFile(abs, 'utf8')
  await fs.writeFile(abs, `${text}\n人工补充的一行\n`, 'utf8')

  await assert.rejects(undoDecision(settings, accepted.undoId), /人工编辑/)
  const still = await fs.readFile(abs, 'utf8')
  assert.match(still, /人工补充的一行/)
})

test('撤销忽略：草稿从 rejected/ 回到 sessions/', async (t) => {
  const { settings, dshHome, cleanup } = await makeSettings()
  t.after(cleanup)
  const rel = await seedDraft(dshHome, 's2.md')
  const rejected = await rejectInbox(settings, rel)
  assert.equal((await listInbox(settings)).length, 0)
  await undoDecision(settings, rejected.undoId)
  assert.equal((await listInbox(settings)).length, 1)
})

test('批量接受：单条失败不中断整批', async (t) => {
  const { settings, dshHome, cleanup } = await makeSettings()
  t.after(cleanup)
  const a = await seedDraft(dshHome, 'a.md', { sessionId: 'a', title: 'A 会话' })
  const b = await seedDraft(dshHome, 'b.md', { sessionId: 'b', title: 'B 会话' })
  const result = await batchInbox(settings, [a, 'sessions/missing.md', b], { action: 'accept', kind: 'notes' })
  assert.equal(result.total, 3)
  assert.equal(result.ok, 2)
  assert.equal(result.items.filter((item) => !item.ok).length, 1)
  assert.equal((await listInbox(settings)).length, 0)
})

test('证据强度：与现有记忆标题重合多的草稿排在前面', async (t) => {
  const { settings, dshHome, memoryDir, cleanup } = await makeSettings()
  t.after(cleanup)
  await writeMemoryFile(
    memoryDir,
    'memory/facts/ssh.md',
    memoryDoc({ title: 'SSH 只允许密钥登录', description: 'sshd 关闭密码认证', body: '正文' }),
  )
  const items = [
    { path: 'sessions/x.md', title: '无关的烹饪笔记' },
    { path: 'sessions/y.md', title: 'SSH 配置与密钥登录' },
  ]
  const enriched = attachSupport(items, [{ path: 'memory/facts/ssh.md', title: 'SSH 只允许密钥登录', description: 'sshd 关闭密码认证' }])
  const byPath = new Map(enriched.map((item) => [item.path, item]))
  assert.ok(byPath.get('sessions/y.md').support >= 1)
  assert.equal(byPath.get('sessions/x.md').support, 0)
  assert.ok(byPath.get('sessions/y.md').related[0].path.includes('ssh.md'))
})

test('收件箱根目录落在 DSH_HOME 下，不进共享目录', async (t) => {
  const { settings, dshHome, cleanup } = await makeSettings()
  t.after(cleanup)
  assert.equal(inboxRoot(settings), path.join(dshHome, 'dsh-mesh', 'inbox'))
})

test('标题不会在半截词处截断（S2 修）', () => {
  // 逗号优先于硬截
  assert.equal(
    makeDraftTitle('在 Windows 上为 mesh-memory 构建真实客户端工程，目录 D:\\dsh-mesh\\client（新建）'),
    '在 Windows 上为 mesh-memory 构建真实客户端工程',
  )
  // 超长时在标点/词边界收尾，不留半截词\n  const persona = makeDraftTitle('你是产品调研员。请用 web_search 和 web_fetch 调研主流记忆系统的图形界面，重点是界面长什么样。')\n  assert.ok(persona.length <= 36, persona)\n  assert.ok(/[。，]$|…$/.test(persona), persona)
  // 短句原样返回
  assert.equal(makeDraftTitle('整理交接文档'), '整理交接文档')
  // 完全没标点时兜底加省略号
  const long = makeDraftTitle('abcdefghijklmnopqrstuvwxyz0123456789abcdef')
  assert.ok(long.endsWith('…'))
  // 去掉 markdown 噪音
  assert.equal(makeDraftTitle('## 用户诉求\n\n- 做一件事'), '做一件事')
})


