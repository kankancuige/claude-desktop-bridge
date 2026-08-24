import test from 'node:test'
import assert from 'node:assert/strict'
import {createCoordinatorVerificationRuntime} from './coordinator-verification-runtime.mjs'

test('Coordinator Verification Runtime 缺少任务边界时立即失败', () => {
    assert.throws(() => createCoordinatorVerificationRuntime(), /dependencies are required/)
})

test('受信命令按 test/build 去重并限制数量', () => {
    const runtime = createCoordinatorVerificationRuntime({
        taskCoordinator: {}, taskWorkbench: {}, createVerificationCampaignService() {},
    })
    const commands = runtime.trustedValidationCommands({commands: [
        {name: 'test:unit', executable: 'npm', args: ['test'], kind: 'test'},
        {name: 'test:unit', executable: 'npm', args: ['test'], kind: 'test'},
        {name: 'build', executable: 'npm', args: ['run', 'build'], kind: 'build'},
    ]})
    assert.equal(commands.length, 2)
    assert.equal(commands[0].kind, 'test')
})
