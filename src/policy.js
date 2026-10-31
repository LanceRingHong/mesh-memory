import fs from 'node:fs/promises'
import path from 'node:path'

/** 永远不允许上传的文件名（P0-3）。 */
const SENSITIVE_BASENAMES = [
  /^\.env(\..+)?$/i,
  /^\.netrc$/i,
  /^\.npmrc$/i,
  /^\.git-credentials$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^key\.properties$/i,
  /^(credentials|secrets?)(\.json|\.ya?ml|\.txt)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore|ppk)$/i,
]

/** 永远不允许出现在上传路径里的目录段。 */
const SENSITIVE_SEGMENTS = new Set(['.ssh', '.gnupg', '.aws', '.dsh', '.kube'])

export function isSensitiveName(filePath) {
  const base = path.basename(String(filePath || ''))
  return SENSITIVE_BASENAMES.some((re) => re.test(base))
}

function normalize(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

/**
 * 上传前的本地路径校验（P0-3）：
 * - 必须是绝对路径、存在、普通文件；
 * - realpath 之后必须落在 allowedUploadRoots 内（符号链接不能逃逸）；
 * - 拒绝密钥/凭据类文件名与敏感目录。
 * 返回可交给 remote_upload_file 的真实路径。
 */
export async function resolveUploadPath(settings, localPath) {
  const given = String(localPath ?? '').trim()
  if (!given) throw new Error('localPath 不能为空')
  if (!path.isAbsolute(given)) throw new Error('localPath 必须是绝对路径')

  let real
  try {
    real = await fs.realpath(given)
  } catch {
    throw new Error(`找不到本机文件：${given}`)
  }
  const stat = await fs.stat(real)
  if (!stat.isFile()) throw new Error('localPath 必须是普通文件')

  // 根目录也要 canonicalize：Windows 8.3 短路径（RUNNER~1）与 realpath 的长路径
  // 字符串不相等，直接比较会误判为“越界”。根不存在时退回 resolve 结果。
  const roots = (
    await Promise.all(
      (settings.allowedUploadRoots || []).map(async (root) => {
        const abs = path.resolve(String(root))
        try {
          return await fs.realpath(abs)
        } catch {
          return abs
        }
      }),
    )
  ).filter(Boolean)
  if (!roots.length) throw new Error('插件未配置 allowedUploadRoots，已拒绝上传')
  const target = normalize(real)
  const inside = roots.some((root) => {
    const base = normalize(root)
    return target === base || target.startsWith(base + path.sep)
  })
  if (!inside) {
    throw new Error(
      `localPath 不在允许上传的目录内：${real}。允许的根目录：${roots.join('；')}。` +
        '需要扩展请在插件配置 allowedUploadRoots 中显式添加，不要绕过工具边界。',
    )
  }

  const segments = real.split(/[\\/]/).filter(Boolean).map((item) => item.toLowerCase())
  const hit = segments.find((segment) => SENSITIVE_SEGMENTS.has(segment))
  if (hit || isSensitiveName(real)) {
    throw new Error(`拒绝上传疑似敏感文件：${path.basename(real)}（命中敏感路径规则）`)
  }

  return { path: real, size: stat.size }
}
