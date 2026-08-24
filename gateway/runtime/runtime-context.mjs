/**
 * Gateway Runtime 的命名端口上下文。
 * 组合根可以组装端口，但业务 Runtime 只接收领域分组，避免继续扩张扁平依赖对象。
 */
export function createRuntimeContext({
    session,
    task,
    storage,
    workflow,
    notification,
    http,
    lifecycle,
} = {}) {
    const ports = {session, task, storage, workflow, notification, http, lifecycle}
    for (const [name, value] of Object.entries(ports)) {
        if (value !== undefined && (value === null || typeof value !== 'object')) {
            throw new TypeError(`runtime context port ${name} must be an object`)
        }
    }
    return Object.freeze(Object.fromEntries(Object.entries(ports).map(([name, value]) => [
        name, value ? Object.freeze({...value}) : Object.freeze({}),
    ])))
}

export function assertRuntimePort(port, methods = []) {
    if (!port || typeof port !== 'object') throw new TypeError('runtime port is required')
    for (const method of methods) if (typeof port[method] !== 'function') throw new TypeError(`runtime port method ${method} is required`)
    return port
}
