import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { settingsOf } from '../src/config.js'

/**
 * 每个用例一个临时根目录：mem/（共享记忆）+ home/（DSH_HOME）。
 * 绝不触碰真实记忆目录。
 */
export async function makeSettings(overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-mesh-test-'))
  const memoryDir = path.join(root, 'mem')
  const dshHome = path.join(root, 'home')
  await fs.mkdir(memoryDir, { recursive: true })
  await fs.mkdir(dshHome, { recursive: true })
  const base = settingsOf({ memoryDir, deviceName: 'test-device' })
  const settings = { ...base, memoryDir, dshHome, ...overrides }
  return {
    settings,
    root,
    memoryDir,
    dshHome,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  }
}

export async function writeMemoryFile(memoryDir, rel, text, mtimeMs) {
  const file = path.join(memoryDir, rel)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, text, 'utf8')
  if (Number.isFinite(mtimeMs)) {
    await fs.utimes(file, new Date(mtimeMs), new Date(mtimeMs))
  }
  return file
}

export function memoryDoc({ title, description, body, extra = {} }) {
  const head = [
    '---',
    `title: ${JSON.stringify(title || 'doc')}`,
    `description: ${JSON.stringify(description || '')}`,
    ...Object.entries(extra).map(([k, v]) => `${k}: ${JSON.stringify(v)}`),
    '---',
    '',
  ].join('\n')
  return `${head}${body || ''}\n`
}

/** Windows 默认需要开发者模式/管理员才能建符号链接；建不了就跳过该用例。 */
export async function trySymlink(t, target, linkPath) {
  try {
    await fs.symlink(target, linkPath, 'file')
    return true
  } catch (error) {
    t.skip(`无法创建符号链接（${error.code || error.message}），跳过 symlink 用例`)
    return false
  }
}

/** junction 在 Windows 不需要特权，用来验证 realpath 包含检查。 */
export async function tryJunction(t, target, linkPath) {
  if (process.platform !== 'win32') return false
  try {
    await fs.symlink(target, linkPath, 'junction')
    return true
  } catch (error) {
    t.skip(`无法创建 junction（${error.code || error.message}）`)
    return false
  }
}
