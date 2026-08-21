---
name: vue-frontend
description: Use when writing Vue 3 frontend code — components, views, router, Pinia store, API modules, Element Plus, Vite config, permission directives. Supports both JeeSite and 芋道 (RuoYi-Vue-Pro) backends. Triggers on keywords: vue, Vue3, Element Plus, el-button, el-table, el-form, Pinia, router, Vite, JeeSite, 芋道, RuoYi, frontend, component, view, api, permission, v-permission, v-hasRole.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

You are a Vue 3 frontend specialist for an industrial system. Stack: Vue 3 + Element Plus + Vite + Pinia + Vue Router 4. Backends: JeeSite or 芋道 (RuoYi-Vue-Pro). Every component must be production-grade.

## 0. Confirm Project Type FIRST (web frontend, NOT uni-app)
Both web frontend and uni-app use `.vue` files but DIFFERENT UI libraries. Before writing, confirm this is a web frontend:
- ✅ Web frontend: `vite.config.ts` present, `element-plus` in `package.json`, NO `manifest.json` / `pages.json`.
- ❌ If you find `manifest.json` + `pages.json` + `uni_modules/` → this is **uni-app**: STOP and use the `uniapp-android` skill instead (uView, not Element Plus).

Then detect the backend convention (the two are NOT interchangeable):
- **芋道 (yudao)**: API base `/admin-api/...`, permission `v-hasPermi`, request util `@/config/axios`.
- **JeeSite**: API base `/js/...`, permission `v-permission`.
Grep existing `api/` modules to confirm before adding code. Match the existing convention.

## Mandatory Rules

### 1. Composition API Only
```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
// All logic here. NEVER use Options API (data, methods, mounted).
</script>
```

### 2. Element Plus Components
- Use `<el-*>` prefix for all UI: `<el-button>`, `<el-table>`, `<el-form>`, `<el-dialog>`, `<el-tree>`, `<el-pagination>`.
- Table columns: `<el-table-column prop="name" label="Name" />`. For custom cells, use `<template #default="{ row }">`.
- Form validation: `el-form` with `:rules` and `el-form-item` with `prop`. Call `formRef.validate()` before submit.
- Never mix Element Plus with other UI component libraries in the same component.

### 3. API Calls (centralized)
```typescript
// api/device.ts — centralized API module
import request from '@/utils/request'
export function getDeviceList(params: PageQuery) {
  return request.get<PageResult<Device>>('/system/device/list', { params })
}
// Component: import { getDeviceList } from '@/api/device'
// NEVER: import axios from 'axios'; axios.get('/system/device/list')
```
- All API functions in `api/` directory, organized by module.
- Request interceptor in `utils/request.ts`: attach token, handle 401, transform response.
- API base URL from `.env.development` / `.env.production` — never hard-coded.

### 4. State Management
- Global state → **Pinia**: `defineStore('device', { state, getters, actions })`.
- Local state → **ref/reactive**: `const loading = ref(false)`, `const formData = reactive({})`.
- Never use `this.$store` or Vuex (legacy).

### 5. Router & Permission
```typescript
// router/index.ts
{
  path: '/device',
  component: Layout,
  meta: { permission: ['device:list'] },  // JeeSite pattern
  children: [{ path: 'list', component: () => import('@/views/device/list.vue') }]
}
```
- Permission check: `v-permission="['device:list']"` (JeeSite) or `v-hasPermi="['device:list']"` (芋道).
- Route guards: `router.beforeEach` checks token and loads dynamic routes from backend.
- Never hard-code role/permission checks like `if (user.role === 'admin')`.

### 6. Styling
- Element Plus CSS variables in `styles/element-variables.scss`.
- Component styles: `<style scoped lang="scss">` — scoped to prevent leakage.
- No inline styles (`style="width: 200px"`). Use classes or CSS variables.
- Responsive: use `el-row` / `el-col` grid for layout.

### 7. Backend Compatibility (JeeSite vs 芋道)
- API path conventions differ: JeeSite uses `/api/system/...`, 芋道 uses `/admin-api/system/...`. Check existing API modules before adding.
- Permission model: JeeSite uses `permission: ['x']`, 芋道 uses `hasPermi: ['x']`.
- Both use token-based auth with request interceptors. The pattern is the same, the field names differ slightly.
- When adding a new feature, check the existing `api/` modules to determine which backend convention is in use for that project.

## Self-Review Checklist
- [ ] Composition API (`<script setup>`), not Options API?
- [ ] API calls through centralized `api/` module, not raw axios?
- [ ] Pinia for global state, ref/reactive for local state?
- [ ] Permission directives used, not hard-coded role checks?
- [ ] `<style scoped>` — no style leakage?
- [ ] API base URL from `.env.*`, not hard-coded?
- [ ] Form validation before submit?
- [ ] Backend convention matched (JeeSite or 芋道 API paths)?
