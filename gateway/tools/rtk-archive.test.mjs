import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {buildWindowsRtkExtractArgs, buildWindowsRtkExtractEnv, selectRtkReleaseAsset, verifyRtkAssetDigest} from './rtk-archive.mjs'

const binaryName = 'rtk-x86_64-pc-windows-msvc.exe'
const asset = selectRtkReleaseAsset([
    {name: 'rtk-x86_64-pc-windows-msvc.zip'},
    {name: 'rtk-x86_64-unknown-linux-gnu.tar.gz'},
], binaryName, 'win32')
assert.equal(asset.name, 'rtk-x86_64-pc-windows-msvc.zip')
assert.throws(() => selectRtkReleaseAsset([{name: 'rtk-x86_64-pc-windows-msvc.zip'}, {name: 'copy-rtk-x86_64-pc-windows-msvc.zip'}], binaryName, 'win32'))

const payload = Buffer.from('rtk-test-payload')
const digest = `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`
assert.equal(verifyRtkAssetDigest(payload, digest).length, 64)
assert.throws(() => verifyRtkAssetDigest(Buffer.from('changed'), digest))
assert.throws(() => verifyRtkAssetDigest(payload, ''))

if (process.platform === 'win32') {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-rtk-extract-'))
    try {
        const source = join(dir, 'rtk.exe')
        const archive = join(dir, 'rtk.zip')
        const destination = join(dir, 'out.exe')
        writeFileSync(source, payload)
        const compressed = spawnSync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command',
            'Compress-Archive -LiteralPath $env:BRIDGE_TEST_RTK_SOURCE -DestinationPath $env:BRIDGE_TEST_RTK_ARCHIVE -Force',
        ], {
            timeout: 30_000,
            windowsHide: true,
            env: {...process.env, BRIDGE_TEST_RTK_SOURCE: source, BRIDGE_TEST_RTK_ARCHIVE: archive},
        })
        assert.equal(compressed.status, 0, compressed.stderr?.toString())
        const extracted = spawnSync('powershell.exe', buildWindowsRtkExtractArgs(), {
            timeout: 30_000,
            windowsHide: true,
            env: buildWindowsRtkExtractEnv(archive, destination),
        })
        assert.equal(extracted.status, 0, extracted.stderr?.toString())
        assert.deepEqual(readFileSync(destination), payload)
    } finally {
        rmSync(dir, {recursive: true, force: true})
    }
}
console.log('rtk-archive tests passed')
