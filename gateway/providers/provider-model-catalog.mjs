import {parseTokenCount} from '../context/context-lifecycle.mjs'

export const PROVIDERS = [
    {
        id: 'deepseek', name: 'DeepSeek', icon: 'D',
        baseUrl: 'https://api.deepseek.com/anthropic',
        officialUrl: 'https://platform.deepseek.com',
        docsUrl: 'https://api-docs.deepseek.com',
        models: [
            {id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: '1M'},
            {id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: '256K'},
            {id: 'deepseek-chat', name: 'DeepSeek Chat', contextWindow: '128K'},
            {id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', contextWindow: '128K'},
        ],
        pricing: {input: '4 CNY/1M tokens', output: '16 CNY/1M tokens'},
    },
    {
        id: 'zhipu', name: '智谱AI', icon: 'Z',
        baseUrl: 'https://open.bigmodel.cn/api/anthropic',
        officialUrl: 'https://open.bigmodel.cn',
        docsUrl: 'https://docs.bigmodel.cn',
        models: [
            {id: 'glm-5.2', name: 'GLM-5.2', contextWindow: '128K'},
            {id: 'glm-5.1', name: 'GLM-5.1', contextWindow: '128K'},
            {id: 'glm-5', name: 'GLM-5', contextWindow: '128K'},
            {id: 'glm-4.7', name: 'GLM-4.7', contextWindow: '128K'},
            {id: 'glm-4.6', name: 'GLM-4.6', contextWindow: '128K'},
            {id: 'glm-4.5', name: 'GLM-4.5', contextWindow: '128K'},
            {id: 'glm-4-flash', name: 'GLM-4-Flash', contextWindow: '128K'},
        ],
        pricing: {input: '1 CNY/1M tokens', output: '4 CNY/1M tokens'},
    },
    {
        id: 'moonshot', name: 'Kimi 月之暗面', icon: 'K',
        baseUrl: 'https://api.moonshot.ai/anthropic',
        officialUrl: 'https://platform.kimi.ai',
        docsUrl: 'https://platform.kimi.ai/docs',
        models: [
            {id: 'kimi-k2.6', name: 'Kimi K2.6', contextWindow: '256K'},
            {id: 'kimi-k2.5', name: 'Kimi K2.5', contextWindow: '256K'},
            {id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', contextWindow: '256K'},
        ],
        pricing: {input: '0.95 USD/1M tokens', output: '4 USD/1M tokens'},
    },
    {
        id: 'opencode', name: 'OpenCode', icon: 'OC',
        baseUrl: 'https://opencode.ai/zen/v1',
        officialUrl: 'https://opencode.ai',
        docsUrl: 'https://opencode.ai/docs',
        models: [
            {id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: '1M'},
            {id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: '256K'},
            {id: 'glm-5.2', name: 'GLM-5.2', contextWindow: '128K'},
            {id: 'glm-5.1', name: 'GLM-5.1', contextWindow: '128K'},
            {id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', contextWindow: '256K'},
            {id: 'kimi-k2.6', name: 'Kimi K2.6', contextWindow: '256K'},
            {id: 'kimi-k2.5', name: 'Kimi K2.5', contextWindow: '256K'},
            {id: 'minimax-m2.7', name: 'MiniMax M2.7', contextWindow: '256K'},
            {id: 'minimax-m2.5', name: 'MiniMax M2.5', contextWindow: '256K'},
            {id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', contextWindow: '128K'},
            {id: 'mimo-v2.5', name: 'MiMo V2.5', contextWindow: '128K'},
            {id: 'qwen3.7-max', name: 'Qwen3.7 Max', contextWindow: '128K'},
            {id: 'qwen3.6-plus', name: 'Qwen3.6 Plus', contextWindow: '128K'},
            {id: 'qwen3.5-plus', name: 'Qwen3.5 Plus', contextWindow: '128K'},
        ],
        pricing: {input: '$10/月(Go)', output: 'Zen 按量'},
    },
    {
        id: 'anthropic', name: 'Anthropic', icon: 'A',
        baseUrl: 'https://api.anthropic.com',
        officialUrl: 'https://console.anthropic.com',
        docsUrl: 'https://docs.anthropic.com/en/api',
        models: [
            {id: 'claude-opus-4-5', name: 'Claude Opus 4.5', contextWindow: '200K'},
            {id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: '200K'},
            {id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: '200K'},
        ],
        pricing: {input: '15 USD/1M tokens', output: '75 USD/1M tokens'},
    },
    {
        id: 'qwen', name: '千问', icon: 'Q',
        baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
        officialUrl: 'https://bailian.console.aliyun.com',
        docsUrl: 'https://help.aliyun.com/zh/model-studio',
        models: [
            {id: 'qwen3-max', name: 'Qwen3 Max', contextWindow: '128K'},
            {id: 'qwen3.5-plus', name: 'Qwen3.5 Plus', contextWindow: '128K'},
            {id: 'qwen3.5-flash', name: 'Qwen3.5 Flash', contextWindow: '128K'},
            {id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus', contextWindow: '128K'},
        ],
        pricing: {input: '0.5 CNY/1M tokens', output: '2 CNY/1M tokens'},
    },
    {
        id: 'openrouter', name: 'OpenRouter', icon: 'R',
        baseUrl: 'https://openrouter.ai/api/v1',
        officialUrl: 'https://openrouter.ai',
        docsUrl: 'https://openrouter.ai/docs',
        models: [
            {id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', contextWindow: '200K'},
            {id: 'anthropic/claude-opus-4', name: 'Claude Opus 4', contextWindow: '200K'},
            {id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: '1M'},
            {id: 'openai/gpt-5', name: 'GPT-5', contextWindow: '128K'},
            {id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', contextWindow: '128K'},
        ],
        pricing: {input: '按模型不同', output: '聚合定价'},
    },
    {
        id: 'ollama', name: 'Ollama (本地)', icon: 'O',
        baseUrl: 'http://localhost:11434/v1',
        officialUrl: 'https://ollama.com',
        docsUrl: 'https://ollama.com/docs',
        models: [
            {id: 'qwen3', name: 'Qwen 3', contextWindow: '32K'},
            {id: 'llama4', name: 'Llama 4', contextWindow: '128K'},
            {id: 'deepseek-r1', name: 'DeepSeek R1', contextWindow: '128K'},
            {id: 'codestral', name: 'Codestral', contextWindow: '256K'},
        ],
        pricing: {input: '本地免费', output: '不限量'},
    },
    {
        id: 'volcengine', name: '火山引擎', icon: 'V',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        officialUrl: 'https://console.volcengine.com/ark',
        docsUrl: 'https://www.volcengine.com/docs/82379',
        models: [
            {id: 'doubao-seed-1.6', name: '豆包 Seed 1.6', contextWindow: '128K'},
            {id: 'doubao-seed-1.6-flash', name: '豆包 Flash 1.6', contextWindow: '128K'},
            {id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: '1M'},
            {id: 'deepseek-r1-0528', name: 'DeepSeek R1', contextWindow: '128K'},
        ],
        pricing: {input: '0.8 CNY/1M tokens', output: '2 CNY/1M tokens'},
    },
    {
        id: 'gemini', name: 'Gemini', icon: 'G',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        officialUrl: 'https://ai.google.dev',
        docsUrl: 'https://ai.google.dev/gemini-api/docs',
        models: [
            {id: 'gemini-3-pro', name: 'Gemini 3 Pro', contextWindow: '1M'},
            {id: 'gemini-3-flash', name: 'Gemini 3 Flash', contextWindow: '1M'},
            {id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: '1M'},
            {id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: '1M'},
        ],
        pricing: {input: '0.15 USD/1M tokens', output: '0.60 USD/1M tokens'},
    },
    {
        id: 'minimax', name: 'MiniMax', icon: 'M',
        baseUrl: 'https://api.minimaxi.com/anthropic',
        officialUrl: 'https://platform.minimaxi.com',
        docsUrl: 'https://platform.minimax.io/docs/api',
        models: [
            {id: 'MiniMax-M3', name: 'MiniMax M3', contextWindow: '512K'},
            {id: 'MiniMax-M2.7', name: 'MiniMax M2.7', contextWindow: '205K'},
            {id: 'MiniMax-M2.5', name: 'MiniMax M2.5', contextWindow: '205K'},
            {id: 'MiniMax-M2.1', name: 'MiniMax M2.1', contextWindow: '1M'},
            {id: 'MiniMax-M2.1-Lightning', name: 'MiniMax M2.1 Lightning', contextWindow: '1M'},
        ],
        pricing: {input: '0.30 USD/1M tokens', output: '1.20 USD/1M tokens'},
    },
    {
        id: 'codex-relay', name: 'AICodeMirror Codex', icon: 'CM',
        baseUrl: 'https://api.claudecode.net.cn/api/codex/backend-api/codex',
        officialUrl: 'https://www.aicodemirror.ai',
        docsUrl: 'https://www.aicodemirror.ai',
        models: [
            {id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', contextWindow: '256K'},
            {id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', contextWindow: '256K'},
            {id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: '256K'},
        ],
        pricing: {input: '按 AICodeMirror 账户计费', output: '按 AICodeMirror 账户计费'},
    },
    {
        id: 'codex', name: 'Codex', icon: 'X',
        baseUrl: 'https://api.openai.com/v1',
        officialUrl: 'https://github.com/openai/codex',
        docsUrl: 'https://github.com/openai/codex',
        models: [
            {id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', contextWindow: '200K'},
            {id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', contextWindow: '200K'},
            {id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', contextWindow: '200K'},
        ],
        pricing: {input: '3 USD/1M tokens', output: '15 USD/1M tokens'},
    },
    {
        id: 'custom', name: '自定义', icon: '···',
        baseUrl: '',
        officialUrl: '',
        docsUrl: '',
        models: [],
        pricing: {input: '', output: ''},
    },
];

export function parseContextWindow(value) { return parseTokenCount(value) }

export function parsePricingPrice(value) {
    if (!value) return null
    const match = /^([\d.]+)\s*(CNY|USD|EUR|GBP|JPY)/i.exec(String(value))
    return match ? {price: parseFloat(match[1]), currency: match[2].toUpperCase()} : null
}

export function lookupModelInfo(modelId) {
    for (const provider of PROVIDERS) {
        for (const model of provider.models) {
            if (model.id !== modelId) continue
            const contextWindow = parseContextWindow(model.contextWindow)
            const input = parsePricingPrice(provider.pricing?.input)
            const output = parsePricingPrice(provider.pricing?.output)
            return {contextWindow, pricing: input && output
                ? {inputPrice: input.price, outputPrice: output.price, currency: input.currency} : null}
        }
    }
    return {contextWindow: null, pricing: null}
}
