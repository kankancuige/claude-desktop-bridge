import assert from 'node:assert/strict'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {basename, dirname, join, relative, resolve} from 'node:path'
import test from 'node:test'
import {applySkillRoute, routeSkills} from '../agents/skill-router.mjs'
import {createQueryOptionsRuntime} from './query-options-runtime.mjs'

function createRuntime({installed = true, enabled = true} = {}) {
    const diagnostics = []
    const bridgeHome = mkdtempSync(join(tmpdir(), 'bridge-query-options-'))
    const runtime = createQueryOptionsRuntime({
        BRIDGE_HOME: bridgeHome,
        MODEL: 'model-a',
        VALID_PERMISSION_MODES: new Set(['default']),
        VALID_THINKING_LEVELS: new Set(['auto']),
        VALID_MODEL_MODES: new Set(['auto', 'fixed']),
        restoreSecretValue: value => value,
        getClaudeExe: () => null,
        normalizeContextProfile: value => value || 'full',
        routeSkills,
        loadOrBuildProjectContext: async () => ({languages: ['C#'], frameworks: ['Avalonia'], manifestFingerprint: [{path: 'App.csproj'}]}),
        getBuiltinResourceState: () => [
            {id: 'avalonia-ui', type: 'skill', enabled, installed},
            {id: 'vue-frontend', type: 'skill', enabled: true, installed: true},
        ],
        ensureBuiltinSkillsAvailable: names => ({available: names, installed: []}),
        decideTask: () => null,
        loadAgentDefinitions: () => ({}),
        shouldDeferAutomaticQuery: () => false,
        mapModel: value => value,
        resolveTaskModelRoute: ({explicitModel, defaultModel}) => ({mode: 'fixed', model: explicitModel || defaultModel, tier: null, blockingReason: null}),
        loadWfConfig: () => ({modelTiers: {}}),
        shouldValidateProviderModel: () => false,
        validateProviderModel: () => null,
        prepareQueryProvider: async ({baseUrl, apiKey}) => ({effectiveBaseUrl: baseUrl || '', sdkApiKey: apiKey || 'test-key', usesCodexRelay: false}),
        parseTokenCount: value => Number(value) || 0,
        lookupModelInfo: () => ({contextWindow: 0}),
        calculateAutoCompactWindow: () => null,
        mapThinkingLevel: () => ({type: 'disabled'}),
        sanitizeMcpServers: value => value,
        buildChildProcessEnv: () => ({}),
        buildCavemanSystemPrompt: () => '',
        makeCanUseTool: () => null,
        rtkPostToolUseHandler: () => null,
        applyContextProfile: options => options,
        applySkillRoute,
        relative, resolve, basename, dirname, join,
        rmdirSync() {}, safeChildPath: () => null, existsSync: () => false, unlinkSync() {}, deleteSession() {},
        sessions: new Map(), broadcast() {},
        log: {info() {}, warn() {}, debug(value) { diagnostics.push(value) }},
    })
    return {runtime, diagnostics}
}

test('Query Options 使用 ProjectContext 选择 Avalonia Skill', async () => {
    const {runtime, diagnostics} = createRuntime()
    const options = await runtime.makeQueryOptions({text: '页面增加主题切换', model: 'model-a'}, 'D:\work', {env: {}, mcpServers: {}}, {}, null)
    assert.deepEqual(options.skills, ['avalonia-ui'])
    assert.deepEqual(diagnostics[0].frameworks, ['Avalonia'])
})

test('Query Options 首次命中会先准备 Skill 并记录选择诊断', async () => {
    const {runtime, diagnostics} = createRuntime({installed: false})
    const options = await runtime.makeQueryOptions({text: '页面增加主题切换', model: 'model-a'}, 'D:\work', {env: {}, mcpServers: {}}, {}, null)
    assert.deepEqual(options.skills, ['avalonia-ui'])
    assert.deepEqual(diagnostics[0].selectedSkills, ['avalonia-ui'])
})

test('Query Options 抑制已禁用 Skill 并记录名称级诊断', async () => {
    const {runtime, diagnostics} = createRuntime({enabled: false})
    const options = await runtime.makeQueryOptions({text: '页面增加主题切换', model: 'model-a'}, 'D:\work', {env: {}, mcpServers: {}}, {}, null)
    assert.deepEqual(options.skills, [])
    assert.deepEqual(diagnostics[0].suppressedSkills, ['avalonia-ui'])
})

test('Query Options 不让旧 Vue 路由绕过 Avalonia 架构过滤', async () => {
    const {runtime, diagnostics} = createRuntime()
    const options = await runtime.makeQueryOptions({skillRoute: ['vue-frontend'], model: 'model-a'}, 'D:\work', {env: {}, mcpServers: {}}, {}, null)
    assert.deepEqual(options.skills, [])
    assert.deepEqual(diagnostics[0].suppressedSkills, ['vue-frontend'])
})
