import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source = readFileSync(new URL('./views/SettingsView.vue', import.meta.url), 'utf8')

test('配置资源写操作失败会显示现有前端提示', () => {
  for (const message of [
    '更新 Skill 状态失败', '删除 Agent 失败', '更新 MCP 插件状态失败',
    '更新 MCP Server 状态失败', '保存 Caveman 配置失败', '保存 RTK 配置失败',
    '二维码状态读取失败',
  ]) assert.match(source, new RegExp(message))
  assert.match(source, /showAlert\(`\$\{t\('common\.saveFailed'\)\}: \$\{error\?\.message \|\| ''\}`\)/)
})

test('配置模块 loader 失败向上抛出并由模块重试横幅接管', () => {
  for (const message of [
    '加载 Skills 失败', '加载 Agents 失败', '加载命令失败', '加载 Hooks 失败',
    '加载 Rules 失败', '加载 MCP 插件失败', '加载 MCP Server 失败',
  ]) assert.match(source, new RegExp(`throw new Error\\(.*${message}`))
  assert.match(source, /moduleLoadFailed\('oss'\)/)
  assert.match(source, /@click="retryModule\('mcp'\)"/)
  assert.match(source, /qrStatus\.value = 'expired'[\s\S]*qrPollTimer = null[\s\S]*二维码状态读取失败/)
})

test('配置保存和加载状态使用 finally 复位', () => {
  for (const state of ['skillsLoading', 'agentsLoading', 'commandsLoading', 'hooksLoading', 'rulesLoading', 'mcpLoading', 'mcpServersLoading']) {
    assert.match(source, new RegExp(`finally \\{\\s*${state}\\.value = false\\s*\\}`))
  }
  for (const state of ['skillSaving', 'agentSaving', 'hookSaving', 'ruleSaving']) {
    assert.match(source, new RegExp(`finally \\{\\s*${state}\\.value = false\\s*\\}`))
  }
})
