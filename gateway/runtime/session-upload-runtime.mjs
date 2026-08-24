/**
 * Session 上传边界。
 * 只负责上传目录的安全定位、有效性判断和清理；文件内容解析与模型路由仍由 HTTP 端口负责。
 */
export function createSessionUploadRuntime({
    safeChildPath,
    cleanupUploadDir,
    prepareUploadDir,
    statSync,
    ttlMs,
    logger = {debug() {}, warn() {}},
} = {}) {
    if (typeof safeChildPath !== 'function' || typeof cleanupUploadDir !== 'function'
        || typeof prepareUploadDir !== 'function' || typeof statSync !== 'function'
        || !Number.isFinite(ttlMs) || ttlMs <= 0) {
        throw new TypeError('session upload runtime dependencies are required')
    }

    function isValidSessionId(value) {
        return typeof value === 'string'
            && value.length >= 1
            && value.length <= 128
            && value !== '.'
            && value !== '..'
            && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
    }

    function isDirectoryPath(value) {
        if (typeof value !== 'string' || !value.trim()) return false
        try {
            return statSync(value).isDirectory()
        } catch (error) {
            if (error?.code !== 'ENOENT') logger.debug({err: error, path: value}, '检查目录失败')
            return false
        }
    }

    function getUploadDir(workDir, sessionId = 'legacy') {
        const root = safeChildPath(workDir, '.bridge-uploads', {allowNested: false})
        return root && isValidSessionId(sessionId)
            ? safeChildPath(root, sessionId, {allowNested: false})
            : null
    }

    function cleanupSessionUploads(workDir, sessionId = 'legacy', removeAll = false) {
        return cleanupUploadDir(getUploadDir(workDir, sessionId), {
            removeAll,
            ttlMs,
            onError: (error, path) => logger.debug({err: error, path}, '读取附件元数据失败'),
        })
    }

    function prepareSessionUploadDir(workDir, sessionId = 'legacy') {
        const uploadDir = getUploadDir(workDir, sessionId)
        if (!uploadDir) return null
        prepareUploadDir(uploadDir, {
            ttlMs,
            onError: (error, path) => logger.debug({err: error, path}, '读取附件元数据失败'),
        })
        return uploadDir
    }

    return {
        isValidSessionId,
        isDirectoryPath,
        getUploadDir,
        cleanupSessionUploads,
        prepareSessionUploadDir,
    }
}
