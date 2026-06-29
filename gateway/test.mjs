/**
 * Gateway 集成测试 — 完整生命周期验证
 * ── 功能说明 ──
 * 端到端测试 Gateway 的核心链路: 创建 session → WebSocket 连接 → 发送消息 → 流式接收回复
 * 用法: node test.mjs
 *
 * ── 测试覆盖 ──
 *   1. HTTP POST /api/sessions 创建会话
 *   2. WebSocket /ws/:sessionId 建立双向通道
 *   3. user_message 发送 + assistant_message / text_delta / result 接收
 *   4. 30 秒超时保护，防止 WS 假死导致进程挂起
 *
 * ── 依赖 ──
 *   - ws: WebSocket 客户端库 (npm i ws)
 *   - Gateway 需已在 127.0.0.1:3456 运行
 */
import WebSocket from 'ws'

const BASE = 'http://127.0.0.1:3456'

// ═══════════════════════════════════════════
// ── Step 1: 创建 session ──
// 功能说明: 向 Gateway HTTP API 发起 POST 请求创建新会话
// 实现方式: POST /api/sessions，body 携带 workDir 指定工作目录
//   成功返回 { sessionId }，失败则 crash（测试脚本不吞异常）
// ═══════════════════════════════════════════
const createRes = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({workDir: 'D:/ckd/Code/znzpxt-vue3-new'}),
})
const {sessionId} = await createRes.json()
console.log(`✅ Session created: ${sessionId}`)

// ═══════════════════════════════════════════
// ── Step 2: 建立 WebSocket 连接 ──
// 功能说明: 连接到 Gateway WS 端点，建立双向消息通道
// 实现方式: new WebSocket(url) → onopen 触发后发送测试消息
// 关键数据流: WS 连接 → send(user_message) → onmessage 事件流 → result → exit
// ═══════════════════════════════════════════
const ws = new WebSocket(`ws://127.0.0.1:3456/ws/${sessionId}`)

// ── 连接成功 → 发送测试消息 ──
ws.on('open', () => {
    console.log('✅ WS connected, sending message...')
    // 发送一条简单的英文问候，验证 Claude 回复能力
    ws.send(JSON.stringify({type: 'user_message', content: 'Say hello in Chinese, one sentence only.'}))
})

// ── 消息接收 ──
// 功能说明: 解析 Gateway WS 推送的各种事件类型并打印调试信息
// 事件类型:
//   - text_delta: 流式文本增量片段 → 实时打印到 stdout（不换行）
//   - assistant_message: 完整 assistant 消息块 → 提取 text blocks 打印
//   - result: 回合完成 → 打印回合数/耗时/token 用量并退出
//   - error: Gateway 返回的错误 → 打印并退出(1)
//   - status/pong: 心跳/状态消息 → 跳过不打印（减少噪音）
ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    // 心跳和状态消息跳过，避免刷屏
    if (msg.type !== 'status' && msg.type !== 'pong') {
        const preview = JSON.stringify(msg).slice(0, 200)
        console.log(`  ← [${msg.type}] ${preview}`)
    }
    // 流式文本增量 → 实时输出，模拟打字机效果
    if (msg.type === 'text_delta') {
        process.stdout.write(msg.text || '')
    }
    // 完整 assistant 消息 → 提取 text 内容展示
    if (msg.type === 'assistant_message') {
        const text = msg.message?.content?.find?.(b => b.type === 'text')?.text
        if (text) console.log('\n📝 Assistant:', text.slice(0, 200))
    }
    // 回合完成 → 打印统计信息并正常退出
    if (msg.type === 'result') {
        console.log(`\n✅ Result: ${msg.subtype}, turns=${msg.num_turns}, duration=${msg.duration_ms}ms`)
        if (msg.usage) console.log(`   Usage: in=${msg.usage.input_tokens} out=${msg.usage.output_tokens}`)
        process.exit(0)
    }
    // 错误 → 打印并异常退出
    if (msg.type === 'error') {
        console.log(`\n❌ Error: ${msg.message}`)
        process.exit(1)
    }
})

// ── WS 连接异常 ──
// 功能说明: WebSocket 层级错误（网络不通、Gateway 未启动等）
// 实现方式: 直接打印错误信息并退出(1)，不重试
ws.on('error', (err) => {
    console.error('WS error:', err.message)
    process.exit(1)
})

// ═══════════════════════════════════════════
// ── 30 秒超时保护 ──
// 功能说明: 防止 WS 假死或 Gateway 无响应导致进程永久挂起
// 实现方式: setTimeout 30s → 打印超时提示并强制退出(1)
//   正常流程中 result 事件会先触发 process.exit(0)，此定时器不会执行
// ═══════════════════════════════════════════
setTimeout(() => {
    console.log('\n⏰ Timeout');
    process.exit(1)
}, 30000)
