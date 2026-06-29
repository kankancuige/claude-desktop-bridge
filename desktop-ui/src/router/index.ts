/**
 * Vue Router 路由配置
 * github.com/kankancuige/claude-desktop-bridge
 * ── 功能说明 ──
 * 定义应用的两个页面路由：工作区首页和设置页
 * ── 实现方式 ──
 * 使用 createWebHashHistory（hash 模式）而非 HTML5 History 模式，
 * 因为 Electron 加载的是本地文件（file:// 协议），
 * HTML5 History 的 pushState 在 file:// 下不可用，hash 模式无此问题。
 * 所有页面组件使用动态 import 实现路由级别的代码分割。
 */

import {createRouter, createWebHashHistory} from 'vue-router'

const router = createRouter({
    /**
     * ── Hash 模式 ──
     * 原因: Electron 生产模式通过 loadFile 加载 dist/index.html，
     * 使用 file:// 协议，不支持 HTML5 History API 的 pushState。
     * Hash 模式 (#/path) 在所有协议下均可用，且无需服务端配置回退路由。
     */
    history: createWebHashHistory(),

    routes: [
        /**
         * ── 工作区首页 ──
         * 路径: /
         * 功能: 项目选择、会话管理、与 Claude 对话的主界面
         * 组件: WorkspaceView.vue（懒加载，首屏不加载此组件时减小初始 bundle）
         */
        {
            path: '/',
            name: 'workspace',
            component: () => import('../views/WorkspaceView.vue'),
        },

        /**
         * ── 设置页 ──
         * 路径: /settings
         * 功能: 主题切换、语言设置、gateway 配置等
         * 组件: SettingsView.vue（懒加载，仅在用户访问设置时加载）
         */
        {
            path: '/settings',
            name: 'settings',
            component: () => import('../views/SettingsView.vue'),
        },

        // Workflow DAG 设计器已嵌入 Settings → Workflow Tab 内，不再独立路由

    ],
})

export default router
