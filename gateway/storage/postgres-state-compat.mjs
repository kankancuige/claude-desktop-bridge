import {identifier} from './postgres-schema.mjs'

function text(value, fallback = '') { return value == null ? fallback : String(value) }
function number(value, fallback = null) {
    if (value == null || String(value).trim() === '') return fallback
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
}
function json(value, fallback) {
    if (value == null) return fallback
    if (typeof value === 'object') return value
    try { return JSON.parse(String(value)) } catch { return fallback }
}
function key(...parts) { return parts.map(part => text(part)).join('\u0000') }
function limit(value, fallback = 100, max = 500) { return Math.max(1, Math.min(max, number(value, fallback) || fallback)) }
function required(value, name) {
    const result = text(value).trim()
    if (!result || result.length > 512 || /[\0\r\n]/.test(result)) throw Object.assign(new TypeError(`${name} 无效`), {code: 'STORAGE_STATE_KEY_INVALID'})
    return result
}
function parseStateRow(row) {
    if (!row) return null
    return {
        ...row,
        notifications: json(row.notificationsJson, {}),
        state: json(row.stateJson, {}),
    }
}

/**
 * 为旧同步业务 API 提供 PostgreSQL 事实源的内存投影。
 * 业务调用立即看到内存变更，所有落库动作进入单一 FIFO 队列；失败只进入 degraded，不切换事实源。
 */
export class PostgresStateCompat {
    constructor({gateway, schema = 'bridge', logger = null, now = () => Date.now()} = {}) {
        if (!gateway?.query) throw new TypeError('StorageGateway is required')
        this.gateway = gateway
        this.schema = identifier(schema, 'bridge')
        this.logger = logger
        this.now = now
        this.mode = 'postgres'
        this.available = true
        this.degraded = false
        this.degradedReason = null
        this.schemaVersion = 0
        this._queue = Promise.resolve()
        this._entries = new Map()
        this._sessions = new Map()
        this._memory = new Map()
        this._tasks = new Map()
        this._taskEvents = new Map()
        this._workflows = new Map()
        this._pitfalls = new Map()
        this._occurrences = new Map()
        this._links = new Map()
        this._reports = new Map()
        this._campaigns = new Map()
        this._usage = new Map()
    }

    async load() {
        const q = async (sql, values = []) => (await this.gateway.query(sql, values)).rows || []
        try {
            const [schema, entries, sessions, memory, tasks, taskEvents, workflows, pitfalls, occurrences, links, reports, campaigns, usage] = await Promise.all([
                q(`SELECT version FROM ${this.schema}.schema_version WHERE id = 1`),
                q(`SELECT kind, platform, entry_id AS "entryId", data_json AS data FROM ${this.schema}.state_entries`),
                q(`SELECT project_key AS "projectKey", session_id AS "sessionId", sdk_session_id AS "sdkSessionId", work_dir AS "workDir", source, visibility, transcript_path AS "transcriptPath", mtime, size, title, content_hash AS "contentHash", last_opened_at AS "lastOpenedAt", permission_mode AS "permissionMode", mirrors_json AS mirrors, runtime_revision AS "runtimeRevision", updated_at AS "updatedAt" FROM ${this.schema}.session_index`),
                q(`SELECT project_key AS "projectKey", source_key AS "sourcePath", title, body, metadata, body_hash AS "contentHash", updated_at AS "updatedAt", status, scope FROM ${this.schema}.content_documents WHERE content_kind = 'memory' AND version = (SELECT MAX(c2.version) FROM ${this.schema}.content_documents c2 WHERE c2.project_key = content_documents.project_key AND c2.content_kind = content_documents.content_kind AND c2.source_key = content_documents.source_key)`),
                q(`SELECT project_key AS "projectKey", task_key AS "taskKey", session_id AS "sessionId", task_id AS "taskId", sdk_session_id AS "sdkSessionId", status, outcome, continuation_reason AS "continuationReason", phase, review_state AS "reviewState", model_tier AS "modelTier", error_code AS "errorCode", sequence, revision, started_at AS "startedAt", completed_at AS "completedAt", updated_at AS "updatedAt", notifications AS "notificationsJson", state_json AS "stateJson" FROM ${this.schema}.task_state`),
                q(`SELECT project_key AS "projectKey", task_key AS "taskKey", revision, event_type AS "eventType", event_json AS payload, created_at AS "createdAt" FROM ${this.schema}.task_events`),
                q(`SELECT project_key AS "projectKey", workflow_id AS "workflowId", parent_session_id AS "parentSessionId", name, status, current_phase AS "currentPhase", token_spent AS "tokenSpent", started_at AS "startedAt", ended_at AS "endedAt", revision, updated_at AS "updatedAt", state_json AS "stateJson" FROM ${this.schema}.workflow_state`),
                q(`SELECT id, project_key AS "projectKey", scope, fingerprint, status, title, summary, root_cause AS "rootCause", prevention, tags, first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt", confirmed_at AS "confirmedAt", mitigated_at AS "mitigatedAt", expires_at AS "expiresAt", updated_at AS "updatedAt" FROM ${this.schema}.pitfalls`),
                q(`SELECT id, pitfall_id AS "pitfallId", task_id AS "taskId", context_json AS context, observed_at AS "observedAt" FROM ${this.schema}.pitfall_occurrences`),
                q(`SELECT pitfall_id AS "pitfallId", kind, target, created_at AS "createdAt" FROM ${this.schema}.pitfall_links`),
                q(`SELECT task_id AS "taskId", project_key AS "projectKey", session_id AS "sessionId", status, evidence_level AS "evidenceLevel", created_at AS "createdAt", updated_at AS "updatedAt", report_json AS report FROM ${this.schema}.execution_reports`),
                q(`SELECT campaign_id AS "campaignId", task_id AS "taskId", project_key AS "projectKey", status, created_at AS "createdAt", updated_at AS "updatedAt", campaign_json AS campaign FROM ${this.schema}.verification_campaigns`),
                q(`SELECT event_id AS "eventId", project_key AS "projectKey", session_id AS "sessionId", model, provider_key AS "providerKey", context_fingerprint AS "contextFingerprint", policy, cache_eligibility AS "cacheEligibility", reason_codes AS "reasonCodes", input_tokens AS "inputTokens", output_tokens AS "outputTokens", cache_read_input_tokens AS "cacheReadInputTokens", cache_creation_input_tokens AS "cacheCreationInputTokens", usage_source AS source, duration_ms AS "durationMs", retry_count AS "retryCount", created_at AS "createdAt", status, ended_at AS "endedAt", error_code AS "errorCode" FROM ${this.schema}.model_usage_events`),
            ])
            this.schemaVersion = number(schema[0]?.version, 0)
            for (const row of entries) {
                const bucket = key(row.kind, row.platform)
                if (!this._entries.has(bucket)) this._entries.set(bucket, new Map())
                this._entries.get(bucket).set(row.entryId, json(row.data, null))
            }
            for (const row of sessions) this._sessions.set(key(row.projectKey, row.sessionId), {...row, mirrors: json(row.mirrors, null)})
            for (const row of memory) this._memory.set(key(row.projectKey, row.sourcePath), {...row, metadata: json(row.metadata, {})})
            for (const row of tasks) this._tasks.set(key(row.projectKey, row.taskKey), parseStateRow(row))
            for (const row of taskEvents) this._taskEvents.set(key(row.projectKey, row.taskKey, row.revision), row)
            for (const row of workflows) this._workflows.set(key(row.projectKey, row.workflowId), {...row, state: json(row.stateJson, {})})
            for (const row of pitfalls) this._pitfalls.set(row.id, {...row, tags: json(row.tags, [])})
            for (const row of occurrences) this._occurrences.set(row.id, {...row, context: json(row.context, {})})
            for (const row of links) this._links.set(key(row.pitfallId, row.kind, row.target), row)
            for (const row of reports) this._reports.set(row.taskId, json(row.report, null))
            for (const row of campaigns) this._campaigns.set(row.campaignId, json(row.campaign, null))
            for (const row of usage) this._usage.set(row.eventId, {...row, reasonCodes: json(row.reasonCodes, [])})
            return this
        } catch (error) {
            this.degraded = true
            this.degradedReason = error.code || 'postgres_load_failed'
            throw Object.assign(new Error('PostgreSQL 状态投影加载失败'), {code: 'STORAGE_STATE_LOAD_FAILED', cause: error})
        }
    }

    _enqueue(operation, context = {}) {
        this._queue = this._queue.then(async () => {
            try { await operation() }
            catch (error) {
                this.degraded = true
                this.degradedReason = error.code || 'postgres_write_failed'
                this.logger?.error?.({err: error, ...context}, 'PostgreSQL 状态写入失败')
            }
        })
        return true
    }

    async flush() { await this._queue }
    async close() { await this.flush() }

    loadEntries(kind, platform) { return new Map(this._entries.get(key(kind, platform)) || []) }
    replaceEntries(kind, platform, entries) {
        const bucket = new Map(entries instanceof Map ? entries : Object.entries(entries || {}))
        this._entries.set(key(kind, platform), bucket)
        this._enqueue(async () => this.gateway.state.replaceEntries(kind, platform, bucket), {kind, platform})
        return true
    }
    clearEntries(kind, platform) { const bucket = this._entries.get(key(kind, platform)); const count = bucket?.size || 0; this._entries.delete(key(kind, platform)); this._enqueue(() => this.gateway.query(`DELETE FROM ${this.schema}.state_entries WHERE kind = $1 AND platform = $2`, [text(kind), text(platform)])); return count }
    summarizeEntries(kind, platform, states = ['pending', 'failed', 'dead', 'sent']) { const result = Object.fromEntries(states.map(state => [state, 0])); for (const value of this.loadEntries(kind, platform).values()) if (Object.hasOwn(result, value?.state)) result[value.state]++; return result }

    upsertSessionIndex(record = {}) {
        const row = {...record, projectKey: required(record.projectKey, 'projectKey'), sessionId: required(record.sessionId, 'sessionId'), transcriptPath: required(record.transcriptPath, 'transcriptPath'), updatedAt: this.now()}
        const id = key(row.projectKey, row.sessionId); const previous = this._sessions.get(id); const merged = {...previous, ...row}; this._sessions.set(id, merged)
        this._enqueue(() => this.gateway.query(`INSERT INTO ${this.schema}.session_index (project_key, session_id, sdk_session_id, work_dir, source, visibility, transcript_path, mtime, size, title, content_hash, last_opened_at, permission_mode, mirrors_json, runtime_revision, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16) ON CONFLICT (project_key, session_id) DO UPDATE SET sdk_session_id=COALESCE(EXCLUDED.sdk_session_id,${this.schema}.session_index.sdk_session_id), work_dir=COALESCE(EXCLUDED.work_dir,${this.schema}.session_index.work_dir), source=COALESCE(EXCLUDED.source,${this.schema}.session_index.source), visibility=COALESCE(EXCLUDED.visibility,${this.schema}.session_index.visibility), transcript_path=EXCLUDED.transcript_path, mtime=EXCLUDED.mtime, size=EXCLUDED.size, title=COALESCE(EXCLUDED.title,${this.schema}.session_index.title), content_hash=COALESCE(EXCLUDED.content_hash,${this.schema}.session_index.content_hash), last_opened_at=COALESCE(EXCLUDED.last_opened_at,${this.schema}.session_index.last_opened_at), permission_mode=COALESCE(EXCLUDED.permission_mode,${this.schema}.session_index.permission_mode), mirrors_json=COALESCE(EXCLUDED.mirrors_json,${this.schema}.session_index.mirrors_json), runtime_revision=COALESCE(EXCLUDED.runtime_revision,${this.schema}.session_index.runtime_revision), updated_at=EXCLUDED.updated_at`, [row.projectKey,row.sessionId,row.sdkSessionId||null,row.workDir||null,row.source||null,row.visibility||null,row.transcriptPath,number(row.mtime,0),number(row.size,0),row.title||null,row.contentHash||null,number(row.lastOpenedAt),row.permissionMode||null,JSON.stringify(row.mirrors||null),number(row.runtimeRevision),row.updatedAt]), {table: 'session_index'})
        return merged
    }
    upsertSessionCatalog(record) { return this.upsertSessionIndex(record) }
    upsertSessionCatalogBatch(records = []) { for (const record of records) this.upsertSessionIndex(record); return true }
    listSessionIndex(projectKey, {limit: max = 100, visibility = null} = {}) { return [...this._sessions.values()].filter(row => row.projectKey === text(projectKey) && (!visibility || row.visibility === visibility)).sort((a,b)=>number(b.mtime,0)-number(a.mtime,0)).slice(0, limit(max)).map(row=>({...row, mirrors: json(row.mirrors,null)})) }
    listVisibleSessions(projectKey, max = 100) { return this.listSessionIndex(projectKey, {limit: max, visibility: 'visible'}) }
    getSessionCatalog(projectKey, sessionId) { const row = this._sessions.get(key(projectKey, sessionId)); return row ? {...row, mirrors: json(row.mirrors,null)} : null }
    getSessionCatalogs(projectKey, sessionIds = []) { const wanted = new Set(sessionIds.map(text)); return new Map(this.listSessionIndex(projectKey, {limit: 5000}).filter(row => wanted.has(row.sessionId)).map(row => [row.sessionId,row])) }
    findSessionIndexById(sessionId) { const id = text(sessionId); return [...this._sessions.values()].filter(row => row.sessionId === id || row.sdkSessionId === id).map(row => ({...row, mirrors: json(row.mirrors, null)})) }
    updateSessionSettings(projectKey, sessionId, patch = {}) { const id=key(projectKey,sessionId); const row=this._sessions.get(id); if(!row)return false; const next={...row,...patch,updatedAt:this.now()}; this._sessions.set(id,next); this.upsertSessionIndex(next); return true }
    updateSessionSettingsByIds(projectKey, ids, patch = {}) { let count=0; for(const row of this.listSessionIndex(projectKey,{limit:5000})) if(ids.map(text).includes(row.sessionId)||ids.map(text).includes(row.sdkSessionId)){this.updateSessionSettings(projectKey,row.sessionId,patch);count++} return count>0 }
    removeSessionIndex(transcriptPath) { for(const [id,row] of this._sessions) if(row.transcriptPath===transcriptPath){this._sessions.delete(id);this._enqueue(()=>this.gateway.query(`DELETE FROM ${this.schema}.session_index WHERE transcript_path = $1`,[transcriptPath]));return true} return false }
    removeSessionCatalog(projectKey, sessionId) { const id=key(projectKey,sessionId); if(!this._sessions.has(id))return false; this._sessions.delete(id); this._enqueue(()=>this.gateway.query(`DELETE FROM ${this.schema}.session_index WHERE project_key = $1 AND session_id = $2`,[text(projectKey),text(sessionId)])); return true }
    clearSessionIndex(projectKey) { const rows=this.listSessionIndex(projectKey,{limit:5000}); for(const row of rows)this.removeSessionCatalog(projectKey,row.sessionId); return rows.length }

    upsertMemoryIndex(record = {}) { const row={...record,projectKey:required(record.projectKey,'projectKey'),sourcePath:required(record.sourcePath,'sourcePath'),updatedAt:this.now()}; this._memory.set(key(row.projectKey,row.sourcePath),row); this._enqueue(()=>this.gateway.content.put({projectKey:row.projectKey,kind:'memory',sourceKey:row.sourcePath,title:row.title||'',body:row.body||'',bodyHash:row.contentHash||undefined,scope:row.scope||'project',status:row.status||'active',metadata:{keywords:row.keywords||'',mtime:row.mtime||0,size:row.size||0,confidence:row.confidence??1,lastVerifiedAt:row.lastVerifiedAt??null,expiresAt:row.expiresAt??null,lastUsedAt:row.lastUsedAt??null}})); return true }
    listMemoryIndex(projectKey,{status='active',limit:max=100}={}) { return [...this._memory.values()].filter(row=>row.projectKey===text(projectKey)&&(!status||status==='all'||row.status===status)).sort((a,b)=>number(b.updatedAt,0)-number(a.updatedAt,0)).slice(0,limit(max)) }
    removeMemoryIndex(projectKey,sourcePath){const id=key(projectKey,sourcePath);if(!this._memory.has(id))return false;this._memory.delete(id);this._enqueue(()=>this.gateway.content.remove({projectKey,kind:'memory',sourceKey:sourcePath}));return true}
    clearMemoryIndex(projectKey){const rows=this.listMemoryIndex(projectKey,{status:'all',limit:5000});for(const row of rows)this.removeMemoryIndex(projectKey,row.sourcePath);return rows.length}
    markMemoryUsed(projectKey,sourcePath,usedAt=this.now()){const row=this._memory.get(key(projectKey,sourcePath));if(!row)return false;row.lastUsedAt=usedAt;row.updatedAt=this.now();this._enqueue(()=>this.gateway.query(`UPDATE ${this.schema}.content_documents SET metadata = jsonb_set(COALESCE(metadata,'{}'::jsonb), '{lastUsedAt}', to_jsonb($4::bigint)), updated_at = $4 WHERE project_key=$1 AND content_kind='memory' AND source_key=$2 AND version=(SELECT MAX(version) FROM ${this.schema}.content_documents WHERE project_key=$1 AND content_kind='memory' AND source_key=$2)`,[text(projectKey),text(sourcePath),'',number(usedAt,this.now())]));return true}

    _taskKey(record){return key(record.projectKey,record.taskKey||record.taskId||record.sdkSessionId||record.sessionId)}
    recordTaskTransition(record={}){const id=this._taskKey(record);const current=this._tasks.get(id);const revision=number(record.revision??record.sequence??record.state?.revision,0);if(current&&number(current.revision,0)>=revision)return false;const state=record.state&&typeof record.state==='object'?record.state:record;const taskKey=text(record.taskKey||record.taskId||record.sdkSessionId||record.sessionId);const row={...record,projectKey:text(record.projectKey),taskKey,revision,updatedAt:number(record.updatedAt,this.now()),notificationsJson:record.notifications||state.notifications||{},stateJson:state};this._tasks.set(id,parseStateRow(row));this._taskEvents.set(key(row.projectKey,taskKey,number(record.eventRevision,revision)),{projectKey:row.projectKey,taskKey,revision:number(record.eventRevision,revision),eventType:text(record.eventType,'task/state-changed'),payload:record.eventPayload||state,createdAt:row.updatedAt});this._enqueue(()=>this.gateway.state.recordTaskTransition(record),{table:'task_state'});return true}
    upsertTaskState(record){return this.recordTaskTransition(record)}
    appendTaskEvent(record={}){const projectKey=text(record.projectKey);const taskKey=text(record.taskKey||record.taskId);const revision=number(record.eventRevision??record.revision,0);if(!projectKey||!taskKey||revision<1)return false;const row={projectKey,taskKey,revision,eventType:text(record.eventType,'task/event'),payload:record.eventPayload||record.payload||{},createdAt:number(record.createdAt,this.now())};const id=key(projectKey,taskKey,revision);if(this._taskEvents.has(id))return false;this._taskEvents.set(id,row);this._enqueue(()=>this.gateway.state.appendTaskEvent(record),{table:'task_events'});return true}
    getTaskState(projectKey,value){const v=text(value);return [...this._tasks.values()].filter(row=>row.projectKey===text(projectKey)&&(row.taskKey===v||row.taskId===v||row.sdkSessionId===v||row.sessionId===v)).sort((a,b)=>number(b.revision,0)-number(a.revision,0))[0]||null}
    listTaskEvents({projectKey,taskId,limit:max=100,before=null,after=null,eventType=null}={}){return [...this._taskEvents.values()].filter(row=>row.projectKey===text(projectKey)&&(row.taskKey===text(taskId)||row.taskKey===`${text(taskId)}:coordinator`)&&(!eventType||row.eventType===text(eventType))&& (before==null||number(row.revision,0)<number(before,0)) && (after==null||number(row.revision,0)>number(after,0))).sort((a,b)=>number(a.revision,0)-number(b.revision,0)).slice(0,limit(max))}
    getCoordinatorTaskState(projectKey,taskId){return this._tasks.get(key(projectKey,`${taskId}:coordinator`))||[...this._tasks.values()].find(row=>row.projectKey===text(projectKey)&&row.taskId===text(taskId)&&row.state?.coordinator)||null}
    listTaskStates(projectKey,{activeOnly=false,limit:max=100}={}){return [...this._tasks.values()].filter(row=>(!projectKey||row.projectKey===text(projectKey))&&(!activeOnly||['running','reviewing','changes_required','fixing'].includes(row.status))).sort((a,b)=>number(b.updatedAt,0)-number(a.updatedAt,0)).slice(0,limit(max))}
    listWorkbenchProjectKeys(){return [...new Set([...this._tasks.values(),...this._memory.values(),...this._reports.values()].map(row=>text(row.projectKey)).filter(v=>v&&v!=='*'))].sort((a,b)=>a.localeCompare(b))}
    listTaskNotificationIntents(platform,{limit:max=100}={}){return this.listTaskStates(null,{limit:max}).filter(row=>['pending','failed'].includes(row.notifications?.[platform]?.state))}
    updateTaskNotification({taskId,sessionId=null,platform,notificationId,state,lastError='',updatedAt=this.now()}={}){const row=[...this._tasks.values()].find(item=>(taskId&&item.taskId===taskId)||(sessionId&&item.sessionId===sessionId));if(!row)return false;const notifications={...(row.notifications||{}),[platform]:{...(row.notifications?.[platform]||{}),state,notificationId,lastError,updatedAt}};return this.recordTaskTransition({...row,revision:number(row.revision,0)+1,notifications,state:{...row.state,notifications,updatedAt}})}
    removeTaskState(projectKey,taskKey){const id=key(projectKey,taskKey);if(!this._tasks.has(id))return false;this._tasks.delete(id);this._enqueue(()=>this.gateway.query(`DELETE FROM ${this.schema}.task_state WHERE project_key=$1 AND task_key=$2`,[text(projectKey),text(taskKey)]));return true}
    pruneTaskState(){return 0}
    upsertWorkflowState(record={}){const row={...record,projectKey:text(record.projectKey),workflowId:text(record.workflowId),state:record.state||{},updatedAt:this.now()};this._workflows.set(key(row.projectKey,row.workflowId),row);this._enqueue(()=>this.gateway.query(`INSERT INTO ${this.schema}.workflow_state (project_key,workflow_id,parent_session_id,name,status,current_phase,token_spent,started_at,ended_at,revision,updated_at,state_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) ON CONFLICT (project_key,workflow_id) DO UPDATE SET status=EXCLUDED.status,current_phase=EXCLUDED.current_phase,token_spent=EXCLUDED.token_spent,ended_at=EXCLUDED.ended_at,revision=EXCLUDED.revision,updated_at=EXCLUDED.updated_at,state_json=EXCLUDED.state_json`,[row.projectKey,row.workflowId,row.parentSessionId||null,row.name||row.workflowId,row.status||'starting',row.currentPhase||null,number(row.tokenSpent,0),number(row.startedAt),number(row.endedAt),number(row.revision,0),row.updatedAt,JSON.stringify(row.state||{})]));return true}
    listWorkflowStates(projectKey,{parentSessionId=null,limit:max=100}={}){return [...this._workflows.values()].filter(row=>row.projectKey===text(projectKey)&&(!parentSessionId||row.parentSessionId===parentSessionId)).sort((a,b)=>number(b.updatedAt,0)-number(a.updatedAt,0)).slice(0,limit(max))}
    pruneWorkflowState(){return 0}

    recordPitfall(record={}){const id=text(record.id)||cryptoRandom();const existing=[...this._pitfalls.values()].find(row=>row.projectKey===text(record.projectKey)&&row.scope===text(record.scope,'project')&&row.fingerprint===text(record.fingerprint));const row={...existing,...record,id,projectKey:text(record.projectKey),scope:text(record.scope,'project'),status:text(record.status,'observed'),tags:record.tags||existing?.tags||[],firstSeenAt:existing?.firstSeenAt||this.now(),lastSeenAt:this.now(),updatedAt:this.now()};this._pitfalls.set(id,row);this._enqueue(()=>this.gateway.query(`INSERT INTO ${this.schema}.pitfalls (id,project_key,scope,fingerprint,status,title,summary,root_cause,prevention,tags,first_seen_at,last_seen_at,confirmed_at,mitigated_at,expires_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16) ON CONFLICT (project_key,scope,fingerprint) DO UPDATE SET status=EXCLUDED.status,title=EXCLUDED.title,summary=EXCLUDED.summary,tags=EXCLUDED.tags,last_seen_at=EXCLUDED.last_seen_at,updated_at=EXCLUDED.updated_at`,[row.id,row.projectKey,row.scope,row.fingerprint,row.status,text(row.title),text(row.summary),row.rootCause||null,row.prevention||null,JSON.stringify(row.tags),number(row.firstSeenAt,this.now()),number(row.lastSeenAt,this.now()),number(row.confirmedAt),number(row.mitigatedAt),number(row.expiresAt),row.updatedAt]));return row}
    recordPitfallOccurrence({pitfallId,occurrenceId,taskId=null,context={},observedAt=this.now()}={}){const id=text(occurrenceId)||cryptoRandom();if(this._occurrences.has(id))return false;const row={id,pitfallId,taskId,context,observedAt};this._occurrences.set(id,row);this._enqueue(()=>this.gateway.query(`INSERT INTO ${this.schema}.pitfall_occurrences (id,pitfall_id,task_id,context_json,observed_at) VALUES ($1,$2,$3,$4::jsonb,$5) ON CONFLICT DO NOTHING`,[id,pitfallId,taskId,JSON.stringify(context),observedAt]));return true}
    countPitfallOccurrences(pitfallId){return [...this._occurrences.values()].filter(row=>row.pitfallId===pitfallId).length}
    linkPitfall({pitfallId,kind,target,createdAt=this.now()}={}){const id=key(pitfallId,kind,target);if(this._links.has(id))return false;const row={pitfallId,kind,target,createdAt};this._links.set(id,row);this._enqueue(()=>this.gateway.query(`INSERT INTO ${this.schema}.pitfall_links (pitfall_id,kind,target,created_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[pitfallId,kind,target,createdAt]));return true}
    getPitfall(projectKey,fingerprint,scope='project'){return [...this._pitfalls.values()].find(row=>row.projectKey===text(projectKey)&&row.fingerprint===text(fingerprint)&&row.scope===scope)||null}
    listPitfalls(projectKey,{statuses=null,scopes=null,limit:max=100,now=this.now()}={}){return [...this._pitfalls.values()].filter(row=>(row.projectKey===text(projectKey)||(row.scope==='global'&&row.projectKey==='*'))&&(!row.expiresAt||row.expiresAt>now)&&(!statuses?.length||statuses.includes(row.status))&&(!scopes?.length||scopes.includes(row.scope))).sort((a,b)=>number(b.lastSeenAt,0)-number(a.lastSeenAt,0)).slice(0,limit(max))}
    listRecentPitfalls({limit:max=100,now=this.now()}={}){return [...this._pitfalls.values()].filter(row=>!row.expiresAt||row.expiresAt>now).sort((a,b)=>number(b.lastSeenAt,0)-number(a.lastSeenAt,0)).slice(0,limit(max))}
    updatePitfallStatus(id,status,{rootCause=null,prevention=null,evidence=null,now=this.now()}={}){const row=this._pitfalls.get(id);if(!row)return false;Object.assign(row,{status,rootCause:rootCause||row.rootCause,prevention:prevention||row.prevention,updatedAt:now,...status==='confirmed'?{confirmedAt:now}:{} ,...status==='mitigated'?{mitigatedAt:now}:{}});this.recordPitfall(row);if(evidence)this.linkPitfall({pitfallId:id,kind:'evidence',target:evidence,createdAt:now});return true}
    upsertExecutionReport({projectKey,sessionId=null,report,updatedAt=this.now()}={}){if(!report?.taskId)return false;this._reports.set(report.taskId,{...report,projectKey,sessionId,updatedAt});this._enqueue(()=>this.gateway.query(`INSERT INTO ${this.schema}.execution_reports (task_id,project_key,session_id,status,evidence_level,created_at,updated_at,report_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT (task_id) DO UPDATE SET status=EXCLUDED.status,evidence_level=EXCLUDED.evidence_level,updated_at=EXCLUDED.updated_at,report_json=EXCLUDED.report_json WHERE EXCLUDED.updated_at >= ${this.schema}.execution_reports.updated_at`,[report.taskId,projectKey,sessionId,report.status||'unknown',report.verification?.evidenceLevel||'L0',number(report.startedAt,updatedAt),updatedAt,JSON.stringify(report)]));return true}
    getExecutionReport(taskId){return this._reports.get(text(taskId))||null}
    listExecutionReports(projectKey,{limit:max=100}={}){return [...this._reports.values()].filter(row=>!projectKey||row.projectKey===text(projectKey)).sort((a,b)=>number(b.updatedAt,0)-number(a.updatedAt,0)).slice(0,limit(max))}
    upsertVerificationCampaign({projectKey,campaign,updatedAt=this.now()}={}){if(!campaign?.campaignId)return false;this._campaigns.set(campaign.campaignId,{...campaign,projectKey,updatedAt});this._enqueue(()=>this.gateway.query(`INSERT INTO ${this.schema}.verification_campaigns (campaign_id,task_id,project_key,status,created_at,updated_at,campaign_json) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (campaign_id) DO UPDATE SET status=EXCLUDED.status,updated_at=EXCLUDED.updated_at,campaign_json=EXCLUDED.campaign_json`,[campaign.campaignId,campaign.taskId,projectKey,campaign.status||'not_started',number(campaign.createdAt,updatedAt),updatedAt,JSON.stringify(campaign)]));return true}
    getVerificationCampaign(id){return this._campaigns.get(text(id))||null}
    listVerificationCampaigns(projectKey,{taskId=null,limit:max=100}={}){return [...this._campaigns.values()].filter(row=>row.projectKey===text(projectKey)&&(!taskId||row.taskId===text(taskId))).sort((a,b)=>number(b.updatedAt,0)-number(a.updatedAt,0)).slice(0,limit(max))}
    appendModelUsageEvent(event={}){if(this._usage.has(text(event.eventId)))return false;this._usage.set(text(event.eventId),event);this._enqueue(()=>this.gateway.state.appendModelUsageEvent(event));return true}
    updateModelUsageEvent(eventId,event={}){const id=text(eventId);const current=this._usage.get(id);if(!current)return false;const row={...current,...event,eventId:id};this._usage.set(id,row);this._enqueue(()=>this.gateway.state.updateModelUsageEvent(id,row));return true}
    listModelUsageEvents(sessionId,{limit:max=100}={}){return [...this._usage.values()].filter(row=>row.sessionId===text(sessionId)).sort((a,b)=>number(b.createdAt,0)-number(a.createdAt,0)).slice(0,limit(max))}
    normalizeUsageWindow({from=null,to=null}={}){const end=number(to,this.now());const start=number(from,end-14*24*60*60*1000);return {from:Math.min(start,end),to:Math.max(start,end)}}
    listModelUsageHistory({from=null,to=null,projectKey=null,limit:max=100}={}){const window=this.normalizeUsageWindow({from,to});return [...this._usage.values()].filter(row=>number(row.createdAt,0)>=window.from&&number(row.createdAt,0)<=window.to&&(!projectKey||row.projectKey===text(projectKey))).sort((a,b)=>number(b.createdAt,0)-number(a.createdAt,0)).slice(0,limit(max)).map(row=>({...row}))}
    summarizeModelUsage({from=null,to=null,projectKey=null}={}){const window=this.normalizeUsageWindow({from,to});const rows=this.listModelUsageHistory({from:window.from,to:window.to,projectKey,limit:500});const sum=field=>rows.reduce((total,row)=>total+(Number.isSafeInteger(Number(row[field]))?Number(row[field]):0),0);const trendMap=new Map();for(const row of rows){const day=new Date(number(row.createdAt,0)).toISOString().slice(0,10);const item=trendMap.get(day)||{day,eventCount:0,inputTokens:0,outputTokens:0,cacheReadInputTokens:0,cacheCreationInputTokens:0};item.eventCount++;for(const field of ['inputTokens','outputTokens','cacheReadInputTokens','cacheCreationInputTokens'])if(Number.isSafeInteger(Number(row[field])))item[field]+=Number(row[field]);trendMap.set(day,item)}return {from:window.from,to:window.to,totals:{eventCount:rows.length,unknownTokenEvents:rows.filter(row=>row.inputTokens==null||row.outputTokens==null).length,inputTokens:sum('inputTokens'),outputTokens:sum('outputTokens'),cacheReadInputTokens:sum('cacheReadInputTokens'),cacheCreationInputTokens:sum('cacheCreationInputTokens')},trend:[...trendMap.values()].sort((a,b)=>a.day.localeCompare(b.day))}}
}

function cryptoRandom(){ return `state-${Date.now()}-${Math.random().toString(36).slice(2,12)}` }
export function createPostgresStateCompat(options = {}) { return new PostgresStateCompat(options) }
