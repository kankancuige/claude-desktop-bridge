import {readFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'

if (process.env.BRIDGE_RUN_MANUAL_WECHAT_DELIVERY_ACCEPTANCE !== '1') {
    throw new Error('Set BRIDGE_RUN_MANUAL_WECHAT_DELIVERY_ACCEPTANCE=1 to send the authorized WeChat delivery acceptance message')
}

const bridgeHome = process.env.BRIDGE_HOME || join(homedir(), '.claude-desktop-bridge')
const paired = JSON.parse(readFileSync(join(bridgeHome, 'bridge-paired.json'), 'utf8'))
const userId = Array.isArray(paired?.users) ? paired.users[0] : ''
const token = readFileSync(join(bridgeHome, 'bridge-token'), 'utf8').trim()
if (!userId || !token) throw new Error('paired WeChat recipient or local bridge token is unavailable')

const response = await fetch('http://127.0.0.1:3456/api/wechat/send', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'x-bridge-token': token},
    body: JSON.stringify({
        userId,
        text: `Bridge 微信送达验收 ${new Date().toISOString()}，无需回复。`,
    }),
    signal: AbortSignal.timeout(15_000),
})
const body = await response.json().catch(() => ({}))
console.log(JSON.stringify({
    httpStatus: response.status,
    sent: body.sent === true,
    queued: body.queued === true,
    parts: Number.isSafeInteger(body.parts) ? body.parts : 0,
    error: typeof body.error === 'string' ? body.error.slice(0, 120) : '',
}))

if (!response.ok || body.sent !== true) process.exitCode = 1
