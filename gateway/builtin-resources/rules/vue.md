---
paths: "**/*.vue;**/*.nvue"
---

# Vue 3 Core Rules (shared: web frontend + uni-app)
Applies to ALL Vue 3 single-file components. This rule holds ONLY the conflict-free shared core. UI-library and platform specifics live in skills:
- Web frontend (Element Plus) → `vue-frontend` skill
- uni-app Android (uView) → `uniapp-android` skill

## Composition API
- `<script setup>` only. No Options API (`data` / `methods` / `mounted`).

## API Calls
- Centralized in `api/` modules. NEVER call raw `axios` / `uni.request` with a hard-coded URL inside a component.
- All requests go through a wrapper/interceptor: attach token, handle 401.
- Base URL from `.env.*` / `config`, never hard-coded.

## State
- Global state → Pinia. Local state → `ref` / `reactive`. Never Vuex.

## Styling
- `<style scoped>`. No inline styles.

## UI library — decided by project type, NOT by this rule
- Web frontend (`vite.config.ts` + `element-plus` in package.json) → Element Plus `<el-*>` → invoke `vue-frontend`.
- uni-app (`manifest.json` + `pages.json` + `uni_modules/`) → uView `<u-*>` → invoke `uniapp-android`.
- NEVER mix the two UI libraries in one component.
