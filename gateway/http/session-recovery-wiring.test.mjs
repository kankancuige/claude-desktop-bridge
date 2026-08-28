import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {createSessionMutationRoutes} from './session-mutation-routes.mjs'
import {resolveRecoveryRuntimeIdentity, resolveSessionCreateMode} from '../sessions/session-create-mode.mjs'

const routeSource = readFileSync(new URL('./session-mutation-routes.mjs', import.meta.url), 'utf8')
const rootSource = readFileSync(new URL('../gateway-runtime-impl.mjs', import.meta.url), 'utf8')

test('持久化会话恢复函数从组合根注入并由路由显式接收', () => {
    assert.match(rootSource, /resolveSessionCreateMode, resolveRecoveryRuntimeIdentity, resolveSessionResume/)
    assert.match(routeSource, /const \{resolveRecoveryRuntimeIdentity\} = deps/)
    assert.match(routeSource, /resolveRecoveryRuntimeIdentity\(persistedResumeState\)/)
})

test('POST sessions 的 recovery-only 分支恢复 runtime identity', async () => {
    const sessions = new Map()
    const persisted = {
        status: 'interrupted', resumable: true, sdkSessionId: 'sdk-history-1',
        historySessionId: 'sdk-history-1', permissionMode: 'default',
    }
    class PushStream {}
    const route = createSessionMutationRoutes({
        BRIDGE_HOME: 'D:/bridge', PushStream, sessions,
        VALID_MODEL_MODES: new Set(['auto', 'fixed']),
        VALID_PERMISSION_MODES: new Set(['default', 'acceptEdits', 'plan', 'bypassPermissions']),
        VALID_THINKING_LEVELS: new Set(['auto', 'off', 'low', 'medium', 'high']),
        crypto: {randomUUID: () => 'unused-new-id'},
        readBody: async req => req.body,
        isValidSessionId: value => typeof value === 'string' && value.length > 0,
        normalizeWorkDir: value => value,
        isDirectoryPath: value => value === 'D:/work',
        resolveSessionCreateMode,
        resolveRecoveryRuntimeIdentity,
        sessionCatalogProjectKey: () => 'project-1',
        loadTaskState: () => persisted,
        resolveResumeModel: () => null,
        loadCliSettings: () => ({}),
        makeQueryOptions: async () => ({permissionMode: 'default', bridgeModelMode: 'auto'}),
        openSessionEventJournal: () => ({close() {}}),
        createSessionRuntime: ({query, pushStream, workDir, opts, identity, extra}) => ({
            query, pushStream, workDir, queryOpts: opts, lastSessionId: identity,
            permissionMode: opts.permissionMode, snapshot: null, mirrors: {}, ...extra,
        }),
        repairPersistedTaskState: value => value,
        createTaskStatePatch: value => value,
        restoreSessionMirrors() {},
        persistSessionCatalogSettings() {},
        sessionVisibilitySource: () => null,
        getProjectVisibility: () => null,
        saveTaskState() {},
        taskStateForClient: value => value,
        reconcileTaskNotificationIntents: async () => {},
        scheduleProjectCacheBuild() {},
        scheduleSessionBackgroundInitialization() {},
        invalidateProjectsCache() {},
        log: {warn() {}, error() {}, debug() {}},
    })
    const res = {
        status: 0, body: '',
        writeHead(status) { this.status = status },
        end(body = '') { this.body = body },
    }

    await route({
        req: {method: 'POST', body: {workDir: 'D:/work', recoverSessionId: 'gateway-old'}},
        res,
        url: new URL('http://localhost/api/sessions'),
    })

    assert.equal(res.status, 201)
    assert.equal(JSON.parse(res.body).recovered, true)
    assert.equal(sessions.get('gateway-old').lastSessionId, 'sdk-history-1')
})
