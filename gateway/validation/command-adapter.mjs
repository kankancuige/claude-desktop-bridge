import {spawn} from 'node:child_process'
import {isAbsolute, resolve} from 'node:path'
import {normalizeVerificationAdapter} from './verification-adapter.mjs'

function commandKey(command) {
    return `${command.executable}\0${(command.args || []).join('\0')}`
}

function resolveSpawnCommand(selected, {platform = process.platform} = {}) {
    if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(selected.executable)) return selected
    if (!/^[A-Za-z0-9_.-]+\.(?:cmd|bat)$/i.test(selected.executable)
        || selected.args.some(value => /[\r\n"&|<>^%]/.test(value))) {
        throw Object.assign(new Error('Windows 命令 shim 包含不安全字符'), {code: 'UNSAFE_VERIFICATION_COMMAND'})
    }
    return {...selected, shell: true}
}

export function createCommandVerificationAdapter({commands = [], spawnImpl = spawn, timeoutMs = 120_000, platform = process.platform} = {}) {
    const trusted = new Map(commands.filter(item => item?.executable && Array.isArray(item.args)).map(item => [commandKey(item), item]))
    return normalizeVerificationAdapter({
        id: 'project-command',
        type: 'command',
        timeoutMs,
        async execute(input = {}, {signal} = {}) {
            const selected = {executable: String(input.command?.executable || ''), args: Array.isArray(input.command?.args) ? input.command.args.map(String) : []}
            if (!trusted.has(commandKey(selected))) throw Object.assign(new Error('命令不在 Project Context 受信清单中'), {code: 'UNTRUSTED_VERIFICATION_COMMAND'})
            const cwd = resolve(String(input.workDir || ''))
            if (!isAbsolute(cwd)) throw new TypeError('验证 workDir 必须是绝对路径')
            const spawnCommand = resolveSpawnCommand(selected, {platform})
            return new Promise((resolvePromise, reject) => {
                const child = spawnImpl(spawnCommand.executable, spawnCommand.args, {cwd, shell: spawnCommand.shell === true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']})
                let stdout = ''
                let stderr = ''
                const onAbort = () => child.kill()
                signal?.addEventListener('abort', onAbort, {once: true})
                child.stdout?.on('data', chunk => { stdout = (stdout + chunk).slice(-32_000) })
                child.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-32_000) })
                child.once('error', reject)
                child.once('close', code => {
                    signal?.removeEventListener('abort', onAbort)
                    resolvePromise({passed: code === 0, exitCode: code, stdout, stderr})
                })
            })
        },
        collectEvidence: async result => ({exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr}),
        evaluate: result => result?.passed === true,
    })
}
