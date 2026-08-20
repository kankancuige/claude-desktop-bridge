/**
 * Feishu Adapter — 飞书机器人适配器
 *
 * ── 整体架构 ──
 * 功能说明: 将飞书聊天消息桥接到 Claude Desktop Bridge Gateway，
 *          实现通过飞书单聊与 Claude 交互。
 * 实现方式: 飞书官方 @larksuiteoapi/node-sdk 长连接(WSClient + EventDispatcher)
 *          → 注册 im.message.receive_v1 事件 → fire-and-forget 处理 → TaskCommand 进程内提交。
 * 关键数据流: 飞书 WS 推送事件 → EventDispatcher 分发 → handleMessage() 配对+路由
 *          → resolve session → runImTask() → Client API 回复
 *
 * ── SDK 自动处理项 ──
 * WS 连接建立、鉴权、ping/pong 心跳、断线重连、消息加解密均由 SDK 内部处理，
 * 开发者只需: 创建 WSClient + EventDispatcher + 注册事件处理器 + 调 client API 发消息。
 *
 * ── 前提条件(飞书开放平台) ──
 * 1. 创建企业自建应用 + 添加「机器人」能力
 * 2. 事件订阅 → 开启「使用长连接接收事件」
 * 3. 添加 im.message.receive_v1 事件
 * 4. 发布版本
 *
 * ── 依赖 ──
 * - @larksuiteoapi/node-sdk: 飞书官方 Node SDK (WSClient / EventDispatcher / Client)
 * - TaskCommandService: Gateway 进程内任务命令与事件通道
 * - adapters.json: 存储 appId / appSecret
 * - bridge-paired-feishu.json: 已配对的飞书用户白名单
 * - adapter-sessions.json: 用户→session 绑定关系(mirror 模式用)
 */
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {randomInt} from 'node:crypto'
import {WSClient, EventDispatcher, Client, LoggerLevel, defaultHttpInstance} from '@larksuiteoapi/node-sdk'
import {createLogger} from '../shared/logger.mjs'
import {detectCommand, executeCommand} from './im-commands.mjs'
import {gatewayFetch, gatewayHttpBase} from '../shared/gateway-client.mjs'
import {SessionTaskQueue} from '../sessions/session-task-queue.mjs'
import {ImMessageDeduper} from './im-message-dedupe.mjs'
import {claimDurableInboxMessage, ImInbox} from './im-inbox.mjs'
import {SecurePayloadCodec} from '../security/secure-payload.mjs'
import {NotificationOutbox} from './notification-outbox.mjs'
import {startNotificationWorker, sendOrQueue} from './notification-worker.mjs'
import {splitTextByUtf8Bytes} from '../shared/text-chunks.mjs'
import {loadPairedUsers, savePairedUsers} from './paired-users.mjs'
import {readAdapterConfig} from './adapter-config.mjs'
import {turnFallbackText} from './im-turn-finish.mjs'
import {normalizeImMessageId, validateImText} from './im-input.mjs'
import {runImTask} from './im-task-runner.mjs'
import {platformEntryFilePath} from './platform-entry-store.mjs'
import {PendingConfirmRegistry} from './pending-confirm.mjs'
import {findLatestAdapterUserForSession} from './adapter-bindings.mjs'
import {BRIDGE_HOME} from '../config/bridge-home.mjs'

const log = createLogger('feishu')

const GW = () => gatewayHttpBase()              // Gateway 本地 HTTP 地址
// Bridge 私有配置根目录；不读取 Claude/Codex 的用户配置。

// ── startFeishuAdapter ──
// 功能说明: 飞书适配器入口函数，初始化凭据、SDK 客户端、配对状态、确认挂起表
// 实现方式: 使用闭包保存内部状态，返回镜像钩子供 Gateway 调用。
//          返回 null 表示凭据加载失败，适配器无法启动。
// 关键数据流: adapters.json 加载凭据 → 创建 Client + WSClient → 注册事件处理器 → 启动 WS → 返回钩子对象
export function startFeishuAdapter(token, {taskCommands, stateStore = null, onNotificationStateChange = null} = {}) {
    let appId, appSecret
    let stopped = false
    let connectionError = null
    const taskAbortController = new AbortController()

    // ── reloadCreds ──
    // 功能说明: 从磁盘重新加载飞书应用凭据
    // 实现方式: 读取 adapters.json 中的 feishu.appId / feishu.appSecret
    // SIDE_EFFECT: 修改模块级变量 appId / appSecret
    function reloadCreds() {
        try {
            const adapters = readAdapterConfig(join(BRIDGE_HOME, 'adapters.json'))
            appId = adapters.feishu?.appId
            appSecret = adapters.feishu?.appSecret
            if (!appId || !appSecret) {
                log.warn('未找到凭据 (adapters.json 缺少 feishu.appId/appSecret)');
                return false
            }
            log.info('凭据加载成功');
            return true
        } catch {
            log.warn('加载凭据失败');
            return false
        }
    }

    // 初始化凭据，失败则返回 null 终止适配器启动
    if (!reloadCreds()) return null

    // ── 配对白名单 ──
    // 功能说明: 从 bridge-paired-feishu.json 加载已配对用户白名单
    // 实现方式: 文件不存在时默认空集合，首次配对成功时写入磁盘持久化。
    // 飞书使用独立的配对文件，与微信/钉钉隔离。
    const pairedFile = join(BRIDGE_HOME, 'bridge-paired-feishu.json')
    const pairedUsers = loadPairedUsers(pairedFile)

    // ── 配对码生成 ──
    const pairCode = String(randomInt(100000, 1000000))
    log.info('配对码已生成，可在桌面端 IM 设置中查看')

    // ── 配对暴力破解防护 ──
    const pairFailCount = new Map()
    const PAIR_MAX_FAIL = 5
    const PAIR_COOLDOWN_MS = 10 * 60 * 1000
    const PAIR_ATTEMPT_TTL_MS = 60 * 60 * 1000
    const PAIR_MAX_TRACKED_USERS = 5000

    // ── pendingConfirm 挂起确认表 ──
    // 功能说明: 记录等待用户回复确认的请求，key 为飞书用户 open_id
    const pendingConfirm = new PendingConfirmRegistry()
    const sessionQueue = new SessionTaskQueue({maxDepth: 8})
    const messageDeduper = new ImMessageDeduper()
    const payloadCodec = new SecurePayloadCodec(join(BRIDGE_HOME, 'bridge-store-key'))
    const legacyInboxFile = join(BRIDGE_HOME, 'bridge-im-inbox.json')
    const legacyOutboxFile = join(BRIDGE_HOME, 'bridge-notification-outbox.json')
    const inbox = new ImInbox({
        filePath: platformEntryFilePath(BRIDGE_HOME, 'bridge-im-inbox', 'feishu'), legacyFilePath: legacyInboxFile,
        platform: 'feishu', payloadCodec,
        stateStore,
        onPersistError: error => log.error({err: error}, 'IM inbox 持久化失败'),
    })
    const outbox = new NotificationOutbox({
        filePath: platformEntryFilePath(BRIDGE_HOME, 'bridge-notification-outbox', 'feishu'), legacyFilePath: legacyOutboxFile,
        platform: 'feishu', payloadCodec,
        stateStore,
        onPersistError: error => log.error({err: error}, '通知 outbox 持久化失败'),
    })
    // pendingConfirm TTL 清理：5 分钟超时自动清除，防止异常路径下残留
    const _confirmCleanup = setInterval(() => {
      pendingConfirm.cleanup()
      for (const [uid, attempt] of pairFailCount) {
        if (Date.now() - Number(attempt.lastAttemptAt || 0) > PAIR_ATTEMPT_TTL_MS) pairFailCount.delete(uid)
      }
    }, 5 * 60 * 1000)
    if (_confirmCleanup.unref) _confirmCleanup.unref()
    // ── 飞书 API 客户端 (发消息用) ──
    // 功能说明: 用于通过 HTTP API 发送消息到飞书用户
    // 实现方式: 飞书 SDK Client 封装了 access_token 自动获取/刷新，无需手动管理
    const client = new Client({
        appId,
        appSecret,
        httpInstance: defaultHttpInstance.create({timeout: 15_000}),
    })

    // ── 飞书 WS 长连接客户端 (收消息用) ──
    // 功能说明: 建立到飞书服务端的 WebSocket 长连接，接收事件推送
    // 实现方式: WSClient 自动处理鉴权/Welcome 包/ping-pong 心跳/断线重连，
    //          loggerLevel 控制 SDK 内部日志级别(info 为业务所需最低级别)
    const wsClient = new WSClient({
        appId,
        appSecret,
        loggerLevel: LoggerLevel.info,
    })

    // ── sendMsg ── 发送消息到飞书用户
    // 功能说明: 通过飞书 Open API 发送文本消息到指定飞书用户
    // 实现方式: client.im.message.create() 调用飞书消息 API，
    //          receive_id_type='open_id' 表示使用用户的 open_id 标识，
    //          content 需为 JSON 字符串 `{"text":"..."}` 符合飞书消息格式要求。
    // 异常处理: 捕获异常仅打印日志不抛出，避免因发送失败中断主流程
    // 关键数据流: 参数组装 → Client API → 飞书服务端 → 用户飞书客户端
    async function sendMsg(userId, text) {
        if (stopped) return false
        try {
            await client.im.message.create({
                params: {receive_id_type: 'open_id'},
                data: {
                    receive_id: userId,
                    msg_type: 'text',
                    content: JSON.stringify({text}),  // 飞书要求 content 为 JSON 字符串
                },
            })
            log.debug('sendMsg ok')
            return true
        } catch (e) {
            log.error({err: e}, 'sendMsg 异常')
            return false
        }
    }

    // ── parseConfirmReply ──
    // 功能说明: 解析用户的确认回复文本，支持二选一(allow/deny)和多选项(choice)两种模式
    // 实现方式:
    //   - choice 模式: 尝试将文本解析为数字索引(从1开始)，转为 0-based optionIndex
    //   - permission 模式: 匹配中英文确认/拒绝关键词白名单
    // 关键数据流: 用户原始文本 → 类型判断 → 结构化对象 / null
    function parseConfirmReply(text, type) {
        const t = text.trim().toLowerCase()
        if (type === 'choice') {
            const n = parseInt(t, 10)
            if (!Number.isNaN(n) && n >= 1) return {optionIndex: n - 1}
            return null
        }
        if (['y', 'yes', '确认', '是', '同意', '允许', 'ok', '可以'].includes(t)) return {decision: 'allow'}
        if (['n', 'no', '拒绝', '否', '不', '不行', '取消'].includes(t)) return {decision: 'deny'}
        return null
    }

    // ── handleMessage ── 消息处理入口
    // 功能说明: 单条飞书消息的处理入口，按优先级依次检查: 配对状态 → 挂起确认 → 正常对话
    // 实现方式:
    //   1. 未配对用户→校验配对码/提示配对
    //   2. 有挂起确认→拦截当前消息作为确认回复提交到 /api/confirm
    //   3. 正常对话→resolve session → injectAndWait
    // 关键数据流: raw msg → 配对检查 → session resolve → injectAndWait → 结果回传飞书
    async function processMessage(uid, text, messageId = '') {
        if (stopped) return
        const identity = {source: 'feishu', userId: uid}
        // ── 第0层: 配对鉴权 ──
        if (!pairedUsers.has(uid)) {
            const fc = pairFailCount.get(uid)
            if (fc && fc.count >= PAIR_MAX_FAIL && Date.now() < fc.cooldownUntil) {
                const remainMin = Math.ceil((fc.cooldownUntil - Date.now()) / 60000)
                await sendMsg(uid, `尝试次数过多，请 ${remainMin} 分钟后再试`)
                return
            }
            if (text.trim() === pairCode) {
                pairedUsers.add(uid)
                pairFailCount.delete(uid)
                savePairedUsers(pairedFile, pairedUsers)  // SIDE_EFFECT: 持久化白名单
                await sendMsg(uid, '配对成功！现在可以开始对话了。')
            } else {
                const cur = pairFailCount.get(uid) || {count: 0, cooldownUntil: 0}
                cur.count++
                cur.lastAttemptAt = Date.now()
                if (cur.count >= PAIR_MAX_FAIL) {
                    cur.cooldownUntil = Date.now() + PAIR_COOLDOWN_MS
                    log.warn({userId: uid?.slice(0, 8), failCount: cur.count}, '配对码暴力破解触发冷却')
                }
                pairFailCount.set(uid, cur)
                while (pairFailCount.size > PAIR_MAX_TRACKED_USERS) pairFailCount.delete(pairFailCount.keys().next().value)
                const left = PAIR_MAX_FAIL - cur.count
                await sendMsg(uid, left > 0
                    ? `配对码错误，还剩 ${left} 次机会`
                    : `尝试次数过多，已锁定 ${PAIR_COOLDOWN_MS / 60000} 分钟`)
            }
            return
        }

        // ── 第1层: 已配对用户命令 ──
        const cmd = detectCommand(text)
        if (cmd) {
            const r = await executeCommand(cmd, token, identity)
            if (r?.replyText) await sendMsg(uid, r.replyText)
            return
        }

        // ── 第2层: 挂起确认拦截 ──
        // 处理挂起的确认请求：用户发送回复时，先检测是否为确认回复而非新 prompt
        const pc = pendingConfirm.peek(uid)
        if (pc) {
            const parsed = parseConfirmReply(text, pc.type)
            if (!parsed) {
                await sendMsg(uid, pc.type === 'choice' ? '请回复选项编号（如 1、2）' : '请回复 y/确认 或 n/拒绝')
                return
            }
            try {
                const r = await gatewayFetch(`${GW()}/api/confirm`, token, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({sessionId: pc.sessionId, requestId: pc.requestId, ...parsed}),
                    signal: AbortSignal.timeout(5000),
                }, identity)
                const d = await r.json().catch(() => ({}))
                if (r.ok || d.reason === 'already_resolved') {
                    pendingConfirm.remove(uid, pc)
                    await sendMsg(uid, d.ok ? '已提交' : '该请求已处理')
                } else {
                    await sendMsg(uid, '提交失败，请稍后重试')
                }
            } catch (e) {
                await sendMsg(uid, '提交失败，请稍后重试')
            }
            return
        }

        // ── 第3层: 正常对话 ──
        try {
            await sendMsg(uid, '收到，正在处理...')  // ACK 确认
            let sid = null, noActive = false
            // 解析用户绑定的活跃 session
            try {
                const r = await gatewayFetch(`${GW()}/api/sessions/resolve`, token, {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({userId: uid}), signal: AbortSignal.timeout(5000),
                }, identity)
                if (r.ok) {
                    const d = await r.json();
                    sid = d.sessionId;
                    log.info({sessionId: sid?.slice(0, 8)}, 'session 已解析')
                } else if (r.status === 409) {
                    noActive = true;
                    log.warn('无活跃 session')
                }
            } catch (e) {
                log.error({err: e}, 'resolve 异常')
            }
            if (noActive) {
                await sendMsg(uid, '尚无活跃 Session，请在桌面端打开一个项目后再发送消息。')
                return
            }
            if (!sid) {
                await sendMsg(uid, '无法连接会话');
                return
            }
            const position = sessionQueue.depth(sid)
            if (position > 0) await sendMsg(uid, `当前会话已有 ${position} 条消息处理中，本条将按顺序执行`)
            await sessionQueue.enqueue(sid, () => injectAndWait(sid, uid, text, messageId))
        } catch (e) {
            if (e?.code === 'queue_full') {
                await sendMsg(uid, '当前会话待处理消息已达上限，请稍后重试')
                return
            }
            if (e?.code === 'session_cancelled') {
                await sendMsg(uid, '当前会话已停止，本条排队消息已取消')
                return
            }
            log.error({err: e, userId: uid?.slice(0, 8)}, '处理失败')
            try {
                await sendMsg(uid, '处理失败，请稍后重试')
            } catch (notifyError) {
                log.warn({err: notifyError, userId: uid?.slice(0, 8)}, '发送处理失败提示失败')
            }
        }
    }

    function handleMessage(uid, text, messageId = '') {
        const validation = validateImText(text)
        if (!validation.ok && !messageId) return sendReliableText(uid, turnFallbackText('invalid_input'))
        if (!messageId) return processMessage(uid, text, messageId)
        const claim = claimDurableInboxMessage({
            inbox, deduper: messageDeduper, messageId,
            payload: {uid, text: validation.ok ? text : ''},
        })
        if (!claim.accepted) return
        return (async () => {
            try {
                if (validation.ok) await processMessage(uid, text, messageId)
                else await sendReliableText(uid, turnFallbackText('invalid_input'))
                if (stopped) return
                if (!inbox.complete(messageId)) log.error({messageId: String(messageId).slice(0, 32)}, 'IM inbox 完成状态持久化失败')
            } catch (error) {
                if (stopped) return
                messageDeduper.forget(messageId)
                if (!inbox.fail(messageId, error)) log.error({messageId: String(messageId).slice(0, 32)}, 'IM inbox 失败状态持久化失败')
                log.error({err: error, messageId: String(messageId).slice(0, 32)}, 'inbox 消息处理失败')
            }
        })()
    }

    const notificationWorker = startNotificationWorker({
        outbox,
        deliver: payload => sendMsg(payload.userId, payload.text),
        log,
        onStateChange: event => onNotificationStateChange?.({...event, platform: 'feishu'}),
    })

    async function sendReliableText(userId, text, notificationId = null) {
        if (stopped) return {sent: false, queued: false, error: 'adapter_stopped'}
        const parts = splitTextByUtf8Bytes(text, 4000)
        let sent = true
        let queued = false
        let lastError = ''
        for (let i = 0; i < parts.length; i++) {
            const content = parts.length > 1 ? `【${i + 1}/${parts.length}】${parts[i]}` : parts[i]
            const result = await sendOrQueue(outbox, {userId, text: content}, payload => sendMsg(payload.userId, payload.text), {
                id: notificationId ? `${notificationId}:part:${i + 1}` : undefined,
            })
            if (!result.sent) sent = false
            if (result.queued) queued = true
            if (result.error) lastError = result.error
        }
        return {sent, queued: !sent && queued, error: lastError, parts: parts.length}
    }

    // ── injectAndWait ── 进程内统一任务提交与事件消费
    async function injectAndWait(sessionId, userId, text, messageId = '') {
        if (stopped) return
        return runImTask({
            taskCommands,
            sessionId,
            source: 'feishu',
            userId,
            content: text,
            messageId,
            signal: taskAbortController.signal,
            loadMirror: () => shouldSkipReply(sessionId, userId),
            onPermission: msg => {
                if (pendingConfirm.add(userId, {sessionId, requestId: msg.requestId, type: 'permission'})) {
                    return sendReliableText(userId, `需要授权\n工具: ${msg.toolName}\n\n回复 y/确认 允许，n/拒绝 拒绝`)
                }
            },
            onChoice: msg => {
                const lines = []
                const question = msg.questions?.[0]
                if (question?.question) lines.push(question.question)
                ;(question?.options || []).forEach((option, index) => lines.push(`${index + 1}. ${option.label}`))
                if (pendingConfirm.add(userId, {
                    sessionId, requestId: msg.requestId, type: 'choice', questions: msg.questions,
                })) {
                    return sendReliableText(userId, `请选择\n${lines.join('\n')}\n\n回复选项编号`)
                }
            },
            onStopped: () => sessionQueue.cancel(sessionId),
            onFinish: async ({reason, replyText, toolCount, notificationId, mirrorEnabled}) => {
                log.info({sessionId: sessionId?.slice(0, 8), reason, tools: toolCount, textLen: replyText.length}, 'IM 回合结束')
                if (stopped || reason === 'adapter_stopped' || mirrorEnabled) return
                await sendReliableText(userId, replyText, notificationId)
            },
            onError: (error, context) => {
                log.warn({err: error, sessionId: sessionId?.slice(0, 8), ...context}, '飞书 IM 任务处理失败')
            },
        })
    }

    // ── permSummary ── 权限请求的工具输入摘要
    function permSummary(input) {
        if (!input) return ''
        if (input.command) return `命令: ${String(input.command).slice(0, 200)}`
        if (input.file_path) return `文件: ${input.file_path}`
        try {
            return JSON.stringify(input).slice(0, 200)
        } catch (error) {
            log.debug({err: error}, '飞书权限输入无法序列化')
            return ''
        }
    }

    // ════════════════════════════════════════════════════════════
    // ── 以下为镜像钩子(mirror hooks) ──
    // 功能说明: 由 Gateway 在"同步开启+桌面发起"时调用，将桌面端的确认请求镜像给飞书用户
    // 调用方: Gateway 通过 adapter.onConfirmRequest / adapter.onConfirmResolved 等调用
    // ════════════════════════════════════════════════════════════

    // ── findUserForSession ──
    // 功能说明: 根据 sessionId 查找绑定的飞书用户 ID(open_id 或 user_id)
    // 实现方式: 读取 adapter-sessions.json，仅匹配 feishu 平台的精确绑定；找不到则不发送，避免串发给其他用户。
    function findUserForSession(sid) {
        let ad = {}
        try {
            ad = JSON.parse(readFileSync(join(BRIDGE_HOME, 'adapter-sessions.json'), 'utf8'))
        } catch (error) {
            log.debug({err: error, sessionId: sid?.slice(0, 8)}, '读取飞书镜像状态失败')
        }
        return findLatestAdapterUserForSession(ad, 'feishu', sid)
    }

    // ── onConfirmRequest ── 镜像确认请求(桌面端发起)
    // 功能说明: 收到桌面回合的授权/选择请求 → 推送给飞书用户 + 登记 pendingConfirm
    function onConfirmRequest(info) {
        const uid = info.userId || findUserForSession(info.sessionId)
        if (!uid || !pairedUsers.has(uid)) return
        if (info.type === 'choice') {
            const lines = [];
            const q = info.questions?.[0]
            if (q?.question) lines.push(q.question)
            ;
            (q?.options || []).forEach((o, i) => lines.push(`${i + 1}. ${o.label}`))
            const added = pendingConfirm.add(uid, {
                sessionId: info.sessionId,
                requestId: info.requestId,
                type: 'choice',
                questions: info.questions
            })
            if (added) sendReliableText(uid, `请选择(桌面)\n${lines.join('\n')}\n\n回复选项编号`)
        } else {
            if (pendingConfirm.add(uid, {sessionId: info.sessionId, requestId: info.requestId, type: 'permission'})) {
                sendReliableText(uid, `需要授权(桌面)\n工具: ${info.toolName}\n\n回复 y/确认 允许，n/拒绝 拒绝`)
            }
        }
    }

    // ── onConfirmResolved ── 确认已被其它通道处理
    function onConfirmResolved(sessionId, requestId) {
        pendingConfirm.removeByRequest(sessionId, requestId)
    }

    // ── sendToUser ── Mirror 发送到绑定用户(支持长文本分段)
    // 功能说明: 将镜像回复发送到绑定的飞书用户，超长文本自动按 4000 字节分段
    async function sendToUser(sid, text, targetUserId = null, notificationId = null) {
        const uid = targetUserId || findUserForSession(sid)
        if (!uid || !text) return {sent: false, queued: false, error: 'missing_recipient_or_text'}
        if (!pairedUsers.has(uid)) return {sent: false, queued: false, error: 'recipient_not_paired'}
        return sendReliableText(uid, text, notificationId)
    }

    // ── shouldSkipReply ──
    // 功能说明: 检查 session 的 mirror 开关是否已开启(飞书通道)
    async function shouldSkipReply(sid, userId) {
        try {
            const r = await gatewayFetch(`${GW()}/api/sessions/${sid}/mirror`, token, {signal: AbortSignal.timeout(3000)}, {source: 'feishu', userId})
            if (r.ok) {
                const d = await r.json();
                return !!d.mirrors?.feishu
            }
        } catch (error) {
            log.debug({err: error, sessionId: sid?.slice(0, 8)}, '查询飞书镜像状态失败，按未开启处理')
        }
        return false
    }

    // ── 注册事件处理器 + 启动 WS 长连接 ──
    // 功能说明: 注册 im.message.receive_v1 事件处理器并启动 SDK 长连接
    // 实现方式:
    //   - EventDispatcher 注册 im.message.receive_v1 事件回调
    //   - 回调中提取 sender open_id 和消息文本，fire-and-forget 调用 handleMessage
    //   - fire-and-forget 是必须的: 飞书 SDK 要求事件回调 3 秒内返回，否则超时重推
    //     因此不能 await long-running 任务，实际处理异步进行
    // 关键数据流: 飞书 WS 事件 → EventDispatcher → im.message.receive_v1 handler
    //          → 提取 uid + text → handleMessage 异步执行 → 回调立即返回(避免重推)
    queueMicrotask(() => {
        for (const entry of inbox.recoverable()) {
            inbox.fail(entry.messageId, 'restart_recovery')
            messageDeduper.forget(entry.messageId)
            Promise.resolve().then(() => handleMessage(entry.payload.uid, entry.payload.text, entry.messageId))
                .catch(e => log.error({err: e, messageId: entry.messageId.slice(0, 32)}, '恢复 inbox 失败'))
        }
    })

    wsClient.start({
        eventDispatcher: new EventDispatcher({}).register({
            'im.message.receive_v1': (data) => {
                if (stopped) return
                // ⚠️ 飞书 SDK 要求事件回调 3 秒内返回，否则超时重推 → 不能 await long-running 任务
                const sender = data.sender
                const msg = data.message
                if (!msg || !sender) return

                // 仅处理文本消息
                if (msg.message_type !== 'text') return

                // 提取发送者 ID(优先级: open_id > user_id > union_id)
                const sid = sender.sender_id || {}
                const uid = sid.open_id || sid.user_id || sid.union_id
                if (!uid) return

                // 解析消息文本内容(飞书 content 字段为 JSON 字符串)
                let text = ''
                try {
                    text = JSON.parse(msg.content || '{}').text || ''
                } catch (error) {
                    log.warn({err: error, messageId: String(msg.message_id || '').slice(0, 32)}, '飞书消息内容不是有效 JSON')
                }
                if (!text) return
                log.info({userId: uid?.slice(0, 8), textLength: text.length}, '← 消息')
                // fire-and-forget: 实际处理异步进行，避免 SDK 超时重推
                let handling
                try {
                    handling = handleMessage(uid, text, normalizeImMessageId(msg.message_id || data.event_id))
                } catch (error) {
                    log.error({err: error, messageId: String(msg.message_id || data.event_id || '').slice(0, 32)}, '飞书事件持久化失败，等待平台重推')
                    throw error
                }
                handling?.catch(e => log.error({err: e}, 'handleMessage 异常'))
            },
        }),
    }).then(() => {
        connectionError = null
    }).catch(e => {
        connectionError = String(e?.message || e || 'start_failed')
        log.error({err: e}, '启动异常')
    })

    log.info('WSClient 已启动，等待事件')

    function stop() {
        if (stopped) return
        stopped = true
        taskAbortController.abort()
        try { wsClient.close({force: true}) } catch (error) {
            log.warn({err: error}, '关闭飞书 WSClient 失败')
        }
        sessionQueue.cancelAll()
        pendingConfirm.clear()
        clearInterval(_confirmCleanup)
        notificationWorker.stop()
        log.info('适配器已停止')
    }

    function connectionStatus() {
        if (stopped) return {state: 'stopped'}
        try {
            const status = wsClient.getConnectionStatus?.()
            if (status?.state) return {...status, ...(connectionError ? {lastError: connectionError} : {})}
        } catch (error) {
            return {state: 'error', lastError: String(error?.message || error)}
        }
        return connectionError ? {state: 'error', lastError: connectionError} : {state: 'connecting'}
    }

    function retryNotifications() {
        const reset = outbox.retryFailed()
        notificationWorker.flush().catch(error => log.warn({err: error}, '手动重试通知失败'))
        return {reset, ...outbox.summary()}
    }

    function discardNotifications() {
        const deleted = outbox.discard({states: ['dead']})
        return {deleted, ...outbox.summary()}
    }

    // 返回镜像钩子对象供 Gateway 注册
    return {
        onConfirmRequest, onConfirmResolved, findUserForSession, sendToUser,
        notificationStatus: notificationWorker.summary, notificationState: id => outbox.status(id), pairingCode: () => pairCode,
        retryNotifications, discardNotifications, connectionStatus, stop,
    }
}
