/**
 * Feishu Adapter — 飞书机器人适配器
 *
 * ── 整体架构 ──
 * 功能说明: 将飞书聊天消息桥接到 Claude Desktop Bridge Gateway，
 *          实现通过飞书单聊与 Claude 交互。
 * 实现方式: 飞书官方 @larksuiteoapi/node-sdk 长连接(WSClient + EventDispatcher)
 *          → 注册 im.message.receive_v1 事件 → fire-and-forget 处理 → WebSocket 注入 Gateway。
 * 关键数据流: 飞书 WS 推送事件 → EventDispatcher 分发 → handleMessage() 配对+路由
 *          → resolve session → injectAndWait() WebSocket 注入 → Client API 回复
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
 * - ws: WebSocket 客户端，连接到本地 Gateway WS 接口
 * - adapters.json: 存储 appId / appSecret
 * - bridge-paired-feishu.json: 已配对的飞书用户白名单
 * - adapter-sessions.json: 用户→session 绑定关系(mirror 模式用)
 */
import {readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {homedir} from 'node:os'
import {WSClient, EventDispatcher, Client, LoggerLevel} from '@larksuiteoapi/node-sdk'
import WebSocket from 'ws'
import {createLogger} from './logger.mjs'
import {detectCommand, executeCommand} from './im-commands.mjs'

const log = createLogger('feishu')

const GW = 'http://127.0.0.1:3456'              // Gateway 本地 HTTP 地址
const CLAUDE_HOME = join(homedir(), '.claude')   // Claude 配置根目录

// ── startFeishuAdapter ──
// 功能说明: 飞书适配器入口函数，初始化凭据、SDK 客户端、配对状态、确认挂起表
// 实现方式: 使用闭包保存内部状态，返回镜像钩子供 Gateway 调用。
//          返回 null 表示凭据加载失败，适配器无法启动。
// 关键数据流: adapters.json 加载凭据 → 创建 Client + WSClient → 注册事件处理器 → 启动 WS → 返回钩子对象
export function startFeishuAdapter(token) {
    let appId, appSecret

    // ── reloadCreds ──
    // 功能说明: 从磁盘重新加载飞书应用凭据
    // 实现方式: 读取 adapters.json 中的 feishu.appId / feishu.appSecret
    // SIDE_EFFECT: 修改模块级变量 appId / appSecret
    function reloadCreds() {
        try {
            const adapters = JSON.parse(readFileSync(join(CLAUDE_HOME, 'adapters.json'), 'utf8'))
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
    const pairedFile = join(CLAUDE_HOME, 'bridge-paired-feishu.json')
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
    const pairFailCount = new Map()
    const PAIR_MAX_FAIL = 5
    const PAIR_COOLDOWN_MS = 10 * 60 * 1000

    // ── pendingConfirm 挂起确认表 ──
    // 功能说明: 记录等待用户回复确认的请求，key 为飞书用户 open_id
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

    // ── 飞书 API 客户端 (发消息用) ──
    // 功能说明: 用于通过 HTTP API 发送消息到飞书用户
    // 实现方式: 飞书 SDK Client 封装了 access_token 自动获取/刷新，无需手动管理
    const client = new Client({appId, appSecret})

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
        } catch (e) {
            log.error({err: e}, 'sendMsg 异常')
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
        // 处理挂起的确认请求：用户发送回复时，先检测是否为确认回复而非新 prompt
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
            pendingConfirm.delete(uid)  // 无论成功与否都清除挂起状态
            return
        }

        // ── 第3层: 正常对话 ──
        try {
            await sendMsg(uid, '收到，正在处理...')  // ACK 确认
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
    // 功能说明: 通过 WebSocket 将用户消息注入到指定 Claude session，监听流式回复并回传飞书
    // 实现方式:
    //   1. 连接 Gateway WS /ws/{sessionId}?source=feishu
    //   2. 发送 user_message 后持续监听事件流
    //   3. result 事件后 500ms 触发 finish，通过 sendMsg 发送完整回复
    //   4. 超时 5.5 分钟后自动结束
    // mirror 模式: 若 mirror 开关开启则完全跳过回复发送(bridge 统一广播)
    // 关键数据流: user_message → WS 事件流 → replyText 累积 → finish() → sendMsg 飞书用户
    async function injectAndWait(sessionId, userId, text) {
        return new Promise(async (resolve) => {
            let ws2
            try {
                ws2 = new WebSocket(`ws://127.0.0.1:3456/ws/${sessionId}?source=feishu&token=${encodeURIComponent(token)}`)
            } catch (e) {
                resolve()
                return
            }
            let toolCount = 0, done = false, replyText = ''
            let mirrorOn = false
            let timeoutId = null

            // ── finish ──
            // 功能说明: 标记完成并发送回复(reason 参数用于日志诊断结束原因)
            // 实现方式: done 标志位防重入，mirror 模式或空文本跳过发送
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

            // 事件处理器必须在 await 前注册: await 会让出事件循环，localhost WS 握手极快，
            //   若 await 期间 WS 已 OPEN 则 onopen 永远不触发 → user_message 丢失 → 超时
            ws2.onerror = () => finish('ws_error')
            ws2.onclose = () => finish('ws_close')
            timeoutId = setTimeout(() => finish('timeout'), 5 * 60 * 1000 + 30000)

            ws2.onopen = () => {
                ws2.send(JSON.stringify({type: 'user_message', content: text}));
                log.info({sessionId: sessionId?.slice(0, 8), text: text.slice(0, 50)}, '→session')
            }

            mirrorOn = await shouldSkipReply(sessionId)

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
    // 功能说明: 由 Gateway 在"同步开启+桌面发起"时调用，将桌面端的确认请求镜像给飞书用户
    // 调用方: Gateway 通过 adapter.onConfirmRequest / adapter.onConfirmResolved 等调用
    // ════════════════════════════════════════════════════════════

    // ── findUserForSession ──
    // 功能说明: 根据 sessionId 查找绑定的飞书用户 ID(open_id 或 user_id)
    // 实现方式: 读取 adapter-sessions.json，精确匹配 sessionId，
    //          找不到则回退到最近活跃用户。
    function findUserForSession(sid) {
        let ad = {}
        try {
            ad = JSON.parse(readFileSync(join(CLAUDE_HOME, 'adapter-sessions.json'), 'utf8'))
        } catch {
        }
        let best = null, bestAt = -1
        for (const [uid, v] of Object.entries(ad)) {
            // 飞书的 uid 格式是 open_id 或 user_id
            if (v?.sessionId === sid) return uid  // 精确匹配优先
            if ((v?.updatedAt || 0) > bestAt) {
                bestAt = v?.updatedAt || 0;
                best = uid
            }  // 回退最近活跃
        }
        return best
    }

    // ── onConfirmRequest ── 镜像确认请求(桌面端发起)
    // 功能说明: 收到桌面回合的授权/选择请求 → 推送给飞书用户 + 登记 pendingConfirm
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
    // 功能说明: 将镜像回复发送到绑定的飞书用户，超长文本自动按 4000 字节分段
    async function sendToUser(sid, text) {
        const uid = findUserForSession(sid)
        if (!uid || !text) return
        const MAX = 4000  // 飞书单条消息最大字节数(UTF-8)
        if (Buffer.byteLength(text, 'utf8') <= MAX) {
            await sendMsg(uid, text);
            return
        }
        // ── 长文本分段 ──
        // 每段 MAX-16 字节(预留【N/M】标记)，while 回退确保 UTF-8 字符边界安全
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
    // 功能说明: 检查 session 的 mirror 开关是否已开启(飞书通道)
    async function shouldSkipReply(sid) {
        try {
            const r = await fetch(`http://127.0.0.1:3456/api/sessions/${sid}/mirror`, {signal: AbortSignal.timeout(3000)})
            if (r.ok) {
                const d = await r.json();
                return !!d.mirrors?.feishu
            }
        } catch {
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
    wsClient.start({
        eventDispatcher: new EventDispatcher({}).register({
            'im.message.receive_v1': (data) => {
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
                } catch {
                }
                if (!text) return
                log.info({userId: uid?.slice(0, 8), text: text.slice(0, 50)}, '← 消息')
                // fire-and-forget: 实际处理异步进行，避免 SDK 超时重推
                handleMessage(uid, text).catch(e => log.error({err: e}, 'handleMessage 异常'))
            },
        }),
    }).catch(e => log.error({err: e}, '启动异常'))

    log.info('WSClient 已启动，等待事件')

    // 返回镜像钩子对象供 Gateway 注册
    return {onConfirmRequest, onConfirmResolved, findUserForSession, sendToUser}
}
