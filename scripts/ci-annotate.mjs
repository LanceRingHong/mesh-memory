// 把测试输出的尾部转成 GitHub Actions annotation：
// annotation 可以通过公开 API 读取，便于没有 gh token 时排障。
import fs from 'node:fs'

const file = process.argv[2] || 'test-output.txt'
let text = ''
try {
  text = fs.readFileSync(file, 'utf8')
} catch (error) {
  text = `无法读取 ${file}: ${error?.message || error}`
}
const lines = text.split('\n')
const tail = lines.slice(-80).join('\n')
const escaped = tail
  .replace(/%/g, '%25')
  .replace(/\r/g, '')
  .replace(/\n/g, '%0A')
  .slice(0, 60_000)
console.log(`::error title=unit test failure::${escaped}`)
