import assert from 'node:assert/strict'
import test from 'node:test'
import {resolveResumeModel} from './session-resume-model.mjs'

test('恢复已有历史时必须使用持久化的上一次实际模型', () => {
    assert.equal(resolveResumeModel({
        createMode: 'resume', requestedModel: 'gpt-5.6-terra', persistedModel: 'gpt-5.6-sol',
    }), 'gpt-5.6-sol')
})

test('新建、分支或缺失持久化模型时保留请求模型', () => {
    assert.equal(resolveResumeModel({
        createMode: 'new', requestedModel: 'gpt-5.6-terra', persistedModel: 'gpt-5.6-sol',
    }), 'gpt-5.6-terra')
    assert.equal(resolveResumeModel({
        createMode: 'fork', requestedModel: 'gpt-5.6-terra', persistedModel: 'gpt-5.6-sol',
    }), 'gpt-5.6-terra')
    assert.equal(resolveResumeModel({
        createMode: 'resume', requestedModel: 'gpt-5.6-terra', persistedModel: '',
    }), 'gpt-5.6-terra')
})
