/**
 * project-cache.mjs —— 项目结构缓存 + 依赖图
 * cHJvamVjdC1jYWNoZS5tanMgfCBnaXRodWIuY29tL2thbmthbmN1aWdlL2NsYXVkZS1kZXNrdG9wLWJyaWRnZQ==
 *
 * 按项目缓存文件树、符号表、依赖图。首次缓存全量构建，后续增量更新（SHA256 对比）。
 * lazy 注入：Claude 首次探索项目时通过 pushStream 注入摘要，避免重复探索。
 *
 * 对外 API:
 *   buildProjectCache(workDir)          → cache | null
 *   loadProjectCache(workDir)           → cache | null
 *   saveProjectCache(workDir, cache)
 *   updateProjectCache(workDir, cache, diffMap) → {updated, skipped}
 *   isExplorationAttempt(toolName, input) → bool
 *   buildCacheInjectionText(cache)      → string
 */

import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs'
import {join, dirname, relative, extname, basename} from 'node:path'
import {homedir} from 'node:os'

const require = createRequire(import.meta.url)

// ── 常量 ──
const CLAUDE_HOME = join(homedir(), '.claude')
const MAX_SNAP_FILE_BYTES = 512 * 1024
const MAX_SNAP_FILES = 5000
const SNAP_EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'build', '.next', 'out',
    '.cache', '.vscode', '.idea', 'coverage', '.nuxt', '.output', '.turbo', 'target',
    '__pycache__', '.venv', 'venv'])
const BINARY_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.pdf',
    '.zip', '.gz', '.tar', '.7z', '.exe', '.dll', '.so', '.dylib', '.woff', '.woff2', '.ttf',
    '.otf', '.mp3', '.mp4', '.mov', '.wav', '.webm', '.class', '.jar', '.pyc', '.wasm', '.node', '.bin'])

// tree-sitter 可用性（惰性检测，只检测一次）
let _tsAvailable = null

// ── 多语言扩展名 → 语言配置映射 ──
const LANG_CONFIG = {
    '.py':   {lang: 'python',  tsPackage: 'tree-sitter-python'},
    '.java': {lang: 'java',    tsPackage: 'tree-sitter-java'},
    '.go':   {lang: 'go',      tsPackage: 'tree-sitter-go'},
    '.cs':   {lang: 'csharp',  tsPackage: 'tree-sitter-c-sharp'},
    '.rs':   {lang: 'rust',    tsPackage: 'tree-sitter-rust'},
    '.c':    {lang: 'c',       tsPackage: 'tree-sitter-c'},
    '.h':    {lang: 'c',       tsPackage: 'tree-sitter-c'},
    '.cpp':  {lang: 'cpp',     tsPackage: 'tree-sitter-cpp'},
    '.cc':   {lang: 'cpp',     tsPackage: 'tree-sitter-cpp'},
    '.cxx':  {lang: 'cpp',     tsPackage: 'tree-sitter-cpp'},
    '.hpp':  {lang: 'cpp',     tsPackage: 'tree-sitter-cpp'},
    '.rb':   {lang: 'ruby',    tsPackage: 'tree-sitter-ruby'},
    '.php':  {lang: 'php',     tsPackage: 'tree-sitter-php'},
    '.kt':   {lang: 'kotlin',  tsPackage: '@tree-sitter-grammars/tree-sitter-kotlin'},
    '.kts':  {lang: 'kotlin',  tsPackage: '@tree-sitter-grammars/tree-sitter-kotlin'},
    '.swift':{lang: 'swift',   tsPackage: 'tree-sitter-swift'},
}
// tree-sitter 多语言解析器注册表（惰性加载，每语言独立 Parser 实例防止并发 setLanguage 冲突）
const _parserRegistry = new Map()   // lang → {parser, language} | false

// ── 各语言源文件扩展名（供 resolveImportPath 解析相对导入）──
const LANG_SOURCE_EXTS = {
    python:    ['.py', '.pyi', '.pyx'],
    java:      ['.java'],
    go:        ['.go'],
    csharp:    ['.cs'],
    rust:      ['.rs'],
    c:         ['.c', '.h'],
    cpp:       ['.cpp', '.cc', '.cxx', '.hpp', '.h'],
    ruby:      ['.rb'],
    php:       ['.php', '.phtml'],
    kotlin:    ['.kt', '.kts'],
    swift:     ['.swift'],
    javascript:['.js', '.jsx', '.mjs', '.cjs'],
    typescript:['.ts', '.tsx'],
}

// ── resolveImportPath 用：所有已知源文件扩展名 ──
const ALL_RESOLVABLE_EXTS = [
    '', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue',
    '/index.ts', '/index.js', '/index.vue',
    '.py', '.pyi', '/__init__.py',
    '.java', '.go', '.cs', '.rs',
    '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp',
    '.rb', '.php', '.kt', '.kts', '.swift',
]

// ── 路径编码（对齐 index.mjs encodeProjectName）──
function encodeProjectName(wd) {
    const n = wd.replace(/\\/g, '/')
    const dm = n.match(/^([a-zA-Z]):\/(.*)$/)
    if (!dm) return n.replace(/\//g, '-')
    return dm[1] + '--' + dm[2].replace(/\//g, '-')
}

// ── 辅助函数 ──
function isBinaryPath(p) {
    const dot = p.lastIndexOf('.')
    if (dot < 0) return false
    return BINARY_EXTS.has(p.slice(dot).toLowerCase())
}

function readJSON(p) {
    try {
        return JSON.parse(readFileSync(p, 'utf8'))
    } catch {
        return null
    }
}

function writeJSON(p, d) {
    const parent = dirname(p)
    if (!existsSync(parent)) mkdirSync(parent, {recursive: true})
    writeFileSync(p, JSON.stringify(d, null, 2), 'utf8')
}

function computeContentHash(content) {
    return createHash('sha256').update(content, 'utf8').digest('hex')
}

function sha256File(absPath) {
    try {
        const buf = readFileSync(absPath)
        return createHash('sha256').update(buf).digest('hex')
    } catch {
        return null
    }
}

function resolveImportPath(fromFile, importSpec, knownFiles) {
    if (importSpec.startsWith('.')) {
        // 相对路径: ./foo, ../bar
        const base = dirname(fromFile).replace(/\\/g, '/')
        const parts = base ? base.split('/') : []
        const specParts = importSpec.replace(/\\/g, '/').split('/')
        const resolved = []
        for (const seg of specParts) {
            if (seg === '..') {
                if (resolved.length) resolved.pop(); else if (parts.length) parts.pop()
            } else if (seg !== '.') resolved.push(seg)
        }
        const candidate = [...parts, ...resolved].join('/')
        // 尝试匹配已知文件（处理省略扩展名的情况）
        if (knownFiles.has(candidate)) return candidate
        for (const ext of ALL_RESOLVABLE_EXTS) {
            const tryPath = candidate + ext
            if (knownFiles.has(tryPath)) return tryPath
        }
        return candidate // 兜底：返回最佳猜测
    }
    // 路径别名 (@/xxx, ~/xxx) — 返回 null（标记为 external）
    // 非相对路径且不在已知文件中 → external
    return null
}

// ── tree-sitter 惰性初始化 ──
// 功能说明: 动态 import tree-sitter，失败返回 null → 后续自动退化为 regex 解析
// 实现方式: 异步 require.resolve 探测 + import() 加载 → 缓存解析器实例
async function ensureTreeSitter() {
    if (_tsAvailable !== null) return _tsAvailable ? _tsAvailable.parser : null
    try {
        // 先探测包是否存在
        require.resolve('tree-sitter')
        require.resolve('tree-sitter-javascript')
        require.resolve('tree-sitter-typescript')
        const Parser = (await import('tree-sitter')).default
        const JavaScript = (await import('tree-sitter-javascript')).default
        const TypeScript = (await import('tree-sitter-typescript')).default
        const parser = new Parser()
        // tree-sitter-typescript 提供两种语言: tsx（用于 .tsx）和 typescript（用于 .ts）
        // 根据历史 API，导出的分别是 TypeScript 对象含 tsx 和 typescript 属性
        const tsLang = TypeScript.tsx || TypeScript.typescript || TypeScript
        const jsLang = JavaScript
        _tsAvailable = {parser, tsLang, jsLang}
        return parser
    } catch (e) {
        _tsAvailable = false
        return null
    }
}

// ── tree-sitter 解析 imports/exports ──
// 功能说明: 遍历 AST 提取所有 import/export 声明
// 实现方式: 递归 walk tree-sitter 语法树，匹配 named_imports/namespace_import/export_statement 等节点
function parseImportsTreeSitter(source, ext) {
    if (!_tsAvailable || _tsAvailable === false) return null
    const {parser, tsLang, jsLang} = _tsAvailable
    const lang = ext === '.ts' || ext === '.tsx' ? tsLang : jsLang
    parser.setLanguage(lang)
    const tree = parser.parse(source)
    const root = tree.rootNode

    const imports = []
    const exports = []
    const visited = new Set()

    function walk(node) {
        if (!node || visited.has(node.id)) return
        visited.add(node.id)
        const type = node.type

        // ES import: import { foo, bar } from './module'
        //          import foo from './module'
        //          import * as foo from './module'
        //          import './module' (side-effect)
        if (type === 'import_statement') {
            let from = ''
            const names = []
            let isDynamic = false
            for (const child of node.children) {
                if (child.type === 'string') {
                    from = child.text.slice(1, -1) // 去掉引号
                }
                if (child.type === 'import_clause') {
                    for (const sub of child.children) {
                        if (sub.type === 'named_imports') {
                            for (const spec of sub.children) {
                                if (spec.type === 'import_specifier') {
                                    const nameNode = spec.childForFieldName('name')
                                    if (nameNode) names.push(nameNode.text)
                                }
                            }
                        }
                        if (sub.type === 'namespace_import') {
                            names.push('*')
                        }
                        if (sub.type === 'identifier') {
                            names.push(sub.text)
                        }
                    }
                }
                // call_expression → import() 动态导入
                if (child.type === 'call_expression') {
                    isDynamic = true
                    for (const arg of child.children) {
                        if (arg.type === 'arguments') {
                            for (const s of arg.children) {
                                if (s.type === 'string') {
                                    from = s.text.slice(1, -1);
                                    break
                                }
                            }
                        }
                    }
                }
            }
            if (from && !isDynamic) {
                imports.push({
                    from,
                    names: names.length ? names : ['*'],
                    external: !from.startsWith('.') && !from.startsWith('/')
                })
            }
        }

        // export: export const foo = ...
        //        export function foo() ...
        //        export default function() ...
        //        export { foo, bar }
        if (type === 'export_statement') {
            for (const child of node.children) {
                // export { foo, bar as baz }
                if (child.type === 'export_clause') {
                    for (const spec of child.children) {
                        if (spec.type === 'export_specifier') {
                            const nameNode = spec.childForFieldName('name')
                            if (nameNode) exports.push(nameNode.text)
                        }
                    }
                }
                // export const foo = ..., export function foo(), export class Foo
                if (child.type === 'variable_declaration' || child.type === 'lexical_declaration') {
                    for (const decl of child.children) {
                        if (decl.type === 'variable_declarator') {
                            const nameNode = decl.childForFieldName('name')
                            if (nameNode) {
                                if (nameNode.type === 'identifier') exports.push(nameNode.text)
                                else if (nameNode.type === 'object_pattern') {
                                    for (const prop of nameNode.children) {
                                        if (prop.type === 'shorthand_property_identifier') exports.push(prop.text)
                                    }
                                }
                            }
                        }
                    }
                }
                if (child.type === 'function_declaration') {
                    const nameNode = child.childForFieldName('name')
                    if (nameNode) exports.push(nameNode.text)
                }
                if (child.type === 'class_declaration') {
                    const nameNode = child.childForFieldName('name')
                    if (nameNode) exports.push(nameNode.text)
                }
                // export default function/class/expression
                if (child.type === 'function_declaration' || child.type === 'class_declaration') {
                    const nameNode = child.childForFieldName('name')
                    if (nameNode) exports.push(nameNode.text)
                    else exports.push('default')
                }
            }
        }

        // 顶层 const/let/var 声明（可能有 CommonJS module.exports）
        if (type === 'variable_declaration' || type === 'lexical_declaration') {
            for (const child of node.children) {
                if (child.type === 'variable_declarator') {
                    const nameNode = child.childForFieldName('name')
                    const valueNode = child.childForFieldName('value')
                    if (valueNode && valueNode.type === 'call_expression') {
                        // 检测 require() 模式
                        const fnNode = valueNode.childForFieldName('function')
                        if (fnNode && fnNode.text === 'require') {
                            const args = valueNode.childForFieldName('arguments')
                            if (args) {
                                for (const arg of args.children) {
                                    if (arg.type === 'string') {
                                        const modPath = arg.text.slice(1, -1)
                                        imports.push({
                                            from: modPath,
                                            names: nameNode ? (nameNode.type === 'identifier' ? [nameNode.text] : ['*']) : ['*'],
                                            external: !modPath.startsWith('.') && !modPath.startsWith('/')
                                        })
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // module.exports = ...
        if (type === 'assignment_expression') {
            const left = node.childForFieldName('left')
            if (left && left.type === 'member_expression') {
                const obj = left.childForFieldName('object')
                const prop = left.childForFieldName('property')
                if (obj && obj.text === 'module' && prop && prop.text === 'exports') {
                    const right = node.childForFieldName('right')
                    if (right) {
                        if (right.type === 'identifier') exports.push(right.text)
                        else if (right.type === 'object') {
                            for (const pair of right.children) {
                                if (pair.type === 'pair') {
                                    const key = pair.childForFieldName('key')
                                    if (key) exports.push(key.text)
                                }
                            }
                        }
                    }
                }
            }
        }

        // 递归子节点
        for (const child of node.children) {
            walk(child)
        }
    }

    walk(root)
    // 去重
    const uniqueImports = []
    const seenImports = new Set()
    for (const imp of imports) {
        const key = imp.from + '|' + (imp.names || []).join(',')
        if (!seenImports.has(key)) {
            seenImports.add(key);
            uniqueImports.push(imp)
        }
    }
    return {exports: [...new Set(exports)], imports: uniqueImports}
}

// ── Regex fallback 解析 imports/exports ──
// 功能说明: 正则匹配静态 import / require / export 声明
//   用于 tree-sitter 不可用时降级、以及 Vue SFC 等非标准扩展名文件
// 实现方式: 三组正则逐行匹配: import ... from '...' / require('...') / export ...
function parseImportsRegex(source, ext) {
    const imports = []
    const exports = []

    // 静态 import 声明
    const importRe = /import\s+(?:type\s+)?(?:(?:\{[^}]*\}|[\w\s,]+)\s+from\s+)?['"]([^'"]+)['"]/g
    let m
    while ((m = importRe.exec(source)) !== null) {
        const from = m[1]
        // 从已匹配文本中提取导入名
        const text = m[0]
        const names = []
        const namedMatch = text.match(/import\s+\{([^}]+)\}/)
        if (namedMatch) {
            for (const part of namedMatch[1].split(',')) {
                const name = part.trim().split(/\s+as\s+/)[0].trim()
                if (name) names.push(name)
            }
        }
        const defaultMatch = text.match(/import\s+(\w+)/)
        if (defaultMatch && defaultMatch[1] !== 'type' && !names.includes(defaultMatch[1])) {
            names.push(defaultMatch[1])
        }
        const nsMatch = text.match(/import\s+\*\s+as\s+(\w+)/)
        if (nsMatch) names.push('*')
        imports.push({
            from,
            names: names.length ? names : ['*'],
            external: !from.startsWith('.') && !from.startsWith('/')
        })
    }

    // 动态 import
    const dynRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    while ((m = dynRe.exec(source)) !== null) {
        imports.push({from: m[1], names: ['*'], external: !m[1].startsWith('.') && !m[1].startsWith('/')})
    }

    // CommonJS require
    const requireRe = /(?:const|let|var)\s+(\{[^}]*\}|[\w\s,]+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    while ((m = requireRe.exec(source)) !== null) {
        const binding = m[1]
        const from = m[2]
        const names = []
        if (binding.startsWith('{')) {
            for (const part of binding.slice(1, -1).split(',')) {
                const trimmed = part.trim()
                const colon = trimmed.indexOf(':')
                names.push(colon > 0 ? trimmed.slice(0, colon).trim() : trimmed)
            }
        } else {
            names.push(binding.trim())
        }
        imports.push({from, names, external: !from.startsWith('.') && !from.startsWith('/')})
    }

    // export 声明
    const exportDeclRe = /export\s+(?:const|let|var|function|class|default\s+(?:function|class)?|type|interface|enum|async\s+function)\s+(\w+)/g
    while ((m = exportDeclRe.exec(source)) !== null) {
        if (m[1] !== 'function' && m[1] !== 'class') exports.push(m[1])
    }

    // export { X, Y as Z }
    const namedExportRe = /export\s+\{([^}]+)\}/g
    while ((m = namedExportRe.exec(source)) !== null) {
        for (const part of m[1].split(',')) {
            const cleaned = part.trim().split(/\s+as\s+/)[0].trim()
            if (cleaned) exports.push(cleaned)
        }
    }

    // export default expression
    if (/export\s+default\s+/.test(source) && !/export\s+default\s+(?:function|class)\s+(\w+)/.test(source)) {
        exports.push('default')
    }

    return {exports: [...new Set(exports)], imports}
}

// ── 多语言 helper ──
function getLangConfig(ext) {
    return LANG_CONFIG[ext.toLowerCase()] || null
}

// ── ensureParserForLang ── 惰性加载单语言 parser
async function ensureParserForLang(langConfig) {
    const {lang, tsPackage} = langConfig
    if (_parserRegistry.has(lang)) {
        const entry = _parserRegistry.get(lang)
        return entry === false ? null : entry
    }
    try {
        require.resolve('tree-sitter')
        require.resolve(tsPackage)
        if (!_parserRegistry.has(lang)) {
            const Parser = (await import('tree-sitter')).default
            const LangModule = (await import(tsPackage)).default
            const parser = new Parser()
            parser.setLanguage(LangModule)
            _parserRegistry.set(lang, {parser, language: LangModule})
        }
        return _parserRegistry.get(lang)
    } catch (e) {
        _parserRegistry.set(lang, false)
        return null
    }
}

// ════════════════════ 多语言 Regex 解析器（tree-sitter 不可用时的兜底）════════════════════

function parsePythonRegex(source) {
    const imports = [], exports = []
    // import os, sys / from os import path / from os.path import join as pjoin
    const fromRe = /^from\s+(\S+)\s+import\s+(.+)$/gm
    let m
    while ((m = fromRe.exec(source)) !== null) {
        for (const item of m[2].split(',')) {
            const name = item.trim().split(/\s+as\s+/)[0].trim()
            if (name && name !== '*') imports.push({from: m[1], names: [name], external: !m[1].startsWith('.')})
        }
    }
    const importRe = /^import\s+(.+)$/gm
    while ((m = importRe.exec(source)) !== null) {
        for (const item of m[1].split(',')) {
            const name = item.trim().split(/\s+as\s+/)[0].trim()
            imports.push({from: name, names: [name.split('.')[0]], external: true})
        }
    }
    const defRe = /^(?:def|class)\s+(\w+)/gm
    while ((m = defRe.exec(source)) !== null) { exports.push(m[1]) }
    const allRe = /__all__\s*=\s*\[([^\]]+)\]/g
    while ((m = allRe.exec(source)) !== null) {
        for (const item of m[1].split(',')) {
            const n = item.trim().replace(/['"]/g, '')
            if (n) exports.push(n)
        }
    }
    return {exports: [...new Set(exports)], imports}
}

function parseJavaRegex(source) {
    const imports = [], exports = []
    const importRe = /^import\s+((?:static\s+)?[\w.]+(?:\.[*\w]+)?)\s*;/gm
    let m
    while ((m = importRe.exec(source)) !== null) {
        const parts = m[1].replace(/^static\s+/, '').split('.')
        imports.push({from: m[1], names: [parts[parts.length - 1]], external: true})
    }
    const classRe = /^\s*(?:public\s+)?(?:abstract\s+|final\s+)?(?:class|interface|enum|@interface)\s+(\w+)/gm
    while ((m = classRe.exec(source)) !== null) { exports.push(m[1]) }
    return {exports: [...new Set(exports)], imports}
}

function parseGoRegex(source) {
    const imports = [], exports = []
    const singleRe = /import\s+(?:(\w+)\s+)?["']([^"']+)["']/g
    let m
    while ((m = singleRe.exec(source)) !== null) {
        imports.push({from: m[2], names: [m[1] || m[2].split('/').pop()], external: !m[2].startsWith('.')})
    }
    const blockRe = /import\s*\(([^)]+)\)/gs
    while ((m = blockRe.exec(source)) !== null) {
        const innerRe = /(?:(\w+)\s+)?["']([^"']+)["']/g
        let im
        while ((im = innerRe.exec(m[1])) !== null) {
            imports.push({from: im[2], names: [im[1] || im[2].split('/').pop()], external: !im[2].startsWith('.')})
        }
    }
    const exportRe = /^(?:func|type)\s+(?:\([^)]*\)\s*)?(\w+)/gm
    while ((m = exportRe.exec(source)) !== null) { if (m[1] && m[1] !== '(') exports.push(m[1]) }
    const varRe = /^var\s+(\w+)/gm
    while ((m = varRe.exec(source)) !== null) { exports.push(m[1]) }
    const constRe = /^const\s+(\w+)/gm
    while ((m = constRe.exec(source)) !== null) { exports.push(m[1]) }
    return {exports: [...new Set(exports)], imports}
}

function parseCSharpRegex(source) {
    const imports = [], exports = []
    const usingRe = /^using\s+((?:static\s+)?[\w.]+)\s*;/gm
    let m
    while ((m = usingRe.exec(source)) !== null) {
        const parts = m[1].replace(/^static\s+/, '').split('.')
        imports.push({from: m[1], names: [parts[parts.length - 1]], external: true})
    }
    const typeRe = /^\s*(?:public\s+|internal\s+|protected\s+|private\s+)?(?:static\s+|abstract\s+|sealed\s+|partial\s+|readonly\s+)*(?:class|interface|enum|struct|record)\s+(\w+)/gm
    while ((m = typeRe.exec(source)) !== null) { exports.push(m[1]) }
    const nsRe = /^namespace\s+([\w.]+)/gm
    while ((m = nsRe.exec(source)) !== null) { exports.push(m[1].split('.').pop()) }
    return {exports: [...new Set(exports)], imports}
}

function parseRustRegex(source) {
    const imports = [], exports = []
    const useRe = /^use\s+([\w:]+(?:::\{[^}]+\})?(?:::[\w*]+)?)\s*;/gm
    let m
    while ((m = useRe.exec(source)) !== null) {
        const path = m[1]
        const last = path.split('::').pop().replace(/[{}]/g, '')
        imports.push({from: path, names: [last], external: !path.startsWith('crate') && !path.startsWith('self') && !path.startsWith('super')})
    }
    const extRe = /^extern\s+crate\s+(\w+)/gm
    while ((m = extRe.exec(source)) !== null) { imports.push({from: m[1], names: [m[1]], external: true}) }
    const pubRe = /^pub(?:\s*\([^)]*\))?\s+(?:async\s+)?(?:unsafe\s+)?(?:fn|struct|enum|trait|mod|type|const|static)\s+(\w+)/gm
    while ((m = pubRe.exec(source)) !== null) { exports.push(m[1]) }
    return {exports: [...new Set(exports)], imports}
}

function parseCRegex(source) {
    const imports = [], exports = []
    const includeRe = /^#include\s+[<"]([^>"]+)[>"]/gm
    let m
    while ((m = includeRe.exec(source)) !== null) {
        const name = m[1].split('/').pop().replace(/\.h$/, '')
        imports.push({from: m[1], names: [name], external: true})
    }
    const funcRe = /^\s*(?:static\s+|inline\s+|extern\s+|__attribute__\s*\([^)]*\)\s*)*(?:\w+[\s*]+)+(\w+)\s*\([^)]*\)\s*\{/gm
    while ((m = funcRe.exec(source)) !== null) {
        if (!/^(if|while|for|switch|return|sizeof)$/.test(m[1])) exports.push(m[1])
    }
    return {exports: [...new Set(exports)], imports}
}

function parseCppRegex(source) {
    const result = parseCRegex(source)
    const classRe = /^\s*(?:class|struct|enum\s+class|enum\s+struct)\s+(\w+)/gm
    let m
    while ((m = classRe.exec(source)) !== null) { result.exports.push(m[1]) }
    const nsRe = /^namespace\s+(\w+)/gm
    while ((m = nsRe.exec(source)) !== null) { result.exports.push(m[1]) }
    const usingRe = /^using\s+namespace\s+([\w:]+)/gm
    while ((m = usingRe.exec(source)) !== null) { result.imports.push({from: m[1], names: ['*'], external: true}) }
    result.exports = [...new Set(result.exports)]
    return result
}

function parseRubyRegex(source) {
    const imports = [], exports = []
    const reqRe = /(?:require|require_relative|load)\s+['"]([^'"]+)['"]/g
    let m
    while ((m = reqRe.exec(source)) !== null) {
        imports.push({from: m[1], names: ['*'], external: !m[1].startsWith('.') && !m[1].startsWith('/')})
    }
    const classRe = /^\s*(?:class|module)\s+(\w+(?:::[\w]+)*)/gm
    while ((m = classRe.exec(source)) !== null) { exports.push(m[1]) }
    const defRe = /^\s*def\s+(?:self\.)?(\w+[!?]?)/gm
    while ((m = defRe.exec(source)) !== null) { exports.push(m[1]) }
    return {exports: [...new Set(exports)], imports}
}

function parsePhpRegex(source) {
    const imports = [], exports = []
    const useRe = /^use\s+([\w\\]+)(?:\s+as\s+(\w+))?\s*;/gm
    let m
    while ((m = useRe.exec(source)) !== null) {
        const parts = m[1].split('\\')
        imports.push({from: m[1], names: [m[2] || parts[parts.length - 1]], external: true})
    }
    const incRe = /(?:require(?:_once)?|include(?:_once)?)\s*(?:\(?\s*)?['"]([^'"]+)['"]/g
    while ((m = incRe.exec(source)) !== null) {
        imports.push({from: m[1], names: ['*'], external: !m[1].startsWith('.')})
    }
    const classRe = /^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait|enum)\s+(\w+)/gm
    while ((m = classRe.exec(source)) !== null) { exports.push(m[1]) }
    const funcRe = /^\s*(?:public\s+|protected\s+|private\s+|static\s+)*function\s+(\w+)\s*\(/gm
    while ((m = funcRe.exec(source)) !== null) { exports.push(m[1]) }
    return {exports: [...new Set(exports)], imports}
}

function parseKotlinRegex(source) {
    const imports = [], exports = []
    const importRe = /^import\s+([\w.*]+)\s*$/gm
    let m
    while ((m = importRe.exec(source)) !== null) {
        const parts = m[1].split('.')
        imports.push({from: m[1], names: [parts[parts.length - 1]], external: true})
    }
    const classRe = /^\s*(?:data\s+|sealed\s+|abstract\s+|open\s+|inner\s+)?(?:class|interface|object|enum\s+class)\s+(\w+)/gm
    while ((m = classRe.exec(source)) !== null) { exports.push(m[1]) }
    const funRe = /^\s*(?:suspend\s+|inline\s+|tailrec\s+|override\s+|open\s+)?fun\s+(?:<[^>]+>\s*)?(\w+)/gm
    while ((m = funRe.exec(source)) !== null) { exports.push(m[1]) }
    const valRe = /^\s*(?:val|var|const)\s+(\w+)/gm
    while ((m = valRe.exec(source)) !== null) { exports.push(m[1]) }
    return {exports: [...new Set(exports)], imports}
}

function parseSwiftRegex(source) {
    const imports = [], exports = []
    const importRe = /^import\s+(?:typealias\s+|struct\s+|class\s+|enum\s+|protocol\s+|let\s+|var\s+|func\s+)?(\S+)/gm
    let m
    while ((m = importRe.exec(source)) !== null) {
        const parts = m[1].split('.')
        imports.push({from: m[1], names: [parts[parts.length - 1]], external: true})
    }
    const typeRe = /^\s*(?:public\s+|internal\s+|private\s+|fileprivate\s+|open\s+|final\s+)?(?:class|struct|enum|protocol|extension|actor)\s+(\w+)/gm
    while ((m = typeRe.exec(source)) !== null) { exports.push(m[1]) }
    const funcRe = /^\s*(?:public\s+|internal\s+|private\s+|override\s+|mutating\s+)*func\s+(\w+)/gm
    while ((m = funcRe.exec(source)) !== null) { exports.push(m[1]) }
    return {exports: [...new Set(exports)], imports}
}

// ── regex dispatch map（对齐 LANG_CONFIG）──
const LANG_REGEX_PARSERS = {
    python: parsePythonRegex, java: parseJavaRegex, go: parseGoRegex,
    csharp: parseCSharpRegex, rust: parseRustRegex, c: parseCRegex,
    cpp: parseCppRegex, ruby: parseRubyRegex, php: parsePhpRegex,
    kotlin: parseKotlinRegex, swift: parseSwiftRegex,
}

// ── dedupe helpers ──
function dedupeImports(imports) {
    const seen = new Set(), result = []
    for (const imp of imports) {
        const key = imp.from + '|' + (imp.names || []).join(',')
        if (!seen.has(key)) { seen.add(key); result.push(imp) }
    }
    return result
}

// ── parseImportsTreeSitterMulti ── 多语言 tree-sitter 统一调度
// 使用 tree-sitter 原生 query 语法提取 imports/exports（比 AST walk 更可靠）
function parseImportsTreeSitterMulti(source, ext, langConfig) {
    const entry = _parserRegistry.get(langConfig.lang)
    if (!entry || entry === false) return null
    const {parser, language} = entry

    // 每语言独立 Parser 实例，无需 setLanguage（已在 ensureParserForLang 中设置）
    const tree = parser.parse(source)
    const root = tree.rootNode

    // 按语言定义要匹配的节点类型 + 提取逻辑
    const patterns = LANG_AST_PATTERNS[langConfig.lang]
    if (!patterns) return null

    return extractByPatterns(root, patterns, source)
}

// ── 各语言 tree-sitter AST 节点模式定义 ──
const LANG_AST_PATTERNS = {
    python: {
        importNodes: ['import_statement', 'import_from_statement'],
        exportNodes: ['function_definition', 'class_definition'],
        extractImport(node, source) {
            if (node.type === 'import_from_statement') {
                const modName = node.descendantsOfType('dotted_name')[0]
                const from = modName ? modName.text : ''
                const names = node.descendantsOfType('dotted_name').slice(1).map(n => n.text)
                    .concat(node.descendantsOfType('identifier').map(n => n.text))
                return [{from: from || node.text, names: [...new Set(names)], external: !from.startsWith('.')}]
            }
            // import_statement: import os, sys
            const names = node.descendantsOfType('dotted_name').map(n => {
                const parts = n.text.split('.')
                return parts[0]
            }).filter(Boolean)
            if (names.length) return names.map(n => ({from: n, names: [n], external: true}))
            const ids = node.descendantsOfType('identifier').map(n => n.text).filter(Boolean)
            return ids.map(n => ({from: n, names: [n], external: true}))
        },
        extractExport(node) {
            const nameNode = node.childForFieldName('name')
            return nameNode ? [nameNode.text] : []
        },
    },
    java: {
        importNodes: ['import_declaration'],
        exportNodes: ['class_declaration', 'interface_declaration', 'enum_declaration'],
        extractImport(node) {
            const scoped = node.descendantsOfType('scoped_identifier')
            const ids = node.descendantsOfType('identifier')
            if (scoped.length) {
                const full = scoped[0].text
                const parts = full.split('.')
                return [{from: full, names: [parts[parts.length - 1]], external: true}]
            }
            if (ids.length >= 1) return [{from: ids[ids.length - 1].text, names: [ids[ids.length - 1].text], external: true}]
            return []
        },
        extractExport(node) {
            const nameNode = node.childForFieldName('name')
            return nameNode ? [nameNode.text] : []
        },
    },
    go: {
        importNodes: ['import_declaration'],
        exportNodes: ['function_declaration', 'type_declaration', 'var_declaration', 'const_declaration'],
        extractImport(node) {
            const specs = node.descendantsOfType('import_spec')
            return specs.map(s => {
                const paths = s.descendantsOfType('interpreted_string_literal')
                const path = paths.length ? paths[0].text.slice(1, -1) : ''
                const alias = s.descendantsOfType('package_identifier')
                const name = alias.length ? alias[0].text : path.split('/').pop()
                return {from: path, names: [name], external: !path.startsWith('.')}
            })
        },
        extractExport(node) {
            const nameNode = node.childForFieldName('name')
            return nameNode ? [nameNode.text] : []
        },
    },
    csharp: {
        importNodes: ['using_directive'],
        exportNodes: ['class_declaration', 'interface_declaration', 'struct_declaration', 'enum_declaration', 'namespace_declaration'],
        extractImport(node) {
            const name = node.descendantsOfType('identifier').map(n => n.text).join('.')
                || node.descendantsOfType('qualified_name').map(n => n.text).join('.')
            if (!name) return []
            const parts = name.split('.')
            return [{from: name, names: [parts[parts.length - 1]], external: true}]
        },
        extractExport(node) {
            const nameNode = node.childForFieldName('name')
            return nameNode ? [nameNode.text] : []
        },
    },
    rust: {
        importNodes: ['use_declaration', 'extern_crate_declaration'],
        exportNodes: ['function_item', 'struct_item', 'enum_item', 'trait_item', 'mod_item', 'type_item', 'const_item', 'static_item'],
        extractImport(node) {
            if (node.type === 'extern_crate_declaration') {
                const ids = node.descendantsOfType('identifier')
                const name = ids.length ? ids[0].text : ''
                return name ? [{from: name, names: [name], external: true}] : []
            }
            const paths = node.text.replace(/^use\s+/, '').replace(/;$/, '').trim()
            const last = paths.split('::').pop().replace(/[{}]/g, '')
            return [{from: paths, names: [last], external: !paths.startsWith('crate') && !paths.startsWith('self') && !paths.startsWith('super')}]
        },
        extractExport(node) {
            const nameNode = node.childForFieldName('name')
            return nameNode ? [nameNode.text] : []
        },
    },
    c: {
        importNodes: ['preproc_include'],
        exportNodes: ['function_definition'],
        extractImport(node) {
            const paths = node.descendantsOfType('system_lib_string').concat(node.descendantsOfType('string_literal'))
            if (!paths.length && node.children.length > 1) {
                const text = node.text
                const m = text.match(/[<"]([^>"]+)[>"]/)
                if (m) return [{from: m[1], names: [m[1].split('/').pop().replace(/\.h$/, '')], external: true}]
            }
            return paths.map(p => {
                const path = p.text.slice(1, -1)
                return {from: path, names: [path.split('/').pop().replace(/\.h$/, '')], external: true}
            })
        },
        extractExport(node) {
            const decl = node.descendantsOfType('function_declarator')
            if (decl.length) {
                const ids = decl[0].descendantsOfType('identifier')
                return ids.length ? [ids[0].text] : []
            }
            return []
        },
    },
    cpp: {
        importNodes: ['preproc_include', 'using_declaration'],
        exportNodes: ['function_definition', 'class_specifier', 'struct_specifier', 'namespace_definition'],
        extractImport(node, source) {
            const cResult = LANG_AST_PATTERNS.c.extractImport(node, source)
            if (cResult.length) return cResult
            const ids = node.descendantsOfType('identifier')
            if (ids.length) return [{from: ids.map(n => n.text).join('::'), names: [ids[ids.length - 1].text], external: true}]
            return []
        },
        extractExport(node) {
            const nameNode = node.childForFieldName('name')
            return nameNode ? [nameNode.text] : []
        },
    },
    ruby: {
        importNodes: ['call'],
        exportNodes: ['class', 'module', 'method'],
        extractImport(node) {
            const method = node.childForFieldName('method')
            if (!method || !['require', 'require_relative', 'load'].includes(method.text)) return []
            const args = node.descendantsOfType('string')
            return args.map(a => {
                const path = a.text.slice(1, -1)
                return {from: path, names: ['*'], external: !path.startsWith('.') && !path.startsWith('/')}
            })
        },
        extractExport(node) {
            const nameNode = node.childForFieldName('name')
            return nameNode ? [nameNode.text] : []
        },
    },
    php: {
        importNodes: ['namespace_use_declaration'],
        exportNodes: ['class_declaration', 'function_definition', 'interface_declaration', 'trait_declaration', 'enum_declaration'],
        extractImport(node) {
            const names = node.descendantsOfType('name').map(n => n.text)
            if (!names.length) return []
            const full = names.join('\\')
            const nss = node.descendantsOfType('namespace_use_clause')
            return nss.map(n => ({from: full, names: [n.text.split('\\').pop()], external: true}))
        },
        extractExport(node) {
            const nameNode = node.childForFieldName('name')
            return nameNode ? [nameNode.text] : []
        },
    },
    kotlin: {
        importNodes: ['import_header', 'import_declaration'],
        exportNodes: ['class_declaration', 'function_declaration', 'object_declaration'],
        extractImport(node) {
            const ids = node.descendantsOfType('identifier')
            if (!ids.length) return []
            const last = ids[ids.length - 1].text
            return [{from: ids.map(n => n.text).join('.'), names: [last], external: true}]
        },
        extractExport(node) {
            const nameNode = node.childForFieldName('name') || node.descendantsOfType('simple_identifier')[0]
            return nameNode ? [nameNode.text] : []
        },
    },
    swift: {
        importNodes: ['import_declaration'],
        exportNodes: ['class_declaration', 'struct_declaration', 'enum_declaration', 'protocol_declaration', 'function_declaration', 'extension_declaration'],
        extractImport(node) {
            const ids = node.descendantsOfType('identifier')
            return ids.length ? [{from: ids.map(n => n.text).join('.'), names: [ids[ids.length - 1].text], external: true}] : []
        },
        extractExport(node) {
            const nameNode = node.childForFieldName('name')
            return nameNode ? [nameNode.text] : []
        },
    },
}

// ── extractByPatterns ── 通用 tree-sitter 模式匹配提取器
function extractByPatterns(root, patterns, source) {
    const imports = [], exports = [], visited = new Set()

    function walk(node) {
        if (!node || visited.has(node.id)) return
        visited.add(node.id)
        const type = node.type

        if (patterns.importNodes.includes(type)) {
            const result = patterns.extractImport(node, source)
            if (result && result.length) imports.push(...result)
        }
        if (patterns.exportNodes.includes(type)) {
            const result = patterns.extractExport(node, source)
            if (result && result.length) exports.push(...result)
        }

        for (const child of node.children) { walk(child) }
    }

    walk(root)
    return {exports: [...new Set(exports)], imports: dedupeImports(imports)}
}

// ── Vue SFC script 提取 ──
// 从 .vue 单文件组件中提取 <script> / <script setup> 块内容
// 返回 {source, ext} — ext 用于选择 tree-sitter 语言（.ts/.js）
function extractVueScript(source) {
    // 优先匹配 <script setup lang="ts"> 或 <script lang="ts" setup>
    const setupRe = /<script\s[^>]*\bsetup\b[^>]*>/i
    const normalRe = /<script\s[^>]*>/i
    let m = source.match(setupRe) || source.match(normalRe)
    if (!m || m.index === undefined) return null
    const openTag = m[0]
    const closeIdx = source.indexOf('</script>', m.index + openTag.length)
    if (closeIdx < 0) return null
    const innerSource = source.slice(m.index + openTag.length, closeIdx)
    const isTs = /\blang\s*=\s*["']ts["']/i.test(openTag)
    return {source: innerSource, ext: isTs ? '.ts' : '.js'}
}

// ── 文件提取（单文件） ──
// 功能说明: 对单个源文件提取 imports/exports 符号表
//   根据扩展名选择 tree-sitter（JS/TS 用旧路径，其他语言用多语言路径）或 regex 兜底
async function extractFile(absPath, relPath, ext) {
    try {
        const source = readFileSync(absPath, 'utf8')
        let result = null

        // JS/TS: 保持旧路径不变
        if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(ext)) {
            const parser = await ensureTreeSitter()
            if (parser) {
                result = parseImportsTreeSitter(source, ext)
            }
            if (!result) {
                result = parseImportsRegex(source, ext)
            }
            return result
        }

        // 多语言路径: tree-sitter 优先，不完整时 regex 补充
        const langConfig = getLangConfig(ext)
        if (langConfig) {
            let tsResult = null
            const entry = await ensureParserForLang(langConfig)
            if (entry) {
                tsResult = parseImportsTreeSitterMulti(source, ext, langConfig)
            }
            const regexFn = LANG_REGEX_PARSERS[langConfig.lang]
            const reResult = regexFn ? regexFn(source) : null

            // 合并: tree-sitter 优先，缺失部分用 regex 补充
            if (tsResult && reResult) {
                result = {
                    exports: [...new Set([...tsResult.exports, ...reResult.exports])],
                    imports: tsResult.imports.length > 0 ? tsResult.imports : reResult.imports,
                }
            } else {
                result = tsResult || reResult || parseImportsRegex(source, ext)
            }
            return result
        }

        // Vue SFC: 提取 script 块，用 JS/TS tree-sitter 解析
        if (ext === '.vue') {
            const vue = extractVueScript(source)
            if (vue) {
                const parser = await ensureTreeSitter()
                if (parser) {
                    result = parseImportsTreeSitter(vue.source, vue.ext)
                }
                if (!result) {
                    result = parseImportsRegex(vue.source, vue.ext)
                }
            }
            // 同时用通用 regex 解析完整 source 作为补充（template 中的组件引用等）
            const fullReResult = parseImportsRegex(source, ext)
            if (result) {
                result = {
                    exports: [...new Set([...result.exports, ...fullReResult.exports])],
                    imports: result.imports.length > 0 ? result.imports : fullReResult.imports,
                }
            } else {
                result = fullReResult
            }
            return result
        }

        // 未知扩展名（.css/.scss/.json 等）→ 通用 regex
        result = parseImportsRegex(source, ext)
        return result
    } catch (e) {
        return {exports: [], imports: []}
    }
}

// ── 技术栈检测 ──
// 功能说明: 根据项目根目录的配置文件推断语言/运行时/框架
// 实现方式: 检查 package.json / tsconfig.json / pom.xml / Cargo.toml 等
function detectStack(workDir) {
    const result = {language: 'Unknown', runtime: 'Unknown'}

    // Node.js 生态
    const pkgPath = join(workDir, 'package.json')
    if (existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
            result.runtime = 'Node.js'
            const deps = {...pkg.dependencies, ...pkg.devDependencies}
            if (deps) {
                if (deps.vue) result.framework = deps.vue.startsWith('3') || deps.vue.includes('^3') ? 'Vue 3' : 'Vue'
                else if (deps.react) result.framework = 'React'
                else if (deps['@angular/core']) result.framework = 'Angular'
                else if (deps.svelte) result.framework = 'Svelte'
                if (deps.electron || deps['@electron/remote']) result.framework = (result.framework || '') + ' + Electron'
                if (deps.vite) result.buildTool = 'Vite'
                else if (deps.webpack) result.buildTool = 'Webpack'
                else if (deps.turbo || deps.turborepo) result.buildTool = 'Turborepo'
            }
            // 包管理器
            if (existsSync(join(workDir, 'pnpm-lock.yaml'))) result.packageManager = 'pnpm'
            else if (existsSync(join(workDir, 'yarn.lock'))) result.packageManager = 'yarn'
            else if (existsSync(join(workDir, 'bun.lockb'))) result.packageManager = 'bun'
            else result.packageManager = 'npm'
        } catch {
        }
    }

    // TypeScript
    if (existsSync(join(workDir, 'tsconfig.json'))) {
        result.language = 'TypeScript'
    } else {
        result.language = 'JavaScript'
    }

    // Java
    if (existsSync(join(workDir, 'pom.xml'))) {
        result.language = 'Java';
        result.runtime = 'JVM';
        result.buildTool = 'Maven'
    } else if (existsSync(join(workDir, 'build.gradle')) || existsSync(join(workDir, 'build.gradle.kts'))) {
        result.language = 'Java/Kotlin';
        result.runtime = 'JVM';
        result.buildTool = 'Gradle'
    }

    // Rust
    if (existsSync(join(workDir, 'Cargo.toml'))) {
        result.language = 'Rust';
        result.runtime = 'Native';
        result.buildTool = 'Cargo'
    }

    // Go
    if (existsSync(join(workDir, 'go.mod'))) {
        result.language = 'Go';
        result.runtime = 'Native';
        result.buildTool = 'Go Modules'
    }

    // .NET
    if (existsSync(join(workDir, 'src', 'UI', '*.csproj'))) {
        result.language = 'C#';
        result.runtime = '.NET'
    }

    return result
}

// ── 文件树构建 ──
// 功能说明: 从扁平文件列表构建目录树（按目录分组）
function buildFileTree(files) {
    const tree = {}
    for (const f of files) {
        if (f.binary) continue
        const dir = dirname(f.path).replace(/\\/g, '/') || '.'
        if (!tree[dir]) tree[dir] = []
        tree[dir].push(basename(f.path))
    }
    return tree
}

// ── 依赖图计算 ──
// 功能说明: 从所有文件的符号表构建边列表（跨文件依赖关系）
//   每一条边: sourceFile:symbol → targetFile（按导入路径解析）
function computeEdges(symbols) {
    const edges = []
    const fileSet = new Set(Object.keys(symbols))

    for (const [filePath, symbol] of Object.entries(symbols)) {
        for (const imp of (symbol.imports || [])) {
            if (imp.external) {
                edges.push({
                    source: `${filePath}:*`,
                    target: `external:${imp.from}`,
                    relation: 'external-dep',
                    confidence: 'EXTRACTED'
                })
                continue
            }

            const resolved = resolveImportPath(filePath, imp.from, fileSet)
            const resolvedFile = resolved || imp.from

            for (const name of (imp.names || [])) {
                if (name === '*' || name === 'default') {
                    edges.push({
                        source: `${filePath}:*`,
                        target: `${resolvedFile}:*`,
                        relation: 'imports',
                        confidence: resolved ? 'EXTRACTED' : 'INFERRED'
                    })
                } else {
                    // 检查目标文件是否导出了该符号
                    const targetExports = symbols[resolved]?.exports || []
                    edges.push({
                        source: `${filePath}:${name}`,
                        target: `${resolvedFile}:${name}`,
                        relation: 'imports',
                        confidence: resolved && targetExports.includes(name) ? 'EXTRACTED' : 'INFERRED'
                    })
                }
            }
        }
    }
    return edges
}

// ── Hub 节点检测 ──
// 功能说明: 计算每个文件的入度（被引用次数）和出度，识别高连接度 hub 节点
function computeHubNodes(symbols, edges) {
    const degree = new Map()
    const dependents = new Map()

    for (const edge of edges) {
        // 跳过外部依赖边
        if (edge.relation === 'external-dep') continue

        const targetFile = edge.target.split(':')[0]
        const sourceFile = edge.source.split(':')[0]

        degree.set(targetFile, (degree.get(targetFile) || 0) + 1)
        degree.set(sourceFile, (degree.get(sourceFile) || 0) + 1)

        if (!dependents.has(targetFile)) dependents.set(targetFile, new Set())
        dependents.get(targetFile).add(sourceFile)
    }

    return [...degree.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([id, deg]) => ({
            id,
            degree: deg,
            dependents: [...(dependents.get(id) || [])].slice(0, 10)
        }))
}

// ── 改动影响面评估 ──
// 功能说明: 计算每个文件的 riskOnChange（high/medium/low）
//   high: 被 5+ 个文件依赖; medium: 2-4; low: 0-1
function computeImpactMap(symbols, edges) {
    const affectedBy = new Map()
    for (const edge of edges) {
        // 跳过外部依赖边
        if (edge.relation === 'external-dep') continue

        const sourceFile = edge.source.split(':')[0]
        const targetFile = edge.target.split(':')[0]
        if (!affectedBy.has(targetFile)) affectedBy.set(targetFile, new Set())
        affectedBy.get(targetFile).add(sourceFile)
    }

    // 同时为所有有符号表的文件设置默认 low
    for (const file of Object.keys(symbols)) {
        if (!affectedBy.has(file)) affectedBy.set(file, new Set())
    }

    const result = {}
    for (const [file, affected] of affectedBy) {
        const count = affected.size
        result[file] = {
            riskOnChange: count >= 5 ? 'high' : count >= 2 ? 'medium' : 'low',
            affectedFiles: count
        }
    }
    return result
}

// ── 扫描源文件列表 ──
// 功能说明: 扫描工作目录，返回非二进制、非排除目录的文件列表
function scanSourceFiles(workDir) {
    const files = []
    let tooLargeCount = 0
    if (!existsSync(workDir)) return {files, truncated: false, missing: true, tooLargeCount: 0, unfinishedDirs: []}
    const stack = [workDir]
    while (stack.length) {
        if (files.length >= MAX_SNAP_FILES) {
            // 收集栈中剩下的目录名（取相对路径，最多 20 个）
            const unfinishedDirs = stack.map(d => {
                const rel = relative(workDir, d).replace(/\\/g, '/')
                return rel || '.'
            }).slice(0, 20)
            return {files, truncated: true, missing: false, tooLargeCount, unfinishedDirs}
        }
        const dir = stack.pop()
        let entries
        try {
            entries = readdirSync(dir, {withFileTypes: true})
        } catch {
            continue
        }
        for (const ent of entries) {
            if (ent.isDirectory()) {
                if (SNAP_EXCLUDE_DIRS.has(ent.name)) continue
                stack.push(join(dir, ent.name))
            } else if (ent.isFile()) {
                if (files.length >= MAX_SNAP_FILES) {
                    const unfinishedDirs = ([dir, ...stack]).map(d => {
                        const rel = relative(workDir, d).replace(/\\/g, '/')
                        return rel || '.'
                    }).slice(0, 20)
                    return {files, truncated: true, missing: false, tooLargeCount, unfinishedDirs}
                }
                const full = join(dir, ent.name)
                if (isBinaryPath(ent.name)) continue
                let size = 0
                try {
                    size = statSync(full).size
                } catch {
                }
                if (size > MAX_SNAP_FILE_BYTES) {
                    tooLargeCount++
                    continue
                }
                const rel = relative(workDir, full).replace(/\\/g, '/')
                files.push({path: rel, size, ext: extname(ent.name).toLowerCase()})
            }
        }
    }
    return {files, truncated: false, missing: false, tooLargeCount, unfinishedDirs: []}
}

// ═══════════════════════════════════════════════════════════════════
// 对外 API
// ═══════════════════════════════════════════════════════════════════

// ── cacheFilePath ── 缓存文件路径
// 功能说明: 返回项目对应的缓存文件绝对路径
export function cacheFilePath(workDir) {
    return join(CLAUDE_HOME, 'projects', encodeProjectName(workDir), 'bridge-structure-cache.json')
}

// ── loadProjectCache ── 从磁盘加载缓存
// 功能说明: 读取 JSON 缓存文件，校验最小结构完整性，损坏则返回 null
export function loadProjectCache(workDir) {
    const p = cacheFilePath(workDir)
    if (!existsSync(p)) return null
    try {
        const data = readJSON(p)
        if (!data || typeof data.workDir !== 'string' || !data.fileCache) return null
        return data
    } catch {
        return null
    }
}

// ── saveProjectCache ── 写入缓存到磁盘
// 功能说明: 写入 JSON 缓存文件，自动创建父目录
export function saveProjectCache(workDir, cache) {
    if (!cache) return
    writeJSON(cacheFilePath(workDir), cache)
}

// ── buildProjectCache ── 全量构建缓存
// 功能说明: 扫描项目 → 检测技术栈 → 构建文件树 → 提取所有文件符号 → 计算依赖图
//   返回完整缓存对象；失败返回 null
export async function buildProjectCache(workDir) {
    const scan = scanSourceFiles(workDir)
    if (scan.missing) return null

    const stack = detectStack(workDir)
    const fileTree = buildFileTree(scan.files)

    // 提取所有文件的符号表（并发但有上限）
    const symbols = {}
    const fileCache = {}
    const batchSize = 8
    for (let i = 0; i < scan.files.length; i += batchSize) {
        const batch = scan.files.slice(i, i + batchSize)
        const results = await Promise.all(batch.map(async (f) => {
            const abs = join(workDir, f.path)
            const hash = sha256File(abs)
            const result = await extractFile(abs, f.path, f.ext)
            return {path: f.path, hash, result}
        }))
        for (const {path, hash, result} of results) {
            if (hash) fileCache[path] = hash
            if (result && (result.exports.length > 0 || result.imports.length > 0)) {
                symbols[path] = result
            }
        }
    }

    const edges = computeEdges(symbols)
    const hubNodes = computeHubNodes(symbols, edges)
    const impactMap = computeImpactMap(symbols, edges)

    const cacheObj = {
        workDir,
        scannedAt: Date.now(),
        truncated: scan.truncated,
        tooLargeCount: scan.tooLargeCount || 0,
        unfinishedDirs: scan.unfinishedDirs || [],
        stack,
        fileTree,
        symbols,
        edges: edges.slice(0, 5000),
        hubNodes: hubNodes.slice(0, 20),
        impactMap,
        fileCache,
    }
    cacheObj.summary = buildCacheInjectionText(cacheObj)
    return cacheObj
}

// ── updateProjectCache ── 增量更新缓存
// 功能说明: 根据 diffMap（来自 diffSnapshotVsCurrent 的结果）识别变更文件
//   SHA256 对比 → 只对内容真正变了的重提取 → 增量更新依赖图
//   SIDE_EFFECT: 直接修改传入的 cache 对象（调用方需在更新后 saveProjectCache）
export async function updateProjectCache(workDir, cache, diffMap) {
    if (!cache || !diffMap) return {updated: 0, skipped: 0}

    let updated = 0
    let skipped = 0
    const changedFiles = []
    const deletedFiles = []

    for (const [path, diff] of diffMap) {
        if (diff.status === 'unchanged') continue

        if (diff.status === 'deleted') {
            deletedFiles.push(path)
            continue
        }

        // added 或 modified: 检查 SHA256
        const abs = join(workDir, path)
        if (isBinaryPath(path)) {
            skipped++;
            continue
        }

        const ext = extname(path).toLowerCase()
        const hash = sha256File(abs)
        if (!hash) {
            skipped++;
            continue
        }

        const oldHash = cache.fileCache?.[path]
        if (oldHash === hash) {
            skipped++;
            continue
        } // 内容未变

        changedFiles.push({path, abs, ext, hash})
    }

    // 处理删除: 从缓存中移除
    for (const path of deletedFiles) {
        delete cache.symbols?.[path]
        delete cache.fileCache?.[path]
        if (cache.fileTree) {
            const dir = dirname(path).replace(/\\/g, '/') || '.'
            if (cache.fileTree[dir]) {
                const bn = basename(path)
                cache.fileTree[dir] = cache.fileTree[dir].filter(f => f !== bn)
                if (cache.fileTree[dir].length === 0) delete cache.fileTree[dir]
            }
        }
        updated++
    }

    // 处理新增/修改: 重新提取
    if (changedFiles.length > 0) {
        const batchSize = 8
        for (let i = 0; i < changedFiles.length; i += batchSize) {
            const batch = changedFiles.slice(i, i + batchSize)
            const results = await Promise.all(batch.map(async (f) => {
                const result = await extractFile(f.abs, f.path, f.ext)
                return {...f, result}
            }))
            for (const {path, hash, result} of results) {
                cache.fileCache[path] = hash
                if (result && (result.exports.length > 0 || result.imports.length > 0)) {
                    cache.symbols[path] = result
                } else {
                    delete cache.symbols?.[path]
                }
                updated++

                // 更新 fileTree
                if (cache.fileTree) {
                    const dir = dirname(path).replace(/\\/g, '/') || '.'
                    const bn = basename(path)
                    if (!cache.fileTree[dir]) cache.fileTree[dir] = []
                    if (!cache.fileTree[dir].includes(bn)) cache.fileTree[dir].push(bn)
                }
            }
        }

        // 重新计算依赖图（相对 cheap，且增量重建 edges 容易遗漏跨文件边）
        if (cache.symbols && Object.keys(cache.symbols).length > 0) {
            cache.edges = computeEdges(cache.symbols).slice(0, 5000)
            cache.hubNodes = computeHubNodes(cache.symbols, cache.edges).slice(0, 20)
            cache.impactMap = computeImpactMap(cache.symbols, cache.edges)
        }
        cache.summary = buildCacheInjectionText(cache)
    }

    cache.scannedAt = Date.now()
    return {updated, skipped}
}

// ── isExplorationAttempt ── 判定是否在探索项目结构
// 功能说明: 根据 toolName + input 判断 Claude 是否在尝试理解项目布局
export function isExplorationAttempt(toolName, input) {
    if (!toolName) return false

    switch (toolName) {
        case 'Glob': {
            if (!input?.pattern) return false
            const p = String(input.pattern)
            // 宽 patterns: **/*, src/**/*, **/*.{ts,js}, packages/*
            return /^(\*\*\/?\*|src|lib|app|packages|components|utils|stores|composables|views|pages|layouts)\//.test(p)
                || p === '**/*'
                || /^\*\*\/\*\.\{/.test(p)
        }

        case 'Grep': {
            if (!input?.pattern) return false
            const searchPattern = String(input.pattern)
            const glob = input.include || input.glob || ''
            // 搜索结构型 pattern + 宽文件 glob
            const isStructureSearch = /^(import |export |class |function |const |interface |type |extends |implements )/.test(searchPattern)
            const isWideGlob = !glob || /^\*\.\{/.test(glob) || /^\*\*\/\*/.test(glob) || /^src\//.test(glob)
            return isStructureSearch && isWideGlob
        }

        case 'Agent':
        case 'Task':
            return input?.subagent_type === 'Explore'
                || input?.name === 'Explore'
                || String(input?.description || '').toLowerCase().includes('explore')

        case 'Bash': {
            if (!input?.command) return false
            const cmd = String(input.command)
            return /\b(find|ls\s+-R|tree|dir\s+\/s)\b/.test(cmd)
                && !cmd.includes('node_modules')
                && !cmd.includes('.git')
                && !cmd.includes('>')
                && !cmd.includes('|')
        }

        default:
            return false
    }
}

// ── buildCacheInjectionText ── 生成注入到 pushStream 的摘要文本
// 功能说明: 从缓存数据生成精简 Markdown 摘要，供 Claude 直接使用
//   控制长度在 ~2000 tokens（~8000 字符）
export function buildCacheInjectionText(cache) {
    if (!cache) return null
    const parts = []

    parts.push('[系统] 项目结构已缓存，无需重复探索。以下是当前项目结构摘要:\n')

    // 技术栈
    parts.push('## 技术栈')
    const s = cache.stack || {}
    parts.push(`- 语言: ${s.language || '?'} / 运行时: ${s.runtime || '?'}`)
    if (s.framework) parts.push(`- 框架: ${s.framework}`)
    if (s.buildTool) parts.push(`- 构建: ${s.buildTool}`)
    if (s.packageManager) parts.push(`- 包管理: ${s.packageManager}`)

    // 文件树摘要
    if (cache.fileTree) {
        const entries = Object.entries(cache.fileTree)
        if (entries.length) {
            parts.push(`\n## 目录结构 (${entries.length} 个目录)`)
            // 按文件数量排序，展示最重要的目录
            const sorted = entries.sort((a, b) => b[1].length - a[1].length)
            for (const [dir, files] of sorted.slice(0, 15)) {
                const displayDir = dir === '.' ? '(根目录)' : dir + '/'
                parts.push(`- ${displayDir} (${files.length} 文件): ${files.slice(0, 5).join(', ')}${files.length > 5 ? ', ...' : ''}`)
            }
            if (sorted.length > 15) parts.push(`  ... 还有 ${sorted.length - 15} 个目录`)
        }
    }

    // Hub 节点（最高连接度文件）
    if (cache.hubNodes?.length) {
        parts.push(`\n## 核心文件（被依赖最多）`)
        for (const node of cache.hubNodes.slice(0, 10)) {
            parts.push(`- \`${node.id}\` — 被 ${node.dependents?.length || 0} 个文件依赖`)
        }
    }

    // 高影响面文件
    if (cache.impactMap) {
        const highRisk = Object.entries(cache.impactMap)
            .filter(([, v]) => v.riskOnChange === 'high')
        if (highRisk.length) {
            parts.push(`\n## 高风险文件（改动影响 >= 5 个文件）`)
            for (const [path, info] of highRisk.slice(0, 8)) {
                parts.push(`- \`${path}\` → ${info.affectedFiles} 个文件受影响`)
            }
        }
    }

    // 符号统计
    if (cache.symbols) {
        const symCount = Object.keys(cache.symbols).length
        if (symCount > 0) {
            const totalExports = Object.values(cache.symbols).reduce((n, s) => n + (s.exports?.length || 0), 0)
            parts.push(`\n## 符号表 (${symCount} 个文件, ${totalExports} 个导出)`)
        }
    }

    // 截断/跳过警告
    const warnings = []
    if (cache.truncated && cache.unfinishedDirs?.length) {
        const sample = cache.unfinishedDirs.slice(0, 8).map(d => d + '/').join(', ')
        warnings.push(`- 文件数达到上限 (${MAX_SNAP_FILES})，以下目录未完全扫描: ${sample}${cache.unfinishedDirs.length > 8 ? ' ...' : ''}`)
    }
    if (cache.tooLargeCount > 0) {
        warnings.push(`- ${cache.tooLargeCount} 个文件因超过 ${MAX_SNAP_FILE_BYTES / 1024}KB 被跳过`)
    }
    if (warnings.length) {
        parts.push(`\n## 扫描警告`)
        parts.push(...warnings)
    }

    // 截断保护 (~8000 字符)
    const full = parts.join('\n')
    if (full.length > 8000) {
        return full.slice(0, 8000) + '\n\n[...已截断，详细依赖关系请查看源文件...]'
    }
    return full
}
