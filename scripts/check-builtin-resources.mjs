import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = resolve(fileURLToPath(new URL('../gateway/builtin-resources/', import.meta.url)))
const manifestPath = join(root, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const forbidden = [
    /(?:sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/,
    /(?:ANTHROPIC|OPENAI|DEEPSEEK|CLAUDE)_API_KEY\s*[:=]\s*[^$<{\s][^\s`"']+/i,
    /C:\\Users\\[^\r\n`"']+/i,
    /(?:Bearer|token)\s+[A-Za-z0-9._-]{24,}/i,
]
const errors = []
const seen = new Set()
for (const resource of manifest.resources || []) {
    for (const field of ['source', 'target']) {
        const value = String(resource[field] || '').replace(/\\/g, '/')
        if (!value || value.split('/').includes('..') || value.startsWith('/')) errors.push(`${resource.type}:${resource.id} ${field} 路径非法`)
    }
    const key = `${resource.type}:${resource.id}`
    if (seen.has(key)) errors.push(`资源重复：${key}`)
    seen.add(key)
    const source = join(root, resource.source)
    if (!existsSync(source)) errors.push(`资源缺失：${key} -> ${resource.source}`)
}
function walk(path) {
    if (!existsSync(path)) return
    if (statSync(path).isFile()) {
        const content = readFileSync(path, 'utf8')
        for (const pattern of forbidden) if (pattern.test(content)) errors.push(`疑似敏感内容：${path}`)
        return
    }
    for (const name of readdirSync(path)) walk(join(path, name))
}
walk(root)
if (errors.length) {
    console.error(errors.join('\n'))
    process.exit(1)
}
console.log(`[builtin-resources] 校验通过：${manifest.resources.length} 项`)
