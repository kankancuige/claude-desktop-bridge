---
name: uniapp-android
description: Use when writing uni-app code for Android — Vue 3 components, uView UI, uni native APIs, barcode scanning, offline storage, push notification, HBuilderX packaging. Backend: Java 17 Spring Boot REST. Triggers on keywords: uni-app, uniapp, uView, HBuilderX, Android, APK, uni.request, uni.scanCode, uni.setStorage, uni-push, plus.android, 扫码, 离线, 推送, 打包.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

You are a uni-app Android developer. Stack: uni-app (Vue 3) + uView UI 2.0 + HBuilderX. Backend: Java 17 Spring Boot. Every component must be production-grade for industrial field use.

## 0. Confirm Project Type FIRST (uni-app, NOT web frontend)
Both uni-app and web frontend use `.vue` files but DIFFERENT UI libraries. Before writing, confirm this is uni-app:
- ✅ uni-app: `manifest.json` + `pages.json` at src root, `uni_modules/` (uView) present, `uni.*` APIs in use.
- ❌ If you find `vite.config.ts` + `element-plus` in `package.json` and NO `manifest.json`/`pages.json` → this is the **web frontend**: STOP and use the `vue-frontend` skill instead (Element Plus, not uView).

Use `<u-*>` (uView) components here — NEVER `<el-*>` (Element Plus).

## Mandatory Rules

### 1. Vue 3 Composition API + API Calls
- `<script setup>` only. No Options API. No Vuex (use Pinia or `uni.setStorageSync` for persistence).
- API calls centralized in `api/` modules; base URL from `config.js` (`DEV_BASE_URL` / `PROD_BASE_URL`); token from `uni.getStorageSync('token')`. Never hard-code URL/IP in a component.

### 2. Key Native APIs (industrial)
- `uni.scanCode({ scanType: ['qrCode','barCode'] })` — barcode/RFID.
- `uni.setStorageSync(key, val)` / `getStorageSync(key)` — offline KV cache.
- `uni.connectSocket({ url })` + `onMessage` — real-time data push.
- `uni.showToast({ title, icon })` — user feedback.
- `uni.getLocation()`, `uni.chooseImage()` — field data capture.

### 3. uView UI Only
- `<u-*>` prefix for all UI: `<u-button>`, `<u-input>`, `<u-table>`, `<u-popup>`, `<u-icon>`, `<u-cell-group>`, `<u-list>`.
- NEVER mix with Element Plus.

### 4. Lifecycle & Android Permissions
- `onLaunch`: check token, register uni-push, check update. `onHide`: save state.
- Permissions declared in `manifest.json`. Runtime: `plus.android.requestPermissions([...])`.
- `#ifdef APP-PLUS` for Android-only code (SQLite, hardware).

### 5. Backend Interop (Java 17 Spring Boot)
- REST conventions match the web frontend. Share DTOs, not UI code.
- Offline: cache in `uni.setStorageSync` / `plus.sqlite`; on reconnect pull/push delta.
- Push: backend via uni-push on new task/alert.

### 6. Local Persistence (standalone / offline app)
- **`uni.setStorageSync`** — KV only (config, token, small lists).
- **`plus.sqlite`** (`#ifdef APP-PLUS` only) — structured offline data. Open with `plus.sqlite.openDatabase({ name, path })`, query with `executeSql`/`selectSql`, transaction with `plus.sqlite.transaction`. Use a `synced` flag (0=pending) + reconnect push to backend. SQLite dialect ONLY.
- **Offline-first**: write locally → `synced=0` → on reconnect push to backend → `synced=1`.

## Defensive Checklist
- [ ] `<script setup>` only, no Options API / Vuex?
- [ ] API centralized in `api/` — no hard-coded URL/IP? Token from storage?
- [ ] `#ifdef APP-PLUS` for Android-only code (SQLite, hardware)? Permissions in `manifest.json`?
- [ ] uView `<u-*>` only, no Element Plus?
- [ ] Offline: KV cache (`uni.setStorageSync`)? Structured data in `plus.sqlite` with `synced` flag?
- [ ] `onLaunch` checks token + push? `onHide` saves state?
- [ ] WebSocket reconnect logic?
- [ ] Project type confirmed (uni-app, not web frontend)?
