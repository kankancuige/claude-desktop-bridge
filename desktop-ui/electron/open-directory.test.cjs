const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const {openDirectoryInShell, resolveOpenDirectory} = require('./open-directory.cjs')

const absoluteDirectory = path.resolve('project-directory')

test('只允许存在的绝对目录并返回真实路径', async () => {
  const result = await resolveOpenDirectory(absoluteDirectory, {
    stat: async () => ({isDirectory: () => true}),
    realpath: async value => `${value}-resolved`,
  })
  assert.deepEqual(result, {ok: true, path: `${absoluteDirectory}-resolved`})
})

test('拒绝相对路径、空路径和文件路径', async () => {
  assert.deepEqual(await resolveOpenDirectory('../project'), {ok: false, error: 'invalid_path'})
  assert.deepEqual(await resolveOpenDirectory(''), {ok: false, error: 'invalid_path'})
  assert.deepEqual(await resolveOpenDirectory(absoluteDirectory, {
    stat: async () => ({isDirectory: () => false}),
  }), {ok: false, error: 'not_directory'})
})

test('目录不存在和读取失败返回稳定错误', async () => {
  assert.deepEqual(await resolveOpenDirectory(absoluteDirectory, {
    stat: async () => { const error = new Error('missing'); error.code = 'ENOENT'; throw error },
  }), {ok: false, error: 'not_found'})
  assert.deepEqual(await resolveOpenDirectory(absoluteDirectory, {
    stat: async () => { throw new Error('denied') },
  }), {ok: false, error: 'unavailable'})
})

test('校验通过后只向系统 Shell 传递真实目录', async () => {
  let openedPath = null
  const result = await openDirectoryInShell(absoluteDirectory, async value => {
    openedPath = value
    return ''
  }, {
    stat: async () => ({isDirectory: () => true}),
    realpath: async value => `${value}-resolved`,
  })
  assert.deepEqual(result, {ok: true})
  assert.equal(openedPath, `${absoluteDirectory}-resolved`)
})

test('系统 Shell 拒绝或异常时返回稳定失败结果', async () => {
  const dependencies = {
    stat: async () => ({isDirectory: () => true}),
    realpath: async value => value,
  }
  assert.deepEqual(await openDirectoryInShell(absoluteDirectory, async () => 'denied', dependencies), {
    ok: false, error: 'shell_open_failed',
  })
  assert.deepEqual(await openDirectoryInShell(absoluteDirectory, async () => { throw new Error('failed') }, dependencies), {
    ok: false, error: 'shell_open_failed',
  })
})
