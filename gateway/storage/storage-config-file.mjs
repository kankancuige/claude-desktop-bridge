import {existsSync, readFileSync} from 'node:fs'
import {isAbsolute, join, resolve} from 'node:path'
import {readPostgresStorageConfig} from './postgres-config.mjs'

const CONFIG_FILE_NAME = 'storage-config.json'
const DEFAULT_MEMORY_DIMENSIONS = 1536

function configError(message, code, cause = null) {
    return Object.assign(new Error(message), {code, ...(cause ? {cause} : {})})
}

function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function hasEnv(env, key) {
    return Object.prototype.hasOwnProperty.call(env, key)
}

function fileOrEnv(env, key, fallback) {
    return hasEnv(env, key) ? env[key] : fallback
}

function readJsonConfig(configPath) {
    let raw
    try {
        raw = readFileSync(configPath, 'utf8')
    } catch (error) {
        throw configError('Bridge Storage 配置文件无法读取', 'STORAGE_CONFIG_FILE_READ_FAILED', error)
    }
    try {
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('配置根节点必须是对象')
        for (const section of ['postgres', 'memory']) {
            if (section in parsed && (!parsed[section] || typeof parsed[section] !== 'object' || Array.isArray(parsed[section]))) {
                throw new Error(`${section} 配置必须是对象`)
            }
        }
        return parsed
    } catch (error) {
        throw configError('Bridge Storage 配置文件 JSON 无效', 'STORAGE_CONFIG_FILE_INVALID', error)
    }
}

function mergeEnvWithFile(fileConfig, env) {
    const postgres = fileConfig.postgres && typeof fileConfig.postgres === 'object' && !Array.isArray(fileConfig.postgres)
        ? fileConfig.postgres
        : {}
    const memory = fileConfig.memory && typeof fileConfig.memory === 'object' && !Array.isArray(fileConfig.memory)
        ? fileConfig.memory
        : {}
    const merged = {...env}
    merged.BRIDGE_STORAGE_BACKEND = fileOrEnv(env, 'BRIDGE_STORAGE_BACKEND', optionalString(fileConfig.backend))
    merged.BRIDGE_POSTGRES_URL = fileOrEnv(env, 'BRIDGE_POSTGRES_URL', optionalString(postgres.connectionString || postgres.url))
    merged.BRIDGE_POSTGRES_SCHEMA = fileOrEnv(env, 'BRIDGE_POSTGRES_SCHEMA', optionalString(postgres.schema))
    merged.BRIDGE_POSTGRES_STATEMENT_TIMEOUT_MS = fileOrEnv(env, 'BRIDGE_POSTGRES_STATEMENT_TIMEOUT_MS', postgres.statementTimeoutMs)
    merged.BRIDGE_MEMORY_EMBEDDING_ENDPOINT = fileOrEnv(env, 'BRIDGE_MEMORY_EMBEDDING_ENDPOINT', optionalString(memory.embeddingEndpoint))
    merged.BRIDGE_MEMORY_EMBEDDING_API_KEY = fileOrEnv(env, 'BRIDGE_MEMORY_EMBEDDING_API_KEY', optionalString(memory.embeddingApiKey))
    merged.BRIDGE_MEMORY_EMBEDDING_MODEL = fileOrEnv(env, 'BRIDGE_MEMORY_EMBEDDING_MODEL', optionalString(memory.embeddingModel))
    merged.BRIDGE_MEMORY_EMBEDDING_DIMENSIONS = fileOrEnv(env, 'BRIDGE_MEMORY_EMBEDDING_DIMENSIONS', memory.embeddingDimensions)
    return merged
}

export function storageConfigPath(bridgeHome) {
    const configured = String(bridgeHome || '').trim()
    if (!configured || !isAbsolute(configured)) throw configError('Bridge Storage 配置目录必须是绝对路径', 'STORAGE_CONFIG_HOME_NOT_ABSOLUTE')
    const root = resolve(configured)
    return join(root, CONFIG_FILE_NAME)
}

export function readStorageConfigFile({bridgeHome, env = process.env, required = true} = {}) {
    const configPath = storageConfigPath(bridgeHome)
    if (!existsSync(configPath)) {
        if (!required) {
            const config = readPostgresStorageConfig(env)
            return {config, path: configPath, source: 'environment'}
        }
        throw configError(`Bridge Storage 配置文件不存在：${configPath}`, 'STORAGE_CONFIG_FILE_MISSING')
    }
    const fileConfig = readJsonConfig(configPath)
    const mergedEnv = mergeEnvWithFile(fileConfig, env)
    const config = readPostgresStorageConfig(mergedEnv)
    const memory = fileConfig.memory && typeof fileConfig.memory === 'object' && !Array.isArray(fileConfig.memory)
        ? fileConfig.memory
        : {}
    const semanticProjects = memory.semanticProjects && typeof memory.semanticProjects === 'object' && !Array.isArray(memory.semanticProjects)
        ? memory.semanticProjects
        : {}
    const dimensions = Number(mergedEnv.BRIDGE_MEMORY_EMBEDDING_DIMENSIONS || DEFAULT_MEMORY_DIMENSIONS)
    if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 4096) {
        throw configError('Memory embedding 维度无效', 'STORAGE_MEMORY_DIMENSIONS_INVALID')
    }
    return {
        config: {
            ...config,
            memory: {
                embeddingEndpoint: optionalString(mergedEnv.BRIDGE_MEMORY_EMBEDDING_ENDPOINT),
                embeddingApiKey: optionalString(mergedEnv.BRIDGE_MEMORY_EMBEDDING_API_KEY),
                embeddingModel: optionalString(mergedEnv.BRIDGE_MEMORY_EMBEDDING_MODEL) || 'text-embedding-3-small',
                embeddingDimensions: dimensions,
                backend: optionalString(memory.backend) || optionalString(mergedEnv.BRIDGE_MEMORY_BACKEND),
                semanticProjects,
            },
        },
        path: configPath,
        source: ['BRIDGE_STORAGE_BACKEND', 'BRIDGE_POSTGRES_URL', 'BRIDGE_POSTGRES_SCHEMA', 'BRIDGE_POSTGRES_STATEMENT_TIMEOUT_MS', 'BRIDGE_MEMORY_EMBEDDING_ENDPOINT', 'BRIDGE_MEMORY_EMBEDDING_API_KEY', 'BRIDGE_MEMORY_EMBEDDING_MODEL', 'BRIDGE_MEMORY_EMBEDDING_DIMENSIONS']
            .some(key => optionalString(env[key])) ? 'file+environment' : 'file',
    }
}

export {CONFIG_FILE_NAME}
