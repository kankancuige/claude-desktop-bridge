import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./task-pause-control.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {isPausedTaskState, resolveComposerTaskAction} = await import(moduleUrl)

test('输入框主操作按运行、暂停和新输入状态切换', () => {
  assert.equal(resolveComposerTaskAction({busy: true, text: '', attachmentCount: 0}), 'pause')
  assert.equal(resolveComposerTaskAction({
    busy: false,
    canContinue: true,
    taskState: {status: 'stopped', resumable: true},
    text: '',
    attachmentCount: 0,
  }), 'continue')
  assert.equal(resolveComposerTaskAction({
    busy: false,
    canContinue: true,
    taskState: {status: 'stopped', resumable: true},
    text: '开始另一项任务',
    attachmentCount: 0,
  }), 'send')
  assert.equal(resolveComposerTaskAction({
    busy: false,
    canContinue: true,
    taskState: {status: 'interrupted', resumable: true},
    text: '',
    attachmentCount: 1,
  }), 'send')
  assert.equal(resolveComposerTaskAction({busy: false, text: '', attachmentCount: 0}), 'disabled')
  assert.equal(resolveComposerTaskAction({
    busy: false,
    canContinue: false,
    taskState: {status: 'interrupted', resumable: false},
    text: '',
    attachmentCount: 0,
  }), 'continue')
  assert.equal(resolveComposerTaskAction({
    busy: false,
    canContinue: true,
    taskState: {status: 'idle', resumable: false},
    text: '',
    attachmentCount: 0,
  }), 'continue')
})

test('只有可恢复终态被识别为暂停任务', () => {
  for (const status of ['failed', 'stopped', 'interrupted', 'incomplete', 'review_paused']) {
    assert.equal(isPausedTaskState({status, resumable: true}), true)
  }
  assert.equal(isPausedTaskState({status: 'stopped', resumable: false}), true)
  assert.equal(isPausedTaskState({status: 'interrupted', resumable: false}), true)
  assert.equal(isPausedTaskState({status: 'running', resumable: true}), false)
  assert.equal(isPausedTaskState({status: 'succeeded', resumable: false}), false)
})
