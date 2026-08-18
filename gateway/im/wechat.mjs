/**
 * WeChat Adapter — 微信机器人适配器
 *
 * ── 整体架构 ──
 * 功能说明: 将微信聊天消息桥接到 Claude Desktop Bridge Gateway，
 *          实现通过微信群聊/私聊与 Claude 交互。
 * 实现方式: HTTP 长轮询(iLink Bot API) → 解析消息 → 配对鉴权 →
 *          TaskCommand 进程内提交 → 事件流回复微信用户。
 * 关键数据流: 微信用户消息 → poll() 拉取 → handleMessage() 鉴权+路由
 *          → resolve session → runImTask() → sendMsg() 回复
 *
 * ── 依赖 ──
 * - TaskCommandService: Gateway 进程内任务命令与事件通道
 * - adapters.json: 存储 botToken / baseUrl 凭据
 * - bridge-paired.json: 已配对的用户白名单
 * - adapter-sessions.json: 用户→session 绑定关系(mirror 模式用)
 */
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {randomInt} from 'node:crypto'
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
import {normalizeWeChatBaseUrl} from './wechat-url.mjs'
import {loadPairedUsers, savePairedUsers} from './paired-users.mjs'
import {readAdapterConfig} from './adapter-config.mjs'
import {turnFallbackText} from './im-turn-finish.mjs'
import {normalizeImMessageId, validateImText} from './im-input.mjs'
import {runImTask} from './im-task-runner.mjs'
import {platformEntryFilePath} from './platform-entry-store.mjs'
import {PendingConfirmRegistry} from './pending-confirm.mjs'
import {findLatestAdapterUserForSession} from './adapter-bindings.mjs'
import {BRIDGE_HOME} from '../config/bridge-home.mjs'

const log = createLogger('wechat')

// ── 常量定义 ──
const GW = () => gatewayHttpBase()              // Gateway 本地 HTTP 地址
// Bridge 私有配置根目录；不读取 Claude/Codex 的用户配置。
const POLL_TIMEOUT = 35000                        // 长轮询超时(毫秒)，略小于微信服务端超时避免断开

// ── startWeChatAdapter ──
// 功能说明: 微信适配器入口函数，初始化凭据、配对状态、确认挂起表，启动轮询循环
// 实现方式: 使用闭包保存内部状态(onConfirmRequest/onConfirmResolved/findUserForSession/sendToUser)，
//          返回镜像钩子供 Gateway 调用。
// 关键数据流: adapters.json 加载 token → 生成配对码 → 启动 poll() → 返回钩子对象
export function startWeChatAdapter(token, {taskCommands, stateStore = null} = {}) {
    let botToken, baseUrl
    let stopped = false
    let activePollController = null
    const taskAbortController = new AbortController()
    const delayCancels = new Set()

    function wait(ms) {
        if (stopped) return Promise.resolve()
        return new Promise(resolve => {
            const timer = setTimeout(done, ms)
            function done() {
                clearTimeout(timer)
                delayCancels.delete(done)
                resolve()
            }
            delayCancels.add(done)
        })
    }

    // ── reloadToken ──
    // 功能说明: 从磁盘重新加载微信 Bot 凭据
    // 实现方式: 优先读取统一加密配置，回退旧账号文件仅用于迁移兼容。
    // SIDE_EFFECT: 修改模块级变量 botToken / baseUrl
    function reloadToken() {
        try {
            const adapters = readAdapterConfig(join(BRIDGE_HOME, 'adapters.json'))
            botToken = adapters.wechat?.botToken
            baseUrl = normalizeWeChatBaseUrl(adapters.wechat?.baseUrl)
            if (!botToken) {
                // 回退：旧格式凭据路径
                const acc = JSON.parse(readFileSync(join(BRIDGE_HOME, 'channels', 'wechat', 'default', 'account.json'), 'utf8'))
                botToken = acc.token;
                baseUrl = normalizeWeChatBaseUrl(acc.baseUrl)
            }
            if (!botToken) {
                log.warn('未找到微信凭据');
                return false
            }
            log.info('token 重载成功');
            return true
        } catch {
            log.warn('加载凭据失败');
            return false
        }
    }

    // 初始化凭据，失败则终止适配器启动
    if (!reloadToken()) return

    // ── 配对白名单 ──
    // 功能说明: 从 bridge-paired.json 加载已配对用户白名单到内存 Set
    // 实现方式: 文件不存在时默认空集合，首次配对成功时写入磁盘持久化。
    // 关键数据流: 磁盘 JSON → Set 内存 → 消息处理时 O(1) 查白名单
    const pairedFile = join(BRIDGE_HOME, 'bridge-paired.json')
    const pairedUsers = loadPairedUsers(pairedFile)

    // ── 配对码生成 ──
    // 功能说明: 每次适配器启动生成一个 6 位随机配对码，用户发送该码给 bot 完成配对
    // 实现方式: Math.random 生成 100000-999999 范围内数字字符串
    const pairCode = String(randomInt(100000, 1000000))
    log.info('配对码已生成，可在桌面端 IM 设置中查看')

    // ── 配对暴力破解防护 ──
    const pairFailCount = new Map()
    const PAIR_MAX_FAIL = 5
    const PAIR_COOLDOWN_MS = 10 * 60 * 1000
    const PAIR_ATTEMPT_TTL_MS = 60 * 60 * 1000
    const PAIR_MAX_TRACKED_USERS = 5000
    log.info('已加载凭据, 开始轮询')

    let buf = ''  // 长轮询游标缓存：服务端增量更新的 offset，避免重复拉取
    let _pollBackoff = 5000  // 指数退避延迟（5s 起始，上限 120s）

    // ── pendingConfirm 挂起确认表 ──
    // 功能说明: 记录等待用户回复确认的请求，key 为 userId，value 包含 sessionId/requestId/type
    // 实现方式: Map 结构，用户下一条非确认回复消息会被拦截并当作确认结果提交到 /api/confirm
    // 关键数据流: permission_request/choice_request 写入 → 用户回复解析 → /api/confirm POST → 删除
    const pendingConfirm = new PendingConfirmRegistry()
    const sessionQueue = new SessionTaskQueue({maxDepth: 8})
    const messageDeduper = new ImMessageDeduper()
    const payloadCodec = new SecurePayloadCodec(join(BRIDGE_HOME, 'bridge-store-key'))
    const legacyInboxFile = join(BRIDGE_HOME, 'bridge-im-inbox.json')
    const legacyOutboxFile = join(BRIDGE_HOME, 'bridge-notification-outbox.json')
    const inbox = new ImInbox({
        filePath: platformEntryFilePath(BRIDGE_HOME, 'bridge-im-inbox', 'wechat'), legacyFilePath: legacyInboxFile,
        platform: 'wechat', payloadCodec,
        stateStore,
        onPersistError: error => log.error({err: error}, 'IM inbox 持久化失败'),
    })
    const outbox = new NotificationOutbox({
        filePath: platformEntryFilePath(BRIDGE_HOME, 'bridge-notification-outbox', 'wechat'), legacyFilePath: legacyOutboxFile,
        platform: 'wechat', payloadCodec,
        stateStore,
        onPersistError: error => log.error({err: error}, '通知 outbox 持久化失败'),
    })
    // pendingConfirm TTL 清理：60s 间隔扫描，清理超时条目防止内存泄漏
    const _confirmCleanup = setInterval(() => {
      pendingConfirm.cleanup()
      for (const [uid, attempt] of pairFailCount) {
        if (Date.now() - Number(attempt.lastAttemptAt || 0) > PAIR_ATTEMPT_TTL_MS) pairFailCount.delete(uid)
      }
    }, 60 * 1000)
    if (_confirmCleanup.unref) _confirmCleanup.unref()
    // ── parseConfirmReply ──
    // 功能说明: 解析用户的确认回复文本，支持二选一(allow/deny)和多选项(choice)两种模式
    // 实现方式:
    //   - choice 模式: 尝试将文本解析为数字索引(从1开始)，转为 0-based optionIndex
    //   - permission 模式: 匹配中英文确认/拒绝关键词白名单
    // 关键数据流: 用户原始文本 → 类型判断 → 结构化对象 { decision: 'allow'/'deny' } 或 { optionIndex: N } → 返回 null 表示无法解析
    function parseConfirmReply(text, type) {
        const t = text.trim().toLowerCase()
        // choice 模式：解析选项编号
        if (type === 'choice') {
            const n = parseInt(t, 10)
            if (!Number.isNaN(n) && n >= 1) return {optionIndex: n - 1}
            return null
        }
        // permission 模式：中英文确认/拒绝关键词匹配
        if (['y', 'yes', '确认', '是', '同意', '允许', 'ok', '可以'].includes(t)) return {decision: 'allow'}
        if (['n', 'no', '拒绝', '否', '不', '不行', '取消'].includes(t)) return {decision: 'deny'}
        return null
    }

    // ── poll ── 长轮询循环
    // 功能说明: 持续拉取微信 bot 新消息，解析 buf 游标实现增量拉取
    // 实现方式: 无限循环内 POST /ilink/bot/getupdates，携带 buf 作为上次消费位置，
    //          POLL_TIMEOUT + 10s 作为 HTTP 超时(比服务端略长避免提前断开)，
    //          响应中的 get_updates_buf 更新游标，msgs 逐条送入 handleMessage。
    // 异常处理:
    //   - 401/404: 重新加载 token(可能是 token 过期)
    //   - ret=-14: session 过期需重新扫码，等待 30 秒后重试
    //   - AbortError: 超时后自动进入下一轮，不抛异常
    // 关键数据流: HTTP POST → 服务端 SSE 风格增量推送 → buf 游标推进 → msgs[] 分发
    async function poll() {
        while (!stopped) {
            try {
                const bn = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'
                const controller = new AbortController()
                activePollController = controller
                const timeout = setTimeout(() => controller.abort(), POLL_TIMEOUT + 10000)
                let res
                try {
                    res = await fetch(`${bn}ilink/bot/getupdates`, {
                        method: 'POST', headers: buildHeaders(),
                        body: JSON.stringify({
                            get_updates_buf: buf,
                            longpolling_timeout_ms: POLL_TIMEOUT,
                            base_info: {device_id: '', client_version: '2.1.7'}
                        }),
                        signal: controller.signal,
                    })
                } finally {
                    clearTimeout(timeout)
                    if (activePollController === controller) activePollController = null
                }
                if (!res.ok) {
                    log.error({status: res.status}, 'getupdates HTTP 错误')
                    if (res.status === 404 || res.status === 401) {
                        // reloadToken 失败不退出循环：token 暂时不可用，长退避后重试，避免适配器静默死亡
                        if (!reloadToken()) {
                            log.error('token 重新加载失败，60s 后重试')
                            await wait(60000)
                            continue
                        }
                    }
                    await wait(5000);
                    continue
                }
                const data = await res.json()
                if (data.ret === -14 || data.errcode === -14) {
                    log.error('session 过期, 需重新扫码');
                    await wait(30000);
                    continue
                }
                if ((data.ret && data.ret !== 0) || (data.errcode && data.errcode !== 0)) {
                    await wait(5000);
                    continue
                }
                for (const msg of (data.msgs || [])) {
                    handleMessage(msg)
                }
                // handleMessage 在返回 Promise 前同步完成 inbox claim；全部 claim 成功后才推进游标。
                if (data.get_updates_buf) buf = data.get_updates_buf
            } catch (e) {
                if (stopped) break
                // AbortError/TimeoutError 是正常超时，静默进入下一轮长轮询
                if (e.name === 'AbortError' || e.name === 'TimeoutError') {
                    _pollBackoff = 5000  // 正常超时重置退避
                    await wait(5000)
                } else {
                    log.error({err: e}, '轮询异常')
                    _pollBackoff = Math.min((_pollBackoff || 5000) * 2, 120000)
                    await wait(_pollBackoff)
                }
            }
        }
    }

    // ── handleMessage ── 消息处理 + 配对鉴权
    // 功能说明: 单条消息的处理入口，按优先级依次检查: 配对状态 → 挂起确认 → 正常对话
    // 实现方式:
    //   1. extractText 提取文本(支持文字+语音转文本)
    //   2. 未配对用户→校验配对码/提示配对
    //   3. 有挂起确认→拦截当前消息作为确认回复
    //   4. 正常对话→resolve session → injectAndWait
    // 关键数据流: raw msg → extractText → 配对检查 → session resolve → injectAndWait → 结果回传
    async function processMessage(msg) {
        if (stopped) return
        const uid = msg.from_user_id
        const ctx = msg.context_token
        const messageId = normalizeImMessageId(msg.message_id || msg.msg_id || msg.id)
        const text = extractText(msg)
        if (!text) return
        const identity = {source: 'wechat', userId: uid}
        log.info({userId: uid?.slice(0, 8), textLength: text.length}, '← 消息')

        // ── 第0层: 配对鉴权 ──
        // 未配对用户需发送配对码，否则提示并拒绝后续处理
        if (!pairedUsers.has(uid)) {
            const fc = pairFailCount.get(uid)
            if (fc && fc.count >= PAIR_MAX_FAIL && Date.now() < fc.cooldownUntil) {
                const remainMin = Math.ceil((fc.cooldownUntil - Date.now()) / 60000)
                await sendMsg(uid, ctx, `尝试次数过多，请 ${remainMin} 分钟后再试`)
                return
            }
            if (text.trim() === pairCode) {
                pairedUsers.add(uid)
                pairFailCount.delete(uid)
                savePairedUsers(pairedFile, pairedUsers)  // SIDE_EFFECT: 持久化白名单
                await sendMsg(uid, ctx, '配对成功！现在可以开始对话了。')
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
                await sendMsg(uid, ctx, left > 0
                    ? `配对码错误，还剩 ${left} 次机会`
                    : `尝试次数过多，已锁定 ${PAIR_COOLDOWN_MS / 60000} 分钟`)
            }
            return
        }

        // ── 第1层: 已配对用户命令 ──
        const command = detectCommand(text)
        if (command) {
            try {
                const result = await executeCommand(command, token, identity)
                if (result?.replyText) await sendMsg(uid, ctx, result.replyText)
            } catch (error) {
                log.error({err: error}, 'IM 命令执行或回复失败')
                await sendMsg(uid, ctx, '命令执行失败，请稍后重试')
            }
            return
        }

        // ── 第2层: 挂起确认拦截 ──
        // 该用户有未完成的确认请求时，本条消息视为确认回复而非新 prompt
        const pc = pendingConfirm.peek(uid)
        if (pc) {
            const parsed = parseConfirmReply(text, pc.type)
            if (!parsed) {
                await sendMsg(uid, ctx, pc.type === 'choice' ? '请回复选项编号（如 1、2）' : '请回复 y/确认 或 n/拒绝')
                return
            }
            try {
                const r = await gatewayFetch(`${GW()}/api/confirm`, token, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({sessionId: pc.sessionId, requestId: pc.requestId, ...parsed}),
                    signal: AbortSignal.timeout(5000),
                }, identity)
                const d = await r.json()
                if (r.ok || d.reason === 'already_resolved') {
                    pendingConfirm.remove(uid, pc)
                    if (d.ok) await sendMsg(uid, ctx, '✅ 已提交，继续处理中...')
                    else await sendMsg(uid, ctx, '该请求已处理（可能桌面端已操作或已超时）')
                } else {
                    await sendMsg(uid, ctx, '提交失败，请稍后重试')
                }
            } catch (e) {
                await sendMsg(uid, ctx, '提交失败，请稍后重试')
            }
            return
        }

        // ── 第3层: 正常对话 ──
        try {
            await sendMsg(uid, ctx, '收到，正在处理...')  // 先发 ACK 确认收到，避免用户重复发送
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
                    log.info({sessionId: sid?.slice(0, 8)}, 'session 已复用')
                } else if (r.status === 409) {
                    noActive = true
                }  // 409 表示无活跃桌面会话
            } catch (error) {
                log.warn({err: error, userId: uid?.slice(0, 8)}, '解析桌面 Session 失败')
            }
            if (noActive) {
                // 有活跃 session 才处理正常消息；无则明确提示
                await sendMsg(uid, ctx, '尚无活跃 Session，请在桌面端打开一个项目后再发送消息。')
                return
            }
            if (!sid) {
                await sendMsg(uid, ctx, '无法连接会话。请确保 Gateway 正常运行。');
                return
            }
            // 同一 Session 串行注入，避免多个 WS 监听器同时消费同一个 result。
            const position = sessionQueue.depth(sid)
            if (position > 0) await sendMsg(uid, ctx, `当前会话已有 ${position} 条消息处理中，本条将按顺序执行`)
            await sessionQueue.enqueue(sid, () => injectAndWait(sid, uid, ctx, text, messageId))
        } catch (e) {
            if (e?.code === 'queue_full') {
                await sendMsg(uid, ctx, '当前会话待处理消息已达上限，请稍后重试')
                return
            }
            if (e?.code === 'session_cancelled') {
                await sendMsg(uid, ctx, '当前会话已停止，本条排队消息已取消')
                return
            }
            log.error({err: e, userId: uid?.slice(0, 8)}, '处理失败')
            try {
                await sendMsg(uid, ctx, '处理失败，请稍后重试')
            } catch (notifyError) {
                log.warn({err: notifyError, userId: uid?.slice(0, 8)}, '发送处理失败提示失败')
            }
        }
    }

    function handleMessage(msg) {
        const messageId = normalizeImMessageId(msg?.message_id || msg?.msg_id || msg?.id)
        const text = extractText(msg)
        const validation = msg?.invalid_input ? {ok: false, code: 'invalid_input'} : validateImText(text || '')
        if (!validation.ok && !messageId) return sendReliableText(msg?.from_user_id, msg?.context_token || '', turnFallbackText('invalid_input'))
        if (!messageId) return processMessage(msg)
        const recoveryPayload = validation.ok ? {
            from_user_id: msg?.from_user_id,
            context_token: msg?.context_token || '',
            message_id: messageId,
            item_list: [{type: 1, text_item: {text}}],
        } : {
            from_user_id: msg?.from_user_id,
            context_token: msg?.context_token || '',
            message_id: messageId,
            invalid_input: true,
        }
        const claim = claimDurableInboxMessage({inbox, deduper: messageDeduper, messageId, payload: recoveryPayload})
        if (!claim.accepted) return
        return (async () => {
            try {
                if (validation.ok) await processMessage(msg)
                else await sendReliableText(msg?.from_user_id, msg?.context_token || '', turnFallbackText('invalid_input'))
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

    // ── injectAndWait ── 进程内统一任务提交与事件消费
    async function injectAndWait(sessionId, userId, ctx, text, messageId = '') {
        if (stopped) return
        return runImTask({
            taskCommands,
            sessionId,
            source: 'wechat',
            userId,
            content: text,
            messageId,
            signal: taskAbortController.signal,
            loadMirror: () => shouldSkipReply(sessionId, userId),
            onPermission: msg => {
                if (pendingConfirm.add(userId, {sessionId, requestId: msg.requestId, type: 'permission'})) {
                    return sendReliableText(userId, ctx, `🔐 需要授权\n工具: ${msg.toolName}\n${permSummary(msg.input)}\n\n回复 y/确认 允许，n/拒绝 拒绝`)
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
                    return sendReliableText(userId, ctx, `🔢 请选择\n${lines.join('\n')}\n\n回复选项编号`)
                }
            },
            onConfirmationResolved: (msg, {mirrorEnabled}) => {
                if (msg.wonBy && msg.wonBy !== 'wechat' && pendingConfirm.removeByRequest(sessionId, msg.requestId) && !mirrorEnabled) {
                    return sendMsg(userId, ctx, '桌面端已处理该确认')
                }
            },
            onStopped: () => sessionQueue.cancel(sessionId),
            onFinish: async ({reason, replyText, toolCount, notificationId, mirrorEnabled}) => {
                log.info({sessionId: sessionId?.slice(0, 8), reason, tools: toolCount, textLen: replyText.length}, 'IM 回合结束')
                if (stopped || reason === 'adapter_stopped' || mirrorEnabled) return
                await sendReliableText(userId, ctx, replyText, notificationId)
            },
            onError: (error, context) => {
                log.warn({err: error, sessionId: sessionId?.slice(0, 8), ...context}, '微信 IM 任务处理失败')
            },
        })
    }

    // ── permSummary ── 权限请求的工具输入摘要
    // 功能说明: 从工具输入对象中提取简短摘要，用于权限确认提示
    // 实现方式: 优先提取 command / file_path 字段，其次 JSON 截断到 200 字符
    function permSummary(input) {
        if (!input) return ''
        if (input.command) return `命令: ${String(input.command).slice(0, 200)}`
        if (input.file_path) return `文件: ${input.file_path}`
        try {
            return JSON.stringify(input).slice(0, 200)
        } catch (error) {
            log.debug({err: error}, '微信权限输入无法序列化')
            return ''
        }
    }

    // ── extractText ── 消息文本提取
    // 功能说明: 从微信消息的 item_list 中提取文本内容
    // 实现方式: 遍历 item_list，支持 type=1 文字消息 和 type=3 语音转文本消息，
    //          取第一个匹配项即返回，无匹配时返回 null。
    // 关键数据流: msg.item_list[] → type 判断 → text_item.text / voice_item.text → 纯文本
    function extractText(msg) {
        for (const item of (msg.item_list || [])) {
            if (item.type === 1 && item.text_item?.text) return item.text_item.text
            if (item.type === 3 && item.voice_item?.text) return item.voice_item.text  // 语音识别结果
        }
        return null
    }

    // ── sendMsg ── 发送消息到微信
    // 功能说明: 通过 iLink Bot HTTP API 发送消息给指定微信用户
    // 实现方式: POST /ilink/bot/sendmessage，message_type=2 表示单聊消息，
    //          client_id 用随机字符串防重，context_token 确保消息关联到原始上下文。
    // 异常处理: 捕获异常仅打印日志不抛出，避免因发送失败中断主流程
    // 关键数据流: 参数组装 → POST iLink API → 微信服务端 → 用户微信客户端
    async function sendMsg(userId, ctx, text) {
        if (stopped) return false
        const bn = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'
        // ctx 为空时用 message_state=1（推送消息），有 ctx 时用 message_state=2（回复消息）
        const messageState = ctx ? 2 : 1
        try {
            const clientId = `cc-bridge-${Math.random().toString(36).slice(2, 10)}`  // 随机 clientId 防重
            const res = await fetch(`${bn}ilink/bot/sendmessage`, {
                method: 'POST', headers: buildHeaders(), signal: AbortSignal.timeout(10000),
                body: JSON.stringify({
                    msg: {
                        from_user_id: '',
                        to_user_id: userId,
                        client_id: clientId,
                        message_type: 2,
                        message_state: messageState,
                        context_token: ctx,
                        item_list: [{type: 1, text_item: {text}}]
                    },
                    base_info: {channel_version: '0.1.0'},
                }),
            })
            if (!res.ok) return false
            const d = await res.json()
            if (d.ret && d.ret !== 0) {
                log.error({ret: d.ret, errmsg: d.errmsg}, 'sendmessage 返回错误')
                return false
            }
            log.debug({textLength: text.length}, 'sendMsg ok')
            return true
        } catch (e) {
            log.error({err: e}, 'sendmessage 异常')
            return false
        }
    }

    async function deliverNotification(payload) {
        if (stopped) return false
        return sendMsg(payload.userId, payload.contextToken || '', payload.text)
    }

    const notificationWorker = startNotificationWorker({outbox, deliver: deliverNotification, log})

    async function sendReliableText(userId, contextToken, text, notificationId = null) {
        if (stopped) return {sent: false, queued: false, error: 'adapter_stopped'}
        const parts = splitTextByUtf8Bytes(text, 3500)
        let sent = true
        let queued = false
        let lastError = ''
        for (let i = 0; i < parts.length; i++) {
            const content = parts.length > 1 ? `【${i + 1}/${parts.length}】${parts[i]}` : parts[i]
            const result = await sendOrQueue(outbox, {
                kind: 'direct', userId, contextToken: contextToken || '', text: content,
            }, deliverNotification, {id: notificationId ? `${notificationId}:part:${i + 1}` : undefined})
            if (!result.sent) sent = false
            if (result.queued) queued = true
            if (result.error) lastError = result.error
        }
        return {sent, queued: !sent && queued, error: lastError, parts: parts.length}
    }

    // ── buildHeaders ──
    // 功能说明: 构建 iLink Bot API 请求头
    // 实现方式: 固定 iLink 协议头 + Bearer token 鉴权 + 随机 X-WECHAT-UIN 模拟客户端
    function buildHeaders() {
        return {
            'Content-Type': 'application/json', 'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': '853081',
            'Authorization': `Bearer ${botToken}`, 'AuthorizationType': 'ilink_bot_token',
            'X-WECHAT-UIN': String(Math.floor(Math.random() * 4294967295)),  // 随机 UIN 模拟不同客户端
        }
    }

    // ════════════════════════════════════════════════════════════
    // ── 以下为镜像钩子(mirror hooks) ──
    // 功能说明: 由 Gateway 在"同步开启+桌面发起"时调用，将桌面端的确认请求/回复镜像给微信用户
    // 调用方: Gateway 通过 adapter.onConfirmRequest / adapter.onConfirmResolved 等调用
    // ════════════════════════════════════════════════════════════

    // ── findUserForSession ──
    // 功能说明: 根据 sessionId 查找绑定的微信用户 ID
    // 实现方式: 读取 adapter-sessions.json，仅匹配 wechat 平台的精确绑定；找不到则不发送，避免串发给其他用户。
    // 关键数据流: sid → adapter-sessions.json → 遍历 entries → uid
    function findUserForSession(sid) {
        let ad = {}
        try {
            ad = JSON.parse(readFileSync(join(BRIDGE_HOME, 'adapter-sessions.json'), 'utf8'))
        } catch (error) {
            log.debug({err: error, sessionId: sid?.slice(0, 8)}, '读取微信镜像状态失败')
        }
        return findLatestAdapterUserForSession(ad, 'wechat', sid)
    }

    // ── onConfirmRequest ── 镜像确认请求(桌面端发起)
    // 功能说明: 收到桌面回合的授权/选择请求 → 推送给微信用户 + 登记 pendingConfirm
    // 实现方式: 通过 findUserForSession 找到目标用户 → 发送对应格式的确认消息 → 写入 pendingConfirm
    // 关键数据流: info → findUserForSession → pendingConfirm.add → sendMsg(微信用户)
    function onConfirmRequest(info) {
        const uid = info.userId || findUserForSession(info.sessionId)
        if (!uid || !pairedUsers.has(uid)) return
        if (info.type === 'choice') {
            const lines = []
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
            if (added) sendReliableText(uid, '', `🔢 请选择（桌面）\n${lines.join('\n')}\n\n回复选项编号`)
        } else {
            if (pendingConfirm.add(uid, {sessionId: info.sessionId, requestId: info.requestId, type: 'permission'})) {
                sendReliableText(uid, '', `🔐 需要授权（桌面）\n工具: ${info.toolName}\n${permSummary(info.input)}\n\n回复 y/确认 允许，n/拒绝 拒绝`)
            }
        }
    }

    // ── onConfirmResolved ── 确认已被其它通道处理
    // 功能说明: 桌面端或其它通道已处理该确认 → 清除本地对应挂起
    // 实现方式: 遍历 pendingConfirm，按 sessionId + requestId 精确匹配并删除
    function onConfirmResolved(sessionId, requestId) {
        pendingConfirm.removeByRequest(sessionId, requestId)
    }

    // ── sendToUser ── Mirror 发送到绑定用户(支持长文本分段)
    // 功能说明: 将镜像回复发送到绑定的微信用户，超长文本自动按字节分段
    // 实现方式: 通过 findUserForSession 找到目标用户，文本 ≤ 3500 字节直接发送，
    //          超出则按 3500 字节一段切割，每段前加【N/M】标记。
    // 注意: 分段使用 Buffer.byteLength(text, 'utf8') 精确计算 UTF-8 字节数，
    //        避免中文字符被截断产生乱码，切割时通过 while 回退确保不在多字节字符中间切断。
    async function sendToUser(sid, text, targetUserId = null, notificationId = null) {
        const uid = targetUserId || findUserForSession(sid)
        if (!uid || !text) return {sent: false, queued: false, error: 'missing_recipient_or_text'}
        if (!pairedUsers.has(uid)) return {sent: false, queued: false, error: 'recipient_not_paired'}
        return sendReliableText(uid, '', text, notificationId)
    }

    // ── shouldSkipReply ──
    // 功能说明: 检查 session 的 mirror 开关是否已开启
    // 实现方式: GET /api/sessions/{sid}/mirror 查询，3 秒超时
    // 返回值: true 表示 mirror 开启(适配器跳过独立回复，由 gateway 统一广播)
    async function shouldSkipReply(sid, userId) {
        try {
            const r = await gatewayFetch(`${GW()}/api/sessions/${sid}/mirror`, token, {signal: AbortSignal.timeout(3000)}, {source: 'wechat', userId})
            if (r.ok) {
                const d = await r.json();
                return !!d.mirrors?.wechat
            }
        } catch (error) {
            log.debug({err: error, sessionId: sid?.slice(0, 8)}, '查询微信镜像状态失败，按未开启处理')
        }
        return false
    }

    // ── 启动长轮询 ──
    queueMicrotask(() => {
        for (const entry of inbox.recoverable()) {
            inbox.fail(entry.messageId, 'restart_recovery')
            messageDeduper.forget(entry.messageId)
            Promise.resolve().then(() => handleMessage(entry.payload))
                .catch(e => log.error({err: e, messageId: entry.messageId.slice(0, 32)}, '恢复 inbox 失败'))
        }
    })
    poll().catch(e => log.error({err: e}, 'poll 异常退出'))

    function stop() {
        if (stopped) return
        stopped = true
        taskAbortController.abort()
        activePollController?.abort()
        for (const cancel of [...delayCancels]) cancel()
        sessionQueue.cancelAll()
        pendingConfirm.clear()
        clearInterval(_confirmCleanup)
        notificationWorker.stop()
        log.info('适配器已停止')
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
        notificationStatus: notificationWorker.summary,
        notificationState: id => outbox.status(id),
        retryNotifications,
        discardNotifications,
        pairingCode: () => pairCode,
        connectionStatus: () => ({state: stopped ? 'stopped' : 'running'}),
        stop,
    }
}
