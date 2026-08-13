import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {safeBasename, safeChildPath} from './path-security.mjs'

function withTempDirs(run) {
    const base = mkdtempSync(join(tmpdir(), 'bridge-path-security-'))
    const root = join(base, 'root')
    const outside = join(base, 'outside')
    mkdirSync(root)
    mkdirSync(outside)
    try {
        run({base, root, outside})
    } finally {
        rmSync(base, {recursive: true, force: true})
    }
}

test('safeChildPath 拒绝绝对路径、空段和父目录穿越', () => {
    withTempDirs(({root}) => {
        assert.equal(safeChildPath(root, '../secret.txt'), null)
        assert.equal(safeChildPath(root, 'a//b.txt'), null)
        assert.equal(safeChildPath(root, 'C:/secret.txt'), null)
        assert.equal(safeChildPath(root, '/secret.txt'), null)
        assert.equal(safeChildPath(root, '%2e%2e/secret.txt'), null)
        assert.equal(safeBasename(root, 'nested/file.txt'), null)
    })
})

test('safeChildPath 允许工作区内的现有文件和新文件', () => {
    withTempDirs(({root}) => {
        mkdirSync(join(root, 'src'))
        writeFileSync(join(root, 'src', 'existing.txt'), 'ok')
        assert.equal(safeChildPath(root, 'src/existing.txt'), join(root, 'src', 'existing.txt'))
        assert.equal(safeChildPath(root, 'src/new.txt'), join(root, 'src', 'new.txt'))
    })
})

test('safeChildPath 拒绝经 symlink 或 junction 写到工作区外的新文件', (t) => {
    withTempDirs(({root, outside}) => {
        const link = join(root, 'linked')
        try {
            symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
        } catch (error) {
            t.skip('当前环境不允许创建 symlink/junction: ' + error.message)
            return
        }
        assert.equal(safeChildPath(root, 'linked/new.txt'), null)
    })
})
