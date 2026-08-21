import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {SessionEventJournal, journalTaskState, sessionEventStorePath} from './session-event-journal.mjs'

function journalPath() {
    return join(mkdtempSync(join(tmpdir(), 'bridge-events-')), 'events.jsonl')
}

test('事件序号连续，关键事件落盘且任务状态可投影', () => {
    const path = journalPath()
    const journal = new SessionEventJournal({path, now: () => 100})
    journal.append('task/accepted', {messageId: 'm1', turnId: 't1'}, {critical: true})
    journal.append('task/state-changed', {taskState: journalTaskState({status: 'running', taskId: 's:t1', turnId: 't1'})})
    assert.deepEqual(journal.read().events.map(event => event.seq), [1, 2])
    assert.equal(journal.projectTaskState({recoverRunning: true, now: 200}).status, 'interrupted')
    assert.match(readFileSync(path, 'utf8'), /task\/accepted/)
})

test('任务状态日志保留实际路由模型以支持重启后的上下文切换判断', () => {
    const journal = new SessionEventJournal({path: journalPath()})
    journal.append('task/state-changed', {taskState: journalTaskState({status: 'succeeded', model: 'model-a'})})
    assert.equal(journal.projectTaskState().model, 'model-a')
})

test('尾部半行被忽略并在重新打开时修复', () => {
    const path = journalPath()
    writeFileSync(path, '{"seq":4,"time":1,"type":"task/accepted","payload":{}}\n{"seq":5', 'utf8')
    const journal = new SessionEventJournal({path})
    assert.equal(journal.read().lastSeq, 4)
    assert.equal(readFileSync(path, 'utf8').endsWith('\n'), true)
    assert.equal(journal.append('task/state-changed', {taskState: journalTaskState({status: 'idle'})}).seq, 5)
})

test('中间损坏或序号中断被隔离，不能作为恢复证据', () => {
    for (const contents of [
        '{"seq":1,"time":1,"type":"task/accepted","payload":{}}\nnot-json\n',
        '{"seq":1,"time":1,"type":"task/accepted","payload":{}}\n{"seq":3,"time":2,"type":"task/state-changed","payload":{}}\n',
    ]) {
        const path = journalPath()
        writeFileSync(path, contents, 'utf8')
        const corrupt = []
        const journal = new SessionEventJournal({path, now: () => 123, onCorrupt: result => corrupt.push(result.code)})
        assert.equal(corrupt.length, 1)
        assert.deepEqual(journal.read().events, [])
        assert.equal(journal.append('task/accepted', {messageId: 'new'}).seq, 1)
    }
})

test('敏感字段、循环引用和超大 payload 被拒绝', () => {
    const journal = new SessionEventJournal({path: journalPath()})
    assert.throws(() => journal.append('task/accepted', {prompt: 'secret'}), error => error.code === 'SESSION_EVENT_SENSITIVE_FIELD')
    assert.throws(() => journal.append('task/accepted', {apiKey: 'secret'}), error => error.code === 'SESSION_EVENT_SENSITIVE_FIELD')
    const circular = {}; circular.self = circular
    assert.throws(() => journal.append('task/accepted', circular), error => error.code === 'SESSION_EVENT_INVALID_PAYLOAD')
    assert.throws(() => journal.append('task/accepted', {detail: 'x'.repeat(70_000)}), error => error.code === 'SESSION_EVENT_PAYLOAD_TOO_LARGE')
})

test('任务状态投影不复制正文、错误详情和审查输出', () => {
    const projected = journalTaskState({
        status: 'review_paused',
        finalReplyText: 'final reply',
        detail: 'assistant 正文',
        review: {
            round: 1,
            tier: 'power',
            summary: '审查长文本',
            blockingFindings: [{severity: 'high', title: '具体问题', description: '完整模型输出'}],
        },
    })
    assert.equal('detail' in projected, false)
    assert.equal(projected.finalReplyText, 'final reply')
    assert.equal(projected.finalReplyAvailable, true)
    assert.deepEqual(projected.review, {round: 1, tier: 'power', blockingCount: 1})
    assert.equal(JSON.stringify(projected).includes('assistant 正文'), false)
    assert.equal(JSON.stringify(projected).includes('完整模型输出'), false)
})

test('容量压缩保留最近连续事件且 close 幂等', () => {
    const journal = new SessionEventJournal({path: journalPath(), maxBytes: 4096, maxEvents: 10})
    for (let index = 0; index < 30; index++) journal.append('runtime/progress', {index, detail: 'x'.repeat(200)})
    const result = journal.read()
    assert.equal(result.ok, true)
    assert.ok(result.events.length <= 30)
    for (let index = 1; index < result.events.length; index++) {
        assert.equal(result.events[index].seq, result.events[index - 1].seq + 1)
    }
    journal.close()
    journal.close()
    assert.throws(() => journal.append('runtime/progress', {}), error => error.code === 'SESSION_EVENT_JOURNAL_CLOSED')
})

test('事件路径固定在项目 sidecar 目录', () => {
    assert.equal(sessionEventStorePath('D:/project-store', 'session-1'), join('D:/project-store', 'bridge-session-events', 'session-1.jsonl'))
    assert.throws(() => sessionEventStorePath('D:/project-store', '../escape'))
})
