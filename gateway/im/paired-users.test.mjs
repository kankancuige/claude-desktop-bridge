import assert from 'node:assert/strict'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {loadPairedUserCount, loadPairedUsers, savePairedUsers} from './paired-users.mjs'

const dir = mkdtempSync(join(tmpdir(), 'bridge-paired-users-'))
try {
    const filePath = join(dir, 'paired.json')
    assert.equal(savePairedUsers(filePath, ['u1', 'u1', '', 'bad\nvalue', 'u2']), 2)
    assert.deepEqual([...loadPairedUsers(filePath)], ['u1', 'u2'])
    savePairedUsers(join(dir, 'bridge-paired.json'), ['wechat-user'])
    assert.equal(loadPairedUserCount(dir, 'wechat'), 1)
    assert.equal(loadPairedUserCount(dir, 'unknown'), 0)
    console.log('paired-users tests passed')
} finally {
    rmSync(dir, {recursive: true, force: true})
}
