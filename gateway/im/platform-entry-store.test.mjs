import assert from 'node:assert/strict'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {clearPlatformEntries, platformEntryFilePath} from './platform-entry-store.mjs'

const dir = mkdtempSync(join(tmpdir(), 'bridge-platform-store-'))
try {
    const filePath = join(dir, 'entries.json')
    writeFileSync(filePath, JSON.stringify({version: 1, entries: {
        'wechat:a': {state: 'pending'},
        'wechat:b': {state: 'failed'},
        'feishu:c': {state: 'sent'},
    }}))
    assert.equal(clearPlatformEntries(filePath, 'wechat'), 2)
    assert.deepEqual(JSON.parse(readFileSync(filePath, 'utf8')).entries, {'feishu:c': {state: 'sent'}})
    assert.equal(clearPlatformEntries(filePath, 'wechat'), 0)
    assert.equal(clearPlatformEntries(filePath, '../bad'), 0)
    assert.equal(platformEntryFilePath(dir, 'bridge-im-inbox', 'wechat'), join(dir, 'bridge-im-inbox.wechat.json'))
    assert.throws(() => platformEntryFilePath(dir, '../bad', 'wechat'), TypeError)
    console.log('platform-entry-store tests passed')
} finally {
    rmSync(dir, {recursive: true, force: true})
}
