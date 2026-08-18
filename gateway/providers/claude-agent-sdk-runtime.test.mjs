import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, normalize} from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'

test('SDK 加载前强制使用 Bridge 私有 CLAUDE_CONFIG_DIR', () => {
    const bridgeHome = mkdtempSync(join(tmpdir(), 'bridge-sdk-home-'))
    const runtimeUrl = new URL('./claude-agent-sdk-runtime.mjs', import.meta.url)
    try {
        const output = execFileSync(process.execPath, [
            '--input-type=module',
            '--eval',
            `await import(${JSON.stringify(runtimeUrl.href)}); process.stdout.write(process.env.CLAUDE_CONFIG_DIR || '')`,
        ], {
            cwd: fileURLToPath(new URL('..', import.meta.url)),
            env: {...process.env, BRIDGE_HOME: bridgeHome, CLAUDE_CONFIG_DIR: join(bridgeHome, 'external-override')},
            encoding: 'utf8',
            timeout: 15_000,
        })
        assert.equal(normalize(output), normalize(bridgeHome))
    } finally {
        rmSync(bridgeHome, {recursive: true, force: true})
    }
})
