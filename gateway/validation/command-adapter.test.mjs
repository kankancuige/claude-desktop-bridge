import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {resolve} from 'node:path'
import test from 'node:test'
import {createCommandVerificationAdapter} from './command-adapter.mjs'

function fakeSpawn(executable, args) {
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => {}
    queueMicrotask(() => {
        child.stdout.end(`${executable} ${args.join(' ')}`)
        child.emit('close', 0)
    })
    return child
}

test('命令适配器只执行 Project Context 受信命令', async () => {
    const adapter = createCommandVerificationAdapter({commands: [{executable: 'node', args: ['--test']}], spawnImpl: fakeSpawn})
    const result = await adapter.execute({command: {executable: 'node', args: ['--test']}, workDir: resolve('.')})
    assert.equal(result.passed, true)
    await assert.rejects(adapter.execute({command: {executable: 'cmd', args: ['/c', 'del']}, workDir: resolve('.')}), error => error?.code === 'UNTRUSTED_VERIFICATION_COMMAND')
})

test('Windows cmd shim 仅在安全参数下启用 shell 且拒绝 shell 元字符', async () => {
    const calls = []
    const spawnImpl = (executable, args, options) => {
        calls.push({executable, args, shell: options.shell})
        return fakeSpawn(executable, args)
    }
    const command = {executable: 'pnpm.cmd', args: ['run', 'test:unit']}
    const adapter = createCommandVerificationAdapter({commands: [command], spawnImpl, platform: 'win32'})
    const result = await adapter.execute({command, workDir: resolve('.')})
    assert.equal(result.passed, true)
    assert.deepEqual(calls[0], {
        executable: 'pnpm.cmd',
        args: ['run', 'test:unit'],
        shell: true,
    })

    const unsafe = {executable: 'pnpm.cmd', args: ['run', 'test:&whoami']}
    const unsafeAdapter = createCommandVerificationAdapter({commands: [unsafe], spawnImpl, platform: 'win32'})
    await assert.rejects(unsafeAdapter.execute({command: unsafe, workDir: resolve('.')}), error => error?.code === 'UNSAFE_VERIFICATION_COMMAND')
})
