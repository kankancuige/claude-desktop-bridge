/**
 * WeChat Adapter — 微信机器人适配器
 *
 * ── 整体架构 ──
 * 功能说明: 将微信聊天消息桥接到 Claude Desktop Bridge Gateway，
 *          实现通过微信群聊/私聊与 Claude 交互。
 * 实现方式: HTTP 长轮询(iLink Bot API) → 解析消息 → 配对鉴权 →
 *          WebSocket 注入 Gateway → 流式回复 → 微信发回用户。
 * 关键数据流: 微信用户消息 → poll() 拉取 → handleMessage() 鉴权+路由
 *          → resolve session → injectAndWait() WebSocket 注入 → sendMsg() 回复
 *
 * ── 依赖 ──
 * - ws: WebSocket 客户端，连接到本地 Gateway WS 接口
 * - adapters.json: 存储 botToken / baseUrl 凭据
 * - bridge-paired.json: 已配对的用户白名单
 * - adapter-sessions.json: 用户→session 绑定关系(mirror 模式用)
 */
import {readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {homedir} from 'node:os'
import WebSocket from 'ws'
import {createLogger} from './logger.mjs'
import {detectCommand, executeCommand} from './im-commands.mjs'

const log = createLogger('wechat')

// ── 常量定义 ──
const GW = 'http://127.0.0.1:3456'              // Gateway 本地 HTTP 地址
const CLAUDE_HOME = join(homedir(), '.claude')   // Claude 配置根目录
const POLL_TIMEOUT = 35000                        // 长轮询超时(毫秒)，略小于微信服务端超时避免断开

// ── startWeChatAdapter ──
// 功能说明: 微信适配器入口函数，初始化凭据、配对状态、确认挂起表，启动轮询循环
// 实现方式: 使用闭包保存内部状态(onConfirmRequest/onConfirmResolved/findUserForSession/sendToUser)，
//          返回镜像钩子供 Gateway 调用。
// 关键数据流: adapters.json 加载 token → 生成配对码 → 启动 poll() → 返回钩子对象
export function startWeChatAdapter() {
    let botToken, baseUrl

    // ── reloadToken ──
    // 功能说明: 从磁盘重新加载微信 Bot 凭据
    // 实现方式: 优先读 adapters.json(新格式)，回退读 channels/wechat/default/account.json(旧格式)，
    //          双层兼容确保迁移期平滑过渡。
    // SIDE_EFFECT: 修改模块级变量 botToken / baseUrl
    function reloadToken() {
        try {
            const adapters = JSON.parse(readFileSync(join(CLAUDE_HOME, 'adapters.json'), 'utf8'))
            botToken = adapters.wechat?.botToken
            baseUrl = adapters.wechat?.baseUrl
            if (!botToken) {
                // 回退：旧格式凭据路径
                const acc = JSON.parse(readFileSync(join(CLAUDE_HOME, 'channels', 'wechat', 'default', 'account.json'), 'utf8'))
                botToken = acc.token;
                baseUrl = acc.baseUrl
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
    const pairedFile = join(CLAUDE_HOME, 'bridge-paired.json')
    let pairedUsers = new Set()
    try {
        const d = JSON.parse(readFileSync(pairedFile, 'utf8'));
        pairedUsers = new Set(d.users || [])
    } catch {
    }

    // ── 配对码生成 ──
    // 功能说明: 每次适配器启动生成一个 6 位随机配对码，用户发送该码给 bot 完成配对
    // 实现方式: Math.random 生成 100000-999999 范围内数字字符串
    const pairCode = String(Math.floor(100000 + Math.random() * 900000))
    log.info({pairCodeMasked: pairCode.slice(0, 2) + '****'}, '配对码已生成')

    // ── 配对暴力破解防护 ──
    const pairFailCount = new Map()
    const PAIR_MAX_FAIL = 5
    const PAIR_COOLDOWN_MS = 10 * 60 * 1000
    log.info('已加载凭据, 开始轮询')

    let buf = ''  // 长轮询游标缓存：服务端增量更新的 offset，避免重复拉取

    // ── pendingConfirm 挂起确认表 ──
    // 功能说明: 记录等待用户回复确认的请求，key 为 userId，value 包含 sessionId/requestId/type
    // 实现方式: Map 结构，用户下一条非确认回复消息会被拦截并当作确认结果提交到 /api/confirm
    // 关键数据流: permission_request/choice_request 写入 → 用户回复解析 → /api/confirm POST → 删除
    const pendingConfirm = new Map()

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
        while (true) {
            try {
                const bn = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'
                const res = await fetch(`${bn}ilink/bot/getupdates`, {
                    method: 'POST', headers: buildHeaders(),
                    body: JSON.stringify({
                        get_updates_buf: buf,
                        longpolling_timeout_ms: POLL_TIMEOUT,
                        base_info: {device_id: '', client_version: '2.1.7'}
                    }),
                    signal: AbortSignal.timeout(POLL_TIMEOUT + 10000),
                })
                if (!res.ok) {
                    log.error({status: res.status}, 'getupdates HTTP 错误')
                    if (res.status === 404 || res.status === 401) {
                        if (!reloadToken()) return
                    }
                    await sleep(5000);
                    continue
                }
                const data = await res.json()
                if (data.ret === -14 || data.errcode === -14) {
                    log.error('session 过期, 需重新扫码');
                    await sleep(30000);
                    continue
                }
                if ((data.ret && data.ret !== 0) || (data.errcode && data.errcode !== 0)) {
                    await sleep(5000);
                    continue
                }
                if (data.get_updates_buf) buf = data.get_updates_buf  // 更新游标实现增量拉取
                for (const msg of (data.msgs || [])) {
                    handleMessage(msg)
                }
            } catch (e) {
                // AbortError 是正常超时，静默进入下一轮长轮询
                if (e.name !== 'AbortError') log.error({err: e}, '轮询异常');
                await sleep(5000)
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
    async function handleMessage(msg) {
        const uid = msg.from_user_id
        const ctx = msg.context_token
        const text = extractText(msg)
        if (!text) return
        log.info({userId: uid?.slice(0, 8), text: text.slice(0, 50)}, '← 消息')

        // ── 第0层: IM 自定义命令 ──
        const cmd = detectCommand(text)
        if (cmd) {
            executeCommand(cmd).then(r => {
                if (r?.replyText) sendMsg(uid, ctx, r.replyText).catch(() => {})
            })
            return
        }

        // ── 第1层: 配对鉴权 ──
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
                writeFileSync(pairedFile, JSON.stringify({users: [...pairedUsers]}))  // SIDE_EFFECT: 持久化白名单
                await sendMsg(uid, ctx, '配对成功！现在可以开始对话了。')
            } else {
                const cur = pairFailCount.get(uid) || {count: 0, cooldownUntil: 0}
                cur.count++
                if (cur.count >= PAIR_MAX_FAIL) {
                    cur.cooldownUntil = Date.now() + PAIR_COOLDOWN_MS
                    log.warn({userId: uid?.slice(0, 8), failCount: cur.count}, '配对码暴力破解触发冷却')
                }
                pairFailCount.set(uid, cur)
                const left = PAIR_MAX_FAIL - cur.count
                await sendMsg(uid, ctx, left > 0
                    ? `配对码错误，还剩 ${left} 次机会`
                    : `尝试次数过多，已锁定 ${PAIR_COOLDOWN_MS / 60000} 分钟`)
            }
            return
        }

        // ── 第2层: 挂起确认拦截 ──
        // 该用户有未完成的确认请求时，本条消息视为确认回复而非新 prompt
        if (pendingConfirm.has(uid)) {
            const pc = pendingConfirm.get(uid)
            const parsed = parseConfirmReply(text, pc.type)
            if (!parsed) {
                await sendMsg(uid, ctx, pc.type === 'choice' ? '请回复选项编号（如 1、2）' : '请回复 y/确认 或 n/拒绝')
                return
            }
            try {
                const r = await fetch(`${GW}/api/confirm`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({sessionId: pc.sessionId, requestId: pc.requestId, ...parsed}),
                    signal: AbortSignal.timeout(5000),
                })
                const d = await r.json()
                if (d.ok) await sendMsg(uid, ctx, '✅ 已提交，继续处理中...')
                else await sendMsg(uid, ctx, '该请求已处理（可能桌面端已操作或已超时）')
            } catch (e) {
                await sendMsg(uid, ctx, '提交失败，请稍后重试')
            }
            pendingConfirm.delete(uid)  // 无论成功与否都清除挂起状态，避免死锁
            return
        }

        // ── 第3层: 正常对话 ──
        try {
            await sendMsg(uid, ctx, '收到，正在处理...')  // 先发 ACK 确认收到，避免用户重复发送
            let sid = null, noActive = false
            // 解析用户绑定的活跃 session
            try {
                const r = await fetch(`${GW}/api/sessions/resolve`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({userId: uid}), signal: AbortSignal.timeout(5000),
                })
                if (r.ok) {
                    const d = await r.json();
                    sid = d.sessionId;
                    log.info({sessionId: sid?.slice(0, 8)}, 'session 已复用')
                } else if (r.status === 409) {
                    noActive = true
                }  // 409 表示无活跃桌面会话
            } catch {
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
            // 注入消息到 Gateway WebSocket，等待 Claude 完整回复
            await injectAndWait(sid, uid, ctx, text)
        } catch (e) {
            log.error({err: e, userId: uid?.slice(0, 8)}, '处理失败')
            try {
                await sendMsg(uid, ctx, '处理失败，请稍后重试')
            } catch {
            }
        }
    }

    // ── injectAndWait ── WS 注入 + 进度反馈 + 回复发送
    // 功能说明: 通过 WebSocket 将用户消息注入到指定 Claude session，监听流式回复并回传微信
    // 实现方式:
    //   1. 连接 Gateway WS /ws/{sessionId}?source=wechat
    //   2. 发送 user_message 后持续监听 assistant_message / text_delta / tool_use_start /
    //      permission_request / choice_request / result 等事件
    //   3. result 事件后 500ms 内通过 /api/wechat/reply 发送完整回复(三阶段: ACK→进度→回复)
    //   4. 超时 5.5 分钟后自动结束，防止 WS 假死导致 Promise 永久挂起
    // 异常处理: WS error/close 触发 finish()，确保 Promise resolve
    // mirror 模式: 若 mirror 开关开启则跳过独立回复(bridge 统一广播)，避免重复消息
    // 关键数据流: user_message → WS 事件流 → replyText 累积 → /api/wechat/reply → 微信用户
    async function injectAndWait(sessionId, userId, ctx, text) {
        return new Promise(async (resolve) => {
            let ws
            try {
                ws = new WebSocket(`ws://127.0.0.1:3456/ws/${sessionId}?source=wechat`)
            } catch (e) {
                resolve()
                return
            }
            let toolCount = 0, done = false, replyText = ''
            let mirrorOn = false
            let timeoutId = null

            // ── finish ── 必须在所有事件处理器之前定义
            const finish = async (reason) => {
                if (done) return;
                done = true;
                if (timeoutId) clearTimeout(timeoutId)
                try { ws.close() } catch {}
                if (await shouldSkipReply(sessionId)) {
                    log.info({sessionId: sessionId?.slice(0, 8)}, 'mirror 已开启，跳过独立回复');
                    resolve(); return
                }
                if (!replyText.trim()) {
                    await sendMsg(userId, ctx, reason === 'result' ? '处理完成，无文本回复' : '处理超时或连接中断，请稍后重试').catch(() => {})
                    resolve(); return
                }
                fetch(`${GW}/api/wechat/reply`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({sessionId, userId, contextToken: ctx, replyText}),
                    signal: AbortSignal.timeout(15000),
                }).then(async (r) => {
                    if (r.ok) {
                        const d = await r.json();
                        log.info({sessionId: sessionId?.slice(0, 8), sent: d.sent, length: d.length}, '← 回复')
                    }
                }).catch(e => log.error({err: e, sessionId: sessionId?.slice(0, 8)}, 'reply 失败')).finally(resolve)
            }

            // 所有事件处理器必须在任何 await 之前注册，防止事件竞态丢失
            ws.onerror = () => finish('ws_error')
            ws.onclose = () => finish('ws_close')
            timeoutId = setTimeout(() => finish('timeout'), 5 * 60 * 1000 + 30000)

            ws.onopen = () => {
                ws.send(JSON.stringify({type: 'user_message', content: text}));
                log.info({sessionId: sessionId?.slice(0, 8), text: text.slice(0, 50)}, '→session')
            }

            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data)
                    if (msg.type === 'assistant_message') {
                        const parts = []
                        for (const block of (msg.message?.content || [])) {
                            if (block.type === 'text' && block.text) parts.push(block.text)
                        }
                        replyText = parts.join('\n')
                    } else if (msg.type === 'text_delta' && msg.text) {
                        replyText += msg.text
                    } else if (msg.type === 'tool_use_start') {
                        toolCount++
                        if (!mirrorOn) sendMsg(userId, ctx, `⏳ [${toolCount}] 🔧 ${msg.tool_name || '工具'}...`)
                    } else if (msg.type === 'permission_request') {
                        if (!mirrorOn) {
                            pendingConfirm.set(userId, {sessionId, requestId: msg.requestId, type: 'permission'})
                            sendMsg(userId, ctx, `🔐 需要授权\n工具: ${msg.toolName}\n${permSummary(msg.input)}\n\n回复 y/确认 允许，n/拒绝 拒绝`)
                        }
                    } else if (msg.type === 'choice_request') {
                        if (!mirrorOn) {
                            const lines = []
                            const q = msg.questions?.[0]
                            if (q?.question) lines.push(q.question)
                            ;(q?.options || []).forEach((o, i) => lines.push(`${i + 1}. ${o.label}`))
                            pendingConfirm.set(userId, {sessionId, requestId: msg.requestId, type: 'choice', questions: msg.questions})
                            sendMsg(userId, ctx, `🔢 请选择\n${lines.join('\n')}\n\n回复选项编号`)
                        }
                    } else if (msg.type === 'confirmation_resolved') {
                        if (msg.wonBy && msg.wonBy !== 'wechat' && pendingConfirm.has(userId)) {
                            pendingConfirm.delete(userId)
                            if (!mirrorOn) sendMsg(userId, ctx, '桌面端已处理该确认')
                        }
                    } else if (msg.type === 'result') {
                        if (toolCount > 0 && !mirrorOn) sendMsg(userId, ctx, `✅ 共执行 ${toolCount} 个工具，正在整理回复...`)
                        setTimeout(() => finish('result'), 500)
                    }
                } catch {}
            }

            // 事件处理器全部就位后才做 async 操作
            mirrorOn = await shouldSkipReply(sessionId)
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
        } catch {
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
        const bn = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'
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
                        message_state: 2,
                        context_token: ctx,
                        item_list: [{type: 1, text_item: {text}}]
                    },
                    base_info: {channel_version: '0.1.0'},
                }),
            })
            const d = await res.json()
            if (d.ret && d.ret !== 0) log.error({ret: d.ret, errmsg: d.errmsg}, 'sendmessage 返回错误')
            else log.debug({text: text.slice(0, 30)}, 'sendMsg ok')
        } catch (e) {
            log.error({err: e}, 'sendmessage 异常')
        }
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
    // 实现方式: 读取 adapter-sessions.json，精确匹配 sessionId，
    //          找不到则回退到最近活跃用户(updatedAt 最大)。
    // 关键数据流: sid → adapter-sessions.json → 遍历 entries → uid
    function findUserForSession(sid) {
        let ad = {}
        try {
            ad = JSON.parse(readFileSync(join(CLAUDE_HOME, 'adapter-sessions.json'), 'utf8'))
        } catch {
        }
        let best = null, bestAt = -1
        for (const [uid, v] of Object.entries(ad)) {
            if (v?.sessionId === sid) return uid  // 精确匹配优先
            if ((v?.updatedAt || 0) > bestAt) {
                bestAt = v?.updatedAt || 0;
                best = uid
            }  // 回退最近活跃
        }
        return best
    }

    // ── onConfirmRequest ── 镜像确认请求(桌面端发起)
    // 功能说明: 收到桌面回合的授权/选择请求 → 推送给微信用户 + 登记 pendingConfirm
    // 实现方式: 通过 findUserForSession 找到目标用户 → 发送对应格式的确认消息 → 写入 pendingConfirm
    // 关键数据流: info → findUserForSession → pendingConfirm.set → sendMsg(微信用户)
    function onConfirmRequest(info) {
        const uid = findUserForSession(info.sessionId)
        if (!uid || !pairedUsers.has(uid)) return
        if (info.type === 'choice') {
            const lines = []
            const q = info.questions?.[0]
            if (q?.question) lines.push(q.question)
            ;
            (q?.options || []).forEach((o, i) => lines.push(`${i + 1}. ${o.label}`))
            pendingConfirm.set(uid, {
                sessionId: info.sessionId,
                requestId: info.requestId,
                type: 'choice',
                questions: info.questions
            })
            sendMsg(uid, '', `🔢 请选择（桌面）\n${lines.join('\n')}\n\n回复选项编号`)
        } else {
            pendingConfirm.set(uid, {sessionId: info.sessionId, requestId: info.requestId, type: 'permission'})
            sendMsg(uid, '', `🔐 需要授权（桌面）\n工具: ${info.toolName}\n${permSummary(info.input)}\n\n回复 y/确认 允许，n/拒绝 拒绝`)
        }
    }

    // ── onConfirmResolved ── 确认已被其它通道处理
    // 功能说明: 桌面端或其它通道已处理该确认 → 清除本地对应挂起
    // 实现方式: 遍历 pendingConfirm，按 sessionId + requestId 精确匹配并删除
    function onConfirmResolved(sessionId, requestId) {
        for (const [uid, pc] of pendingConfirm) {
            if (pc.sessionId === sessionId && pc.requestId === requestId) {
                pendingConfirm.delete(uid);
                break
            }
        }
    }

    // ── sendToUser ── Mirror 发送到绑定用户(支持长文本分段)
    // 功能说明: 将镜像回复发送到绑定的微信用户，超长文本自动按字节分段
    // 实现方式: 通过 findUserForSession 找到目标用户，文本 ≤ 3500 字节直接发送，
    //          超出则按 3500 字节一段切割，每段前加【N/M】标记。
    // 注意: 分段使用 Buffer.byteLength(text, 'utf8') 精确计算 UTF-8 字节数，
    //        避免中文字符被截断产生乱码，切割时通过 while 回退确保不在多字节字符中间切断。
    async function sendToUser(sid, text) {
        const uid = findUserForSession(sid)
        if (!uid || !text) return
        const bn = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'
        const WX_MAX = 3500  // 微信单条消息最大字节数(UTF-8)，经验值
        if (Buffer.byteLength(text, 'utf8') <= WX_MAX) {
            await sendMsg(uid, '', text);
            return
        }
        // ── 长文本分段 ──
        // 功能说明: 按字节安全地将长文本切成多段，确保不会在 UTF-8 多字节字符中间切断
        // 实现方式: 每段尝试 WX_MAX-16 字节(预留 16 字节给【N/M】标记)，
        //          用 while 回退直到 cut 位置恰好在合法字符边界。
        const parts = []
        let remain = text
        while (Buffer.byteLength(remain, 'utf8') > WX_MAX) {
            let cut = WX_MAX - 16
            while (cut > 0 && Buffer.byteLength(remain.slice(0, cut), 'utf8') > WX_MAX - 16) cut--
            parts.push(remain.slice(0, cut));
            remain = remain.slice(cut)
        }
        if (remain) parts.push(remain)
        for (let i = 0; i < parts.length; i++) {
            await sendMsg(uid, '', `【${i + 1}/${parts.length}】${parts[i]}`)
        }
    }

    // ── shouldSkipReply ──
    // 功能说明: 检查 session 的 mirror 开关是否已开启
    // 实现方式: GET /api/sessions/{sid}/mirror 查询，3 秒超时
    // 返回值: true 表示 mirror 开启(适配器跳过独立回复，由 gateway 统一广播)
    async function shouldSkipReply(sid) {
        try {
            const r = await fetch(`http://127.0.0.1:3456/api/sessions/${sid}/mirror`, {signal: AbortSignal.timeout(3000)})
            if (r.ok) {
                const d = await r.json();
                return !!d.mirrors?.wechat
            }
        } catch {
        }
        return false
    }

    // ── 启动长轮询 ──
    poll().catch(e => log.error({err: e}, 'poll 异常退出'))

    // 返回镜像钩子对象供 Gateway 注册
    return {onConfirmRequest, onConfirmResolved, findUserForSession, sendToUser}
}

// ── sleep ── 异步延时工具函数
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms))
}
