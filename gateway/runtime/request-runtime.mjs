const CHILD_ENV_KEYS = [
    'PATH', 'Path', 'PATHEXT', 'ComSpec', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP',
    'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'LANG', 'LC_ALL', 'TZ',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS',
]

/** HTTP 请求、项目路径和子进程输入边界。 */
export function createRequestRuntime({
    imSources = new Set(),
    childEnv = process.env,
    maxBodyBytes = 10_000_000,
    maxMultipartBytes = 10_000_000,
    maxUploadFileBytes = 8 * 1024 * 1024,
} = {}) {
    function decodeProjectName(value) {
        const match = String(value || '').match(/^([a-zA-Z])--(.+)$/)
        return match ? `${match[1]}:/${match[2].replace(/-/g, '/')}` : null
    }

    function normalizeWorkDir(value) {
        if (typeof value !== 'string' || !value.trim()) return ''
        const slashPath = value.trim().replace(/\\/g, '/')
        const isUnc = slashPath.startsWith('//')
        let normalized = slashPath.replace(/\/+/g, '/')
        if (isUnc) normalized = `//${normalized.replace(/^\/+/, '')}`
        if (normalized === '/' || /^[A-Za-z]:\/$/.test(normalized)) return normalized
        return normalized.replace(/\/+$/, '')
    }

    function encodeProjectName(value) {
        const normalized = normalizeWorkDir(value)
        const drive = normalized.match(/^([a-zA-Z]):\/(.*)$/)
        return drive ? `${drive[1]}--${drive[2].replace(/\//g, '-')}` : normalized.replace(/\//g, '-')
    }

    function readBody(req) {
        return new Promise(resolve => {
            const chunks = []
            let totalBytes = 0
            let settled = false
            const cleanup = () => {
                req.removeListener('data', onData); req.removeListener('end', onEnd)
                req.removeListener('error', onError); req.removeListener('aborted', onAborted)
            }
            const settle = value => { if (settled) return; settled = true; cleanup(); resolve(value) }
            const onData = chunk => {
                totalBytes += chunk.length
                if (totalBytes > maxBodyBytes) { req.resume(); settle({_bodyTooLarge: true}); return }
                chunks.push(chunk)
            }
            const onEnd = () => {
                try { settle(JSON.parse(chunks.length ? Buffer.concat(chunks).toString('utf8') : '{}')) }
                catch { settle({_parseError: true}) }
            }
            const onError = () => settle({_bodyError: true})
            const onAborted = () => settle({_bodyError: true})
            req.on('data', onData); req.on('end', onEnd); req.on('error', onError); req.on('aborted', onAborted)
        })
    }

    function parseMultipart(req) {
        return new Promise((resolve, reject) => {
            const chunks = []
            let totalLength = 0
            let settled = false
            const cleanup = () => {
                req.removeListener('data', onData); req.removeListener('end', onEnd)
                req.removeListener('error', onError); req.removeListener('aborted', onAborted)
            }
            const done = (error, value) => {
                if (settled) return
                settled = true; cleanup(); error ? reject(error) : resolve(value)
            }
            const onData = chunk => {
                totalLength += chunk.length
                if (totalLength > maxMultipartBytes) { req.resume(); done(new Error('upload too large')); return }
                chunks.push(chunk)
            }
            const onEnd = () => {
                try {
                    const buffer = Buffer.concat(chunks)
                    const contentType = req.headers['content-type'] || ''
                    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)
                    if (!boundaryMatch) { done(null, {fields: {}, files: {}}); return }
                    const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`)
                    const fields = {}, files = {}
                    let position = buffer.indexOf(boundary)
                    while (position !== -1) {
                        position += boundary.length
                        const next = buffer.indexOf(boundary, position)
                        if (next === -1) break
                        const part = buffer.slice(position, next)
                        const trimmed = part.length >= 2 && part.at(-2) === 13 && part.at(-1) === 10 ? part.slice(0, -2) : part
                        const headerEnd = trimmed.indexOf('\r\n\r\n')
                        if (headerEnd === -1) { position = next; continue }
                        const headerText = trimmed.slice(0, headerEnd).toString()
                        const body = trimmed.slice(headerEnd + 4)
                        const bodyContent = body.length >= 2 && body.at(-2) === 13 && body.at(-1) === 10 ? body.slice(0, -2) : body
                        const name = headerText.match(/name="([^"]+)"/)?.[1]
                        const filename = headerText.match(/filename="([^"]+)"/)?.[1]
                        if (name) {
                            if (filename) {
                                if (bodyContent.length > maxUploadFileBytes) throw new Error('file too large')
                                files[name] = {filename, data: bodyContent,
                                    contentType: headerText.match(/Content-Type:\s*([^\s;]+)/i)?.[1] || 'application/octet-stream'}
                            } else fields[name] = bodyContent.toString()
                        }
                        position = next
                    }
                    done(null, {fields, files})
                } catch (error) { done(error) }
            }
            const onError = error => done(error)
            const onAborted = () => done(new Error('upload aborted'))
            req.on('data', onData); req.on('end', onEnd); req.on('error', onError); req.on('aborted', onAborted)
        })
    }

    function sanitizeMcpServers(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
        const output = {}
        for (const [name, raw] of Object.entries(input)) {
            if (!/^[a-zA-Z0-9._-]{1,64}$/.test(name) || !raw || typeof raw !== 'object') continue
            const transport = raw.type || raw.transport || 'stdio'
            if (!['stdio', 'sse', 'http'].includes(transport)) continue
            if (transport === 'stdio') {
                if (typeof raw.command !== 'string' || !raw.command || raw.command.length > 2048 || /[\0\r\n]/.test(raw.command)) continue
                const args = Array.isArray(raw.args) ? raw.args : []
                if (args.length > 100 || args.some(arg => typeof arg !== 'string' || arg.length > 4096 || /[\0\r\n]/.test(arg))) continue
                const env = {}
                for (const [key, value] of Object.entries(raw.env || {})) {
                    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string' && value.length <= 4096
                        && !/[\0\r\n]/.test(value) && !['BRIDGE_TOKEN', 'BRIDGE_ALLOW_TOKEN_ENDPOINT', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'].includes(key)) env[key] = value
                }
                output[name] = {type: 'stdio', command: raw.command, args,
                    ...(Object.keys(env).length ? {env} : {}), ...(raw.enabled === false ? {enabled: false} : {})}
                continue
            }
            let parsedUrl
            try { parsedUrl = new URL(raw.url) } catch { continue }
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) continue
            const headers = {}
            for (const [key, value] of Object.entries(raw.headers || {})) {
                if (key.toLowerCase() !== 'x-bridge-token' && /^[\x21-\x7e]{1,128}$/.test(key)
                    && typeof value === 'string' && value.length <= 4096 && !/[\0\r\n]/.test(value)) headers[key] = value
            }
            output[name] = {type: transport, url: raw.url,
                ...(Object.keys(headers).length ? {headers} : {}), ...(raw.enabled === false ? {enabled: false} : {})}
        }
        return Object.keys(output).length ? output : undefined
    }

    function buildChildProcessEnv() {
        return Object.fromEntries(CHILD_ENV_KEYS.filter(key => typeof childEnv[key] === 'string' && childEnv[key]).map(key => [key, childEnv[key]]))
    }

    function getAdapterIdentity(req) {
        const source = req.headers['x-bridge-source']
        const userId = req.headers['x-bridge-user-id']
        if (typeof source !== 'string' || typeof userId !== 'string' || !imSources.has(source)
            || !userId || userId.length > 512 || /[\0\r\n]/.test(userId)) return null
        return {source, userId}
    }

    function adapterRouteAllowed(method, pathname) {
        if (method === 'POST' && ['/api/confirm', '/api/sessions/resolve', '/api/desktop/nudge', '/api/mirror', '/api/sessions-by-label'].includes(pathname)) return true
        if (method === 'GET' && ['/api/sessions/focused', '/api/projects'].includes(pathname)) return true
        return method === 'GET' && /^\/api\/sessions\/[^/]+\/mirror$/.test(pathname)
    }

    return {CHILD_ENV_KEYS, decodeProjectName, normalizeWorkDir, encodeProjectName, readBody, parseMultipart,
        sanitizeMcpServers, buildChildProcessEnv, getAdapterIdentity, adapterRouteAllowed}
}
