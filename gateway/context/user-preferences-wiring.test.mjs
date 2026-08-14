import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')

test('桌面和 IM 统一任务入口观察偏好候选', () => {
    assert.match(source, /userPreferences\.observe\(\{[\s\S]*source,[\s\S]*text:/)
    assert.match(source, /for \(const suggestion of preferenceSuggestions\)[\s\S]*preference_suggestion/)
})

test('SDK 输入按当前原始任务判断相关性', () => {
    assert.match(source, /userPreferences\.inject\(session\.workDir, content, prompt\)/)
})

test('WebSocket 重连恢复候选并接收四类响应', () => {
    assert.match(source, /userPreferences\.pending\(s\.workDir\)/)
    assert.match(source, /msg\.type === 'preference_response'/)
    assert.match(source, /userPreferences\.respond\(/)
})
