import assert from 'node:assert/strict'
import test from 'node:test'
import {backfillWorkbenchTaskMetadata, projectTaskMetadata} from './backfill-workbench-task-metadata.mjs'

test('旧任务元数据回填优先使用现有结构化状态且 dry-run 不写入', async () => {
    assert.deepEqual(projectTaskMetadata({taskId: 'id', state: {plan: {goal: '实现导出'}}}), {title: '实现导出', summary: '', goal: '实现导出', requestText: '实现导出', source: 'desktop'})
    let writes = 0
    const report = await backfillWorkbenchTaskMetadata({repository: {listTasks: () => [{taskId: 'id', state: {plan: {goal: '实现导出'}}}], upsertTask: () => { writes += 1 }}, dryRun: true})
    assert.equal(report.candidateCount, 1)
    assert.equal(writes, 0)
})

test('回填不会覆盖可读自定义标题，并对 UUID 标题有限重试', async () => {
    const writes = []
    let attempts = 0
    const report = await backfillWorkbenchTaskMetadata({repository: {
        listTasks: () => [{taskId: 'uuid-task', title: '12345678-1234-4234-8234-123456789012', state: {plan: {goal: '迁移任务'}}}, {taskId: 'custom', title: '我的标题', state: {detail: '摘要', plan: {goal: '已有目标'}}}],
        upsertTask: value => { attempts += 1; if (attempts < 2) throw new Error('temporary'); writes.push(value); return true },
    }, dryRun: false})
    assert.equal(report.candidateCount, 1)
    assert.equal(report.updatedCount, 1)
    assert.equal(writes[0].title, '迁移任务')
})
