import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {buildProjectContext, loadProjectContext, projectContextCachePath} from './project-context.mjs'

function fixture(name) {
    return mkdtempSync(join(tmpdir(), `bridge-project-context-${name}-`))
}

test('空目录和未知项目返回稳定有限摘要', async () => {
    const root = fixture('empty')
    const first = await buildProjectContext(root, {persist: false, now: () => 7})
    const second = await buildProjectContext(root, {persist: false, now: () => 7})
    assert.deepEqual(first, second)
    assert.deepEqual(first.languages, ['JavaScript'])
    assert.deepEqual(first.commands, [])
    assert.equal(first.generatedAt, 7)
})

test('Vue Node 项目只从 manifest 提取受信命令', async () => {
    const root = fixture('vue')
    writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {build: 'vite build', test: 'node --test', dev: 'vite', danger: 'rm -rf .'}, dependencies: {vue: '^3.5.0'}, devDependencies: {typescript: '^6'}}))
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9')
    const value = await buildProjectContext(root, {persist: false})
    assert.deepEqual(value.languages, ['TypeScript'])
    assert.deepEqual(value.frameworks, ['Vue 3'])
    assert.equal(value.packageManager, 'pnpm')
    assert.equal(value.commands[0].executable, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
    assert.deepEqual(value.commands.map(item => item.name), ['build', 'test'])
    assert.deepEqual(value.commands.map(item => item.kind), ['build', 'test'])
    assert.equal(value.commands.some(item => item.name === 'danger'), false)
})

test('Java Maven 与 C# 项目返回框架和构建命令', async () => {
    const java = fixture('java')
    writeFileSync(join(java, 'pom.xml'), '<project><artifactId>spring-boot-starter</artifactId></project>')
    const javaContext = await buildProjectContext(java, {persist: false})
    assert.ok(javaContext.languages.includes('Java'))
    assert.ok(javaContext.frameworks.includes('Spring Boot'))
    assert.equal(javaContext.commands[0].executable, 'mvn')
    assert.equal(javaContext.commands[0].kind, 'test')

    const csharp = fixture('csharp')
    writeFileSync(join(csharp, 'App.csproj'), '<Project><PropertyGroup><UseWindowsForms>true</UseWindowsForms></PropertyGroup></Project>')
    const csharpContext = await buildProjectContext(csharp, {persist: false})
    assert.ok(csharpContext.languages.includes('C#'))
    assert.ok(csharpContext.frameworks.includes('WinForms'))
    assert.equal(csharpContext.commands[0].executable, 'dotnet')
    assert.deepEqual(csharpContext.commands.map(item => item.kind), ['build', 'test'])
})

test('扫描跳过构建目录和密钥文件并仅记录规则元数据', async () => {
    const root = fixture('safe')
    mkdirSync(join(root, 'node_modules'), {recursive: true})
    writeFileSync(join(root, '.env'), 'API_KEY=secret')
    writeFileSync(join(root, 'AGENTS.md'), '# rules\nAPI_KEY=secret')
    writeFileSync(join(root, 'node_modules', 'package.json'), JSON.stringify({scripts: {build: 'bad'}}))
    const value = await buildProjectContext(root, {persist: false})
    assert.deepEqual(value.rules, [{path: 'AGENTS.md', kind: 'agents'}])
    assert.equal(JSON.stringify(value).includes('secret'), false)
    assert.equal(value.commands.length, 0)
})

test('上下文可写入 Bridge 私有缓存并恢复', async () => {
    const root = fixture('persist')
    const home = fixture('home')
    const built = await buildProjectContext(root, {bridgeHome: home})
    assert.ok(projectContextCachePath(root, {bridgeHome: home}).startsWith(home))
    assert.deepEqual(loadProjectContext(root, {bridgeHome: home}), built)
})
