import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjectRuntime} from './project-runtime.mjs'

test('项目缓存按工作目录去重并在成功后保存', async () => {
    const saved = []
    let builds = 0
    const runtime = createProjectRuntime({
        cacheFilePath: workDir => `${workDir}/cache`,
        exists: () => false,
        buildCache: async workDir => { builds++; return {workDir} },
        saveCache: (workDir, cache) => saved.push({workDir, cache}),
        idleDelayMs: 0,
        unrefTimers: false,
    })
    const first = runtime.schedule('D:/project')
    const second = runtime.schedule('D:/project')
    assert.equal(first, second)
    await first
    assert.equal(builds, 1)
    assert.equal(saved.length, 1)
    assert.equal(runtime.builds.size, 0)
})

test('缓存构建失败返回空结果且不会阻塞后续重试', async () => {
    let attempts = 0
    const runtime = createProjectRuntime({
        cacheFilePath: workDir => `${workDir}/cache`,
        buildCache: async () => { attempts++; throw new Error('scan failed') },
        saveCache: () => {},
        logger: {warn() {}},
        idleDelayMs: 0,
        unrefTimers: false,
    })
    assert.equal(await runtime.schedule('D:/project'), null)
    assert.equal(await runtime.schedule('D:/project'), null)
    assert.equal(attempts, 2)
})
