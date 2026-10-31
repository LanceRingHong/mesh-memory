import test from 'node:test'
import assert from 'node:assert/strict'
import { createBuffer, flushCurrent, hydrateFromSession, observeEvent } from '../src/capture.js'
import { listInbox, readInbox } from '../src/inbox.js'
import { ensureLayout } from '../src/store.js'
import { makeSettings } from './helpers.js'

const session = { id: 's-1', header: { title: '初始标题', cwd: 'D:/work' } }

test('捕获用户/助手消息与工具调用', () => {
  const buffer = createBuffer(session)
  observeEvent(buffer, { type: 'turn/start', data: { turn: 1 } })
  observeEvent(buffer, {
    type: 'user/message',
    data: { content: [{ type: 'text', text: '帮我修一下构建' }] },
  })
  observeEvent(buffer, {
    type: 'tool/call',
    data: { name: 'bash', arguments: JSON.stringify({ path: 'src/a.ts', command: 'pnpm build' }) },
  })
  observeEvent(buffer, {
    type: 'assistant/message',
    data: {
      message: {
        content: [
          { type: 'text', text: '依赖没装，已经补上。' },
          { type: 'tool-call', name: 'bash' },
        ],
      },
    },
  })

  assert.equal(buffer.turns, 1)
  assert.deepEqual(
    buffer.messages.map((m) => m.role),
    ['user', 'assistant'],
  )
  assert.ok(buffer.tools.has('bash'))
  assert.ok(buffer.files.has('src/a.ts'))
})

test('标题事件与重复消息去重', () => {
  const buffer = createBuffer(session)
  observeEvent(buffer, { type: 'session/title', data: { title: '构建修复' } })
  assert.equal(buffer.title, '构建修复')

  const msg = { type: 'user/message', data: { content: [{ type: 'text', text: '同一个问题' }] } }
  observeEvent(buffer, msg)
  observeEvent(buffer, msg)
  assert.equal(buffer.messages.length, 1)
})

test('缓冲消息数量有上限', () => {
  const buffer = createBuffer(session)
  for (let i = 0; i < 80; i += 1) {
    observeEvent(buffer, { type: 'user/message', data: { content: [{ type: 'text', text: `消息 ${i}` }] } })
  }
  assert.ok(buffer.messages.length <= 60)
  assert.equal(buffer.messages[buffer.messages.length - 1].text, '消息 79')
})

test('忽略非用户来源的 user 角色消息（运行时上下文）', () => {
  const buffer = createBuffer(session)
  observeEvent(buffer, {
    type: 'user/message',
    data: {
      source: { kind: 'system' },
      content: [{ type: 'text', text: 'Current runtime context…' }],
    },
  })
  assert.equal(buffer.messages.length, 0)

  observeEvent(buffer, {
    type: 'user/message',
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: '真正的问题' }] },
  })
  assert.equal(buffer.messages.length, 1)
  assert.equal(buffer.turns, 1)
})

test('热加载补全：flush 前从会话历史 hydrate', async () => {
  const buffer = createBuffer({
    id: 's-2',
    header: {},
    deriveMessages: () => [
      { role: 'user', source: { kind: 'system' }, content: [{ type: 'text', text: 'runtime context' }] },
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '帮我整理今天的记忆' }] },
      { role: 'assistant', content: [{ type: 'text', text: '好的，我来整理。' }] },
    ],
  })
  await hydrateFromSession(buffer)
  assert.equal(buffer.messages.length, 2)
  assert.equal(buffer.turns, 1)
  assert.equal(buffer.title, '帮我整理今天的记忆')
})

test('flushCurrent 从会话历史补全并写草稿', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  await ensureLayout(settings)

  const session = {
    id: 's-live',
    header: { title: '', cwd: '' },
    deriveMessages: () => [
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '帮我看看部署脚本' }] },
      { role: 'assistant', content: [{ type: 'text', text: '已检查，缺少回滚步骤。' }] },
    ],
  }

  const out = await flushCurrent(settings, session)
  assert.equal(out.length, 1)
  assert.equal(out[0].sessionId, 's-live')

  const items = await listInbox(settings)
  assert.equal(items.length, 1)
  const text = await readInbox(settings, items[0].path)
  assert.match(text, /部署脚本/)
  assert.match(text, /缺少回滚步骤/)
})

test('忽略未知事件与损坏的工具参数', () => {
  const buffer = createBuffer(session)
  observeEvent(buffer, { type: 'something/else', data: {} })
  observeEvent(buffer, { type: 'tool/call', data: { name: 'x', arguments: '{not json' } })
  assert.equal(buffer.messages.length, 0)
  assert.ok(buffer.tools.has('x'))
  assert.equal(buffer.files.size, 0)
})
