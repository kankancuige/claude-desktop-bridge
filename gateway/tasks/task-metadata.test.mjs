import assert from 'node:assert/strict'
import test from 'node:test'
import {createTaskMetadata} from './task-metadata.mjs'

test('任务标题优先使用显式 taskText，并保留来源', () => {
    const result = createTaskMetadata({taskText: '  修复登录超时  ', content: '# 其他标题\n正文', source: 'wechat'})
    assert.equal(result.title, '修复登录超时')
    assert.equal(result.source, 'wechat')
    assert.equal(result.requestText, '修复登录超时')
})

test('标题使用 content 首个有意义行，再回退 Markdown 标题和正文', () => {
    assert.equal(createTaskMetadata({content: '\n\n先处理数据库迁移\n后续说明'}).title, '先处理数据库迁移')
    assert.equal(createTaskMetadata({content: '\n```js\nconst x = 1\n```\n# 迁移任务\n说明'}).title, '迁移任务')
    assert.equal(createTaskMetadata({content: '\n```js\nconst x = 1\n```'}).title, '未命名任务')
})

test('元数据规范化空白、代码块、摘要和 80 字符标题边界', () => {
    const longTitle = 'a'.repeat(100)
    const result = createTaskMetadata({taskText: `  ${longTitle}  `, content: '第一行\r\n\r\n第二行', source: 'desktop'})
    assert.equal(result.title.length, 80)
    assert.equal(result.summary, '第一行\n第二行')
    assert.equal(createTaskMetadata({content: '```\nsecret\n```\n\n实际请求'}).requestText, '实际请求')
})

test('空输入返回稳定的可读回退字段', () => {
    assert.deepEqual(createTaskMetadata({source: 'scheduled'}), {
        title: '未命名任务', summary: '', goal: '', requestText: '', source: 'scheduled',
    })
})
