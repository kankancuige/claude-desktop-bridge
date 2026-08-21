import {Script} from 'node:vm'

export function stripWorkflowExports(source) {
    let scriptBody = String(source || '')
    const metaMatch = /export\s+const\s+meta\s*=\s*\{/.exec(scriptBody)
    if (metaMatch) {
        let depth = 0
        let quote = ''
        let closeIndex = -1
        const openIndex = scriptBody.indexOf('{', metaMatch.index)
        for (let index = openIndex; index < scriptBody.length; index++) {
            const char = scriptBody[index]
            if (quote) {
                if (char === '\\') index++
                else if (char === quote) quote = ''
                continue
            }
            if (char === '"' || char === "'" || char === '`') {
                quote = char
                continue
            }
            if (char === '{') depth++
            else if (char === '}' && --depth === 0) {
                closeIndex = index
                break
            }
        }
        if (closeIndex >= 0) {
            let end = closeIndex + 1
            while (end < scriptBody.length && /[;\r\n]/.test(scriptBody[end])) end++
            scriptBody = scriptBody.slice(0, metaMatch.index) + scriptBody.slice(end)
        }
    }
    return scriptBody.replace(/^\s*export\s+/gm, '')
}

export function validateWorkflowSyntax(source, {filename = 'workflow.mjs'} = {}) {
    const scriptBody = stripWorkflowExports(source)
    new Script(`(async () => { ${scriptBody}\n })`, {filename, displayErrors: true})
    return true
}
