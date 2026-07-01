/**
 * Claude Desktop Bridge — 统一日志模块
 * 基于 pino + pino-roll，提供结构化 JSON 日志、按天+按大小自动分包、sessionId 上下文。
 *
 * 用法:
 *   import { createLogger } from './logger.mjs'
 *   const log = createLogger('gateway')
 *   log.info({ sessionId: 'abc' }, 'session 已创建')
 *   const child = log.child({ sessionId: 'abc' })
 *   child.warn({ err }, 'pump 异常')
 *
 * 环境变量:
 *   LOG_LEVEL=trace|debug|info|warn|error|fatal  默认: info
 *   LOG_DIR=/path/to/logs                         默认: gateway/bridge-logs/
 *   LOG_PRETTY=1                                  强制美化（非 TTY 环境调试用）
 *   LOG_MAX_SIZE=10m                              单文件最大体积（默认 10m，支持 k/m/g）
 *   LOG_RETAIN_DAYS=30                            日志保留天数（默认 30 天）
 */

import pino from 'pino'
import {join} from 'node:path'

const LOG_DIR = process.env.LOG_DIR || join(process.cwd(), 'bridge-logs')
const LOG_LEVEL = process.env.LOG_LEVEL || 'info'
const LOG_MAX_SIZE = process.env.LOG_MAX_SIZE || '10m'
const LOG_RETAIN_DAYS = parseInt(process.env.LOG_RETAIN_DAYS || '30', 10)
const IS_PRETTY = process.env.LOG_PRETTY === '1' || (process.stdout?.isTTY && !process.env.LOG_PRETTY)

// 日志级别映射
const LEVEL_MAP = {trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60}

// ── 多流: 控制台（美化）+ 文件（JSON，按天+按大小分包）──
// pino-roll v4 通过 pino.transport() worker 加载，避免 async 初始化问题
function buildStreams(name) {
    const streams = []

    // 控制台流 — 按 LOG_LEVEL 过滤，pino-pretty 美化
    if (IS_PRETTY) {
        streams.push({
            level: LOG_LEVEL,
            stream: pino.transport({
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'yyyy-mm-dd HH:MM:ss.l',
                    ignore: 'pid,hostname,module',
                    messageFormat: '[{module}] {msg}',
                    levelFirst: true,
                },
            }),
        })
    } else {
        streams.push({level: LOG_LEVEL, stream: process.stdout})
    }

    // 全量文件 — pino-roll v4 按天+按大小分包，JSON 格式
    // 输出: all.2026-06-26.1.log, all.2026-06-26.2.log ...
    try {
        streams.push({
            level: 'debug',
            stream: pino.transport({
                target: 'pino-roll',
                options: {
                    file: join(LOG_DIR, 'all.log'),
                    frequency: 'daily',
                    dateFormat: 'yyyy-MM-dd',
                    size: LOG_MAX_SIZE,
                    limit: {count: LOG_RETAIN_DAYS},
                    mkdir: true,
                },
            }),
        })
    } catch (e) {
        console.warn('[logger] pino-roll 全量日志流创建失败，文件日志将不可用:', e.message || e)
    }

    // 错误文件 — error 级别单独分包
    // 输出: error.2026-06-26.1.log, error.2026-06-26.2.log ...
    try {
        streams.push({
            level: 'error',
            stream: pino.transport({
                target: 'pino-roll',
                options: {
                    file: join(LOG_DIR, 'error.log'),
                    frequency: 'daily',
                    dateFormat: 'yyyy-MM-dd',
                    size: LOG_MAX_SIZE,
                    limit: {count: LOG_RETAIN_DAYS},
                    mkdir: true,
                },
            }),
        })
    } catch (e) {
        console.warn('[logger] pino-roll 错误日志流创建失败:', e.message || e)
    }

    return streams
}

// ── Logger 缓存: 同 name 复用 logger 实例 ──
const _cache = new Map()

/**
 * 创建或复用指定模块的 logger。
 * @param {string} name - 模块名（如 'gateway', 'wechat', 'workflow'）
 * @param {object} [bindings] - 额外的固定绑定字段
 * @returns {import('pino').Logger}
 */
export function createLogger(name, bindings = {}) {
    if (_cache.has(name)) {
        // 同名已缓存，用 child 追加 bindings
        return _cache.get(name).child(bindings)
    }

    const logger = pino({
        name,
        level: LOG_LEVEL,
        serializers: {
            err: pino.stdSerializers.err, // 完整堆栈序列化
            error: pino.stdSerializers.err,
            req: pino.stdSerializers.req,
            res: pino.stdSerializers.res,
        },
        formatters: {
            level(label) {
                return {level: label}
            },
            bindings(bindings) {
                return {pid: bindings.pid, module: bindings.name}
            },
        },
        mixin() {
            return {}
        },
    }, pino.multistream(buildStreams(name)))

    _cache.set(name, logger)
    return logger.child(bindings)
}

/**
 * 带 sessionId 的快捷 logger 创建。
 * @param {string} name - 模块名
 * @param {string} sessionId
 * @returns {import('pino').Logger}
 */
export function sessionLogger(name, sessionId) {
    return createLogger(name, {sessionId: sessionId?.slice(0, 8)})
}

/**
 * HTTP 请求日志 express/vanilla 中间件风格。
 * 包裹在 createServer 回调中手动调用，记录 method/path/status/duration/remoteIP。
 * @param {import('pino').Logger} log
 * @param {object} req - http.IncomingMessage
 * @param {number} statusCode
 * @param {number} startTime - Date.now() 的起始值
 */
export function logHttpRequest(log, req, statusCode, startTime) {
    const dur = Date.now() - startTime
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)
    log.info({
        method: req.method,
        path: url.pathname,
        status: statusCode,
        duration_ms: dur,
        remote_ip: req.socket?.remoteAddress,
    }, `${req.method} ${url.pathname} ${statusCode} ${dur}ms`)
}

export {LEVEL_MAP}
