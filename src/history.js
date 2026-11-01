import { execFile } from 'node:child_process'
import path from 'node:path'
import { backupDir } from './backup.js'

/**
 * 单条记忆的历史：读 `$DSH_HOME/dsh-mesh-backups.git` 里的快照。
 * 和 backup.js 共用同一个 GIT_DIR / GIT_WORK_TREE，不额外建库。
 */

function git(settings, args) {
  const env = {
    ...process.env,
    GIT_DIR: backupDir(settings),
    GIT_WORK_TREE: settings.memoryDir,
    GIT_TERMINAL_PROMPT: '0',
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      ['--no-pager', ...args],
      { cwd: settings.memoryDir, env, timeout: 20_000, windowsHide: true },
      (error, stdout, stderr) => resolve({
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        failed: Boolean(error),
      }),
    )
  })
}

function safeRel(settings, relPath) {
  const rel = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!rel.startsWith('memory/') || rel.includes('..')) return ''
  return rel
}

/** 某条记忆的历史版本（新→旧）。 */
export async function fileHistory(settings, relPath, { limit = 10 } = {}) {
  const rel = safeRel(settings, relPath)
  if (!rel) return { available: false, path: '', reason: '只支持 memory/ 下的路径', items: [] }
  const out = await git(settings, [
    'log',
    '--follow',
    '-n',
    String(Math.max(1, Math.min(50, Number(limit) || 10))),
    '--format=%H\t%ad\t%s',
    '--date=iso',
    '--',
    rel,
  ])
  if (out.failed) {
    const reason = /not a git repository|does not exist|unknown revision/i.test(out.stderr)
      ? '还没有快照（先做一次备份）'
      : out.stderr.trim() || '读取 git 历史失败'
    return { available: false, path: rel, reason, items: [] }
  }
  const items = out.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [commit, date, ...rest] = line.split('\t')
      return { commit, date, message: rest.join('\t') }
    })
  return { available: true, path: rel, items }
}

/** 某个版本的 diff（unified patch，最多 60 KB）。 */
export async function fileDiff(settings, relPath, commit) {
  const rel = safeRel(settings, relPath)
  const sha = String(commit || '').trim()
  if (!rel) throw new Error('只支持 memory/ 下的路径')
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) throw new Error('commit 只接受 4-40 位十六进制')
  const out = await git(settings, ['show', '--format=', '--no-color', '--patch', sha, '--', rel])
  if (out.failed) throw new Error(out.stderr.trim() || '读取 diff 失败')
  const patch = out.stdout || ''
  return { path: rel, commit: sha, patch: patch.slice(0, 60_000), truncated: patch.length > 60_000 }
}

/** 该文件是否在快照库里存在过（用来区分"没历史"和"读失败"）。 */
export async function historyExists(settings) {
  const out = await git(settings, ['rev-parse', '--short', 'HEAD'])
  return !out.failed
}

export function historyDir(settings) {
  return path.join(backupDir(settings))
}
