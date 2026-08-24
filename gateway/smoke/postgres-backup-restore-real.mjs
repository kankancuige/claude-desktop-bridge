import {readFileSync} from 'node:fs'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {promisify} from 'node:util'
import {execFile as execFileCallback} from 'node:child_process'
import {Client} from 'pg'
import {StorageGateway} from '../storage/storage-gateway.mjs'
import {recoverTranscript} from '../sessions/transcript-materializer.mjs'

const execFile = promisify(execFileCallback)
const pgBin = process.env.BRIDGE_PG_BIN || 'D:/ckd/DB/PostgreSQL/17/bin'
const configPath = process.env.BRIDGE_STORAGE_CONFIG || join(process.env.USERPROFILE, '.claude-desktop-bridge', 'storage-config.json')
const database = `bridge_restore_acceptance_${process.pid}`

function quoteIdentifier(value) {
    return `"${String(value).replaceAll('"', '""')}"`
}

function connectionForDatabase(connectionString, databaseName) {
    const url = new URL(connectionString)
    url.pathname = `/${databaseName}`
    return url.toString()
}

async function rows(client, sql, values = []) {
    return (await client.query(sql, values)).rows
}

async function dropDatabase(admin, name) {
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name])
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`)
}

const raw = JSON.parse(readFileSync(configPath, 'utf8'))
const sourceUrl = raw?.postgres?.connectionString
const schema = raw?.postgres?.schema || 'bridge'
if (!sourceUrl) throw new Error('PostgreSQL storage-config.json 缺少 connectionString')

const admin = new Client({connectionString: connectionForDatabase(sourceUrl, 'postgres')})
const source = new Client({connectionString: sourceUrl})
const restoreUrl = connectionForDatabase(sourceUrl, database)
const restored = new Client({connectionString: restoreUrl})
const workDir = await mkdtemp(join(tmpdir(), 'bridge-pg-restore-'))
const dumpPath = join(workDir, 'bridge.dump')
let gateway = null

try {
    await admin.connect()
    await dropDatabase(admin, database)
    await admin.query(`CREATE DATABASE ${quoteIdentifier(database)}`)
    await admin.end()

    // pg_dump --schema 不包含 public 扩展；恢复前在隔离目标库声明 pgvector，保证 vector 列可建表。
    const extensionClient = new Client({connectionString: restoreUrl})
    await extensionClient.connect()
    await extensionClient.query('CREATE EXTENSION IF NOT EXISTS vector')
    await extensionClient.end()

    await execFile(join(pgBin, 'pg_dump.exe'), ['--format=custom', '--no-owner', '--schema', schema, '--file', dumpPath, sourceUrl], {windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024})
    await execFile(join(pgBin, 'pg_restore.exe'), ['--exit-on-error', '--no-owner', '--dbname', restoreUrl, dumpPath], {windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024})

    await source.connect()
    await restored.connect()
    const sourceSchema = await rows(source, 'SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) AS exists', [schema])
    const restoredSchema = await rows(restored, 'SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) AS exists', [schema])
    const contentSql = `SELECT content_kind AS kind, count(*)::int AS count FROM ${quoteIdentifier(schema)}.content_documents GROUP BY content_kind ORDER BY content_kind`
    const hashSql = `SELECT content_kind AS kind, md5(string_agg(coalesce(body_hash, ''), '' ORDER BY project_key, source_key, version)) AS digest FROM ${quoteIdentifier(schema)}.content_documents GROUP BY content_kind ORDER BY content_kind`
    const dimensionsSql = `SELECT DISTINCT dimensions::int AS dimensions FROM ${quoteIdentifier(schema)}.memory_embeddings WHERE dimensions IS NOT NULL ORDER BY dimensions`
    const sourceCounts = await rows(source, contentSql)
    const restoredCounts = await rows(restored, contentSql)
    const sourceHashes = await rows(source, hashSql)
    const restoredHashes = await rows(restored, hashSql)
    const sourceDimensions = await rows(source, dimensionsSql)
    const restoredDimensions = await rows(restored, dimensionsSql)
    const vectorTypeSql = `SELECT format_type(a.atttypid, a.atttypmod) AS type FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = 'memory_embeddings' AND a.attname = 'embedding'`
    const sourceVectorType = await rows(source, vectorTypeSql, [schema])
    const restoredVectorType = await rows(restored, vectorTypeSql, [schema])
    const transcript = await rows(restored, `SELECT project_key, replace(source_key, 'session/', '') AS session_id, body_hash FROM ${quoteIdentifier(schema)}.content_documents WHERE content_kind = 'transcript' ORDER BY updated_at DESC LIMIT 1`)
    if (!transcript[0]) throw new Error('恢复库没有 transcript 内容')

    gateway = new StorageGateway({config: {enabled: true, mode: 'postgres', connectionString: restoreUrl, schema, statementTimeoutMs: 5000}})
    await gateway.connect()
    const targetPath = join(workDir, 'transcript.jsonl')
    const materialized = await recoverTranscript({repository: gateway.repositories.transcript, projectKey: transcript[0].project_key, sessionId: transcript[0].session_id, targetPath, expectedHash: transcript[0].body_hash})
    const evidence = {
        sourceSchema: Boolean(sourceSchema[0]?.exists),
        restoredSchema: Boolean(restoredSchema[0]?.exists),
        sourceCounts,
        restoredCounts,
        sourceHashes,
        restoredHashes,
        sourceDimensions,
        restoredDimensions,
        sourceVectorType,
        restoredVectorType,
        transcript: {status: materialized.status, source: materialized.source, bytes: materialized.bytes, hash: materialized.hash},
    }
    const verified = evidence.sourceSchema && evidence.restoredSchema
        && JSON.stringify(sourceCounts) === JSON.stringify(restoredCounts)
        && JSON.stringify(sourceHashes) === JSON.stringify(restoredHashes)
        && JSON.stringify(sourceDimensions) === JSON.stringify(restoredDimensions)
        && JSON.stringify(sourceVectorType) === JSON.stringify(restoredVectorType)
        && /^vector\(\d+\)$/.test(String(sourceVectorType[0]?.type || ''))
        && materialized.status === 'materialized'
    console.log(JSON.stringify({verified, evidence}))
    if (!verified) process.exitCode = 1
} finally {
    await gateway?.close?.().catch(() => {})
    await source.end().catch(() => {})
    await restored.end().catch(() => {})
    const cleanupAdmin = new Client({connectionString: connectionForDatabase(sourceUrl, 'postgres')})
    try {
        await cleanupAdmin.connect()
        await dropDatabase(cleanupAdmin, database)
    } finally {
        await cleanupAdmin.end().catch(() => {})
        await rm(workDir, {recursive: true, force: true})
    }
}
