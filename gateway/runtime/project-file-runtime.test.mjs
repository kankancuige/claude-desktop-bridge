import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjectFileRuntime} from './project-file-runtime.mjs'

function createMemoryRuntime(files = {'src/a.txt': 'one\nthree'}) {
    const entries = new Map()
    for (const [path, content] of Object.entries(files)) entries.set(path, {content, mtimeMs: 1})
    const dirs = new Set(['D:/work', 'D:/work/src'])
    return createProjectFileRuntime({
        existsSync: path => dirs.has(path) || entries.has(path),
        readdirSync: path => path === 'D:/work'
            ? [{name: 'src', isDirectory: () => true, isFile: () => false}]
            : path === 'D:/work/src'
                ? [{name: 'a.txt', isDirectory: () => false, isFile: () => true}]
                : [],
        statSync: path => {
            const rel = path.replace('D:/work/', '')
            const item = entries.get(rel)
            if (!item) throw new Error('missing')
            return {size: Buffer.byteLength(item.content), mtimeMs: item.mtimeMs, isFile: () => true, isDirectory: () => false}
        },
        readFileSync: path => entries.get(path.replace('D:/work/', '')).content,
        execSync: () => { throw new Error('not a git repository') },
        safeChildPath: (workDir, rel) => rel.startsWith('..') ? null : `${workDir}/${rel}`,
        relativePath: (workDir, full) => full.slice(workDir.length + 1),
        joinPath: (a, b) => `${a}/${b}`,
    })
}

test('项目文件 Runtime 生成快照并计算新增、修改、删除', () => {
    const runtime = createMemoryRuntime()
    const snapshot = {files: new Map([['src/a.txt', {content: 'one\ntwo', size: 7, lines: 2}]])}
    const diff = runtime.diffSnapshotVsCurrent(snapshot, [
        {path: 'src/a.txt', size: 9, mtimeMs: 2, binary: false},
        {path: 'new.txt', size: 1, mtimeMs: 1, binary: false},
    ], 'D:/work')
    assert.equal(diff.get('src/a.txt').status, 'modified')
    assert.equal(diff.get('new.txt').status, 'added')
})

test('项目文件 Runtime 的路径安全和行 Diff 端口保持独立', () => {
    const runtime = createMemoryRuntime()
    assert.equal(runtime.resolveSafe('D:/work', '../secret'), null)
    assert.equal(runtime.lineDiffStats('a\nb', 'a\nc').added, 1)
    assert.equal(runtime.computeLineDiff('a\nb', 'a\nc').lines.filter(line => line.type !== 'context').length, 2)
})

test('项目文件 Runtime 缺少外部端口时立即失败', () => {
    assert.throws(() => createProjectFileRuntime(), /dependencies are required/)
})
