import crypto from 'node:crypto'
import {mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'

let injectedMasterKey = null

export function configureSecurePayloadMasterKey(encodedKey) {
    const text = Buffer.isBuffer(encodedKey) ? '' : String(encodedKey || '').trim()
    const key = Buffer.isBuffer(encodedKey)
        ? Buffer.from(encodedKey)
        : /^[0-9a-f]{64}$/i.test(text)
            ? Buffer.from(text, 'hex')
            : Buffer.from(text, 'base64')
    if (key.length !== 32) throw new TypeError('secure payload master key must be 32 bytes')
    injectedMasterKey = key
}

export class SecurePayloadCodec {
    constructor(keyPath, {allowKeyCreation = true} = {}) {
        if (!keyPath) throw new TypeError('keyPath is required')
        this.keyPath = keyPath
        this._key = this._loadOrCreateKey(allowKeyCreation)
    }

    _loadOrCreateKey(allowKeyCreation) {
        if (injectedMasterKey) return Buffer.from(injectedMasterKey)
        try {
            const raw = readFileSync(this.keyPath, 'utf8').trim()
            const key = Buffer.from(raw, 'hex')
            if (key.length === 32) return key
            throw new Error('secure payload key file is invalid')
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error
        }
        if (!allowKeyCreation) throw new Error('secure payload key is unavailable')
        const key = crypto.randomBytes(32)
        mkdirSync(dirname(this.keyPath), {recursive: true})
        const tmp = join(dirname(this.keyPath), `.${this.keyPath.split(/[\\/]/).pop()}.tmp`)
        const encoded = key.toString('hex')
        writeFileSync(tmp, encoded, {encoding: 'utf8', mode: 0o600})
        try {
            renameSync(tmp, this.keyPath)
        } catch (renameError) {
            writeFileSync(this.keyPath, encoded, {encoding: 'utf8', mode: 0o600})
            try { unlinkSync(tmp) } catch (cleanupError) {
                console.debug('安全存储临时密钥清理失败', {renameError, cleanupError})
            }
        }
        return key
    }

    encode(value) {
        const plain = Buffer.from(JSON.stringify(value), 'utf8')
        if (plain.length > 128 * 1024) throw new RangeError('payload is too large')
        const iv = crypto.randomBytes(12)
        const cipher = crypto.createCipheriv('aes-256-gcm', this._key, iv)
        const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
        const tag = cipher.getAuthTag()
        return Buffer.concat([Buffer.from([1]), iv, tag, encrypted]).toString('base64url')
    }

    decode(encoded) {
        const raw = Buffer.from(String(encoded || ''), 'base64url')
        if (raw.length < 30 || raw[0] !== 1) throw new Error('invalid encrypted payload')
        const iv = raw.subarray(1, 13)
        const tag = raw.subarray(13, 29)
        const encrypted = raw.subarray(29)
        const decipher = crypto.createDecipheriv('aes-256-gcm', this._key, iv)
        decipher.setAuthTag(tag)
        return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'))
    }
}
