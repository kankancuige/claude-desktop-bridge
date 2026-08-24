/** JSON/Markdown 配置文件端口。 */
export function createConfigFileRuntime({
    readFileSync,
    writeFileSync,
    mkdirSync,
    dirname,
    renameSync,
    unlinkSync,
    logger = {warn() {}, debug() {}},
} = {}) {
    if ([readFileSync, writeFileSync, mkdirSync, dirname, renameSync, unlinkSync].some(fn => typeof fn !== 'function')) {
        throw new TypeError('config file dependencies are required')
    }

    function readJSON(path) {
        try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
    }

    function writeJSON(path, data) {
        const tempPath = path + '.tmp'
        const json = JSON.stringify(data, null, 2)
        mkdirSync(dirname(path), {recursive: true})
        writeFileSync(tempPath, json, {encoding: 'utf8', mode: 0o600})
        try {
            renameSync(tempPath, path)
        } catch (renameError) {
            try {
                writeFileSync(path, json, {encoding: 'utf8', mode: 0o600})
            } catch (writeError) {
                try { unlinkSync(tempPath) } catch (cleanupError) { logger.warn({err: cleanupError, path: tempPath}, 'JSON 临时文件清理失败') }
                throw new AggregateError([renameError, writeError], `JSON 写入失败: ${path}`)
            }
            try { unlinkSync(tempPath) } catch (cleanupError) { logger.warn({err: cleanupError, path: tempPath}, 'JSON 临时文件清理失败') }
        }
    }

    function backupFile(path) {
        try { writeFileSync(path + '.bak', readFileSync(path)) } catch (error) { logger.debug({err: error}, '备份配置文件失败') }
    }

    function parseFrontmatter(content) {
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
        if (!match) return {frontmatter: {}, body: content}
        const frontmatter = {}
        for (const line of match[1].split('\n')) {
            const colon = line.indexOf(':')
            if (colon > 0) frontmatter[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
        }
        return {frontmatter, body: content.slice(match[0].length).trim()}
    }

    return {readJSON, writeJSON, backupFile, parseFrontmatter}
}
