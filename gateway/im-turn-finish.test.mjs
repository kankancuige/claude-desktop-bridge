import assert from 'node:assert/strict'
import {turnFallbackText} from './im-turn-finish.mjs'

assert.equal(turnFallbackText('result'), '处理完成，无文本回复')
assert.equal(turnFallbackText('task_completed'), '处理完成，无文本回复')
assert.match(turnFallbackText('task_failed'), /未完成/)
assert.match(turnFallbackText('task_review_paused'), /审查已暂停/)
assert.equal(turnFallbackText('stopped'), '会话已停止')
assert.equal(turnFallbackText('duplicate'), '该消息已接收，请勿重复发送')
assert.equal(turnFallbackText('queue_full'), '当前会话待处理消息已达上限，请稍后重试')
assert.match(turnFallbackText('ws_error'), /连接中断/)

console.log('im turn finish tests passed')
