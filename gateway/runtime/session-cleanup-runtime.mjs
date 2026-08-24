import {join} from 'node:path'

/** Session transcript 头读取和启动清理端口。 */
export function createSessionCleanupRuntime({
    bridgeHome,
    readdirSync,
    statSync,
    existsSync,
    unlinkSync,
    rmSync,
    openSync,
    readSync,
    closeSync,
    logger = {debug() {}, warn() {}, info() {}},
} = {}) {
    if (!bridgeHome || [readdirSync, statSync, existsSync, unlinkSync, rmSync, openSync, readSync, closeSync].some(fn => typeof fn !== 'function')) {
        throw new TypeError('session cleanup dependencies are required')
    }

    function readFileHeadLines(path, maxBytes = 4096) {
        const fd = openSync(path, 'r')
        try {
            const buffer = Buffer.alloc(maxBytes)
            const count = readSync(fd, buffer, 0, maxBytes, 0)
            const text = buffer.toString('utf8', 0, count)
            const lastNewline = text.lastIndexOf('\n')
            return (lastNewline >= 0 ? text.slice(0, lastNewline) : text).split('\n')
        } finally {
            closeSync(fd)
        }
    }

    function cleanupOrphanSessionDirs() {
        const projectsDir = join(bridgeHome, 'projects')
        let cleaned = 0
        try {
            for (const projectEntry of readdirSync(projectsDir)) {
                const projectDir = join(projectsDir, projectEntry)
                try {
                    if (!statSync(projectDir).isDirectory()) continue
                    for (const entry of readdirSync(projectDir)) {
                        if (entry.endsWith('.jsonl') || entry.startsWith('.trash-') || entry === 'bridge-session-map.json'
                            || entry === 'bridge-session-visibility.json' || entry === 'bridge-snapshot'
                            || entry === 'bridge-checkpoints' || entry === 'bridge-task-state' || entry === 'bridge-session-events'
                            || entry === 'bridge-deleted-sessions.json' || entry === 'bridge-scheduled-tasks.json'
                            || entry === 'bridge-workflow-history.jsonl' || entry === 'bridge-config.json') continue
                        const entryPath = join(projectDir, entry)
                        try {
                            if (!statSync(entryPath).isDirectory()) continue
                            const subagentsDir = join(entryPath, 'subagents')
                            const mainJsonl = join(projectDir, entry + '.jsonl')
                            if (!existsSync(subagentsDir) || existsSync(mainJsonl)) continue
                            rmSync(entryPath, {recursive: true, force: true})
                            const trashJsonl = join(projectDir, '.trash-' + entry + '.jsonl')
                            try {
                                if (existsSync(trashJsonl)) unlinkSync(trashJsonl)
                            } catch (error) {
                                logger.debug({err: error, path: trashJsonl}, '清理幽灵 Session trash 文件失败')
                            }
                            cleaned++
                        } catch (error) {
                            logger.debug({err: error, path: entryPath}, '检查幽灵 Session 目录失败')
                        }
                    }
                } catch (error) {
                    logger.debug({err: error, projectDir}, '扫描项目 Session 目录失败')
                }
            }
        } catch (error) {
            if (error?.code !== 'ENOENT') logger.warn({err: error, projectsDir}, '启动时扫描幽灵 Session 失败')
        }
        if (cleaned > 0) logger.info({cleaned}, '启动时清理幽灵 session 目录')
        return {cleaned}
    }

    return {readFileHeadLines, cleanupOrphanSessionDirs}
}
