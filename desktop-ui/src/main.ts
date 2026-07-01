/**
 * Vue 应用入口 (main.ts)
 * ── 功能说明 ──
 * 创建 Vue 3 应用实例，注册核心插件（Pinia 状态管理、Vue Router 路由），
 * 加载全局样式，挂载到 DOM 的 #app 元素。
 * ── 初始化顺序 ──
 * 1. createApp(App) - 创建应用实例
 * 2. use(createPinia()) - 注册 Pinia（状态管理，必须在 router 前）
 * 3. use(router) - 注册路由
 * 4. mount('#app') - 挂载到 DOM
 * ── 架构说明 ──
 * i18n 不使用 Vue 插件方式注册，而是作为独立模块直接 import 使用 t() 函数，
 * 这样可以在 .ts 文件和非组件代码中直接调用，不依赖 Vue 组件上下文。
 */

// Console 水印 —— __REPO_URL__ / __COPYRIGHT__ / __BUILD_TIME__ 为 vite define 构建时常量注入
console.log(
  `%cClaude Desktop Bridge%c ${__REPO_URL__}`,
  'color:#E94560;font-weight:bold;font-size:14px;',
  'color:#888;',
  `\n%c${__COPYRIGHT__}%c\nBuild: ${__BUILD_TIME__}`,
  'color:#555;font-size:10px;',
  'color:inherit;',
)

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import './api'                                   // 全局 fetch 拦截器（bridge-token 认证），须在其他 import 前加载
import App from './App.vue'
import './style.css'                               // 全局样式（CSS 变量、主题色、基础重置）

// ── Monaco Worker 配置 ──
// vite-plugin-monaco-editor 打包 worker 为独立 chunk，需配置 getWorker 引导加载
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'

self.MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    return new editorWorker()
  },
}

const app = createApp(App)

// ── Pinia: 全局状态管理 ──
// Pinia 需要在 router 之前注册，因为路由守卫和页面组件可能依赖 store
app.use(createPinia())

// ── Vue Router: 页面路由 ──
// 使用 hash 模式，适配 Electron file:// 协议
app.use(router)

// ── 挂载到 DOM ──
// index.html 中必须有 <div id="app"></div> 作为挂载点
app.mount('#app')
