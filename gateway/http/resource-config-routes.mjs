import {readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmdirSync, unlinkSync} from 'node:fs'
import {join, dirname, relative} from 'node:path'
import {getBuiltinResourceState, setBuiltinResourceEnabled} from '../config/builtin-resources.mjs'
import {safeBasename, safeChildPath} from '../security/path-security.mjs'

function json(res, status, body) {
    res.writeHead(status, {'Content-Type': 'application/json'})
    res.end(JSON.stringify(body))
}

export function createResourceConfigRoutes(deps = {}) {
    const {bridgeHome: BRIDGE_HOME, parseFrontmatter, builtinCache, safeDecodeURIComponent, backupFile, loadCliSettingsForUpdate, readJSON, log, readBody, dynamicCache, readFetchBodyLimited, maxRemoteTextBytes: MAX_REMOTE_TEXT_BYTES, cavemanValidLevels: CAVEMAN_VALID_LEVELS, loadCavemanConfig, saveCavemanConfig, downloadAndReplaceCaveman, loadRtkConfig, locateRtk, saveRtkConfig, downloadAndReplaceRtk, builtinAgentTypes: BUILTIN_AGENT_TYPES, getLiveQuery, withTimeout, persistDynamicCache, builtinCommands: BUILTIN_COMMANDS, imCustomCommands: IM_CUSTOM_COMMANDS, loadWfConfig, saveWfConfig} = deps
    return async function handleResourceConfigRoute({req, res, url}) {

    // ── Config endpoints ──
    // Skills/MCP 和其他带文件操作的配置路由仍在本组后续迁移；基础配置路由已由 configRoutes 接管。
    // ── GET /api/config/skills —— 列出所有 Skills ──
    // 功能说明: 扫描 ~/.claude-desktop-bridge/skills/ 目录下所有 SKILL.md，解析 frontmatter 返回名称/描述/内容
    // 实现方式: readdirSync → forEach 读 SKILL.md → parseFrontmatter 提取元数据
    // 关键数据流: skills/ 目录 → 遍历读 SKILL.md → 200 {skills: [{name, description, content, size}]}
    if (req.method === 'GET' && url.pathname === '/api/config/skills') {
        const sd = join(BRIDGE_HOME, 'skills');
        const r = [];
        const builtinState = getBuiltinResourceState({bridgeHome: BRIDGE_HOME}).filter(item => item.type === 'skill')
        const builtinNames = new Set(builtinState.map(item => item.id));
        const builtinByName = new Map(builtinState.map(item => [item.id, item]))
        const seen = new Set();
        try {
            for (const n of readdirSync(sd)) {
                try {
                    const c = readFileSync(join(sd, n, 'SKILL.md'), 'utf8');
                    const {frontmatter: fm} = parseFrontmatter(c);
                    const name = fm.name || n;
                    seen.add(name);
                    r.push({
                        name,
                        description: fm.description || '',
                        allowedTools: fm['allowed-tools'] || '',
                        content: c,
                        size: c.length,
                        source: builtinNames.has(name) ? 'builtin' : 'custom',
                        enabled: builtinByName.get(name)?.enabled ?? true,
                        customized: builtinByName.get(name)?.customized ?? false,
                        required: builtinByName.get(name)?.required ?? false,
                    })
                } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
            }
        } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
        ;
        for (const bn of builtinCache.skills) {
            if (!seen.has(bn)) r.push({
                name: bn,
                description: '',
                allowedTools: '',
                content: null,
                size: 0,
                source: 'sdk-builtin',
                enabled: true,
            })
        }
        ;res.writeHead(200);
        res.end(JSON.stringify({skills: r}));
            return true
    }
    const skillM = url.pathname.match(/^\/api\/config\/skills\/(.+)$/);
    if (skillM) {
        const sn = safeDecodeURIComponent(skillM[1]);
        const skillsDir = join(BRIDGE_HOME, 'skills')
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(sn)) {
            res.writeHead(400)
            res.end(JSON.stringify({error: 'invalid skill name'}))
            return true
        }
        const skillDir = safeBasename(skillsDir, sn)
        const sp = skillDir ? safeChildPath(skillDir, 'SKILL.md', {allowNested: false, extensions: ['.md']}) : null
        if (!sp) {
            res.writeHead(400)
            res.end(JSON.stringify({error: 'invalid skill path'}))
            return true
        }
        if (req.method === 'GET') {
            try {
                const c = readFileSync(sp, 'utf8');
                const {frontmatter: fm} = parseFrontmatter(c);
                res.writeHead(200);
                res.end(JSON.stringify({name: fm.name || sn, description: fm.description || '', content: c}))
            } catch {
                res.writeHead(404);
                res.end(JSON.stringify({error: 'not found'}))
            }
            ;
            return true
        }
        if (req.method === 'PUT') {
            try {
                const b = await readBody(req);
                if (!existsSync(skillsDir)) mkdirSync(skillsDir, {recursive: true})
                if (!existsSync(skillDir)) mkdirSync(skillDir, {recursive: true})
                backupFile(sp);
                writeFileSync(sp, b.content, 'utf8');
                res.writeHead(200);
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({error: e.message}))
            }
            ;
            return true
        }
        // ── DELETE /api/config/skills/:name —— 删除 Skill 目录 ──
        // 仅已禁用的 skill 可删除（防止误删正在使用的 skill）
        if (req.method === 'DELETE') {
            try {
                if (getBuiltinResourceState({bridgeHome: BRIDGE_HOME}).some(item => item.type === 'skill' && item.id === sn)) {
                    res.writeHead(409)
                    res.end(JSON.stringify({error: '内置 Skill 不能删除，请使用启用/关闭开关'}))
            return true
                }
                const s = readJSON(join(BRIDGE_HOME, 'settings.json')) || {}
                if (!(s.disabledSkills || []).includes(sn)) {
                    res.writeHead(409)
                    res.end(JSON.stringify({error: '请先禁用再删除'}))
            return true
                }
                if (existsSync(skillDir)) { backupFile(skillDir); rmdirSync(skillDir, {recursive: true}) }
                res.writeHead(200)
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500)
                res.end(JSON.stringify({error: e.message}))
            }
            return true
        }
    }
    // ── POST /api/config/skills —— 创建新 Skill ──
    // 功能说明: 在 ~/.claude-desktop-bridge/skills/ 下创建新的 SKILL.md，名称自动 sanitize 为小写+连字符
    //   已存在则返回 409
    // 关键数据流: POST {name, content?} → mkdir + writeFile → 201 {ok:true, name}
    if (req.method === 'POST' && url.pathname === '/api/config/skills') {
        try {
            const b = await readBody(req);
            const n = (b.name || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
            if (!n) {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'name required'}));
            return true
            }
            ;const d = join(BRIDGE_HOME, 'skills', n);
            if (existsSync(d)) {
                res.writeHead(409);
                res.end(JSON.stringify({error: 'exists'}));
            return true
            }
            ;mkdirSync(d, {recursive: true});
            writeFileSync(join(d, 'SKILL.md'), b.content || `---\nname: ${n}\ndescription: \n---\n\n`, 'utf8');
            res.writeHead(201);
            res.end(JSON.stringify({ok: true, name: n}))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: e.message}))
        }
        ;
            return true
    }
    // ── GET /api/config/disabled-skills —— 获取已禁用的 skill 名称列表 ──
    if (req.method === 'GET' && url.pathname === '/api/config/disabled-skills') {
        const s = readJSON(join(BRIDGE_HOME, 'settings.json')) || {}
        res.writeHead(200)
        res.end(JSON.stringify({disabled: s.disabledSkills || []}))
            return true
    }
    // ── POST /api/config/disabled-skills —— 切换 skill 启用/禁用状态 ──
    if (req.method === 'POST' && url.pathname === '/api/config/disabled-skills') {
        try {
            const b = await readBody(req)
            const name = (b.name || '').trim()
            if (!name) { res.writeHead(400); res.end(JSON.stringify({error: 'name required'})); return }
            if (getBuiltinResourceState({bridgeHome: BRIDGE_HOME}).some(item => item.type === 'skill' && item.id === name)) {
                const resource = setBuiltinResourceEnabled({bridgeHome: BRIDGE_HOME, type: 'skill', id: name, enabled: !b.disabled})
                res.writeHead(200)
                res.end(JSON.stringify({ok: true, name, disabled: b.disabled, resource}))
            return true
            }
            const s = loadCliSettingsForUpdate()
            if (!s.disabledSkills) s.disabledSkills = []
            if (b.disabled) {
                if (!s.disabledSkills.includes(name)) s.disabledSkills.push(name)
            } else {
                s.disabledSkills = s.disabledSkills.filter((n) => n !== name)
            }
            writeJSON(join(BRIDGE_HOME, 'settings.json'), s)
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, name, disabled: b.disabled}))
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({error: e.message})) }
            return true
    }
    // ── GET /api/config/disabled-mcp-plugins —— 获取已禁用的 MCP 插件名称列表 ──
    if (req.method === 'GET' && url.pathname === '/api/config/disabled-mcp-plugins') {
        const s = readJSON(join(BRIDGE_HOME, 'settings.json')) || {}
        res.writeHead(200)
        res.end(JSON.stringify({disabled: s.disabledMcpPlugins || []}))
            return true
    }
    // ── POST /api/config/disabled-mcp-plugins —— 切换 MCP 插件启用/禁用状态 ──
    if (req.method === 'POST' && url.pathname === '/api/config/disabled-mcp-plugins') {
        try {
            const b = await readBody(req)
            const name = (b.name || '').trim()
            if (!name) { res.writeHead(400); res.end(JSON.stringify({error: 'name required'})); return }
            if (getBuiltinResourceState({bridgeHome: BRIDGE_HOME}).some(item => item.type === 'mcp' && item.id === name)) {
                const resource = setBuiltinResourceEnabled({bridgeHome: BRIDGE_HOME, type: 'mcp', id: name, enabled: !b.disabled})
                res.writeHead(200)
                res.end(JSON.stringify({ok: true, name, disabled: b.disabled, resource}))
            return true
            }
            const s = loadCliSettingsForUpdate()
            if (!s.disabledMcpPlugins) s.disabledMcpPlugins = []
            if (b.disabled) {
                if (!s.disabledMcpPlugins.includes(name)) s.disabledMcpPlugins.push(name)
            } else {
                s.disabledMcpPlugins = s.disabledMcpPlugins.filter((n) => n !== name)
            }
            writeJSON(join(BRIDGE_HOME, 'settings.json'), s)
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, name, disabled: b.disabled}))
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({error: e.message})) }
            return true
    }
    // ── GitHub raw 下载（多镜像回退）──
    // raw.githubusercontent.com 国内常被墙，jsdelivr CDN 优先
    async function fetchRawGithub(owner, repo, ref, filePath) {
        const urls = [
            `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${filePath}`,
            `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`,
            `https://mirror.ghproxy.com/https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`,
        ]
        for (const u of urls) {
            try {
                const r = await fetch(u, {signal: AbortSignal.timeout(8000)})
                if (r.ok) { log.info({url: u}, 'fetchRawGithub 成功'); return r }
            } catch (error) {
                log.debug({err: error, url: u}, 'fetchRawGithub 镜像请求失败')
            }
        }
        log.warn({owner, repo, ref, filePath}, 'fetchRawGithub 所有镜像均失败')
        return null
    }

    // ── GET /api/config/skills-market?q=xxx —— 多源搜索 Skills ──
    // 来源: skills.sh + GitHub Code Search (SKILL.md)
    // 返回: {results: [{name, description, url, source, stars?}]}
    if (req.method === 'GET' && url.pathname === '/api/config/skills-market') {
        const q = url.searchParams.get('q') || ''
        if (!q.trim()) { res.writeHead(200); res.end(JSON.stringify({results: []})); return }
        const results = []

        // ── 源 1: skills.sh ──
        try {
            const apiUrl = `https://skills.sh/api/search?q=${encodeURIComponent(q.trim())}`
            const resp = await fetch(apiUrl, {signal: AbortSignal.timeout(10000)})
            if (resp.ok) {
                const data = await resp.json()
                for (const item of (data.results || data || []).slice(0, 10)) {
                    results.push({
                        name: item.name || item.id || '',
                        description: item.description || item.summary || '',
                        url: item.url || item.downloadUrl || item.rawUrl || '',
                        source: 'skills.sh',
                        stars: item.stars,
                    })
                }
            }
        } catch { /* skills.sh 不可达，继续其他源 */ }

        // ── 源 2: GitHub Code Search (SKILL.md 文件) ──
        try {
            const ghQuery = encodeURIComponent(`SKILL.md ${q.trim()} in:file language:markdown`)
            const ghUrl = `https://api.github.com/search/code?q=${ghQuery}&per_page=10`
            const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'claude-desktop-bridge' }
            const ghResp = await fetch(ghUrl, {headers, signal: AbortSignal.timeout(10000)})
            if (ghResp.ok) {
                const ghData = await ghResp.json()
                for (const item of (ghData.items || [])) {
                    const repoFull = item.repository?.full_name || ''
                    const path = item.path || ''
                    // 从 path 提取 skill 名称 (skills/<name>/SKILL.md 或 <name>/SKILL.md)
                    const parts = path.replace(/\/SKILL\.md$/i, '').split('/')
                    const skillName = parts[parts.length - 1]
                    const rawUrl = `https://raw.githubusercontent.com/${repoFull}/main/${path}`
                    const name = repoFull ? `${repoFull}/${skillName}` : skillName
                    if (results.find(r => r.url === rawUrl)) continue  // 去重
                    results.push({
                        name,
                        description: `GitHub: ${repoFull} — ${path}`,
                        url: rawUrl,
                        source: 'github',
                        stars: item.repository?.stargazers_count,
                    })
                }
            }
        } catch { /* GitHub 不可达 */ }

        // ── 源 3: npm registry (关键词 claude-code-skill) ──
        try {
            const npmUrl = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q.trim())}+keywords:claude-code-skill&size=10`
            const npmResp = await fetch(npmUrl, {signal: AbortSignal.timeout(10000)})
            if (npmResp.ok) {
                const npmData = await npmResp.json()
                for (const obj of (npmData.objects || [])) {
                    const pkg = obj.package || {}
                    const repoUrl = pkg.links?.repository || ''
                    const rawUrl = repoUrl
                        ? repoUrl.replace('github.com', 'raw.githubusercontent.com').replace(/\/tree\//, '/') + '/main/SKILL.md'
                        : ''
                    if (!rawUrl || results.find(r => r.url === rawUrl)) continue
                    results.push({
                        name: pkg.name,
                        description: pkg.description || '',
                        url: rawUrl,
                        source: 'npm',
                        version: pkg.version,
                    })
                }
            }
        } catch { /* npm 不可达 */ }

        res.writeHead(200)
        res.end(JSON.stringify({results: results.slice(0, 30)}))
            return true
    }
    // ── POST /api/config/skills-market/install —— 从 URL 安装 skill ──
    // 支持: 原始 SKILL.md URL / GitHub 各种链接
    if (req.method === 'POST' && url.pathname === '/api/config/skills-market/install') {
        try {
            const b = await readBody(req)
            const rawUrl = (b.url || '').trim()
            const name = (b.name || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
            if (!rawUrl || !name) { res.writeHead(400); res.end(JSON.stringify({error: 'url and name required'})); return }

            let resp = null

            // ── 情况 1: github.com/owner/repo (裸 repo URL) ──
            const bareRepo = rawUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
            if (bareRepo) {
                const [_, owner, repo] = bareRepo
                // 尝试多种可能的 SKILL.md 路径
                const candidates = [
                    `skills/${name}/SKILL.md`,
                    `SKILL.md`,
                    `${name}/SKILL.md`,
                ]
                for (const fp of candidates) {
                    resp = await fetchRawGithub(owner, repo, 'main', fp)
                    if (resp) break
                }
                if (!resp) {
                    res.writeHead(502)
                    res.end(JSON.stringify({error: `仓库 ${owner}/${repo} 中未找到 SKILL.md，尝试路径: ${candidates.join(', ')}`}))
            return true
                }
            }

            // ── 情况 2: github.com/owner/repo/blob/<ref>/<path> ──
            const blobUrl = rawUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/)
            if (!resp && blobUrl) {
                resp = await fetchRawGithub(blobUrl[1], blobUrl[2], blobUrl[3], blobUrl[4])
                if (!resp) {
                    res.writeHead(502)
                    res.end(JSON.stringify({error: `无法从 ${blobUrl[1]}/${blobUrl[2]} 下载 ${blobUrl[4]}`}))
            return true
                }
            }

            // ── 情况 3: raw.githubusercontent.com / cdn.jsdelivr.net 等直链 ──
            const rawGitHub = rawUrl.match(/^https:\/\/(?:raw\.githubusercontent\.com|cdn\.jsdelivr\.net\/gh|mirror\.ghproxy\.com\/https\/raw\.githubusercontent\.com)\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/)
            if (!resp && rawGitHub) {
                resp = await fetchRawGithub(rawGitHub[1], rawGitHub[2], rawGitHub[3], rawGitHub[4])
                if (!resp) {
                    res.writeHead(502)
                    res.end(JSON.stringify({error: `无法下载 ${rawGitHub[4]}，所有镜像均失败`}))
            return true
                }
            }

            // ── 情况 4: 其他直链 URL（仅允许已知代码托管平台，防止 SSRF）──
            if (!resp) {
                const allowedHosts = /^https:\/\/([^/]+\.)?(github\.com|githubusercontent\.com|gitlab\.com|bitbucket\.org|jsdelivr\.net|ghproxy\.com|gitee\.com)(\/|$)/i
                if (allowedHosts.test(rawUrl)) {
                    try {
                        resp = await fetch(rawUrl, {signal: AbortSignal.timeout(30000)})
                    } catch (error) {
                        log.debug({err: error, url: rawUrl}, 'Skill 直链下载失败')
                    }
                }
            }

            if (!resp || !resp.ok) { res.writeHead(502); res.end(JSON.stringify({error: `下载失败 ${resp?.status || '网络不可达'}`})); return }
            const content = (await readFetchBodyLimited(resp, MAX_REMOTE_TEXT_BYTES)).toString('utf8')
            if (!content.trim()) { res.writeHead(502); res.end(JSON.stringify({error: '下载内容为空'})); return }

            // ── 校验: 拒绝非 SKILL.md 内容（GitHub HTML 页面等）──
            if (!content.includes('---') && content.includes('<!DOCTYPE')) {
                res.writeHead(502)
                res.end(JSON.stringify({error: '下载内容非 SKILL.md（可能是 GitHub 页面），请提供原始文件直链'}))
            return true
            }

            const d = join(BRIDGE_HOME, 'skills', name)
            mkdirSync(d, {recursive: true})
            writeFileSync(join(d, 'SKILL.md'), content, 'utf8')
            log.info({name}, 'skill 已从市场安装')
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, name}))
        } catch (e) {
            log.error({err: e}, 'skill 安装失败')
            res.writeHead(500)
            res.end(JSON.stringify({error: e.message || '安装失败'}))
        }
            return true
    }
    // ── GET/PUT /api/config/caveman —— Caveman 压缩模式配置 ──
    // 功能说明: GET 读取 Caveman 配置 + 版本信息；PUT 全量写入
    if (url.pathname === '/api/config/caveman') {
        if (req.method === 'GET') {
            res.writeHead(200)
            res.end(JSON.stringify({
                ...loadCavemanConfig(),
                cavemanCurrent: dynamicCache.cavemanCurrent || null,
                cavemanUpdate: dynamicCache.cavemanUpdate || null,
                releases: dynamicCache.cavemanReleases || [],
            }))
            return true
        }
        if (req.method === 'PUT') {
            try {
                const b = await readBody(req)
                const level = (b.level || 'full').trim()
                if (!CAVEMAN_VALID_LEVELS.includes(level)) {
                    res.writeHead(400)
                    res.end(JSON.stringify({error: `无效级别，支持: ${CAVEMAN_VALID_LEVELS.join(', ')}`}))
            return true
                }
                saveCavemanConfig({enabled: !!b.enabled, level})
                res.writeHead(200)
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500)
                res.end(JSON.stringify({error: e.message}))
            }
            return true
        }
    }
    // ── POST /api/config/caveman/update —— 下载并替换 Caveman SKILL.md ──
    if (req.method === 'POST' && url.pathname === '/api/config/caveman/update') {
        try {
            const b = await readBody(req)
            const version = (b.version || '').trim()
            if (!version) { res.writeHead(400); res.end(JSON.stringify({error: 'version required'})); return }
            await downloadAndReplaceCaveman(version)
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, version}))
        } catch (e) {
            log.error({err: e}, 'Caveman 更新失败')
            res.writeHead(500)
            res.end(JSON.stringify({error: e.message}))
        }
            return true
    }
    // ── GET/PUT /api/config/rtk —— RTK Bash 压缩配置 ──
    // 功能说明: GET 返回 rtk 配置 + 版本更新信息 + 可用版本列表；PUT 全量写入 enabled
    //   配置存 settings.json → bashCompress: {enabled}
    //   版本存 dynamicCache → rtkUpdate + rtkReleases
    // 关键数据流: GET → loadRtkConfig() + dynamicCache → 200 {enabled, rtkAvailable, rtkUpdate, releases}
    //   PUT {enabled} → saveRtkConfig → 200 {ok:true}
    if (url.pathname === '/api/config/rtk') {
        if (req.method === 'GET') {
            const cfg = loadRtkConfig()
            const rtkPath = locateRtk()
            res.writeHead(200)
            res.end(JSON.stringify({
                enabled: cfg.enabled,
                rtkAvailable: !!rtkPath,
                rtkCurrent: dynamicCache.rtkCurrent || null,
                rtkUpdate: dynamicCache.rtkUpdate || null,
                releases: dynamicCache.rtkReleases || [],
            }))
            return true
        }
        if (req.method === 'PUT') {
            try {
                const b = await readBody(req)
                saveRtkConfig({enabled: !!b.enabled})
                res.writeHead(200)
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500)
                res.end(JSON.stringify({error: e.message}))
            }
            return true
        }
    }
    // ── POST /api/config/rtk/update —— 下载并替换 RTK 二进制 ──
    // 功能说明: 从 GitHub 下载指定版本 → 解压 → 替换本地二进制 + version.txt
    //   仅管理员操作；下载约 120s 超时
    // 关键数据流: POST {version: "v0.42.4"} → downloadAndReplaceRtk → 200 {ok, version}
    if (req.method === 'POST' && url.pathname === '/api/config/rtk/update') {
        try {
            const b = await readBody(req)
            const version = (b.version || '').trim()
            if (!version) { res.writeHead(400); res.end(JSON.stringify({error: 'version required'})); return }
            await downloadAndReplaceRtk(version)
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, version}))
        } catch (e) {
            log.error({err: e}, 'RTK 更新失败')
            res.writeHead(500)
            res.end(JSON.stringify({error: e.message}))
        }
            return true
    }
    // ── GET /api/config/hooks —— 列出所有 Hooks ──
    // 功能说明: 从 settings.json 中读取 hooks 配置，同时读取 ~/.claude-desktop-bridge/hooks/ 下对应的脚本文件内容
    //   返回按事件类型分组的 hooks 列表，每个 hook 包含对应的脚本文件内容
    // 实现方式: readJSON settings.json → 提取 hooks 字段 → 遍历匹配 hooks 目录下实际脚本 → 嵌入 content
    // 关键数据流: settings.json hooks → 匹配 hooks/ 目录文件 → 200 {hooks: {eventType: [{matcher, hooks:[{command, filename, content}]}]}}
    if (req.method === 'GET' && url.pathname === '/api/config/hooks') {
        const hp = join(BRIDGE_HOME, 'settings.json');
        const hd = join(BRIDGE_HOME, 'hooks');
        const hooks = {};
        try {
            const s = readJSON(hp);
            if (s?.hooks) {
                for (const [et, entries] of Object.entries(s.hooks)) {
                    hooks[et] = entries.map(e => ({
                        matcher: e.matcher || '*',
                        timeout: e.timeout || 0,
                        source: 'custom',
                        hooks: (e.hooks || []).map(h => {
                            const fn = basename(h.command?.split(/\s+/).pop() || '');
                            let c = '';
                            try {
                                const hookPath = safeBasename(hd, fn, {extensions: ['.sh', '.js']})
                                if (hookPath) c = readFileSync(hookPath, 'utf8')
                            } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
                            ;
                            return {...h, filename: fn, content: c, source: 'custom'}
                        })
                    }))
                }
            }
        } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
        ;res.writeHead(200);
        res.end(JSON.stringify(hooks));
            return true
    }
    const hookFileM = url.pathname.match(/^\/api\/config\/hooks\/([^/]+)$/);
    if (hookFileM) {
        const fn = safeDecodeURIComponent(hookFileM[1]);
        const hd = join(BRIDGE_HOME, 'hooks')
        if (!/^[a-zA-Z0-9_.-]+\.(sh|js)$/.test(fn)) {
            res.writeHead(400)
            res.end(JSON.stringify({error: 'invalid hook filename'}))
            return true
        }
        const fp = safeBasename(hd, fn, {extensions: ['.sh', '.js']})
        if (!fp) {
            res.writeHead(400)
            res.end(JSON.stringify({error: 'invalid hook path'}))
            return true
        }
        if (req.method === 'GET') {
            try {
                const c = readFileSync(fp, 'utf8');
                res.writeHead(200);
                res.end(JSON.stringify({filename: fn, content: c, size: c.length}))
            } catch {
                res.writeHead(404);
                res.end(JSON.stringify({error: 'not found'}))
            }
            ;
            return true
        }
        if (req.method === 'PUT') {
            try {
                const b = await readBody(req);
                backupFile(fp);
                writeFileSync(fp, b.content, 'utf8');
                res.writeHead(200);
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({error: e.message}))
            }
            ;
            return true
        }
    }
    // ── POST /api/config/hooks —— 创建新 Hook 脚本 ──
    // 功能说明: 在 ~/.claude-desktop-bridge/hooks/ 下创建新的 .sh 或 .js 脚本文件，文件名自动 sanitize
    //   默认填充 #!/usr/bin/env bash + set -euo pipefail 模板
    // 关键数据流: POST {filename, content?} → writeFileSync → 201 {ok:true, filename}
    if (req.method === 'POST' && url.pathname === '/api/config/hooks') {
        try {
            const b = await readBody(req);
            let fn = (b.filename || 'new-hook').trim().replace(/[^a-zA-Z0-9_.-]/g, '-');
            if (!fn.endsWith('.sh') && !fn.endsWith('.js')) fn += '.sh';
            const hd = join(BRIDGE_HOME, 'hooks')
            const fp = safeBasename(hd, fn, {extensions: ['.sh', '.js']})
            if (!fp) {
                res.writeHead(400)
                res.end(JSON.stringify({error: 'invalid hook filename'}))
            return true
            }
            if (existsSync(fp)) {
                res.writeHead(409);
                res.end(JSON.stringify({error: 'exists'}));
            return true
            }
            if (!existsSync(hd)) mkdirSync(hd, {recursive: true})
            ;writeFileSync(fp, b.content || '#!/usr/bin/env bash\nset -euo pipefail\n', 'utf8');
            res.writeHead(201);
            res.end(JSON.stringify({ok: true, filename: fn}))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: e.message}))
        }
        ;
            return true
    }
    // ── 内置 Rules 名称集合（与项目 CLAUDE.md 模板一起发布的规则）──
    const builtinRuleState = new Map(getBuiltinResourceState({bridgeHome: BRIDGE_HOME})
        .filter(item => item.type === 'rule').map(item => [item.target.replace(/^rules\//, '').replace(/\.md$/, ''), item]))
    // ── 递归扫描 rules/ 目录下所有 .md 文件 ──
    function scanRulesDir(dir, baseDir, result) {
        for (const entry of readdirSync(dir, {withFileTypes: true})) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                scanRulesDir(full, baseDir, result);
            } else if (entry.name.endsWith('.md')) {
                try {
                    const c = readFileSync(full, 'utf8');
                    const {frontmatter: fm} = parseFrontmatter(c);
                    const relPath = relative(baseDir, full).replace(/\\/g, '/');
                    const stem = entry.name.replace(/\.md$/, '');
                    const builtin = builtinRuleState.get(stem)
                    result.push({filename: relPath, content: c, frontmatter: fm, size: c.length, source: builtin ? 'builtin' : 'custom', enabled: builtin?.enabled ?? true, customized: builtin?.customized ?? false, required: builtin?.required ?? false})
                } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
            }
        }
    }
    // ── GET /api/config/rules —— 列出所有 Rules ──
    // 功能说明: 递归扫描 ~/.claude-desktop-bridge/rules/ 目录下所有 .md 文件，解析 frontmatter 返回源数据
    //   Rules 为按文件扩展名匹配注入的编码规范
    // 关键数据流: rules/ 目录 → 遍历 .md → parseFrontmatter → 200 {rules: [{filename, content, frontmatter}]}
    if (req.method === 'GET' && url.pathname === '/api/config/rules') {
        const rd = join(BRIDGE_HOME, 'rules');
        const r = [];
        try {
            scanRulesDir(rd, rd, r)
        } catch (error) {
            log.warn({err: error, rulesDir: rd}, '扫描 Rules 目录失败')
        }
        res.writeHead(200);
        res.end(JSON.stringify({rules: r}));
            return true
    }
    const ruleM = url.pathname.match(/^\/api\/config\/rules\/(.+)$/);
    if (ruleM) {
        let fn = safeDecodeURIComponent(ruleM[1]);
        const rulesDir = join(BRIDGE_HOME, 'rules')
        const fp = safeChildPath(rulesDir, fn, {extensions: ['.md']})
        if (!fp) {
            res.writeHead(400); res.end(JSON.stringify({error: 'invalid filename'})); return
        }
        if (req.method === 'GET') {
            try {
                const c = readFileSync(fp, 'utf8');
                const {frontmatter: fm} = parseFrontmatter(c);
                res.writeHead(200);
                res.end(JSON.stringify({filename: fn, content: c, frontmatter: fm, size: c.length}))
            } catch {
                res.writeHead(404);
                res.end(JSON.stringify({error: 'not found'}))
            }
            ;
            return true
        }
        if (req.method === 'PUT') {
            try {
                const b = await readBody(req);
                if (!existsSync(dirname(fp))) mkdirSync(dirname(fp), {recursive: true});
                backupFile(fp);
                writeFileSync(fp, b.content, 'utf8');
                res.writeHead(200);
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({error: e.message}))
            }
            ;
            return true
        }
        if (req.method === 'DELETE') {
            try {
                if (getBuiltinResourceState({bridgeHome: BRIDGE_HOME}).some(item => item.type === 'rule' && item.target === `rules/${fn}`)) {
                    res.writeHead(409)
                    res.end(JSON.stringify({error: '内置 Rule 不能删除，请使用启用/关闭开关'}))
            return true
                }
                backupFile(fp);
                if (existsSync(fp)) unlinkSync(fp);
                res.writeHead(200);
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({error: e.message}))
            }
            ;
            return true
        }
    }
    // ── POST /api/config/rules —— 创建新 Rule ──
    // 功能说明: 在 ~/.claude-desktop-bridge/rules/ 下创建新的 .md 规则文件，文件名自动 sanitize
    //   默认模板包含 paths frontmatter 配置
    // 关键数据流: POST {filename, content?, paths?} → writeFileSync → 201 {ok:true, filename}
    if (req.method === 'POST' && url.pathname === '/api/config/rules') {
        try {
            const b = await readBody(req);
            let fn = (b.filename || 'new-rule').trim().replace(/[^a-zA-Z0-9_.-]/g, '-');
            if (!fn.endsWith('.md')) fn += '.md';
            const fp = join(BRIDGE_HOME, 'rules', fn);
            if (existsSync(fp)) {
                res.writeHead(409);
                res.end(JSON.stringify({error: 'exists'}));
            return true
            }
            ;writeFileSync(fp, b.content || `---\npaths: "${b.paths || '**/*.*'}"\n---\n\n`, 'utf8');
            res.writeHead(201);
            res.end(JSON.stringify({ok: true, filename: fn}))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: e.message}))
        }
        ;
            return true
    }
    // ── Agents CRUD（~/.claude-desktop-bridge/agents/<name>.md，frontmatter: name/description/tools/model）──
    if (req.method === 'GET' && url.pathname === '/api/config/agents') {
        const ad = join(BRIDGE_HOME, 'agents');
        const r = [];
        const seen = new Set()
        const builtinAgentState = getBuiltinResourceState({bridgeHome: BRIDGE_HOME}).filter(item => item.type === 'agent')
        const builtinAgentByName = new Map(builtinAgentState.map(item => [item.id, item]))
        try {
            for (const fn of readdirSync(ad)) {
                if (!fn.endsWith('.md')) continue
                try {
                    const c = readFileSync(join(ad, fn), 'utf8')
                    const {frontmatter: fm} = parseFrontmatter(c)
                    const name = fm.name || fn.replace(/\.md$/, '')
                    seen.add(name)
                    const isBuiltin = Array.isArray(dynamicCache.agentNames) && dynamicCache.agentNames.includes(name)
                    r.push({
                        filename: fn,
                        name,
                        description: fm.description || '',
                        type: fm.type || '',
                        language: fm.language || '',
                        tools: fm.tools || '',
                        model: fm.model || 'inherit',
                        content: c,
                        size: c.length,
                        loaded: isBuiltin,
                        source: builtinAgentByName.has(name) ? 'builtin' : 'custom',
                        enabled: builtinAgentByName.get(name)?.enabled ?? true,
                        customized: builtinAgentByName.get(name)?.customized ?? false,
                        required: builtinAgentByName.get(name)?.required ?? false,
                    })
                } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
            }
        } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
        if (Array.isArray(builtinCache.agents)) {
            for (const an of builtinCache.agents) {
                if (!seen.has(an)) r.push({
                    filename: '',
                    name: an,
                    type: BUILTIN_AGENT_TYPES[an] || '',
                    description: '',
                    tools: '',
                    model: 'inherit',
                    content: null,
                    size: 0,
                    loaded: true,
                    source: 'sdk-builtin',
                    enabled: true,
                })
            }
        }
        res.writeHead(200);
        res.end(JSON.stringify({agents: r}));
            return true
    }
    const agentM = url.pathname.match(/^\/api\/config\/agents\/(.+)$/)
    if (agentM) {
        const an = safeDecodeURIComponent(agentM[1]).replace(/\.md$/, '').replace(/[^a-zA-Z0-9_-]/g, '-')
        const fp = join(BRIDGE_HOME, 'agents', an + '.md')
        if (req.method === 'GET') {
            try {
                const c = readFileSync(fp, 'utf8');
                const {frontmatter: fm} = parseFrontmatter(c);
                res.writeHead(200);
                res.end(JSON.stringify({
                    name: fm.name || an,
                    description: fm.description || '',
                    tools: fm.tools || '',
                    model: fm.model || 'inherit',
                    content: c
                }))
            } catch {
                res.writeHead(404);
                res.end(JSON.stringify({error: 'not found'}))
            }
            ;
            return true
        }
        if (req.method === 'PUT') {
            try {
                const b = await readBody(req);
                if (!existsSync(dirname(fp))) mkdirSync(dirname(fp), {recursive: true});
                backupFile(fp);
                writeFileSync(fp, b.content, 'utf8');
                res.writeHead(200);
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({error: e.message}))
            }
            ;
            return true
        }
        if (req.method === 'DELETE') {
            try {
                if (getBuiltinResourceState({bridgeHome: BRIDGE_HOME}).some(item => item.type === 'agent' && item.target === `agents/${an}.md`)) {
                    res.writeHead(409)
                    res.end(JSON.stringify({error: '内置 Agent 不能删除，请使用启用/关闭开关'}))
            return true
                }
                backupFile(fp);
                if (existsSync(fp)) unlinkSync(fp);
                res.writeHead(200);
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({error: e.message}))
            }
            ;
            return true
        }
    }
    // ── POST /api/config/agents —— 创建新 Agent ──
    // 功能说明: 在 ~/.claude-desktop-bridge/agents/ 下创建新的 .md 文件，名称自动 sanitize
    //   默认 frontmatter 模板: tools 留空 = 继承全部工具，model 默认 inherit
    // 关键数据流: POST {name, description?, tools?, model?} → writeFileSync → 201 {ok:true, name}
    if (req.method === 'POST' && url.pathname === '/api/config/agents') {
        try {
            const b = await readBody(req)
            const n = (b.name || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
            if (!n) {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'name required'}));
            return true
            }
            const ad = join(BRIDGE_HOME, 'agents');
            if (!existsSync(ad)) mkdirSync(ad, {recursive: true})
            const fp = join(ad, n + '.md')
            if (existsSync(fp)) {
                res.writeHead(409);
                res.end(JSON.stringify({error: 'exists'}));
            return true
            }
            // 默认 frontmatter 模板：tools 留空表示继承全部工具
            // 字段值去除换行防止 YAML 注入；name 已在上方 sanitize 为 [a-z0-9-]
            const lang = b.language || ''
            const safe = (v) => String(v || '').replace(/[\r\n]/g, ' ')
            const tpl = b.content || `---\nname: ${n}\ntype: ${safe(b.type)}\nlanguage: ${lang}\ndescription: ${safe(b.description)}\ntools: ${safe(b.tools)}\nmodel: ${safe(b.model) || 'inherit'}\n---\n\n`
            writeFileSync(fp, tpl, 'utf8')
            res.writeHead(201);
            res.end(JSON.stringify({ok: true, name: n}));
            return true
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: e.message}));
            return true
        }
    }

    // 动态斜杠命令列表：活跃 query 调 supportedCommands()，缓存供冷启动
    // ── GET /api/config/commands —— 动态斜杠命令列表 ──
    // 功能说明: 通过活跃 query 调用 supportedCommands() 获取 Claude Code 内置命令列表
    //   有活跃 query 时实时获取并刷新缓存；没有则回退 dynamicCache 或 BUILTIN_COMMANDS 兜底列表
    // 实现方式: getLiveQuery() → withTimeout(q.supportedCommands(), 5s) → 更新 dynamicCache + 持久化
    //   兜底: BUILTIN_COMMANDS 含 20 个常见命令（help/clear/compact/config/cost/review 等）
    // 关键数据流: GET → getLiveQuery() → supportedCommands() → commands 列表 || BUILTIN_COMMANDS → 200 {commands, live, cachedAt}
    if (req.method === 'GET' && url.pathname === '/api/config/commands') {
        const q = getLiveQuery();
        if (q) {
            try {
                const cmds = await withTimeout(q.supportedCommands(), 5000);
                if (Array.isArray(cmds) && cmds.length) {
                    dynamicCache.commands = cmds;
                    dynamicCache.updatedAt = Date.now();
                    persistDynamicCache()
                }
            } catch (e) {
                log.warn({err: e}, 'supportedCommands 失败')
            }
        }
        ;const commandsEnabled = getBuiltinResourceState({bridgeHome: BRIDGE_HOME}).find(item => item.type === 'command' && item.id === 'commands')?.enabled !== false
        const commandsList = (dynamicCache.commands?.length ? dynamicCache.commands : null) || BUILTIN_COMMANDS;
        const builtin = commandsList.map(c => ({...c, source: 'builtin', enabled: commandsEnabled}));
        const custom = IM_CUSTOM_COMMANDS.map(c => ({...c, source: 'custom'}));
        const tagged = [...builtin, ...custom];
        res.writeHead(200);
        res.end(JSON.stringify({commands: tagged, builtinEnabled: commandsEnabled, live: !!q, cachedAt: dynamicCache.updatedAt}));
            return true
    }

    // ── GET /api/config/builtin-resources —— 统一内置资源清单与启用状态 ──
    if (req.method === 'GET' && url.pathname === '/api/config/builtin-resources') {
        try {
            res.writeHead(200)
            res.end(JSON.stringify({resources: getBuiltinResourceState({bridgeHome: BRIDGE_HOME})}))
        } catch (error) {
            log.error({err: error}, '读取内置资源状态失败')
            res.writeHead(500)
            res.end(JSON.stringify({error: String(error?.message || error)}))
        }
            return true
    }

    // ── PUT /api/config/builtin-resources/:type/:id —— 持久化单项开关 ──
    const builtinResourceMatch = url.pathname.match(/^\/api\/config\/builtin-resources\/([^/]+)\/([^/]+)$/)
    if (req.method === 'PUT' && builtinResourceMatch) {
        try {
            const type = safeDecodeURIComponent(builtinResourceMatch[1])
            const id = safeDecodeURIComponent(builtinResourceMatch[2])
            const body = await readBody(req)
            if (typeof body.enabled !== 'boolean') {
                res.writeHead(400)
                res.end(JSON.stringify({error: 'enabled 必须是布尔值'}))
            return true
            }
            const resource = setBuiltinResourceEnabled({bridgeHome: BRIDGE_HOME, type, id, enabled: body.enabled})
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, resource}))
        } catch (error) {
            const status = ['BUILTIN_RESOURCE_NOT_FOUND', 'BUILTIN_RESOURCE_REQUIRED'].includes(error?.code) ? 400 : 500
            res.writeHead(status)
            res.end(JSON.stringify({ok: false, error: String(error?.message || error), code: error?.code || 'BUILTIN_RESOURCE_UPDATE_FAILED'}))
        }
            return true
    }


        if (url.pathname === '/api/config/workflow-settings') {
            if (req.method === 'GET') { json(res, 200, loadWfConfig()); return true }
            if (req.method === 'PUT') { const body = await readBody(req); saveWfConfig({...loadWfConfig(), ...body}); json(res, 200, {ok: true}); return true }
        }
        return false
    }
}
