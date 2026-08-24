/**
 * 组合根使用的轻量 HTTP 路由调度器。
 * 路由只负责领域契约，调度器不持有业务状态，也不改变响应格式。
 */
export function createHttpRouter({routes = [], onError} = {}) {
    const handlers = routes.filter(route => typeof route === 'function')
    return async function dispatch(context = {}) {
        for (const route of handlers) {
            try {
                if (await route(context)) return true
            } catch (error) {
                if (typeof onError === 'function') return onError(error, context)
                throw error
            }
        }
        return false
    }
}
