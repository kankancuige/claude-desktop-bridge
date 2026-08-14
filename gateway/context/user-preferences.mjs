import crypto from 'node:crypto'
import {existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'

const STORE_VERSION = 1
const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

const DEFINITIONS = [
    {
        id: 'encoding.utf8',
        key: 'encoding',
        value: 'utf-8',
        label: '文本文件使用 UTF-8 编码',
        detect: text => /(?:(?:统一|始终|一直|以后|每次|默认|必须|请).{0,10}utf-?8|(?:使用|采用|保存为|保持|统一为)\s*utf-?8)(?:\s*编码)?/i.test(text)
            && !/(?:不要|禁止|不再|不能).{0,12}utf-?8/i.test(text),
        relevant: text => actionTask(text) && /代码|文件|文档|注释|编码|修改|实现|修复|新增|创建|生成|写入|保存|edit|write|patch|code/i.test(text),
        overridden: text => /(?:使用|采用|保存为|改成).{0,12}(?:gbk|ansi|utf-?16)/i.test(text)
            || /(?:不要|禁止|不能).{0,12}utf-?8/i.test(text),
    },
    {
        id: 'comments.chinese',
        key: 'comments',
        value: 'zh-cn',
        label: '代码注释使用简体中文',
        detect: text => /中文注释|注释.{0,8}(?:使用|采用|统一为|改成)简体?中文|使用简体?中文.{0,6}注释/i.test(text),
        relevant: text => actionTask(text) && /代码|注释|实现|修改|修复|新增|重构|code|comment/i.test(text),
        overridden: text => /(?:注释).{0,10}(?:使用|采用|改成)英文|英文注释/i.test(text),
    },
    {
        id: 'git.no_auto_commit',
        key: 'git.autoCommit',
        value: false,
        label: '未经明确要求不执行 Git commit 或 push',
        detect: text => /(?:不要|禁止|不许|无需|不用)(?:自动|擅自)?\s*(?:git\s*)?(?:提交|commit|push)/i.test(text),
        relevant: text => actionTask(text) && /代码|项目|仓库|文件|修改|实现|修复|新增|重构|git|commit|push/i.test(text),
        overridden: text => positiveCommitRequest(text),
    },
    {
        id: 'notification.after_verification',
        key: 'notification.timing',
        value: 'after-verification',
        label: '验证完成后再发送任务完成通知',
        detect: text => /(?:测试|验证|验收)(?:完成|通过|成功)(?:后|再).{0,16}(?:通知|回复|告诉)|(?:通知|回复|告诉).{0,16}(?:测试|验证|验收)(?:完成|通过|成功)/i.test(text),
        relevant: text => actionTask(text),
        overridden: text => /(?:无需|不用|不要)(?:等待)?(?:测试|验证|验收).{0,12}(?:通知|回复)|立即通知/i.test(text),
    },
]

function actionTask(text) {
    return /修改|实现|修复|新增|创建|生成|写入|保存|重构|提交|发布|部署|测试|验证|检查并修复|edit|write|patch|implement|fix|create|commit|push|deploy/i.test(text)
}

function positiveCommitRequest(text) {
    if (!/(?:提交|commit|push)/i.test(text)) return false
    return !/(?:不要|禁止|不许|无需|不用|别)(?:自动|擅自)?\s*(?:git\s*)?(?:提交|commit|push)/i.test(text)
}

function emptyStore() {
    return {version: STORE_VERSION, candidates: {}, preferences: {}, dismissed: {}}
}

function normalizeStore(raw) {
    if (!raw || typeof raw !== 'object') return emptyStore()
    return {
        version: STORE_VERSION,
        candidates: raw.candidates && typeof raw.candidates === 'object' ? raw.candidates : {},
        preferences: raw.preferences && typeof raw.preferences === 'object' ? raw.preferences : {},
        dismissed: raw.dismissed && typeof raw.dismissed === 'object' ? raw.dismissed : {},
    }
}

function projectKey(workDir) {
    const normalized = String(workDir || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
    const drive = normalized.match(/^([a-zA-Z]):\/(.*)$/)
    return drive ? `${drive[1]}--${drive[2].replace(/\//g, '-')}` : normalized.replace(/\//g, '-')
}

function safeTaskHash(source, taskId) {
    return crypto.createHash('sha256').update(`${source || 'desktop'}\0${taskId || ''}`).digest('hex').slice(0, 24)
}

function publicSuggestion(candidate) {
    return {
        id: candidate.id,
        label: candidate.label,
        occurrences: Array.isArray(candidate.occurrences) ? candidate.occurrences.length : 0,
        firstSeenAt: candidate.firstSeenAt || 0,
        lastSeenAt: candidate.lastSeenAt || 0,
        scopeOptions: ['project', 'global'],
    }
}

export function detectPreferenceCandidates(text) {
    const safeText = typeof text === 'string' ? text.slice(0, 20_000) : ''
    return DEFINITIONS.filter(definition => definition.detect(safeText)).map(definition => ({
        id: definition.id,
        key: definition.key,
        value: definition.value,
        label: definition.label,
    }))
}

export function createUserPreferenceService({claudeHome, threshold = 2, windowMs = DEFAULT_WINDOW_MS, now = () => Date.now(), onWarning = () => {}} = {}) {
    if (!claudeHome) throw new Error('claudeHome is required')
    const globalPath = join(claudeHome, 'bridge-preferences.json')

    function projectPath(workDir) {
        return join(claudeHome, 'projects', projectKey(workDir), 'bridge-preferences.json')
    }

    function readStore(path) {
        if (!existsSync(path)) return emptyStore()
        try {
            return normalizeStore(JSON.parse(readFileSync(path, 'utf8')))
        } catch (error) {
            // 损坏文件单独隔离，避免偏好功能阻断正常任务。
            try {
                renameSync(path, `${path}.corrupt-${now()}`)
            } catch (renameError) {
                onWarning(renameError, {operation: 'quarantine', path})
            }
            onWarning(error, {operation: 'read', path})
            return emptyStore()
        }
    }

    function writeStore(path, store) {
        mkdirSync(dirname(path), {recursive: true})
        const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
        writeFileSync(temp, JSON.stringify(normalizeStore(store), null, 2), 'utf8')
        renameSync(temp, path)
    }

    function effectivePreference(workDir, id) {
        const project = readStore(projectPath(workDir)).preferences[id]
        if (project) return project
        return readStore(globalPath).preferences[id] || null
    }

    function observe({projectDir, taskId, sessionId, source = 'desktop', text}) {
        if (!projectDir || !text) return []
        const matches = detectPreferenceCandidates(text)
        if (matches.length === 0) return []
        const path = projectPath(projectDir)
        const store = readStore(path)
        const timestamp = now()
        const identity = safeTaskHash(source, taskId || sessionId)
        const suggestions = []
        let changed = false

        for (const match of matches) {
            const savedPreference = effectivePreference(projectDir, match.id)
            if (store.dismissed[match.id] || (savedPreference && savedPreference.enabled !== false)) continue
            const existing = store.candidates[match.id] || {...match, occurrences: [], firstSeenAt: timestamp}
            const recent = Array.isArray(existing.occurrences)
                ? existing.occurrences.filter(item => item && timestamp - Number(item.at || 0) <= windowMs)
                : []
            if (!recent.some(item => item.taskHash === identity)) {
                recent.push({taskHash: identity, at: timestamp})
                changed = true
            }
            existing.occurrences = recent
            existing.lastSeenAt = timestamp
            existing.pending = recent.length >= threshold
            store.candidates[match.id] = existing
            if (existing.pending) suggestions.push(publicSuggestion(existing))
        }
        if (changed) writeStore(path, store)
        return suggestions
    }

    function pending(projectDir) {
        if (!projectDir) return []
        const store = readStore(projectPath(projectDir))
        return Object.values(store.candidates).filter(item => item?.pending === true).map(publicSuggestion)
    }

    function respond({projectDir, suggestionId, action}) {
        const definition = DEFINITIONS.find(item => item.id === suggestionId)
        if (!definition || !projectDir || !['project', 'global', 'once', 'dismiss'].includes(action)) {
            throw Object.assign(new Error('invalid preference response'), {code: 'INVALID_PREFERENCE_RESPONSE'})
        }
        const path = projectPath(projectDir)
        const projectStore = readStore(path)
        const candidate = projectStore.candidates[suggestionId]
        if (!candidate?.pending) throw Object.assign(new Error('preference suggestion not found'), {code: 'PREFERENCE_SUGGESTION_NOT_FOUND'})

        if (action === 'project' || action === 'global') {
            const targetPath = action === 'global' ? globalPath : path
            const target = action === 'global' ? readStore(targetPath) : projectStore
            target.preferences[suggestionId] = {
                id: definition.id,
                key: definition.key,
                value: definition.value,
                label: definition.label,
                scope: action,
                source: 'user_confirmed',
                occurrences: candidate.occurrences.length,
                firstSeenAt: candidate.firstSeenAt || now(),
                lastSeenAt: candidate.lastSeenAt || now(),
                updatedAt: now(),
                enabled: true,
            }
            delete projectStore.candidates[suggestionId]
            if (target === projectStore) writeStore(path, projectStore)
            else {
                writeStore(targetPath, target)
                writeStore(path, projectStore)
            }
        } else {
            delete projectStore.candidates[suggestionId]
            if (action === 'dismiss') projectStore.dismissed[suggestionId] = {dismissedAt: now()}
            writeStore(path, projectStore)
        }
        return {ok: true, action, suggestionId}
    }

    function relevant(projectDir, text) {
        if (!projectDir || !text) return []
        const global = readStore(globalPath).preferences
        const project = readStore(projectPath(projectDir)).preferences
        const merged = {...global, ...project}
        return DEFINITIONS.flatMap(definition => {
            const preference = merged[definition.id]
            if (!preference || preference.enabled === false || !definition.relevant(text) || definition.overridden(text)) return []
            return [preference]
        })
    }

    function inject(projectDir, text, relevanceText = text) {
        const preferences = relevant(projectDir, relevanceText)
        if (preferences.length === 0) return text
        const rules = preferences.map(item => `- ${item.label}`).join('\n')
        return `[Bridge 用户偏好，仅在与当前任务相关且不与本轮明确要求冲突时适用]\n${rules}\n[Bridge 用户偏好结束]\n\n${text}`
    }

    function listAll() {
        const projects = []
        const projectsRoot = join(claudeHome, 'projects')
        if (existsSync(projectsRoot)) {
            for (const encodedDir of readdirSync(projectsRoot, {withFileTypes: true})) {
                if (!encodedDir.isDirectory()) continue
                const path = join(projectsRoot, encodedDir.name, 'bridge-preferences.json')
                if (!existsSync(path)) continue
                const store = readStore(path)
                projects.push({encodedDir: encodedDir.name, preferences: Object.values(store.preferences), suggestions: Object.values(store.candidates).filter(item => item?.pending).map(publicSuggestion)})
            }
        }
        return {global: Object.values(readStore(globalPath).preferences), projects}
    }

    function update({scope, projectDir, encodedDir, id, enabled}) {
        const path = scope === 'global' ? globalPath : encodedDir
            ? join(claudeHome, 'projects', encodedDir, 'bridge-preferences.json')
            : projectPath(projectDir)
        const store = readStore(path)
        if (!store.preferences[id]) throw Object.assign(new Error('preference not found'), {code: 'PREFERENCE_NOT_FOUND'})
        store.preferences[id].enabled = enabled !== false
        store.preferences[id].updatedAt = now()
        writeStore(path, store)
        return store.preferences[id]
    }

    function remove({scope, projectDir, encodedDir, id}) {
        const path = scope === 'global' ? globalPath : encodedDir
            ? join(claudeHome, 'projects', encodedDir, 'bridge-preferences.json')
            : projectPath(projectDir)
        const store = readStore(path)
        const existed = Boolean(store.preferences[id])
        delete store.preferences[id]
        writeStore(path, store)
        return {ok: true, deleted: existed}
    }

    return {observe, pending, respond, relevant, inject, listAll, update, remove, paths: {globalPath, projectPath}}
}
