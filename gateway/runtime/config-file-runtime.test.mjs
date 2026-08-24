import test from 'node:test'
import assert from 'node:assert/strict'
import {createConfigFileRuntime} from './config-file-runtime.mjs'

test('配置文件 Runtime 解析 frontmatter 和 JSON', () => {
    const files = new Map([['a.json', '{"ok":true}']])
    const runtime = createConfigFileRuntime({
        readFileSync: path => files.get(path), writeFileSync: (path, value) => files.set(path, value),
        mkdirSync() {}, dirname: path => path.slice(0, path.lastIndexOf('/')), renameSync: (from, to) => files.set(to, files.get(from)), unlinkSync: path => files.delete(path),
    })
    assert.deepEqual(runtime.readJSON('a.json'), {ok: true})
    assert.deepEqual(runtime.parseFrontmatter('---\ntitle: Demo\n---\nBody'), {frontmatter: {title: 'Demo'}, body: 'Body'})
})

test('配置文件 Runtime 缺少依赖时立即失败', () => {
    assert.throws(() => createConfigFileRuntime(), /dependencies are required/)
})
