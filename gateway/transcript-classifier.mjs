import {closeSync, openSync, readSync} from 'node:fs'

const DEFAULT_MAX_BYTES = 256 * 1024
const DEFAULT_MAX_RECORDS = 64

export function classifyTranscriptLines(lines, maxRecords = DEFAULT_MAX_RECORDS) {
    let parsedRecords = 0
    let sawAgentMarker = false

    for (const line of lines) {
        if (!line?.trim()) continue
        let record
        try {
            record = JSON.parse(line)
        } catch (error) {
            if (!(error instanceof SyntaxError)) throw error
            continue
        }

        parsedRecords++
        // 主会话可能包含 agentId，因为它可以调用 Agent 工具。显式根会话标记优先。
        if (record?.isSidechain === false) return 'main'
        if (record?.isSidechain === true) sawAgentMarker = true
        if (parsedRecords >= maxRecords) break
    }

    return sawAgentMarker ? 'agent' : 'unknown'
}

export function classifyTranscriptFile(filePath, maxBytes = DEFAULT_MAX_BYTES) {
    let fd
    try {
        fd = openSync(filePath, 'r')
        const buffer = Buffer.allocUnsafe(maxBytes)
        const bytesRead = readSync(fd, buffer, 0, maxBytes, 0)
        return classifyTranscriptLines(buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n/))
    } catch {
        return 'unknown'
    } finally {
        if (fd !== undefined) closeSync(fd)
    }
}
