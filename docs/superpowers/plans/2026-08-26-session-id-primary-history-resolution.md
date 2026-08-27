# Session ID 主定位历史消息实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 每个任务完成后运行对应测试，并保留现有 dirty worktree 改动。

**Goal:** 将历史消息定位从“项目目录编码优先”改为“`historySessionId` 主定位、项目目录仅作提示和权限校验”，解决项目改名、中文编码变化和旧目录编码异常导致的历史恢复失败。

**Architecture:** `historySessionId` 是持久化 transcript 的主身份，Gateway 通过 Session 索引、Session map 和受限扫描解析真实 transcript 路径。项目目录只用于列表分组、权限校验和查询优化；旧的项目路径接口保留为兼容包装层。`gatewaySessionId` 只表示当前 Gateway 运行会话，不参与历史文件主定位。

**Tech Stack:** Node.js ESM、Node test runner、HTTP Gateway、Vue 3 + TypeScript、Vite、Electron。

## Global Constraints

- 不删除或强制搬迁现有 transcript；先通过 resolver 兼容读取。
- 保留 `GET /api/projects/:encodedDir/sessions/:sessionId/messages`，旧接口内部转为 ID 主定位。
- 所有历史读取必须校验 Session ID 格式、真实 transcript、`cwd` 和项目权限。
- 同一 `historySessionId` 命中多个候选时返回 `409`，禁止猜测。
- 保留现有未提交改动，不执行 `git reset`、`git checkout`、提交或推送。
- Build、host test、runtime smoke test 分开记录，不能用 build 代替运行时验收。

## 当前根因证据

- 前端目前请求 `/api/projects/{encodedDir}/sessions/{historySessionId}/messages`。
- transcript 实际存放为 `projects/{旧编码目录}/{historySessionId}.jsonl`。
- 旧编码目录可能丢失中文或错误处理项目名中的连字符。
- 当前 Gateway 在项目目录不匹配时可能返回 `404 HISTORY_NOT_FOUND`，即使 Session ID 和 transcript 文件都存在。
- transcript 内的 `cwd` 保留真实工作目录，可用于索引修复和权限校验。

## 文件责任表

- Modify: `gateway/projects/project-transcript-location.mjs`，提供 ID 主导的 transcript resolver。
- Modify: `gateway/projects/project-transcript-location.test.mjs`，覆盖旧目录、中文目录、项目名连字符和歧义 ID。
- Modify: `gateway/runtime/project-session-runtime.mjs`，维护按 `historySessionId` 查询的派生索引并修复旧目录映射。
- Modify: `gateway/storage/repositories/session-repository.mjs` 或实际 Session 索引实现文件，补充按 Session ID 查询接口；先以现有 repository 实现为准，不重复造索引。
- Modify: `gateway/http/memory-routes.mjs`，将旧历史接口改为 resolver 包装层。
- Modify: `gateway/http/request-handler.mjs` 或对应路由注册位置，新增 `/api/sessions/:historySessionId/messages` 路由。
- Modify: `desktop-ui/src/views/WorkspaceView.vue`，历史消息请求改为 ID 主定位，保留项目提示参数用于兼容和校验。
- Modify: `desktop-ui/src/session-open-performance.test.mjs` 及必要的前端测试，覆盖预加载、重试和错误提示。
- Add if needed: `gateway/http/session-history-routes.test.mjs`，验证新接口状态码和权限行为。

---

### Task 1: 建立 ID 主定位失败测试

**Files:**
- Modify: `gateway/projects/project-transcript-location.test.mjs`
- Add if needed: `gateway/http/session-history-routes.test.mjs`

**Interfaces:**
- 失败用例调用 `findSessionTranscript({bridgeHome, encodedDir, sessionId})` 或新 resolver。
- 失败用例模拟项目编码目录与 transcript 内 `cwd` 不一致，但 Session ID 唯一。

- [ ] **Step 1: 添加唯一 Session ID 跨旧编码目录测试**

```js
test('仅凭 historySessionId 可从旧编码目录找到 transcript', () => {
  // 项目提示目录使用新编码，文件实际位于旧目录；预期仍返回 found。
})
```

- [ ] **Step 2: 添加项目名含连字符和中文的测试**

测试真实 `cwd` 为 `D:/hcd/系统/znzpxt-yt`，请求项目提示为 `D--hcd-系统-znzpxt-yt`，文件位于旧目录，预期不返回 404。

- [ ] **Step 3: 添加重复 Session ID 歧义测试**

同一 ID 位于两个项目目录时，预期返回 `{status: 'ambiguous'}`，不能按目录顺序猜测。

- [ ] **Step 4: 运行失败测试确认当前实现不能通过**

Run: `node --test gateway/projects/project-transcript-location.test.mjs`

Expected: 新增的 ID 主定位测试在旧实现下失败，记录具体失败状态。

---

### Task 2: 实现统一 Session transcript resolver

**Files:**
- Modify: `gateway/projects/project-transcript-location.mjs`
- Modify: `gateway/projects/project-transcript-location.test.mjs`

**Interfaces:**

实现：

```js
resolveSessionTranscript({
  bridgeHome,
  sessionId,
  projectHint,
  workDir,
  repository,
})
```

返回：

```js
{status: 'found', sessionId, encodedDir, workDir, filePath, source}
{status: 'missing'}
{status: 'ambiguous', matches: [{encodedDir, filePath}]}
```

定位顺序：

1. 按 `sessionId` 查询 repository；
2. 按 `bridge-session-map.json` 查询 SDK transcript ID；
3. 检查 `projectHint` 对应目录；
4. 只读扫描项目目录并用 transcript 的真实 `cwd` 缩小候选；
5. 只接受唯一候选。

- [ ] **Step 1: 复用现有 `validSessionId`、`transcriptWorkDir` 和路径安全校验**

不得允许 `../`、路径分隔符或超长 Session ID 穿透到 projects 根目录之外。

- [ ] **Step 2: 让 resolver 优先通过 ID 索引命中**

索引命中后验证文件仍存在、是普通文件，并在可读取时校正真实 `cwd` 和 `encodedDir`。

- [ ] **Step 3: 实现旧目录有限回查**

当项目提示目录不存在或未命中时，按 Session ID 查找候选；候选超过一个返回 `ambiguous`。

- [ ] **Step 4: 运行定位测试确认通过**

Run: `node --test gateway/projects/project-transcript-location.test.mjs`

Expected: 所有正常、旧编码、中文、连字符、越权和歧义测试通过。

---

### Task 3: 补齐 Session 索引和旧目录修复

**Files:**
- Modify: `gateway/runtime/project-session-runtime.mjs`
- Modify: 实际 Session repository 文件
- Modify: `gateway/gateway-runtime-impl.mjs` 的依赖注入和导出
- Test: 对应 runtime/repository 测试文件

**Interfaces:**

索引查询至少提供：

```js
repository.findBySessionId(sessionId)
repository.upsert({sessionId, encodedDir, workDir, transcriptPath, mtime, size})
repository.removeByTranscriptPath(transcriptPath)
```

- [ ] **Step 1: 先确认现有索引字段和 repository API**

使用 `rg` 查找当前 Session index schema 和查询方法；不得另建第二套并行索引。

- [ ] **Step 2: 为扫描发现的 transcript 写入真实 `cwd` 和路径**

项目目录名称只作为初始候选，最终 `workDir` 以 transcript 真实 `cwd` 为准。

- [ ] **Step 3: 处理陈旧索引**

文件不存在、大小或修改时间不一致时删除陈旧行，再回退到只读扫描并重建索引。

- [ ] **Step 4: 保持删除链路一致**

删除 Session 时同步移除 repository、session map、visibility、snapshot、checkpoint 和 event 元数据；不要删除其他 Session。

- [ ] **Step 5: 运行索引和项目扫描测试**

Run: `node --test gateway/projects/project-session-runtime.test.mjs gateway/storage/repositories/*test.mjs`

Expected: 索引命中、陈旧修复、旧目录聚合和删除清理测试通过；不存在的测试文件需先按实际路径替换。

---

### Task 4: 新增 ID 主导历史 HTTP 接口并兼容旧接口

**Files:**
- Modify: `gateway/http/memory-routes.mjs`
- Modify: `gateway/http/request-handler.mjs` 或实际路由注册位置
- Add/Modify: `gateway/http/session-history-routes.test.mjs`

**Interfaces:**

新增：

```text
GET /api/sessions/:historySessionId/messages
```

兼容保留：

```text
GET /api/projects/:encodedDir/sessions/:historySessionId/messages
```

兼容接口把 `encodedDir` 作为 `projectHint`，不得把它作为唯一文件定位条件。

- [ ] **Step 1: 添加新接口失败测试**

覆盖 `200`、`404`、`409`、`403`、`500`，并断言返回的 `encodedDir` 来自 resolver 实际结果。

- [ ] **Step 2: 实现新接口**

读取 resolver 返回的 `filePath`，调用现有 `parseSessionHistory`；不要复制另一份 transcript 解析逻辑。

- [ ] **Step 3: 实现权限校验**

项目绑定存在时，按 resolver 得到的真实 `workDir`/`encodedDir` 校验；只要校验失败返回 `403`，不能为了恢复历史绕过权限。

- [ ] **Step 4: 将旧接口改为兼容包装**

旧接口只负责解析 `projectHint` 并调用同一个新 handler，避免两套行为继续分叉。

- [ ] **Step 5: 运行 HTTP 路由测试**

Run: `node --test gateway/http/session-history-routes.test.mjs gateway/http/memory-routes.test.mjs`

Expected: 新旧接口均通过，旧编码目录不再因项目名变化直接返回 404。

---

### Task 5: 修改前端历史加载为 ID 主定位

**Files:**
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Modify: `desktop-ui/src/session-open-performance.test.mjs`
- Test: `desktop-ui/src/session-selection.test.mjs` 及相关前端测试

**Interfaces:**

前端历史请求优先使用：

```text
/api/sessions/{historySessionId}/messages
```

旧接口只作为版本兼容回退，不得首先依赖 `encodedDir`。

- [ ] **Step 1: 添加前端请求断言**

确认 `loadHistory()` 使用 `historySessionId` 构建新 URL，`projectPath` 仅用于 tab 所有权和展示。

- [ ] **Step 2: 修改预加载和创建完成后的重试**

预加载失败时不立即写入“历史消息加载失败，将以空白会话开始”；Gateway Session 创建完成后仍使用同一个 `historySessionId` 重试。

- [ ] **Step 3: 保持 Gateway Session ID 只用于运行连接**

禁止用新的 `gatewaySessionId` 替换 `historySessionId` 参与历史 URL。

- [ ] **Step 4: 保留 tab 归属校验**

继续校验 tab ID、项目路径和 history Session ID，避免旧请求覆盖用户当前选择的 tab。

- [ ] **Step 5: 运行前端测试和构建**

Run: `node --test desktop-ui/src/session-open-performance.test.mjs desktop-ui/src/session-selection.test.mjs`

Run: `pnpm --dir desktop-ui exec vite build`

Expected: 定向测试通过，Vite build 通过；构建警告单独记录，不将 warning 当作失败。

---

### Task 6: 真实运行时验收和回归检查

**Files:**
- No source changes unless runtime evidence exposes a new root cause.
- Review: `C:\Users\CKD\AppData\Roaming\desktop-ui\gateway.log`

- [ ] **Step 1: 重启开发桌面端和 Gateway**

重启后确认新进程实际加载当前工作区代码；若使用安装包，先重新打包并确认安装包包含最新 `dist` 和 Gateway 文件。

- [ ] **Step 2: 打开项目名含中文或连字符的已有历史会话**

确认历史消息正常展示，不出现“将以空白会话开始”。

- [ ] **Step 3: 验证 Gateway Session 轮换**

确认 WebSocket 使用新的 Gateway Session ID，但历史接口仍使用原 `historySessionId`。

- [ ] **Step 4: 验证失败路径**

删除或指定不存在的 Session ID，确认返回明确的历史不存在错误；制造重复候选时确认返回 `409`，而不是读取错误项目。

- [ ] **Step 5: 检查日志和差异**

搜索：`SESSION_LOOKUP_BY_ID`、`SESSION_INDEX_REPAIRED`、`HISTORY_NOT_FOUND`、`HISTORY_LOCATION_AMBIGUOUS`、`HISTORY_PERMISSION_DENIED`。

Run: `git diff --check`

Expected: 原始历史恢复故障消失，正常/失败/边界/重复路径均有证据；未完成的安装包或真实桌面验证必须标记为 blocker。

## 完成判定

只有同时满足以下条件才可宣布完成：

1. 仅凭 `historySessionId` 能读取历史 transcript。
2. 项目名称、中文编码或旧目录编码变化不影响恢复。
3. 同 ID 多候选不会误读，返回明确 `409`。
4. 权限校验仍基于真实项目归属。
5. 旧接口和新接口行为一致。
6. 前端不再把临时定位失败伪装成空白会话。
7. 定向测试、前端 build 和真实运行时验收均有独立证据。
