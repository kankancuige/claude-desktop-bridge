/**
 * 项目缓存运行时。
 *
 * 项目扫描和缓存构建属于后台资源生命周期，不应阻塞 Session 创建；
 * 这里提供单项目去重、空闲延迟和失败清理契约。
 */
export function createProjectRuntime({
    cacheFilePath,
    exists = () => false,
    buildCache,
    saveCache,
    logger = {warn() {}},
    idleDelayMs = 1_500,
    unrefTimers = true,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
} = {}) {
    if (typeof cacheFilePath !== 'function' || typeof buildCache !== 'function' || typeof saveCache !== 'function') {
        throw new TypeError('project cache functions are required')
    }
    const builds = new Map()

    function schedule(workDir) {
        const path = cacheFilePath(workDir)
        if (!path || exists(path) || builds.has(workDir)) return builds.get(workDir) || null
        let timer
        const job = new Promise(resolve => {
            timer = setTimeoutFn(resolve, idleDelayMs)
            if (unrefTimers) timer?.unref?.()
        })
            .then(() => buildCache(workDir))
            .then(cache => {
                if (cache) saveCache(workDir, cache)
                return cache
            })
            .catch(error => {
                logger.warn({err: error, workDir}, '后台 project-cache 构建失败')
                return null
            })
            .finally(() => {
                if (timer) clearTimeoutFn(timer)
                builds.delete(workDir)
            })
        builds.set(workDir, job)
        return job
    }

    return {schedule, builds}
}
