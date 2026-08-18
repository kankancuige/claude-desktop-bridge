import assert from 'node:assert/strict'
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {createUserPreferenceService, detectPreferenceCandidates} from './user-preferences.mjs'

function fixture(options = {}) {
    const home = mkdtempSync(join(tmpdir(), 'bridge-preferences-'))
    return {home, service: createUserPreferenceService({bridgeHome: home, ...options})}
}

test('只识别明确的白名单偏好表达', () => {
    assert.deepEqual(detectPreferenceCandidates('以后代码文件统一使用 UTF-8 编码').map(item => item.id), ['encoding.utf8'])
    assert.deepEqual(detectPreferenceCandidates('这个文件为什么是 UTF-8？'), ['encoding.utf8'].filter(() => false))
    assert.deepEqual(detectPreferenceCandidates('不要使用 UTF-8'), [])
})

test('同一任务重复不计数，不同任务达到阈值后生成候选', () => {
    const {service} = fixture()
    assert.deepEqual(service.observe({projectDir: 'D:\\demo', taskId: 'a', text: '统一使用 UTF-8 编码'}), [])
    assert.deepEqual(service.observe({projectDir: 'D:\\demo', taskId: 'a', text: '统一使用 UTF-8 编码'}), [])
    const suggestions = service.observe({projectDir: 'D:\\demo', taskId: 'b', text: '请继续使用 UTF-8 编码'})
    assert.equal(suggestions.length, 1)
    assert.equal(suggestions[0].occurrences, 2)
    assert.equal(service.pending('D:\\demo').length, 1)
})

test('过期出现次数不会触发候选', () => {
    let timestamp = 1_000
    const {service} = fixture({windowMs: 100, now: () => timestamp})
    service.observe({projectDir: 'D:\\demo', taskId: 'a', text: '统一使用 UTF-8 编码'})
    timestamp = 1_200
    assert.deepEqual(service.observe({projectDir: 'D:\\demo', taskId: 'b', text: '统一使用 UTF-8 编码'}), [])
})

test('确认项目偏好后只对相关任务注入，显式冲突优先', () => {
    const {service} = fixture()
    service.observe({projectDir: 'D:\\demo', taskId: 'a', text: '统一使用 UTF-8 编码'})
    service.observe({projectDir: 'D:\\demo', taskId: 'b', text: '统一使用 UTF-8 编码'})
    service.respond({projectDir: 'D:\\demo', suggestionId: 'encoding.utf8', action: 'project'})
    assert.match(service.inject('D:\\demo', '修改 src/a.js 并保存文件'), /UTF-8/)
    assert.equal(service.inject('D:\\demo', 'UTF-8 是什么？'), 'UTF-8 是什么？')
    assert.equal(service.inject('D:\\demo', '修改文件并使用 GBK 编码'), '修改文件并使用 GBK 编码')
    assert.equal(service.inject('D:\\demo', '历史上下文包含修改代码', '简单解释一下这个概念'), '历史上下文包含修改代码')
})

test('项目偏好覆盖全局偏好并支持禁用和删除', () => {
    const {service} = fixture()
    service.observe({projectDir: 'D:\\one', taskId: 'a', text: '不要自动提交'})
    service.observe({projectDir: 'D:\\one', taskId: 'b', text: '不要自动提交'})
    service.respond({projectDir: 'D:\\one', suggestionId: 'git.no_auto_commit', action: 'global'})
    assert.match(service.inject('D:\\two', '修改项目代码'), /commit/)
    service.update({scope: 'global', id: 'git.no_auto_commit', enabled: false})
    assert.equal(service.inject('D:\\two', '修改项目代码'), '修改项目代码')
    assert.equal(service.remove({scope: 'global', id: 'git.no_auto_commit'}).deleted, true)
})

test('损坏文件被隔离且不会阻断读取', () => {
    const {home, service} = fixture()
    writeFileSync(service.paths.globalPath, '{broken', 'utf8')
    assert.deepEqual(service.listAll().global, [])
    assert.throws(() => readFileSync(service.paths.globalPath, 'utf8'))
})

test('候选存储不保存完整原文或凭据', () => {
    const {service} = fixture()
    const text = '以后统一使用 UTF-8 编码，token=secret-value'
    service.observe({projectDir: 'D:\\demo', taskId: 'a', text})
    const stored = readFileSync(service.paths.projectPath('D:\\demo'), 'utf8')
    assert.doesNotMatch(stored, /secret-value|token=|以后统一使用/)
})
