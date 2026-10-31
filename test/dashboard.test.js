import test from 'node:test'
import assert from 'node:assert/strict'
import { isLoopbackRequest } from '../src/dashboard.js'

function req(socket, host) {
  return { socket: socket ? { remoteAddress: socket } : {}, headers: host === undefined ? {} : { host } }
}

test('回环校验同时看 socket 与 Host（P2-7）', () => {
  assert.equal(isLoopbackRequest(req('127.0.0.1', '127.0.0.1:8765')), true)
  assert.equal(isLoopbackRequest(req('::1', '[::1]:8765')), true)
  assert.equal(isLoopbackRequest(req('::ffff:127.0.0.1', '127.0.0.1:8765')), true)

  // Host 伪造：连接来自非回环地址，必须拒绝
  assert.equal(isLoopbackRequest(req('10.0.0.5', '127.0.0.1:8765')), false)
  // 回环连接但 Host 不是本机
  assert.equal(isLoopbackRequest(req('127.0.0.1', 'evil.example:8765')), false)
  // 缺 socket / Host
  assert.equal(isLoopbackRequest(req(undefined, '127.0.0.1')), false)
  assert.equal(isLoopbackRequest(req('127.0.0.1', undefined)), false)
  assert.equal(isLoopbackRequest({}), false)
})
