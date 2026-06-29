/**
 * Gateway Pinia Store
 * ── 功能说明 ──
 * 管理与 gateway 后端的完整通信生命周期：
 *   1. 通过 HTTP POST /api/sessions 创建会话
 *   2. 通过 WebSocket /ws/:sessionId 维持双向消息通道
 *   3. 处理 assistant_message、thinking、result、error 等多种消息类型
 *   4. 管理连接状态（idle / thinking / streaming）和消息历史
 * ── 实现方式 ──
 * 使用 Pinia Composition API (setup store) 模式，
 * 所有状态为 ref 响应式，方法为普通 async/同步函数。
 * WebSocket 实例为非响应式变量（let ws），避免 Proxy 包装干扰原生 API。
 */

import {defineStore} from 'pinia'
import {ref} from 'vue'

// ── gateway 后端地址常量 ──
// gateway 始终运行在 localhost:3456，不对外暴露
const GW = 'http://127.0.0.1:3456'

export const useGatewayStore = defineStore('gateway', () => {
    // ═══════════════════════════════════════════
    // ── 响应式状态 (ref) ──
    // ═══════════════════════════════════════════

    /**
     * ── sessionId ──
     * 当前会话的唯一标识符，由 gateway 在 createSession 时分配
     * null 表示尚未创建会话
     */
    const sessionId = ref(null)

    /**
     * ── connected ──
     * WebSocket 连接状态：true 表示已建立连接，false 表示断开/未连接
     * 用于 UI 层显示连接指示器
     */
    const connected = ref(false)

    /**
     * ── messages ──
     * 消息历史数组，每条消息格式: { role, text, time }
     * role 取值: 'user' | 'assistant' | 'system' | 'thinking' | 'error'
     * 用于渲染聊天界面
     */
    const messages = ref([])

    /**
     * ── status ──
     * gateway 当前工作状态:
     *   'idle'       - 空闲，等待用户输入
     *   'thinking'   - 正在处理用户消息/工具调用
     *   'streaming'  - 正在流式返回 assistant 文本
     */
    const status = ref('idle') // idle | thinking | streaming

    // ═══════════════════════════════════════════
    // ── 非响应式状态 ──
    // ═══════════════════════════════════════════

    /**
     * ── ws ──
     * WebSocket 实例，非响应式变量
     * 原因: WebSocket 是原生对象，不需要 Vue 响应式包装；
     * 且 Proxy 包装会干扰 readyState 等属性的正确读取
     * SIDE_EFFECT: connect() 时创建/替换；旧连接在调用前会被主动关闭
     */
    let ws = null

    // ═══════════════════════════════════════════
    // ── 方法 ──
    // ═══════════════════════════════════════════

    /**
     * ── createSession: 创建 gateway 会话 ──
     * 功能说明: 向 gateway 后端发起 HTTP POST 创建新会话，成功后自动建立 WebSocket 连接
     * 实现方式:
     *   1. POST /api/sessions，body 包含 workDir（工作目录路径）
     *   2. 响应成功后提取 sessionId 并保存到状态
     *   3. 使用 sessionId 建立 WebSocket 连接
     * @param {string} workDir - 用户选择的工作目录绝对路径
     * @returns {Promise<object>} 包含 sessionId 的响应数据
     * @throws {Error} 创建失败时抛出错误
     */
    async function createSession(workDir) {
        const res = await fetch(`${GW}/api/sessions`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({workDir}),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'create session failed')
        sessionId.value = data.sessionId
        connect(data.sessionId)
        return data
    }

    /**
     * ── connect: 建立 WebSocket 连接 ──
     * 功能说明: 连接到 gateway 的 WebSocket 端点，设置事件处理器
     * 实现方式:
     *   1. 先关闭已有 WebSocket（如果存在），防止连接泄露
     *   2. 创建新 WebSocket，路径为 /ws/:sessionId
     *   3. onopen: 设置 connected = true，写入系统消息
     *   4. onmessage: JSON.parse 后路由到 handleMessage 分发
     *   5. onclose/onerror: 设置 connected = false，status 恢复 idle
     * @param {string} sid - 会话 ID
     * SIDE_EFFECT: 替换全局 ws 变量；注册事件监听器
     */
    function connect(sid) {
        if (ws) ws.close()                            // 关闭旧连接，防止泄露
        ws = new WebSocket(`ws://127.0.0.1:3456/ws/${sid}`)

        // ── 连接成功 ──
        ws.onopen = () => {
            connected.value = true
            messages.value.push({
                role: 'system',
                text: `Connected to ${sid}`,
                time: Date.now()
            })
        }

        // ── 接收消息 ──
        // 所有来自 gateway 的消息都通过 handleMessage 统一分发
        ws.onmessage = (e) => {
            const msg = JSON.parse(e.data)
            handleMessage(msg)
        }

        // ── 连接关闭 ──
        // 可能是主动关闭或 gateway 断开，恢复 idle 状态
        ws.onclose = () => {
            connected.value = false
            status.value = 'idle'
        }

        // ── 连接错误 ──
        // WebSocket 级别的错误（如无法连接），标记为断开
        ws.onerror = () => {
            connected.value = false
        }
    }

    /**
     * ── handleMessage: 消息分发处理 ──
     * 功能说明: 根据 msg.type 将消息路由到对应的处理逻辑，并追加到 messages 数组
     * 消息类型:
     *   - system_init:      会话初始化信息（模型、工作目录）
     *   - assistant_message: AI 回复（text 阻塞 + thinking 块）
     *   - result:           回合完成摘要（回合数、耗时、token 用量）
     *   - error:            错误信息
     * 实现方式: switch-case 分发，每种类型构造统一格式的消息对象
     * @param {object} msg - gateway 发来的 JSON 消息对象
     */
    function handleMessage(msg) {
        switch (msg.type) {
            // ── 系统初始化 ──
            // 包含模型名称和当前工作目录，用于 UI 顶部信息栏
            case 'system_init':
                messages.value.push({
                    role: 'system',
                    text: `Model: ${msg.model} | CWD: ${msg.cwd}`,
                    time: Date.now()
                })
                break

            // ── AI 助手回复 ──
            // 消息内容可能包含多个 block，每个 block 可能是 text（正文）或 thinking（思考过程）
            case 'assistant_message': {
                const textBlocks = msg.message?.content || []
                for (const block of textBlocks) {
                    if (block.type === 'text') {
                        // 普通文本块：直接添加到消息列表
                        messages.value.push({
                            role: 'assistant',
                            text: block.text,
                            time: Date.now()
                        })
                    } else if (block.type === 'thinking') {
                        // 思考过程块：截取前 200 字符展示，避免思考内容过长
                        messages.value.push({
                            role: 'thinking',
                            text: (block.thinking || '').slice(0, 200),
                            time: Date.now()
                        })
                    }
                }
                break
            }

            // ── 回合完成 ──
            // 汇总本轮对话的统计信息：回合数、耗时、输入/输出 token 数
            case 'result':
                messages.value.push({
                    role: 'system',
                    text: `Done · ${msg.num_turns} turns · ${msg.duration_ms}ms · in:${msg.usage?.input_tokens} out:${msg.usage?.output_tokens}`,
                    time: Date.now(),
                })
                status.value = 'idle'                     // 完成处理，恢复空闲
                break

            // ── 错误 ──
            // gateway 返回的错误信息，恢复 idle 状态以允许用户重试
            case 'error':
                messages.value.push({
                    role: 'error',
                    text: msg.message,
                    time: Date.now()
                })
                status.value = 'idle'
                break
        }
    }

    /**
     * ── sendMessage: 发送用户消息 ──
     * 功能说明: 将用户输入的文本发送给 gateway，触发 AI 处理
     * 实现方式:
     *   1. 检查 WebSocket 是否处于 OPEN 状态（readyState === 1）
     *   2. 设置 status 为 'thinking'
     *   3. 先将用户消息追加到 messages（乐观更新）
     *   4. 通过 WebSocket 发送 JSON 消息
     * @param {string} content - 用户输入的消息文本
     */
    function sendMessage(content) {
        if (!ws || ws.readyState !== 1) return       // WebSocket 未就绪，静默跳过
        status.value = 'thinking'
        messages.value.push({
            role: 'user',
            text: content,
            time: Date.now()
        })
        ws.send(JSON.stringify({type: 'user_message', content}))
    }

    /**
     * ── stopGeneration: 中断 AI 生成 ──
     * 功能说明: 发送停止指令给 gateway，中断当前正在进行的 AI 生成
     * 实现方式: 通过 WebSocket 发送 stop_generation 类型的 JSON 消息
     * 典型场景: 用户觉得回答方向不对、回答太长、或发错了消息
     */
    function stopGeneration() {
        if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({type: 'stop_generation'}))
        }
    }

    // ── 暴露给组件使用的接口 ──
    // 组件通过 useGatewayStore() 获取这些状态和方法
    return {
        sessionId,
        connected,
        messages,
        status,
        createSession,
        sendMessage,
        stopGeneration
    }
})
