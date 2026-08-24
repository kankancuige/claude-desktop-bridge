import assert from 'node:assert/strict'
import {createStorageGateway} from '../storage/storage-gateway.mjs'
import {ensurePostgresSchema} from '../storage/postgres-schema.mjs'

if (process.env.BRIDGE_STORAGE_BACKEND !== 'postgres' || !process.env.BRIDGE_POSTGRES_URL) {
    console.error(JSON.stringify({verified: false, code: 'POSTGRES_ACCEPTANCE_CONFIG_MISSING'}))
    process.exitCode = 2
} else {
    const gateway = createStorageGateway()
    try {
        const healthBefore = await gateway.health()
        assert.equal(healthBefore.healthy, true)
        const client = await gateway.connect()
        const schema = await ensurePostgresSchema(client, {schema: gateway.config.schema})
        const rollbackMarker = `acceptance-${Date.now()}`
        await assert.rejects(() => gateway.transaction(async tx => {
            await tx.query(`INSERT INTO "${gateway.config.schema}".state_entries (kind, platform, entry_id, state, updated_at, data_json) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, ['acceptance', 'local', rollbackMarker, 'pending', Date.now(), JSON.stringify({marker: rollbackMarker})])
            throw new Error('intentional-rollback')
        }), /intentional-rollback/)
        const rollbackCheck = await gateway.query(`SELECT COUNT(*)::int AS count FROM "${gateway.config.schema}".state_entries WHERE kind = $1 AND platform = $2 AND entry_id = $3`, ['acceptance', 'local', rollbackMarker])
        assert.equal(Number(rollbackCheck.rows?.[0]?.count || 0), 0)
        const counts = await gateway.query(`SELECT content_kind AS kind, COUNT(*)::int AS count FROM "${gateway.config.schema}".content_documents GROUP BY content_kind ORDER BY content_kind`)
        console.log(JSON.stringify({verified: true, health: healthBefore, schema, contentCounts: counts.rows || []}))
    } catch (error) {
        console.error(JSON.stringify({verified: false, code: error.code || 'POSTGRES_ACCEPTANCE_FAILED', message: error.message}))
        process.exitCode = 1
    } finally {
        await gateway.close().catch(() => {})
    }
}
