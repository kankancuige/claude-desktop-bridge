import {existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {SecurePayloadCodec} from './secure-payload.mjs'

const FORMAT_VERSION = 2
const MAX_CONFIG_BYTES = 128 * 1024

function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

function codecFor(filePath, keyPath, {allowKeyCreation = true} = {}) {
    return new SecurePayloadCodec(keyPath || join(dirname(filePath), 'bridge-store-key'), {allowKeyCreation})
}

function atomicWrite(filePath, content) {
    mkdirSync(dirname(filePath), {recursive: true})
    const tmp = join(dirname(filePath), `.${filePath.split(/[\\/]/).pop()}.tmp`)
    writeFileSync(tmp, content, {encoding: 'utf8', mode: 0o600})
    try {
        renameSync(tmp, filePath)
    } catch (renameError) {
        try {
            writeFileSync(filePath, content, {encoding: 'utf8', mode: 0o600})
        } catch (writeError) {
            try { unlinkSync(tmp) } catch (cleanupError) {
                console.debug('适配器配置临时文件清理失败', cleanupError)
            }
            throw new AggregateError([renameError, writeError], `adapter config write failed: ${filePath}`)
        }
        try { unlinkSync(tmp) } catch (cleanupError) {
            console.debug('适配器配置临时文件残留，将在下次写入时覆盖', cleanupError)
        }
    }
}

export function readAdapterConfig(filePath, {keyPath} = {}) {
    if (!filePath || !existsSync(filePath)) return {}
    const raw = readFileSync(filePath, 'utf8')
    if (Buffer.byteLength(raw, 'utf8') > MAX_CONFIG_BYTES) throw new RangeError('adapter config is too large')
    const parsed = JSON.parse(raw)
    if (parsed?.version === FORMAT_VERSION && parsed?.encrypted === true && typeof parsed.payload === 'string') {
        const decoded = codecFor(filePath, keyPath, {allowKeyCreation: false}).decode(parsed.payload)
        if (!isObject(decoded)) throw new Error('adapter config payload is invalid')
        return decoded
    }
    if (!isObject(parsed)) throw new Error('adapter config is invalid')
    return parsed
}

export function writeAdapterConfig(filePath, config, {keyPath} = {}) {
    if (!filePath || !isObject(config)) throw new TypeError('adapter config must be an object')
    const payload = codecFor(filePath, keyPath).encode(config)
    atomicWrite(filePath, JSON.stringify({version: FORMAT_VERSION, encrypted: true, payload}, null, 2))
}

export function migrateAdapterConfig(filePath, options = {}) {
    if (!filePath || !existsSync(filePath)) return {migrated: false, config: {}}
    const raw = readFileSync(filePath, 'utf8')
    if (Buffer.byteLength(raw, 'utf8') > MAX_CONFIG_BYTES) throw new RangeError('adapter config is too large')
    const parsed = JSON.parse(raw)
    if (parsed?.version === FORMAT_VERSION && parsed?.encrypted === true) {
        return {migrated: false, config: readAdapterConfig(filePath, options)}
    }
    if (!isObject(parsed)) throw new Error('adapter config is invalid')
    writeAdapterConfig(filePath, parsed, options)
    return {migrated: true, config: parsed}
}
