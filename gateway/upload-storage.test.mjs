import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {cleanupUploadDir, prepareUploadDir} from './upload-storage.mjs'

function withTempDir(run) {
    const root = mkdtempSync(join(tmpdir(), 'bridge-upload-storage-'))
    try {
        run(root)
    } finally {
        rmSync(root, {recursive: true, force: true})
    }
}

test('首次上传准备空目录后目录仍然存在', () => {
    withTempDir(root => {
        const uploadDir = join(root, '.bridge-uploads')
        prepareUploadDir(uploadDir, {ttlMs: 60_000})

        assert.equal(existsSync(uploadDir), true)
        assert.deepEqual(readdirSync(uploadDir), [])
    })
})

test('上传前清理过期文件但保留目录和新文件', () => {
    withTempDir(root => {
        const uploadDir = join(root, '.bridge-uploads')
        prepareUploadDir(uploadDir, {ttlMs: 60_000})
        const expired = join(uploadDir, 'expired.txt')
        const current = join(uploadDir, 'current.txt')
        writeFileSync(expired, 'old')
        writeFileSync(current, 'new')
        const oldTime = new Date(Date.now() - 120_000)
        utimesSync(expired, oldTime, oldTime)

        const result = prepareUploadDir(uploadDir, {ttlMs: 60_000})

        assert.deepEqual(result, {removed: 1, bytes: 3})
        assert.equal(existsSync(uploadDir), true)
        assert.equal(existsSync(expired), false)
        assert.equal(existsSync(current), true)
    })
})

test('Session 删除清理全部附件后允许移除空目录', () => {
    withTempDir(root => {
        const uploadDir = join(root, '.bridge-uploads')
        prepareUploadDir(uploadDir, {ttlMs: 60_000})
        writeFileSync(join(uploadDir, 'attachment.txt'), 'data')

        cleanupUploadDir(uploadDir, {removeAll: true, ttlMs: 60_000})

        assert.equal(existsSync(uploadDir), false)
    })
})
