/**
 * Session Artifact Runtime。
 * 负责快照、checkpoint、回合基线、差异计算和可回滚文件恢复。
 */
export function createSessionArtifactRuntime(deps = {}) {
    const {BRIDGE_HOME, encodeProjectName, readJSON, writeJSON, log, sessions, buildFileSnapshot, currentFileScan, diffSnapshotVsCurrent, resolveSafe, existsSync, unlinkSync, dirname, join, mkdirSync, writeFileSync} = deps
    if (!sessions || typeof buildFileSnapshot !== 'function' || typeof diffSnapshotVsCurrent !== 'function') {
        throw new TypeError('session artifact dependencies are required')
    }

function snapshotStorePath(workDir, sessionId) {
    return join(BRIDGE_HOME, 'projects', encodeProjectName(workDir), 'bridge-snapshot', sessionId + '.json')
}

function saveSnapshot(s, sessionId) {
    try {
        if (!s?.snapshot) return true
        const fp = snapshotStorePath(s.workDir, sessionId)
        // Map 不能直接 JSON，转 entries 数组
        const obj = {
            takenAt: s.snapshot.takenAt,
            truncated: s.snapshot.truncated,
            gitHead: s.snapshot.gitHead || undefined,
            files: [...s.snapshot.files.entries()]
        }
        writeJSON(fp, obj)
        return true
    } catch (e) {
        log.warn({err: e}, 'snapshot 保存失败')
        return false
    }
}

function loadSnapshot(workDir, sessionId) {
    const d = readJSON(snapshotStorePath(workDir, sessionId))
    if (!d || !Array.isArray(d.files)) return null
    return {takenAt: d.takenAt, truncated: !!d.truncated, gitHead: d.gitHead || undefined, files: new Map(d.files)}
}

// 记录点落盘路径：~/.claude-desktop-bridge/projects/<encoded>/bridge-checkpoints/<sessionId>.json
function checkpointStorePath(workDir, sessionId) {
    return join(BRIDGE_HOME, 'projects', encodeProjectName(workDir), 'bridge-checkpoints', sessionId + '.json')
}

// 从磁盘载入历史记录点（resume 续接用）；失败返回空数组
function loadCheckpoints(workDir, sessionId) {
    const d = readJSON(checkpointStorePath(workDir, sessionId))
    return Array.isArray(d?.checkpoints) ? d.checkpoints : []
}

// 落盘当前 session 的记录点（含 before 增量内容）
// SIDE_EFFECT: 写 bridge-checkpoints/<sessionId>.json
function saveCheckpoints(s, sessionId) {
    try {
        const fp = checkpointStorePath(s.workDir, sessionId)
        writeJSON(fp, {workDir: s.workDir, checkpoints: s.checkpoints || []})
        return true
    } catch (e) {
        log.warn({err: e}, 'checkpoint 保存失败')
        return false
    }
}

// ── beginTurn — 回合开始：记录修改前状态（异步快照，不阻塞消息入队）──
// 功能说明: 在 Claude 每轮开始处理用户消息前，异步拍下「修改前」快照并记录 prompt，
//   供 finalizeCheckpoint 在回合结束时对比 diff，生成记录点
// 实现方式: 先占位 pendingTurn（含 prompt + time）→ 消息立即入队 SDK →
//   setImmediate 异步构建 buildFileSnapshot → 填入 preSnapshot
//   构建失败时推进 pendingTurn，后续 finalizeCheckpoint 会跳过该失败回合
// 关键设计: preSnapshot 只在 result 事件时需要（通常几秒后），
//   没必要在消息处理路径上同步阻塞事件循环（大项目 buildFileSnapshot 可达数百 ms）
// SIDE_EFFECT: mutates session.pendingTurn（分两次：同步写 prompt/time，异步写 preSnapshot）
function beginTurn(sessionId, prompt, options = {}) {
    const s = sessions.get(sessionId);
    if (!s) return
    const captureFiles = options.captureFiles !== false
    // 同步占位：prompt + time + _turnId 先落盘，消息立即入队 SDK 不受阻
    const turnId = Symbol('turn')
    const turn = {
        prompt: String(prompt || '').slice(0, 500),
        preSnapshot: null,
        captureFiles,
        time: Date.now(),
        _turnId: turnId
    }
    if (s.pendingTurn) {
        if (!Array.isArray(s._pendingTurns)) s._pendingTurns = []
        s._pendingTurns.push(turn)
        return
    }
    s.pendingTurn = turn
    if (!captureFiles) {
        log.info({sessionId: sessionId?.slice(0, 8)}, '[beginTurn] 轻量问答跳过文件快照')
        return
    }
    // 异步构建快照：增量以 s.snapshot 为 baseline，只重读 mtime/size 变动的文件
    // 用 setImmediate 推迟到当前事件循环 tick 结束后执行，保证消息先入队
    // CAS 守护 _turnId: stop 后立即新消息时，旧 setImmediate 看到 _turnId 不匹配则跳过
    const snapSession = s
    setImmediate(() => {
        try {
            if (!snapSession.pendingTurn || snapSession.pendingTurn._turnId !== turnId) return
            snapSession.pendingTurn.preSnapshot = buildFileSnapshot(snapSession.workDir, snapSession.snapshot)
            log.info({sessionId: sessionId?.slice(0,8), gitHead: !!snapSession.pendingTurn.preSnapshot?.gitHead, fileCount: snapSession.pendingTurn.preSnapshot?.files?.size}, '[beginTurn] 快照已构建')
        } catch (e) {
            log.warn({err: e}, 'beginTurn snapshot 失败');
            if (snapSession.pendingTurn && snapSession.pendingTurn._turnId === turnId) {
                advancePendingTurn(sessionId, snapSession)
            }
        }
    })
}

// ── finalizeCheckpoint — 回合结束：对比修改前后的文件差异，生成记录点 ──
// 功能说明: 在 Claude 每轮完成后（收到 result 事件），diff 本轮修改前(preSnapshot) vs 当前文件状态，
//   识别变更文件及其 before/after 内容，组装 checkpoint 对象追加到 session.checkpoints
// 实现方式:
//   1. diffSnapshotVsCurrent(preSnapshot, currentFiles) → diffMap
//   2. 逐变更文件构造 {path,status,added,removed,before,notRevertible}
//   3. 修改前内容从 preSnapshot.files.get(path).content 获取
//   4. 二进制/超大文件标记 notRevertible=true（无可回退内容）
//   5. checkpointSeq 递增生成唯一 ID (cp-{seq})
//   6. 同步更新 session.snapshot 为当前状态（作为新一轮的基线）
// SIDE_EFFECT: mutates session.checkpoints/snapshot/pendingTurn + 落盘 bridge-checkpoints/<sessionId>.json
function schedulePendingTurnSnapshot(sessionId, snapSession, turn) {
    if (turn.captureFiles === false) return
    setImmediate(() => {
        try {
            if (snapSession.pendingTurn?._turnId !== turn._turnId) return
            turn.preSnapshot = buildFileSnapshot(snapSession.workDir, snapSession.snapshot)
        } catch (e) {
            log.warn({err: e, sessionId: sessionId?.slice(0, 8)}, 'queued turn snapshot failed')
            if (snapSession.pendingTurn?._turnId === turn._turnId) {
                advancePendingTurn(sessionId, snapSession)
            }
        }
    })
}

function advancePendingTurn(sessionId, session) {
    session.pendingTurn = session._pendingTurns?.shift() || null
    if (session.pendingTurn) schedulePendingTurnSnapshot(sessionId, session, session.pendingTurn)
    return session.pendingTurn
}

function finalizeCheckpoint(sessionId) {
    const s = sessions.get(sessionId);
    if (!s || !s.pendingTurn) { log.info({sessionId: sessionId?.slice(0,8), hasSession: !!s, hasPendingTurn: !!s?.pendingTurn}, '[ckpt] 跳过: 无会话或无 pendingTurn'); return null }
    if (s.pendingTurn.captureFiles === false) {
        log.info({sessionId: sessionId?.slice(0, 8)}, '[ckpt] 轻量问答跳过文件 checkpoint')
        advancePendingTurn(sessionId, s)
        return null
    }
    if (!s.pendingTurn.preSnapshot) {
        try {
            s.pendingTurn.preSnapshot = buildFileSnapshot(s.workDir, s.snapshot)
            log.info({sessionId: sessionId?.slice(0,8), gitHead: !!s.pendingTurn.preSnapshot?.gitHead}, '[ckpt] 降级同步构建快照')
        } catch (e) {
            log.warn({err: e}, 'finalizeCheckpoint snapshot 降级构建失败');
            advancePendingTurn(sessionId, s)
            return null
        }
    }
    const currentTurn = s.pendingTurn
    const pre = currentTurn.preSnapshot;
    const prompt = currentTurn.prompt;
    const time = currentTurn.time
    advancePendingTurn(sessionId, s)
    if (!pre) { log.info({sessionId: sessionId?.slice(0,8)}, '[ckpt] 跳过: preSnapshot 为空'); return null }
    const scan = currentFileScan(s.workDir, pre)
    if (scan.missing) { log.info({sessionId: sessionId?.slice(0,8)}, '[ckpt] 跳过: 工作目录不存在'); return null }
    const diffMap = diffSnapshotVsCurrent(pre, scan.files, s.workDir)
    const files = []
    let revertible = true
    for (const [path, d] of diffMap) {
        if (d.status === 'unchanged') continue
        const snap = pre.files.get(path)
        let before = null, notRevertible = false
        if (d.status === 'added') {
            before = null  // 本轮新增 → 回退时删除
        } else {
            // modified / deleted → 需要修改前内容才能回写
            if (snap && !snap.binary && !snap.tooLarge && !snap.readError && typeof snap.content === 'string') before = snap.content
            else {
                notRevertible = true;
                revertible = false
            }  // 二进制/超大/读失败 → 该文件不可回退
        }
        files.push({path, status: d.status, before, notRevertible, added: d.added, removed: d.removed})
    }
    if (!files.length) { log.info({sessionId: sessionId?.slice(0,8), totalDiff: diffMap.size, gitHead: !!pre?.gitHead}, '[ckpt] 跳过: 本轮未改动文件'); return null }  // 本轮没动文件，不建记录点
    if (!s.checkpoints) s.checkpoints = []
    s.checkpointSeq = (s.checkpointSeq || 0) + 1
    const checkpoint = {id: `cp-${s.checkpointSeq}`, prompt, time, files, revertible}
    s.checkpoints.push(checkpoint)
    log.info({sessionId: sessionId?.slice(0,8), cpId: `cp-${s.checkpointSeq}`, fileCount: files.length, gitHead: !!pre?.gitHead}, '[ckpt] 记录点已创建')
    // 裁剪上限，防止长会话无界增长
    if (s.checkpoints.length > 50) s.checkpoints.splice(0, s.checkpoints.length - 50)
    // 异步落盘：in-memory checkpoints 已更新，API 立即可见；磁盘 I/O 不阻塞 result 广播
    const cpSession = s
    setImmediate(() => {
        if (!saveCheckpoints(cpSession, sessionId)) {
            log.warn({sessionId: sessionId?.slice(0, 8)}, '保存 checkpoint 失败')
        }
    })
    // 注意：不要在这里重置 session.snapshot —— 文件面板「仅改动」依赖会话起始基线，
    // 重置会让累计改动清零导致「仅改动」空白。记录点用自己的 per-turn preSnapshot，互不影响。
    return {created: true, ...checkpoint}
}

// 回退到指定记录点之前的状态：倒序撤销该记录点及其之后的所有轮次
// dryRun=true 仅预览受影响文件，不写盘
// ── rewindToCheckpoint — 文件回退到指定记录点 ──
// 功能说明: 将工作目录的所有文件回退到目标 checkpoint 之前的状态
//   倒序遍历从尾部到目标 index 的所有 checkpoint，逐文件还原:
//     added → 删除文件; modified/deleted → 写回 before 内容
//   dryRun=true 时仅计算影响面不实际写盘（用于前置校验）
// 实现方式: 从 cps.length-1 到 idx 倒序处理，每轮按 status 类型决定恢复操作
//   回退完成后截断 checkpoints 数组到 idx 之前，保存到磁盘
// 关键数据流: checkpoints[idx..] → 倒序恢复文件 → cps.slice(0, idx) → saveCheckpoints
// SIDE_EFFECT: 写/删工作目录文件 + 截断 session.checkpoints（不动文件面板基线）
function rewindToCheckpoint(sessionId, checkpointId, dryRun) {
    const s = sessions.get(sessionId);
    if (!s) return {ok: false, error: 'session_not_found'}
    const cps = s.checkpoints || []
    const idx = cps.findIndex(c => c.id === checkpointId)
    if (idx < 0) return {ok: false, error: 'checkpoint_not_found'}
    // 待撤销范围：[idx, 末尾]，倒序应用保证最终回到 idx 轮之前的状态
    const affected = new Set()
    let blocked = []
    for (let i = cps.length - 1; i >= idx; i--) {
        for (const f of cps[i].files) {
            if (f.notRevertible) {
                blocked.push(f.path);
                continue
            }
            affected.add(f.path)
            if (dryRun) continue
            const abs = resolveSafe(s.workDir, f.path)
            if (!abs) continue
            try {
                if (f.status === 'added') {
                    if (existsSync(abs)) unlinkSync(abs)
                }  // 新增 → 删除
                else {
                    if (!existsSync(dirname(abs))) mkdirSync(dirname(abs), {recursive: true});
                    writeFileSync(abs, f.before ?? '', 'utf8')
                }  // 改/删 → 写回
            } catch (e) {
                log.warn({err: e, path: f.path}, 'rewind write 失败')
            }
        }
    }
    if (dryRun) return {ok: true, dryRun: true, files: [...affected], blocked}
    // 截断记录点到 idx 之前 + 落盘（不动 session.snapshot：回退后仍以会话起始为基线对比）
    s.checkpoints = cps.slice(0, idx)
    if (!saveCheckpoints(s, sessionId)) {
        return {ok: false, code: 'persist_failed', error: 'checkpoint 持久化失败', reverted: [...affected], blocked}
    }
    return {ok: true, reverted: [...affected], blocked, remaining: s.checkpoints.length}
}


    return {
        snapshotStorePath, saveSnapshot, loadSnapshot, checkpointStorePath,
        loadCheckpoints, saveCheckpoints, beginTurn, finalizeCheckpoint,
        rewindToCheckpoint, schedulePendingTurnSnapshot, advancePendingTurn,
    }
}
