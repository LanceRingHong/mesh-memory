import test from 'node:test'
import assert from 'node:assert/strict'
import {
  callRemote,
  completionOf,
  pickWorkspace,
  readSession,
  runOnHost,
  transferOutcome,
} from '../src/remote.js'

const exec = () => ({ callId: 'outer-1', agent: { id: 'agent-1' }, signal: new AbortController().signal })

/**
 * 假 ToolRuntime：get() 返回“工具定义”（带一个会爆炸的 execute，证明我们没走它），
 * execute() 记录描述符并返回预置响应。
 */
function fakeCtx(responses) {
  const calls = []
  const ctx = {
    tools: {
      get(name) {
        if (!Object.hasOwn(responses, name) || responses[name] === null) return undefined
        return {
          name,
          execute() {
            throw new Error('禁止直接调用 tool.execute()：必须经过 ToolRuntime.execute()')
          },
        }
      },
      async execute(descriptor) {
        calls.push(descriptor)
        const response = responses[descriptor.name]
        if (typeof response === 'function') return response(descriptor)
        return { isError: false, content: [{ type: 'text', text: JSON.stringify(response) }], value: response }
      },
    },
  }
  return { ctx, calls }
}

const ok = (value) => ({ isError: false, content: [{ type: 'text', text: JSON.stringify(value) }], value })
const fail = (message) => ({ isError: true, content: [{ type: 'text', text: `Error: ${message}` }], error: { message } })

test('callRemote 走 ToolRuntime.execute 并带上 agent/signal（P1-1）', async () => {
  const { ctx, calls } = fakeCtx({ remote_list_hosts: { hosts: [] } })
  const outer = exec()
  const result = await callRemote(ctx, outer, 'remote_list_hosts', {})
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'remote_list_hosts')
  assert.deepEqual(calls[0].arguments, {})
  assert.equal(calls[0].agent, outer.agent)
  assert.equal(calls[0].signal, outer.signal)
  assert.match(calls[0].callId, /^outer-1-remote_list_hosts-/)
  assert.ok(result)
})

test('callRemote 在没有 agent 作用域时退回直接调用（旧宿主兼容）', async () => {
  let direct = 0
  const ctx = {
    tools: {
      get: () => ({ execute: async () => { direct += 1; return { ok: true } } }),
      execute: () => { throw new Error('不应走 runtime') },
    },
  }
  await callRemote(ctx, { callId: 'x' }, 'remote_list_hosts', {})
  assert.equal(direct, 1)
})

test('callRemote 对不可见工具直接报错（per-agent 限制生效）', async () => {
  const { ctx } = fakeCtx({ remote_list_hosts: null })
  await assert.rejects(() => callRemote(ctx, exec(), 'remote_list_hosts', {}), /不可用/)
})

test('callRemote 把嵌套错误变成可读异常', async () => {
  const { ctx } = fakeCtx({ remote_create_session: () => fail('host offline') })
  await assert.rejects(() => callRemote(ctx, exec(), 'remote_create_session', {}), /host offline/)
})

test('pickWorkspace 不再静默回退（P1-4）', () => {
  const list = [
    { workspaceId: 'w1', backend: 'harness', path: '/sdcard', title: 'sdcard' },
    { workspaceId: 'w2', backend: 'harness', path: '/root/workspace', title: 'root' },
    { workspaceId: 'c1', backend: 'codex', path: '/x' },
  ]
  assert.equal(pickWorkspace(list, { workspaceId: 'w1' }).workspaceId, 'w1')
  assert.equal(pickWorkspace(list, { workspacePath: '/root/workspace' }).workspaceId, 'w2')
  assert.throws(() => pickWorkspace(list, { workspacePath: '/does-not-exist' }), /找不到路径.*sdcard.*root/)
  assert.throws(() => pickWorkspace(list, { workspaceId: 'nope' }), /不在目标主机上/)
  assert.throws(() => pickWorkspace([], {}), /没有可用的 harness 工作区/)

  const single = [list[0]]
  assert.deepEqual(pickWorkspace(single, {}), { workspaceId: 'w1', fallback: false, candidates: single })
  const fallback = pickWorkspace(list, {})
  assert.equal(fallback.workspaceId, 'w1')
  assert.equal(fallback.fallback, true)
})

test('completionOf：只有明确完成才算完成（P1-4）', () => {
  assert.equal(completionOf('idle').finished, true)
  assert.equal(completionOf('completed').finished, true)
  assert.equal(completionOf('running').finished, false)
  assert.equal(completionOf('accepted').finished, false)
  assert.equal(completionOf(undefined).finished, false)
  const approval = completionOf('needs_user_input')
  assert.equal(approval.finished, false)
  assert.equal(approval.waitingFor, 'approval')
  assert.equal(completionOf('failed').failed, true)
})

test('transferOutcome：accepted 没有落盘信息不算成功（P2-13）', () => {
  assert.equal(transferOutcome({ status: 'accepted' }).ok, false)
  assert.equal(transferOutcome({ status: 'accepted', path: '/root/workspace/a.tgz', bytes: 10 }).ok, true)
  assert.equal(transferOutcome({ status: 'timeout', timeout: true }).ok, false)
  assert.equal(transferOutcome({ status: 'unknown' }).ok, false)
  assert.equal(transferOutcome({ status: 'done', name: 'a.tgz' }).ok, true)
  assert.equal(transferOutcome({ status: 'failed' }).settled, true)
})

test('runOnHost：显式工作区不存在时报错而不是换目录', async () => {
  const { ctx } = fakeCtx({
    remote_list_workspaces: { workspaces: [{ workspaceId: 'w1', backend: 'harness', path: '/sdcard' }] },
  })
  await assert.rejects(
    () => runOnHost(ctx, exec(), { hostId: 'h', workspacePath: '/nope', task: 'x' }),
    /找不到路径/,
  )
})

test('runOnHost：running 不会被当成完成，并带 fallback 标记', async () => {
  const { ctx, calls } = fakeCtx({
    remote_list_workspaces: {
      workspaces: [
        { workspaceId: 'w1', backend: 'harness', path: '/sdcard' },
        { workspaceId: 'w2', backend: 'harness', path: '/root/workspace' },
      ],
    },
    remote_create_session: { sessionId: 's1' },
    remote_send_message: { accepted: true },
    remote_wait_sessions: { status: 'idle' },
    remote_read_session: { status: 'running', records: [] },
  })
  const result = await runOnHost(ctx, exec(), { hostId: 'h', task: 'do it', waitMs: 1000 })
  assert.equal(result.status, 'running')
  assert.equal(result.finished, false)
  assert.equal(result.workspaceFallback, true)
  assert.equal(result.workspaceId, 'w1')
  assert.ok(result.workspaceCandidates.some((item) => item.workspaceId === 'w2'))
  // 建会话 / 发消息 / 等待 / 读回 都经过 runtime
  assert.deepEqual(
    calls.map((call) => call.name),
    ['remote_list_workspaces', 'remote_create_session', 'remote_send_message', 'remote_wait_sessions', 'remote_read_session'],
  )
})

test('runOnHost：发送失败时尝试中断，不留孤儿会话', async () => {
  const { ctx, calls } = fakeCtx({
    remote_list_workspaces: { workspaces: [{ workspaceId: 'w1', backend: 'harness', path: '/sdcard' }] },
    remote_create_session: { sessionId: 's1' },
    remote_send_message: () => fail('queue full'),
    remote_interrupt_session: { accepted: true },
  })
  await assert.rejects(() => runOnHost(ctx, exec(), { hostId: 'h', task: 'x', waitMs: 1000 }), /发送任务失败/)
  assert.ok(calls.some((call) => call.name === 'remote_interrupt_session'))
})

test('runOnHost：显式工作区命中时不标记 fallback', async () => {
  const { ctx } = fakeCtx({
    remote_list_workspaces: { workspaces: [{ workspaceId: 'w1', backend: 'harness', path: '/sdcard' }] },
    remote_create_session: { sessionId: 's1' },
    remote_send_message: { accepted: true },
    remote_wait_sessions: { status: 'idle' },
    remote_read_session: { status: 'idle', records: [] },
  })
  const result = await runOnHost(ctx, exec(), { hostId: 'h', workspacePath: '/sdcard', task: 'x', waitMs: 1000 })
  assert.equal(result.workspaceFallback, false)
  assert.equal(result.finished, true)
})

test('readSession 透传 cursor 并返回 nextCursor（P2-12）', async () => {
  const { ctx, calls } = fakeCtx({
    remote_read_session: {
      status: 'idle',
      records: [],
      nextCursor: { throughSeq: 42, beforeSeq: 84 },
    },
  })
  const out = await readSession(ctx, exec(), {
    hostId: 'h',
    workspaceId: 'w',
    sessionId: 's',
    cursor: { beforeSeq: 84 },
  })
  assert.deepEqual(calls[0].arguments.cursor, { beforeSeq: 84 })
  assert.deepEqual(out.nextCursor, { throughSeq: 42, beforeSeq: 84 })
  assert.equal(out.lastSeq, 42)
  assert.equal(out.truncated, false)
})

test('summarizeSession 对超长历史标记 truncated（P2-12）', async () => {
  const records = Array.from({ length: 205 }, (_, i) => ({
    type: 'assistant/message',
    json: JSON.stringify({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `m${i}` }] } } }),
  }))
  const { ctx } = fakeCtx({ remote_read_session: { status: 'idle', records } })
  const out = await readSession(ctx, exec(), { hostId: 'h', workspaceId: 'w', sessionId: 's' })
  assert.equal(out.messageCount, 205)
  assert.equal(out.messages.length, 200)
  assert.equal(out.truncated, true)
})
