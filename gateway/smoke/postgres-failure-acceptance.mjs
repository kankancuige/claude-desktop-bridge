import assert from 'node:assert/strict'
import {createStorageGateway} from '../storage/storage-gateway.mjs'

export async function runPostgresFailureAcceptance({gateway = createStorageGateway()} = {}) {
    const evidence = {health: await gateway.health(), rollback: false, closeFlush: false, reconnect: false}
    assert.equal(evidence.health.healthy, true)
    const marker = `failure-acceptance-${Date.now()}`
    await assert.rejects(() => gateway.transaction(async client => {
        await client.query(`INSERT INTO ${gateway.config.schema}.state_entries (kind, platform, entry_id, state, updated_at, data_json) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, ['acceptance', 'failure', marker, 'pending', Date.now(), JSON.stringify({marker})])
        throw new Error('intentional-rollback')
    }), /intentional-rollback/)
    const check = await gateway.query(`SELECT COUNT(*)::int AS count FROM ${gateway.config.schema}.state_entries WHERE kind = $1 AND platform = $2 AND entry_id = $3`, ['acceptance', 'failure', marker])
    evidence.rollback = Number(check.rows?.[0]?.count || 0) === 0
    const connectedClient = await gateway.connect()
    await connectedClient.end()
    await assert.rejects(() => gateway.query('SELECT 1'), error => error?.code === 'STORAGE_POSTGRES_DISCONNECTED')
    evidence.reconnect = (await gateway.health()).healthy === true
    await gateway.close()
    evidence.closeFlush = true
    return evidence
}

if (process.env.BRIDGE_STORAGE_BACKEND === 'postgres' && process.env.BRIDGE_POSTGRES_URL) {
    try {
        const result = await runPostgresFailureAcceptance()
        console.log(JSON.stringify({verified: true, ...result}))
    } catch (error) {
        console.error(JSON.stringify({verified: false, code: error.code || 'POSTGRES_FAILURE_ACCEPTANCE_FAILED', message: error.message}))
        process.exitCode = 1
    }
} else {
    console.error(JSON.stringify({verified: false, code: 'POSTGRES_ACCEPTANCE_CONFIG_MISSING'}))
    process.exitCode = 2
}
