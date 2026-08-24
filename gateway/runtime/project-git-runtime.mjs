/** 项目 Git 上下文端口。Git 命令执行和 SDK 注入不再由组合根直接实现。 */
export function createProjectGitRuntime({execSync, markInternalInput, logger = {info() {}}} = {}) {
    if (typeof execSync !== 'function' || typeof markInternalInput !== 'function') throw new TypeError('project git dependencies are required')

    function buildGitContext(workDir) {
        try {
            const branch = execSync('git rev-parse --abbrev-ref HEAD', {cwd: workDir, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe']}).trim()
            const head = execSync('git rev-parse --short HEAD', {cwd: workDir, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe']}).trim()
            const log = execSync('git log --oneline -10', {cwd: workDir, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe']}).trim()
            const status = execSync('git status --short', {cwd: workDir, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe']}).trim()
            return `[GitContext]\nBranch: ${branch}\nHEAD: ${head}\n\n最近 10 条提交:\n${log}\n\n工作区状态:\n${status || '(clean)'}`
        } catch { return null }
    }

    function injectGitContext(sessionId, session, {markInput = markInternalInput} = {}) {
        if (session?._gitInjected || !session?.pushStream || !session?._gitContext) return false
        session._gitInjected = true
        markInput(session)
        session.pushStream.push({
            type: 'user', session_id: sessionId,
            message: {role: 'user', content: [{type: 'text', text: session._gitContext}]},
            parent_tool_use_id: null,
        })
        logger.info({sessionId: sessionId?.slice(0, 8)}, 'git-context 已注入')
        return true
    }

    return {buildGitContext, injectGitContext}
}
