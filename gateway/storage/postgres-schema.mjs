const MAX_IDENTIFIER = 63
const MIN_VECTOR_DIMENSIONS = 1
const MAX_VECTOR_DIMENSIONS = 4096

export function normalizeVectorDimensions(value, fallback = 1536) {
    const parsed = Number(value ?? fallback)
    if (!Number.isInteger(parsed) || parsed < MIN_VECTOR_DIMENSIONS || parsed > MAX_VECTOR_DIMENSIONS) {
        throw Object.assign(new Error('embedding 维度无效'), {code: 'STORAGE_VECTOR_DIMENSIONS_INVALID'})
    }
    return parsed
}

function identifier(value, fallback) {
    const name = String(value || fallback || '').trim()
    if (!/^[a-z_][a-z0-9_]*$/i.test(name) || name.length > MAX_IDENTIFIER) throw Object.assign(new Error('PostgreSQL 标识符无效'), {code: 'STORAGE_IDENTIFIER_INVALID'})
    return `"${name.replaceAll('"', '""')}"`
}

function sqlString(value) {
    return `'${String(value).replaceAll("'", "''")}'`
}

// 表和字段注释是数据库运维、迁移审查和现场排障的长期契约；新增字段必须同时补充这里。
export const schemaCommentDefinitions = Object.freeze({
    schema_version: {
        comment: 'Bridge PostgreSQL 结构化存储的迁移版本登记表，用于幂等升级和拒绝未知版本。',
        columns: {
            id: '固定主键，当前仅允许值 1，保证整个 schema 只有一条版本记录。',
            version: '当前 Bridge 数据库结构版本号；启动时用于判断兼容性和迁移状态。',
            updated_at: '版本记录最后更新时间，Unix epoch 毫秒时间戳。',
        },
    },
    state_entries: {
        comment: '统一状态入口的队列和平台状态投影，承载 IM inbox、通知 outbox 及其他可重试状态。',
        columns: {
            kind: '状态条目类型，例如 inbox 或 outbox，用于区分处理队列。',
            platform: '来源或发送目标平台，例如 wechat、feishu、dingtalk。',
            entry_id: '平台内条目的稳定幂等标识，和 kind、platform 共同组成主键。',
            state: '当前处理状态，例如 pending、sent、failed 或 dead。',
            updated_at: '状态最后变更时间，Unix epoch 毫秒时间戳。',
            next_attempt_at: '下一次允许重试的时间，Unix epoch 毫秒时间戳；为空表示无需排队重试。',
            attempts: '已尝试处理次数，用于退避、死信和运维诊断。',
            payload: '受控的可读载荷摘要；不得保存凭据或未脱敏敏感内容。',
            data_json: '完整结构化条目数据，供 StorageGateway 恢复业务状态和完成幂等处理。',
        },
    },
    session_index: {
        comment: '会话目录索引，保存项目与 SDK transcript 的关联和可见性投影，不替代 transcript 正文。',
        columns: {
            project_key: '经过稳定编码的项目标识，用于隔离不同工作目录的数据。',
            session_id: 'Bridge 对外使用的会话标识。',
            sdk_session_id: 'Claude Agent SDK 的原生会话标识，用于 resume 和恢复。',
            work_dir: '会话所属工作目录；仅用于索引和恢复，不作为跨项目查询键。',
            source: '会话来源，例如 user、agent 或 workflow。',
            visibility: '客户端目录可见性投影，例如 visible、hidden 或 archived。',
            transcript_path: 'SDK transcript 的受控绝对路径，必须唯一且不保存 transcript 正文。',
            mtime: 'transcript 文件最后修改时间，Unix epoch 秒或毫秒浮点值，沿用导入源格式。',
            size: 'transcript 文件字节数，用于目录排序和变更检测。',
            title: '会话展示标题，可由首条用户消息或用户编辑产生。',
            content_hash: 'transcript 内容摘要哈希，用于变更检测和去重。',
            last_opened_at: '最近一次打开会话的时间，Unix epoch 毫秒时间戳。',
            permission_mode: '会话实际生效的工具权限模式。',
            mirrors_json: '跨模型或跨 Provider 会话镜像的受控元数据，不保存完整 prompt。',
            runtime_revision: 'Gateway runtime 版本序号，用于拒绝迟到或过期的会话投影。',
            updated_at: '索引记录最后更新时间，Unix epoch 毫秒时间戳。',
        },
    },
    content_documents: {
        comment: '统一内容仓储，保存 Memory、Markdown、transcript 和事件正文的版本化受控副本。',
        columns: {
            project_key: '内容所属项目的稳定编码，用于项目隔离。',
            content_kind: '内容类型，只允许 memory、markdown、transcript 或 event。',
            source_key: '项目内的来源键，例如相对文件路径或事件流标识。',
            title: '内容展示标题。',
            body: '内容正文；业务层通过 StorageGateway 读写，日志不得输出正文。',
            body_hash: '正文内容哈希，用于版本去重、幂等写入和迁移校验。',
            version: '同一项目、类型和来源键的单调版本号。',
            scope: '内容作用域，例如 project 或 global。',
            status: '内容生命周期状态，例如 active、disabled 或 deleted。',
            metadata: '内容附加元数据，例如 Memory 使用时间和来源属性。',
            created_at: '该版本首次创建时间，Unix epoch 毫秒时间戳。',
            updated_at: '该版本最后更新时间，Unix epoch 毫秒时间戳。',
        },
    },
    memory_embeddings: {
        comment: 'Memory 向量索引投影，记录正文哈希对应的 embedding 状态；正文事实源仍在 content_documents。',
        columns: {
            project_key: '向量所属项目的稳定编码，用于召回隔离。',
            source_key: '对应 Memory 内容的来源键，与 content_documents.source_key 对齐。',
            body_hash: '生成该向量时的正文哈希，正文变化后必须重新生成。',
            embedding_model: '生成向量所使用的模型名称或稳定标识。',
            dimensions: '向量维度，必须和 PostgreSQL vector 列及模型输出一致。',
            embedding_json: '无 pgvector 时的兼容向量 JSON 投影；仅用于迁移或诊断。',
            status: '向量生命周期状态，例如 pending、ready、failed 或 deleted。',
            updated_at: '向量记录最后更新时间，Unix epoch 毫秒时间戳。',
            embedding: 'pgvector 扩展启用后生成的定长向量列，用于相似度召回。',
        },
    },
    task_state: {
        comment: '统一任务生命周期当前状态表，保存任务恢复、完成门禁和客户端展示所需的结构化投影。',
        columns: {
            project_key: '任务所属项目的稳定编码。',
            task_key: '任务聚合根稳定键，保证同一项目内的任务幂等。',
            session_id: '任务关联的 Bridge 会话标识。',
            task_id: '对外任务标识；可能与 task_key 不同。',
            sdk_session_id: '任务执行所使用的 SDK 会话标识，用于恢复。',
            status: '任务当前生命周期状态，例如 queued、running、reviewing 或 terminal。',
            outcome: '任务结果分类，例如 success、failed、incomplete 或 blocked。',
            continuation_reason: '任务可继续或需要人工继续的原因。',
            phase: '任务当前阶段，例如 planning、executing、verifying 或 reporting。',
            review_state: '最终复核状态和门禁结果。',
            model_tier: '任务实际使用的模型档位，例如 Balanced 或 Power。',
            error_code: '失败或阻塞时的稳定错误码。',
            sequence: '任务事件顺序号，用于客户端排序。',
            revision: '任务状态修订号，用于幂等更新和拒绝迟到写入。',
            started_at: '任务开始执行时间，Unix epoch 毫秒时间戳。',
            completed_at: '任务进入稳定终态时间，Unix epoch 毫秒时间戳。',
            updated_at: '任务状态最后更新时间，Unix epoch 毫秒时间戳。',
            notifications: '终态通知意图及其投递状态的结构化投影。',
            state_json: '任务完整结构化状态快照，不保存完整 prompt 或凭据。',
        },
    },
    task_events: {
        comment: '任务生命周期事件表，按修订号保存可重放的脱敏事件，并受 task_state 外键约束。',
        columns: {
            project_key: '事件所属项目的稳定编码。',
            task_key: '事件所属任务聚合根键。',
            revision: '事件对应的任务修订号，同一任务内唯一且单调递增。',
            event_type: '生命周期事件类型，例如 state_changed、agent_started 或 completed。',
            event_json: '事件结构化内容，必须是脱敏后的可重放数据。',
            created_at: '事件写入时间，Unix epoch 毫秒时间戳。',
        },
    },
    workflow_state: {
        comment: 'Workflow 执行状态表，记录父任务下的脚本流程、阶段和恢复信息。',
        columns: {
            project_key: 'Workflow 所属项目的稳定编码。',
            workflow_id: 'Workflow 运行实例标识。',
            parent_session_id: '承载该 Workflow 的父会话标识。',
            name: 'Workflow 定义名称。',
            status: 'Workflow 当前状态，例如 starting、running、paused、completed 或 failed。',
            current_phase: 'Workflow 当前执行阶段。',
            token_spent: '已记录的模型 token 消耗，仅用于治理统计。',
            started_at: 'Workflow 开始时间，Unix epoch 毫秒时间戳。',
            ended_at: 'Workflow 结束或暂停时间，Unix epoch 毫秒时间戳。',
            revision: 'Workflow 状态修订号，用于恢复和迟到事件控制。',
            updated_at: 'Workflow 状态最后更新时间，Unix epoch 毫秒时间戳。',
            state_json: 'Workflow 状态快照和 Agent 进度元数据。',
        },
    },
    execution_reports: {
        comment: '任务执行报告表，保存计划偏离、Agent 结果和验证证据的脱敏汇总。',
        columns: {
            task_id: '任务标识，也是报告的唯一主键。',
            project_key: '报告所属项目的稳定编码。',
            session_id: '报告关联的 Bridge 会话标识。',
            status: '报告对应的任务终态。',
            evidence_level: '报告证据等级，例如 static、host、runtime 或 hardware。',
            created_at: '报告首次创建时间，Unix epoch 毫秒时间戳。',
            updated_at: '报告最后更新时间，Unix epoch 毫秒时间戳。',
            report_json: '执行报告正文结构化数据，不应包含凭据和完整 prompt。',
        },
    },
    verification_campaigns: {
        comment: '验证活动表，记录多场景测试、重试、取消和恢复后的统一验收结果。',
        columns: {
            campaign_id: '验证活动唯一标识。',
            task_id: '发起该验证活动的任务标识。',
            project_key: '验证目标项目的稳定编码。',
            status: '验证活动当前状态，例如 queued、running、passed、failed 或 inconclusive。',
            created_at: '验证活动创建时间，Unix epoch 毫秒时间戳。',
            updated_at: '验证活动最后更新时间，Unix epoch 毫秒时间戳。',
            campaign_json: '验证场景、逐项证据、失败原因和恢复信息。',
        },
    },
    model_usage_events: {
        comment: '模型用量与上下文缓存资格事件表，仅保存脱敏统计，不保存 Prompt、凭据或完整 transcript。',
        columns: {
            event_id: '用量事件唯一标识，用于去重。',
            project_key: '事件所属项目的稳定编码，可为空表示全局事件。',
            session_id: '事件关联的 Bridge 会话标识。',
            model: '实际请求使用的模型标识。',
            provider_key: '脱敏后的 Provider 稳定标识。',
            context_fingerprint: '稳定上下文 envelope 的匿名指纹。',
            policy: '本次上下文或缓存治理策略。',
            cache_eligibility: '缓存资格判断，例如 eligible、unknown 或 ineligible。',
            reason_codes: '影响缓存和计费判断的结构化原因码列表。',
            input_tokens: 'Provider 或 SDK 报告的输入 token 数；未知时为空。',
            output_tokens: 'Provider 或 SDK 报告的输出 token 数；未知时为空。',
            cache_read_input_tokens: 'Provider 实际报告的缓存读取 token 数；不得用估算值填充。',
            cache_creation_input_tokens: 'Provider 实际报告的缓存创建 token 数；不得用估算值填充。',
            usage_source: '用量来源，例如 sdk、provider 或 partial。',
            duration_ms: '本次请求耗时，毫秒。',
            retry_count: '本次请求重试次数。',
            created_at: '用量事件产生时间，Unix epoch 毫秒时间戳。',
            status: '调用生命周期状态，例如 pending、completed、failed 或 cancelled。',
            ended_at: '调用结束时间，Unix epoch 毫秒时间戳；未结束时为空。',
            error_code: '调用异常或取消的有界错误码，不包含凭据和正文。',
        },
    },
    pitfalls: {
        comment: 'Pitfall Ledger 根因记录表，用于跨任务识别重复失败、确认缓解和注入预防建议。',
        columns: {
            id: 'Pitfall 唯一标识。',
            project_key: 'Pitfall 所属项目的稳定编码。',
            scope: 'Pitfall 作用域，例如 project 或 global。',
            fingerprint: '根因和策略组合的稳定指纹，用于去重。',
            status: 'Pitfall 状态，例如 observed、confirmed、mitigated 或 expired。',
            title: '面向用户和 Agent 的简短问题标题。',
            summary: '问题现象和影响范围摘要。',
            root_cause: '已验证的根因说明。',
            prevention: '后续任务可采用的预防和规避建议。',
            tags: '用于检索和分类的脱敏标签 JSON。',
            first_seen_at: '首次观察到该问题的时间，Unix epoch 毫秒时间戳。',
            last_seen_at: '最近一次观察到该问题的时间，Unix epoch 毫秒时间戳。',
            confirmed_at: '用户或系统确认 Pitfall 的时间。',
            mitigated_at: '验证缓解措施生效的时间。',
            expires_at: '该 Pitfall 失效或需要重新验证的时间。',
            updated_at: 'Pitfall 记录最后更新时间，Unix epoch 毫秒时间戳。',
        },
    },
    pitfall_occurrences: {
        comment: 'Pitfall 发生记录表，关联具体任务和上下文，用于频次统计与重复失败治理。',
        columns: {
            id: '发生记录唯一标识。',
            pitfall_id: '关联的 Pitfall 唯一标识。',
            task_id: '触发该发生记录的任务标识，可为空。',
            context_json: '脱敏的发生上下文，例如阶段、错误类别和验证结果。',
            observed_at: '观察到问题的时间，Unix epoch 毫秒时间戳。',
        },
    },
    pitfall_links: {
        comment: 'Pitfall 关联表，将根因记录链接到规则、代码、测试或文档等治理目标。',
        columns: {
            pitfall_id: '关联的 Pitfall 唯一标识。',
            kind: '目标类型，例如 rule、file、test 或 document。',
            target: '目标的稳定标识或受控路径。',
            created_at: '关联创建时间，Unix epoch 毫秒时间戳。',
        },
    },
})

export function schemaCommentSql(schemaName = 'bridge', {includeVector = false} = {}) {
    const schema = identifier(schemaName, 'bridge')
    const statements = []
    for (const [tableName, definition] of Object.entries(schemaCommentDefinitions)) {
        statements.push(`COMMENT ON TABLE ${schema}.${identifier(tableName)} IS ${sqlString(definition.comment)};`)
        for (const [columnName, comment] of Object.entries(definition.columns)) {
            if (columnName === 'embedding' && !includeVector) continue
            statements.push(`COMMENT ON COLUMN ${schema}.${identifier(tableName)}.${identifier(columnName)} IS ${sqlString(comment)};`)
        }
    }
    return statements.join('\n')
}

export function schemaSql(schemaName = 'bridge', {includeComments = true} = {}) {
    const schema = identifier(schemaName, 'bridge')
    return `
CREATE SCHEMA IF NOT EXISTS ${schema};
CREATE TABLE IF NOT EXISTS ${schema}.schema_version (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL,
    updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS ${schema}.state_entries (
    kind TEXT NOT NULL,
    platform TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    state TEXT,
    updated_at BIGINT NOT NULL,
    next_attempt_at BIGINT,
    attempts INTEGER NOT NULL DEFAULT 0,
    payload TEXT,
    data_json JSONB NOT NULL,
    PRIMARY KEY (kind, platform, entry_id)
);
CREATE INDEX IF NOT EXISTS idx_state_entries_due ON ${schema}.state_entries (kind, platform, state, next_attempt_at, updated_at);
CREATE TABLE IF NOT EXISTS ${schema}.session_index (
    project_key TEXT NOT NULL,
    session_id TEXT NOT NULL,
    sdk_session_id TEXT,
    work_dir TEXT,
    source TEXT,
    visibility TEXT,
    transcript_path TEXT NOT NULL,
    mtime DOUBLE PRECISION NOT NULL,
    size BIGINT NOT NULL,
    title TEXT,
    content_hash TEXT,
    last_opened_at BIGINT,
    permission_mode TEXT,
    mirrors_json JSONB,
    runtime_revision BIGINT,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (project_key, session_id),
    UNIQUE (transcript_path)
);
CREATE INDEX IF NOT EXISTS idx_session_visibility ON ${schema}.session_index (project_key, visibility, mtime DESC);
CREATE INDEX IF NOT EXISTS idx_session_recent ON ${schema}.session_index (project_key, mtime DESC);
CREATE TABLE IF NOT EXISTS ${schema}.content_documents (
    project_key TEXT NOT NULL,
    content_kind TEXT NOT NULL CHECK (content_kind IN ('memory', 'markdown', 'transcript', 'event')),
    source_key TEXT NOT NULL,
    title TEXT,
    body TEXT,
    body_hash TEXT NOT NULL,
    version BIGINT NOT NULL DEFAULT 1,
    scope TEXT NOT NULL DEFAULT 'project',
    status TEXT NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (project_key, content_kind, source_key, version)
);
CREATE INDEX IF NOT EXISTS idx_content_lookup ON ${schema}.content_documents (project_key, content_kind, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_parent_lookup ON ${schema}.content_documents (project_key, (metadata->>'parentKey'), status, updated_at DESC, source_key DESC) WHERE content_kind = 'memory';
CREATE TABLE IF NOT EXISTS ${schema}.memory_embeddings (
    project_key TEXT NOT NULL,
    source_key TEXT NOT NULL,
    body_hash TEXT NOT NULL,
    embedding_model TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    embedding_json JSONB,
    status TEXT NOT NULL DEFAULT 'pending',
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (project_key, source_key, body_hash, embedding_model)
);
CREATE INDEX IF NOT EXISTS idx_memory_embedding_lookup ON ${schema}.memory_embeddings (project_key, status, updated_at DESC);
CREATE TABLE IF NOT EXISTS ${schema}.task_state (
    project_key TEXT NOT NULL,
    task_key TEXT NOT NULL,
    session_id TEXT,
    task_id TEXT,
    sdk_session_id TEXT,
    status TEXT NOT NULL,
    outcome TEXT,
    continuation_reason TEXT,
    phase TEXT,
    review_state TEXT,
    model_tier TEXT,
    error_code TEXT,
    sequence BIGINT NOT NULL DEFAULT 0,
    revision BIGINT NOT NULL DEFAULT 0,
    started_at BIGINT,
    completed_at BIGINT,
    updated_at BIGINT NOT NULL,
    notifications JSONB,
    state_json JSONB NOT NULL,
    PRIMARY KEY (project_key, task_key)
);
CREATE INDEX IF NOT EXISTS idx_task_active ON ${schema}.task_state (project_key, status, updated_at DESC);
CREATE TABLE IF NOT EXISTS ${schema}.task_events (
    project_key TEXT NOT NULL,
    task_key TEXT NOT NULL,
    revision BIGINT NOT NULL,
    event_type TEXT NOT NULL,
    event_json JSONB NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (project_key, task_key, revision),
    FOREIGN KEY (project_key, task_key) REFERENCES ${schema}.task_state(project_key, task_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ${schema}.workflow_state (
    project_key TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    parent_session_id TEXT,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    current_phase TEXT,
    token_spent BIGINT NOT NULL DEFAULT 0,
    started_at BIGINT,
    ended_at BIGINT,
    revision BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL,
    state_json JSONB NOT NULL,
    PRIMARY KEY (project_key, workflow_id)
);
CREATE TABLE IF NOT EXISTS ${schema}.execution_reports (
    task_id TEXT PRIMARY KEY,
    project_key TEXT NOT NULL,
    session_id TEXT,
    status TEXT NOT NULL,
    evidence_level TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    report_json JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS ${schema}.verification_campaigns (
    campaign_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    project_key TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    campaign_json JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS ${schema}.model_usage_events (
    event_id TEXT PRIMARY KEY,
    project_key TEXT,
    session_id TEXT,
    model TEXT,
    provider_key TEXT,
    context_fingerprint TEXT,
    policy TEXT,
    cache_eligibility TEXT,
    reason_codes JSONB NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_input_tokens INTEGER,
    cache_creation_input_tokens INTEGER,
    usage_source TEXT NOT NULL,
    duration_ms BIGINT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    ended_at BIGINT,
    error_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_usage_session ON ${schema}.model_usage_events (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_created_at ON ${schema}.model_usage_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_project_created_at ON ${schema}.model_usage_events (project_key, created_at DESC);
CREATE TABLE IF NOT EXISTS ${schema}.pitfalls (
    id TEXT PRIMARY KEY,
    project_key TEXT NOT NULL,
    scope TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    status TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    root_cause TEXT,
    prevention TEXT,
    tags JSONB NOT NULL,
    first_seen_at BIGINT NOT NULL,
    last_seen_at BIGINT NOT NULL,
    confirmed_at BIGINT,
    mitigated_at BIGINT,
    expires_at BIGINT,
    updated_at BIGINT NOT NULL,
    UNIQUE (project_key, scope, fingerprint)
);
CREATE TABLE IF NOT EXISTS ${schema}.pitfall_occurrences (
    id TEXT PRIMARY KEY,
    pitfall_id TEXT NOT NULL REFERENCES ${schema}.pitfalls(id) ON DELETE CASCADE,
    task_id TEXT,
    context_json JSONB,
    observed_at BIGINT NOT NULL,
    UNIQUE (pitfall_id, task_id)
);
CREATE TABLE IF NOT EXISTS ${schema}.pitfall_links (
    pitfall_id TEXT NOT NULL REFERENCES ${schema}.pitfalls(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    target TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (pitfall_id, kind, target)
);
INSERT INTO ${schema}.schema_version (id, version, updated_at)
VALUES (1, 1, EXTRACT(EPOCH FROM clock_timestamp())::BIGINT)
ON CONFLICT (id) DO NOTHING;
${includeComments ? schemaCommentSql(schemaName) : ''}
`
}

export async function ensurePostgresSchema(client, {schema = 'bridge', vectorDimensions = null} = {}) {
    if (!client?.query) throw new TypeError('PostgreSQL client is required')
    const extension = await client.query("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS enabled")
    // 先建表，再补齐生命周期列，最后执行列注释；这样旧账本表不会因新增列尚未存在而在 COMMENT 处失败。
    await client.query(schemaSql(schema, {includeComments: false}))
    // 兼容已存在的账本表：生命周期字段用于保留中途断线/取消的调用记录。
    const usageTable = `${identifier(schema, 'bridge')}.model_usage_events`
    await client.query(`ALTER TABLE ${usageTable} ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed'`)
    await client.query(`ALTER TABLE ${usageTable} ADD COLUMN IF NOT EXISTS ended_at BIGINT`)
    await client.query(`ALTER TABLE ${usageTable} ADD COLUMN IF NOT EXISTS error_code TEXT`)
    await client.query(schemaCommentSql(schema))
    let configuredDimensions = null
    if (extension.rows?.[0]?.enabled === true && vectorDimensions !== null && vectorDimensions !== undefined) {
        configuredDimensions = normalizeVectorDimensions(vectorDimensions)
        const table = `${identifier(schema, 'bridge')}.memory_embeddings`
        await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS embedding vector(${configuredDimensions})`)
        await client.query(schemaCommentSql(schema, {includeVector: true}))
    }
    const version = await client.query(`SELECT version FROM ${identifier(schema, 'bridge')}.schema_version WHERE id = 1`)
    return {
        schema,
        migrationVersion: Number(version.rows?.[0]?.version || 0),
        vectorEnabled: extension.rows?.[0]?.enabled === true,
        ...(configuredDimensions ? {vectorDimensions: configuredDimensions} : {}),
    }
}

export {identifier}
