import {execFile as defaultExecFile} from 'node:child_process'
import {promisify} from 'node:util'

const exec = promisify(defaultExecFile)

function required(value, name) {
    const result = String(value || '').trim()
    if (!result) throw Object.assign(new TypeError(`${name} is required`), {code: 'POSTGRES_BACKUP_ARGUMENT_INVALID'})
    return result
}

function safeIdentifier(value) {
    const result = required(value, 'schema')
    if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(result)) throw Object.assign(new TypeError('schema invalid'), {code: 'POSTGRES_BACKUP_SCHEMA_INVALID'})
    return result
}

export function buildPostgresBackupPlan({connectionString, schema = 'bridge', dumpPath, restoreDatabase} = {}) {
    return {
        dump: {command: 'pg_dump', args: ['--format=custom', '--no-owner', '--schema', safeIdentifier(schema), '--file', required(dumpPath, 'dumpPath'), required(connectionString, 'connectionString')]},
        restore: {command: 'pg_restore', args: ['--exit-on-error', '--no-owner', '--dbname', required(restoreDatabase, 'restoreDatabase'), required(dumpPath, 'dumpPath')]},
    }
}

export function validatePostgresRestoreEvidence({schema, contentCounts = [], embeddingDimensions = [], transcript = null} = {}) {
    const normalizedSchema = safeIdentifier(schema)
    const dimensions = embeddingDimensions.map(value => Number(value)).filter(Number.isInteger)
    const validTranscript = transcript && transcript.status === 'materialized' && Number(transcript.bytes) >= 0 && /^[a-f0-9]{64}$/i.test(String(transcript.hash || ''))
    return {
        passed: normalizedSchema.length > 0 && Array.isArray(contentCounts) && dimensions.every(value => value > 0) && Boolean(validTranscript),
        schema: normalizedSchema,
        contentCounts,
        embeddingDimensions: dimensions,
        transcriptVerified: Boolean(validTranscript),
    }
}

export async function runPostgresBackupRestoreAcceptance({connectionString, schema = 'bridge', dumpPath, restoreDatabase, execFile = exec, verify} = {}) {
    const plan = buildPostgresBackupPlan({connectionString, schema, dumpPath, restoreDatabase})
    await execFile(plan.dump.command, plan.dump.args, {windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024})
    await execFile(plan.restore.command, plan.restore.args, {windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024})
    const evidence = typeof verify === 'function' ? await verify({schema: safeIdentifier(schema), restoreDatabase}) : null
    if (!evidence) throw Object.assign(new Error('PostgreSQL 恢复证据未提供'), {code: 'POSTGRES_RESTORE_EVIDENCE_MISSING'})
    const result = validatePostgresRestoreEvidence(evidence)
    if (!result.passed) throw Object.assign(new Error('PostgreSQL 恢复证据校验失败'), {code: 'POSTGRES_RESTORE_EVIDENCE_INVALID', evidence: result})
    return {verified: true, evidence: result}
}
