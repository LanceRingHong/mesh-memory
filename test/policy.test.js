import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { makeSettings, trySymlink, tryJunction, tryDirLink } from './helpers.js'
import * as policy from '../src/policy.js'

test('上传白名单：只允许配置的根目录（P0-3）', async (t) => {
  const { settings, cleanup, root } = await makeSettings()
  t.after(cleanup)
  const allowed = path.join(root, 'downloads')
  const outside = path.join(root, 'secrets')
  await fs.mkdir(allowed, { recursive: true })
  await fs.mkdir(outside, { recursive: true })
  const okFile = path.join(allowed, 'artifact.tgz')
  await fs.writeFile(okFile, 'payload', 'utf8')
  const secretFile = path.join(outside, 'notes.txt')
  await fs.writeFile(secretFile, 'secret', 'utf8')

  const scoped = { ...settings, allowedUploadRoots: [allowed] }
  const resolved = await policy.resolveUploadPath(scoped, okFile)
  assert.equal(resolved.size, 7)

  await assert.rejects(() => policy.resolveUploadPath(scoped, secretFile), /不在允许上传的目录/)
})

test('上传拒绝敏感文件名（P0-3）', async (t) => {
  const { settings, cleanup, root } = await makeSettings()
  t.after(cleanup)
  const allowed = path.join(root, 'downloads')
  await fs.mkdir(allowed, { recursive: true })
  const scoped = { ...settings, allowedUploadRoots: [allowed] }

  for (const name of ['.env', '.env.local', 'id_rsa', 'server.pem', 'client.key', 'keystore.jks', '.netrc']) {
    const file = path.join(allowed, name)
    await fs.writeFile(file, 'x', 'utf8')
    await assert.rejects(() => policy.resolveUploadPath(scoped, file), /敏感/, `${name} 应被拒绝`)
  }

  const harmless = path.join(allowed, 'memo.md')
  await fs.writeFile(harmless, 'x', 'utf8')
  assert.equal((await policy.resolveUploadPath(scoped, harmless)).size, 1)
})

test('上传拒绝目录、相对路径与不存在的文件（P0-3）', async (t) => {
  const { settings, cleanup, root } = await makeSettings()
  t.after(cleanup)
  const allowed = path.join(root, 'downloads')
  await fs.mkdir(allowed, { recursive: true })
  const scoped = { ...settings, allowedUploadRoots: [allowed] }

  await assert.rejects(() => policy.resolveUploadPath(scoped, 'relative/file.txt'), /绝对路径/)
  await assert.rejects(() => policy.resolveUploadPath(scoped, path.join(allowed, 'missing.txt')), /找不到/)
  await assert.rejects(() => policy.resolveUploadPath(scoped, allowed), /普通文件/)
})

test('上传不跟随符号链接逃出白名单（P0-3）', async (t) => {
  const { settings, cleanup, root } = await makeSettings()
  t.after(cleanup)
  const allowed = path.join(root, 'downloads')
  await fs.mkdir(allowed, { recursive: true })
  const secret = path.join(root, 'outside.txt')
  await fs.writeFile(secret, 'secret', 'utf8')
  const link = path.join(allowed, 'link.txt')
  if (!(await trySymlink(t, secret, link))) return

  await assert.rejects(
    () => policy.resolveUploadPath({ ...settings, allowedUploadRoots: [allowed] }, link),
    /不在允许上传的目录/,
  )
})

test('白名单根目录会做 realpath 规范化（Windows 短路径/符号链接根）', async (t) => {
  const { settings, cleanup, root } = await makeSettings()
  t.after(cleanup)
  const realDir = path.join(root, 'real-downloads')
  await fs.mkdir(realDir, { recursive: true })
  const file = path.join(realDir, 'artifact.tgz')
  await fs.writeFile(file, 'payload', 'utf8')

  const linkDir = path.join(root, 'linked-downloads')
  if (!(await tryDirLink(t, realDir, linkDir))) return

  // 配置里写的是链接路径，文件在真实路径下：canonicalize 之后应当放行。
  const resolved = await policy.resolveUploadPath({ ...settings, allowedUploadRoots: [linkDir] }, file)
  assert.equal(resolved.size, 7)
})

test('上传白名单拦住经由 junction 的目录逃逸（P0-3）', async (t) => {
  const { settings, cleanup, root } = await makeSettings()
  t.after(cleanup)
  const allowed = path.join(root, 'downloads')
  const outside = path.join(root, 'outside')
  await fs.mkdir(allowed, { recursive: true })
  await fs.mkdir(outside, { recursive: true })
  await fs.writeFile(path.join(outside, 'secret.txt'), 'secret', 'utf8')
  const junction = path.join(allowed, 'linked')
  if (!(await tryJunction(t, outside, junction))) return

  await assert.rejects(
    () => policy.resolveUploadPath({ ...settings, allowedUploadRoots: [allowed] }, path.join(junction, 'secret.txt')),
    /不在允许上传的目录/,
  )
})

test('默认上传白名单包含记忆目录与 Downloads（P0-3）', async (t) => {
  const { settings, cleanup } = await makeSettings()
  t.after(cleanup)
  assert.ok(Array.isArray(settings.allowedUploadRoots))
  assert.ok(settings.allowedUploadRoots.length >= 1)
  assert.ok(settings.allowedUploadRoots.some((p) => path.resolve(p) === path.resolve(settings.memoryDir)))
  assert.ok(settings.allowedUploadRoots.some((p) => /Downloads$/i.test(p)))
})
