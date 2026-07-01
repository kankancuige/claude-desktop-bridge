/**
 * DingTalk Adapter — 钉钉机器人适配器
 *
 * ── 整体架构 ──
 * 功能说明: 将钉钉聊天消息桥接到 Claude Desktop Bridge Gateway，
 *          实现通过钉钉单聊与 Claude 交互。
 * 实现方式: 钉钉官方 dingtalk-stream SDK Stream 长连接(DWClient)
 *          → 注册 TOPIC_ROBOT 回调 → handleMessage 配对+路由
 *          → WebSocket 注入 Gateway → HTTP API 回复。
 * 关键数据流: 钉钉 Stream WS 推送 → DWClient → registerCallbackListener(TOPIC_ROBOT)
 *          → handleMessage() → resolve session → injectAndWait() WS 注入 → sendMsg() HTTP 回复
 *
 * ── Stream 模式 vs HTTP 回调 ──
 * 钉钉 Stream 模式: 双向 WebSocket，SDK 自动处理鉴权/注册/心跳/重连。
 * 接收消息: registerCallbackListener(TOPIC_ROBOT, handler) 注册回调。
 * 发送消息: 通过 HTTP API POST /v1.0/robot/oToMessages/batchSend (单聊机器人消息)。
 *
 * ── 前提条件(钉钉开发者后台) ──
 * 1. 创建企业内部应用 → 获取 Client ID + Client Secret
 * 2. 选择 Stream 模式(不是 HTTP 回调)
 * 3. 添加机器人能力
 * 4. 发布版本
 *
 * ── 依赖 ──
 * - dingtalk-stream: 钉钉官方 Stream SDK (DWClient / TOPIC_ROBOT)
 * - ws: WebSocket 客户端，连接到本地 Gateway WS 接口
 * - adapters.json: 存储 appKey / appSecret
 * - bridge-paired-dingtalk.json: 已配对的钉钉用户白名单
 * - adapter-sessions.json: 用户→session 绑定关系(mirror 模式用)
 */
import {readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {homedir} from 'node:os'
import {DWClient, TOPIC_ROBOT} from 'dingtalk-stream'
import WebSocket from 'ws'
import {createLogger} from './logger.mjs'
import {detectCommand, executeCommand} from './im-commands.mjs'

const log = createLogger('dingtalk')

const GW = 'http://127.0.0.1:3456'              // Gateway 本地 HTTP 地址
const CLAUDE_HOME = join(homedir(), '.claude')   // Claude 配置根目录

// ── startDingTalkAdapter ──
// 功能说明: 钉钉适配器入口函数，初始化凭据、access_token 管理、配对状态、确认挂起表
// 实现方式: 使用闭包保存内部状态，返回镜像钩子供 Gateway 调用。
//          返回 null 表示凭据加载失败，适配器无法启动。
// 关键数据流: adapters.json 加载凭据 → 获取 access_token → 创建 DWClient → 注册回调
//          → connect() → 返回钩子对象
export function startDingTalkAdapter() {
    let appKey, appSecret

    // ── reloadCreds ──
    // 功能说明: 从磁盘重新加载钉钉应用凭据
    // 实现方式: 读取 adapters.json 中的 dingtalk.appKey / dingtalk.appSecret
    // SIDE_EFFECT: 修改模块级变量 appKey / appSecret
    function reloadCreds() {
        try {
            const adapters = JSON.parse(readFileSync(join(CLAUDE_HOME, 'adapters.json'), 'utf8'))
            appKey = adapters.dingtalk?.appKey
            appSecret = adapters.dingtalk?.appSecret
            if (!appKey || !appSecret) {
                log.warn('未找到凭据 (adapters.json 缺少 dingtalk.appKey/appSecret)');
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

    // ── access_token 管理 ──
    // 功能说明: 钉钉发送消息 HTTP API 需要 access_token，这里用懒加载 + 定时过期机制管理
    // 实现方式:
    //   - getAccessToken(): 首次调用时通过 OAuth2 接口获取 token，后续复用缓存的 token
    //   - 定时器: 每 100 分钟清空缓存(钉钉 token 有效期 2 小时)，迫使下次调用重新获取
    // 关键数据流: appKey+appSecret → /oauth2/accessToken → 缓存 → sendMsg 使用 → 100分钟后过期
    let accessToken = null

    // ── getAccessToken ──
    // 功能说明: 获取(或返回缓存的)钉钉 access_token
    async function getAccessToken() {
        if (accessToken) return accessToken
        try {
            const r = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({appKey, appSecret}),
                signal: AbortSignal.timeout(10000),
            })
            const d = await r.json()
            if (d.accessToken) {
                accessToken = d.accessToken;
                log.info('access_token 获取成功');
                return accessToken
            }
            log.error({code: d.code, message: d.message}, 'access_token 获取失败');
            return null
        } catch (e) {
            log.error({err: e}, 'access_token 异常');
            return null
        }
    }

    // 每 100 分钟清除 token 缓存(钉钉 token 有效期 2 小时，提前 20 分钟刷新)
    const tokenRefreshTimer = setInterval(() => {
        accessToken = null
    }, 100 * 60 * 1000)
    // 确保定时器不会阻止进程退出
    if (tokenRefreshTimer && typeof tokenRefreshTimer.unref === 'function') tokenRefreshTimer.unref()

    // ── sendMsg ── 发送消息到钉钉用户(通过 HTTP API)
    // 功能说明: 通过钉钉机器人单聊消息 API 发送文本到指定用户
    // 实现方式: POST /v1.0/robot/oToMessages/batchSend，robotCode 为应用 appKey，
    //          userIds 数组(单个用户也用数组形式)，msgKey='sampleText' 表示文本消息，
    //          msgParam 为 JSON 字符串包含 content 字段。
    // 异常处理: 捕获异常仅打印日志不抛出
    // 关键数据流: getAccessToken → x-acs-dingtalk-access-token 头 → POST batchSend → 钉钉用户
    async function sendMsg(userId, text) {
        const token = await getAccessToken()
        if (!token) return
        try {
            const r = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
                method: 'POST', headers: {'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token},
                body: JSON.stringify({
                    robotCode: appKey,
                    userIds: [userId],  // 钉钉 API 接受数组，单用户也是数组形式
                    msgKey: 'sampleText',
                    msgParam: JSON.stringify({content: text}),  // msgParam 必须是 JSON 字符串
                }),
                signal: AbortSignal.timeout(10000),
            })
            const d = await r.json()
            if (d.code) log.error({code: d.code}, 'sendMsg 失败')
            else log.debug('sendMsg ok')
        } catch (e) {
            log.error({err: e}, 'sendMsg 异常')
        }
    }

    // ── 配对白名单 ──
    const pairedFile = join(CLAUDE_HOME, 'bridge-paired-dingtalk.json')
    let pairedUsers = new Set()
    try {
        const d = JSON.parse(readFileSync(pairedFile, 'utf8'));
        pairedUsers = new Set(d.users || [])
    } catch {
    }

    // ── 配对码生成 ──
    const pairCode = String(Math.floor(100000 + Math.random() * 900000))
    log.info({pairCodeMasked: pairCode.slice(0, 2) + '****'}, '配对码已生成')

    // ── 配对暴力破解防护 ──
    const pairFailCount = new Map()  // userId → {count, cooldownUntil}
    const PAIR_MAX_FAIL = 5           // 连续失败上限
    const PAIR_COOLDOWN_MS = 10 * 60 * 1000  // 冷却时间 10 分钟

    // ── pendingConfirm 挂起确认表 ──
    const pendingConfirm = new Map()
    // pendingConfirm TTL 清理：5 分钟超时自动清除，防止异常路径下残留
    const _confirmCleanup = setInterval(() => {
      const cutoff = Date.now() - 5 * 60 * 1000
      for (const [uid, pc] of pendingConfirm) {
        if ((pc._at || 0) < cutoff) pendingConfirm.delete(uid)
      }
    }, 5 * 60 * 1000)
    if (_confirmCleanup.unref) _confirmCleanup.unref()
    // 包装 set 自动注入 _at 时间戳，供 TTL 清理使用
    const _pcSet = pendingConfirm.set.bind(pendingConfirm)
    pendingConfirm.set = (k, v) => _pcSet(k, {...v, _at: Date.now()})

    // ── parseConfirmReply ──
    // 功能说明: 解析用户的确认回复文本
    // 实现方式: choice 模式解析数字索引，permission 模式匹配中英文关键词白名单
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
    // 功能说明: 单条钉钉消息的处理入口，按优先级依次检查: 配对状态 → 挂起确认 → 正常对话
    async function handleMessage(uid, text) {
        // ── 第0层: IM 自定义命令 ──
        const cmd = detectCommand(text)
        if (cmd) {
            const r = await executeCommand(cmd)
            if (r?.replyText) await sendMsg(uid, r.replyText)
            return
        }

        // ── 第1层: 配对鉴权 ──
        if (!pairedUsers.has(uid)) {
            // 暴力破解防护：检查冷却期
            const fc = pairFailCount.get(uid)
            if (fc && fc.count >= PAIR_MAX_FAIL && Date.now() < fc.cooldownUntil) {
                const remainMin = Math.ceil((fc.cooldownUntil - Date.now()) / 60000)
                await sendMsg(uid, `尝试次数过多，请 ${remainMin} 分钟后再试`)
                return
            }
            if (text.trim() === pairCode) {
                pairedUsers.add(uid)
                pairFailCount.delete(uid)
                writeFileSync(pairedFile, JSON.stringify({users: [...pairedUsers]}))  // SIDE_EFFECT: 持久化白名单
                await sendMsg(uid, '配对成功！现在可以开始对话了。')
            } else {
                const cur = pairFailCount.get(uid) || {count: 0, cooldownUntil: 0}
                cur.count++
                if (cur.count >= PAIR_MAX_FAIL) {
                    cur.cooldownUntil = Date.now() + PAIR_COOLDOWN_MS
                    log.warn({userId: uid?.slice(0, 8), failCount: cur.count}, '配对码暴力破解触发冷却')
                }
                pairFailCount.set(uid, cur)
                const left = PAIR_MAX_FAIL - cur.count
                await sendMsg(uid, left > 0
                    ? `配对码错误，还剩 ${left} 次机会`
                    : `尝试次数过多，已锁定 ${PAIR_COOLDOWN_MS / 60000} 分钟`)
            }
            return
        }

        // ── 第2层: 挂起确认拦截 ──
        if (pendingConfirm.has(uid)) {
            const pc = pendingConfirm.get(uid)
            const parsed = parseConfirmReply(text, pc.type)
            if (!parsed) {
                await sendMsg(uid, pc.type === 'choice' ? '请回复选项编号（如 1、2）' : '请回复 y/确认 或 n/拒绝')
                return
            }
            try {
                const r = await fetch(`${GW}/api/confirm`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({sessionId: pc.sessionId, requestId: pc.requestId, ...parsed}),
                    signal: AbortSignal.timeout(5000),
                })
                if (r.ok) await sendMsg(uid, '已提交')
                else await sendMsg(uid, '该请求已处理')
            } catch (e) {
                await sendMsg(uid, '提交失败，请稍后重试')
            }
            pendingConfirm.delete(uid)
            return
        }

        // ── 第3层: 正常对话 ──
        try {
            await sendMsg(uid, '收到，正在处理...')  // ACK
            let sid = null, noActive = false
            try {
                const r = await fetch(`${GW}/api/sessions/resolve`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({userId: uid}), signal: AbortSignal.timeout(5000),
                })
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
            await injectAndWait(sid, uid, text)
        } catch (e) {
            log.error({err: e, userId: uid?.slice(0, 8)}, '处理失败')
            try {
                await sendMsg(uid, '处理失败，请稍后重试')
            } catch {
            }
        }
    }

    // ── injectAndWait ── WS 注入 + 进度反馈 + 回复发送
    // 功能说明: 通过 WebSocket 将用户消息注入到指定 Claude session，监听流式回复并回传钉钉
    // 实现方式:
    //   1. 连接 Gateway WS /ws/{sessionId}?source=dingtalk
    //   2. 发送 user_message 后持续监听事件流
    //   3. result 事件后 500ms 触发 finish，通过 sendMsg 发送完整回复
    //   4. 超时 5.5 分钟后自动结束
    // mirror 模式: 若 mirror 开关开启则完全跳过回复发送
    // 关键数据流: user_message → WS 事件流 → replyText 累积 → finish() → sendMsg 钉钉用户
    async function injectAndWait(sessionId, userId, text) {
        return new Promise(async (resolve) => {
            let ws2
            try {
                ws2 = new WebSocket(`ws://127.0.0.1:3456/ws/${sessionId}?source=dingtalk`)
            } catch (e) {
                resolve()  // WebSocket 构造失败直接结束
                return
            }
            let toolCount = 0, done = false, replyText = ''
            let mirrorOn = false
            let timeoutId = null

            // ── finish ──
            const finish = async (reason) => {
                if (done) return;
                done = true;
                if (timeoutId) clearTimeout(timeoutId)
                log.info({
                    sessionId: sessionId?.slice(0, 8),
                    reason,
                    tools: toolCount,
                    textLen: replyText.length
                }, 'finish')
                try {
                    ws2.close()
                } catch {
                }
                if (mirrorOn) {
                    resolve();
                    return
                }
                if (!replyText.trim()) {
                    resolve();
                    return
                }
                await sendMsg(userId, replyText.trim())
                resolve()
            }

            // ── WS 事件处理（必须在任何 await 之前注册，防止事件竞态丢失）──
            ws2.onerror = () => finish('ws_error')
            ws2.onclose = () => finish('ws_close')
            timeoutId = setTimeout(() => finish('timeout'), 5 * 60 * 1000 + 30000)

            ws2.onopen = () => {
                ws2.send(JSON.stringify({type: 'user_message', content: text}));
                log.info({sessionId: sessionId?.slice(0, 8), text: text.slice(0, 50)}, '→session')
            }

            ws2.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data)
                    if (msg.type === 'text_delta' && msg.text) {
                        replyText += msg.text
                    } else if (msg.type === 'assistant_message') {
                        const parts = [];
                        for (const b of (msg.message?.content || [])) {
                            if (b.type === 'text' && b.text) parts.push(b.text)
                        }
                        replyText = parts.join('\n')
                    } else if (msg.type === 'tool_use_start') {
                        toolCount++
                        if (!mirrorOn) sendMsg(userId, `⏳ [${toolCount}] ${msg.tool_name || '工具'}...`)
                    } else if (msg.type === 'permission_request') {
                        if (!mirrorOn) {
                            pendingConfirm.set(userId, {sessionId, requestId: msg.requestId, type: 'permission'})
                            sendMsg(userId, `需要授权\n工具: ${msg.toolName}\n\n回复 y/确认 允许，n/拒绝 拒绝`)
                        }
                    } else if (msg.type === 'choice_request') {
                        if (!mirrorOn) {
                            const lines = [];
                            const q = msg.questions?.[0]
                            if (q?.question) lines.push(q.question)
                            ;
                            (q?.options || []).forEach((o, i) => lines.push(`${i + 1}. ${o.label}`))
                            pendingConfirm.set(userId, {
                                sessionId,
                                requestId: msg.requestId,
                                type: 'choice',
                                questions: msg.questions
                            })
                            sendMsg(userId, `请选择\n${lines.join('\n')}\n\n回复选项编号`)
                        }
                    } else if (msg.type === 'result') {
                        if (toolCount > 0 && !mirrorOn) sendMsg(userId, `共执行 ${toolCount} 个工具`)
                        setTimeout(finish, 500, 'result')
                    }
                } catch {
                }
            }

            // 事件处理器全部就位后才做 async 操作
            mirrorOn = await shouldSkipReply(sessionId)
        })
    }

    // ── permSummary ── 权限请求的工具输入摘要
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

    // ════════════════════════════════════════════════════════════
    // ── 以下为镜像钩子(mirror hooks) ──
    // 功能说明: 由 Gateway 在"同步开启+桌面发起"时调用，将桌面端的确认请求镜像给钉钉用户
    // ════════════════════════════════════════════════════════════

    // ── findUserForSession ──
    // 功能说明: 根据 sessionId 查找绑定的钉钉用户 ID
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

    // ── onConfirmRequest ── 镜像确认请求
    function onConfirmRequest(info) {
        const uid = findUserForSession(info.sessionId)
        if (!uid || !pairedUsers.has(uid)) return
        if (info.type === 'choice') {
            const lines = [];
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
            sendMsg(uid, `请选择(桌面)\n${lines.join('\n')}\n\n回复选项编号`)
        } else {
            pendingConfirm.set(uid, {sessionId: info.sessionId, requestId: info.requestId, type: 'permission'})
            sendMsg(uid, `需要授权(桌面)\n工具: ${info.toolName}\n\n回复 y/确认 允许，n/拒绝 拒绝`)
        }
    }

    // ── onConfirmResolved ── 确认已被其它通道处理
    function onConfirmResolved(sessionId, requestId) {
        for (const [uid, pc] of pendingConfirm) {
            if (pc.sessionId === sessionId && pc.requestId === requestId) {
                pendingConfirm.delete(uid);
                break
            }
        }
    }

    // ── sendToUser ── Mirror 发送到绑定用户(支持长文本分段)
    async function sendToUser(sid, text) {
        const uid = findUserForSession(sid)
        if (!uid || !text) return
        const MAX = 4000  // 钉钉单条消息最大字节数(UTF-8)
        if (Buffer.byteLength(text, 'utf8') <= MAX) {
            await sendMsg(uid, text);
            return
        }
        // ── 长文本分段 ──
        const parts = [];
        let remain = text
        while (Buffer.byteLength(remain, 'utf8') > MAX) {
            let cut = MAX - 16
            while (cut > 0 && Buffer.byteLength(remain.slice(0, cut), 'utf8') > MAX - 16) cut--
            parts.push(remain.slice(0, cut));
            remain = remain.slice(cut)
        }
        if (remain) parts.push(remain)
        for (let i = 0; i < parts.length; i++) await sendMsg(uid, `【${i + 1}/${parts.length}】${parts[i]}`)
    }

    // ── shouldSkipReply ──
    // 功能说明: 检查 session 的 mirror 开关是否已开启(钉钉通道)
    async function shouldSkipReply(sid) {
        try {
            const r = await fetch(`http://127.0.0.1:3456/api/sessions/${sid}/mirror`, {signal: AbortSignal.timeout(3000)})
            if (r.ok) {
                const d = await r.json();
                return !!d.mirrors?.dingtalk
            }
        } catch {
        }
        return false
    }

    // ── 启动 Stream 客户端 ──
    // 功能说明: 创建 DWClient 并注册机器人消息回调，然后连接钉钉 Stream 长连接
    // 实现方式:
    //   1. 用 appKey + appSecret 初始化 DWClient
    //   2. registerCallbackListener(TOPIC_ROBOT, handler) 注册机器人消息回调
    //   3. 回调中提取 senderId 和消息文本，await handleMessage 处理
    //   4. 必须调用 socketCallBackResponse 响应 SDK(SUCCESS/FAIL)，否则 SDK 可能重试
    // 关键数据流: 钉钉 Stream WS → DWClient → TOPIC_ROBOT 回调 → extractDingText
    //          → handleMessage → socketCallBackResponse
    const dwClient = new DWClient({clientId: appKey, clientSecret: appSecret})

    // 注册机器人消息回调
    // ── registerCallbackListener(TOPIC_ROBOT) ──
    // 功能说明: 处理钉钉机器人收到的消息事件
    // 实现方式:
    //   - message.body: 原始消息数据，结构取决于 topic(ROBOT 时为机器人消息体)
    //   - message.headers.messageId: 用于 socketCallBackResponse 响应
    //   - extractDingText: 兼容多种钉钉消息体格式提取文本
    //   - 回调必须响应(SUCCESS/FAIL)，否则 Stream SDK 会不断重推
    dwClient.registerCallbackListener(TOPIC_ROBOT, async (message) => {
        // 钉钉 Stream SDK 回调结构:
        //   message.headers: { messageId, topic, ... }
        //   message.body: 原始消息数据 (根据 topic 不同而不同)
        try {
            const body = message.body || {}
            log.debug({raw: JSON.stringify(message).slice(0, 300)}, '收到回调')

            // 机器人消息体可能格式:
            //   { text: { content: "..." }, senderId: "..." }  ← 钉钉标准格式
            //   或 { senderId, senderStaffId, text: { content }, ... }
            const uid = body.senderId || body.senderStaffId || body.sender_id
            const text = extractDingText(body)

            if (!uid || !text) {
              // 消息为空或发送者未知，仍需响应 SUCCESS 避免 SDK 重推
              dwClient.socketCallBackResponse(message.headers.messageId, {status: 'SUCCESS'})
              return
            }
            log.info({userId: uid?.slice(0, 8), text: text.slice(0, 50)}, '← 消息')
            await handleMessage(uid, text)

            // 回调必须响应，否则 SDK 可能重试
            dwClient.socketCallBackResponse(message.headers.messageId, {status: 'SUCCESS'})
        } catch (e) {
            log.error({err: e}, '回调处理异常')
            try {
                dwClient.socketCallBackResponse(message.headers.messageId, {status: 'FAIL'})
            } catch {
            }
        }
    })

    // ── extractDingText ── 钉钉消息文本提取
    // 功能说明: 从钉钉消息体中提取文本内容，兼容多种消息格式
    // 实现方式: 按优先级依次尝试:
    //   1. body.text.content (钉钉标准格式: text 对象含 content 字段)
    //   2. body.text 直接是字符串
    //   3. body.content 是 JSON 字符串需解析
    //   4. body.content 直接是纯文本
    // 关键数据流: body → 格式推断 → 逐级回退 → 返回纯文本或空字符串
    function extractDingText(body) {
        if (body.text?.content) return body.text.content
        if (typeof body.text === 'string') return body.text
        if (typeof body.content === 'string') {
            try {
                const c = JSON.parse(body.content);
                return c.content || c.text || ''
            } catch {
                return body.content
            }
        }
        return body.content || ''
    }

    // ── 连接 Stream → 启动成功 ──
    dwClient.connect().then(() => {
        log.info('Stream 客户端已启动，等待消息')
    }).catch(e => {
        log.error({err: e}, '启动异常')
    })

    // 返回镜像钩子对象供 Gateway 注册
    return {onConfirmRequest, onConfirmResolved, findUserForSession, sendToUser}
}
