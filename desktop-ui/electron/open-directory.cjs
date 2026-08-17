const fs = require('fs')
const path = require('path')

/**
 * 校验渲染进程提交的目录，并解析为真实绝对路径。
 * 主进程只把确认存在的目录交给系统 Shell，避免接受相对路径或文件路径。
 */
async function resolveOpenDirectory(input, dependencies = {}) {
  const stat = dependencies.stat || fs.promises.stat
  const realpath = dependencies.realpath || fs.promises.realpath
  const candidate = typeof input === 'string' ? input.trim() : ''
  if (!candidate || candidate.includes('\0') || !path.isAbsolute(candidate)) {
    return {ok: false, error: 'invalid_path'}
  }

  try {
    const info = await stat(candidate)
    if (!info.isDirectory()) return {ok: false, error: 'not_directory'}
    return {ok: true, path: await realpath(candidate)}
  } catch (error) {
    return {ok: false, error: error?.code === 'ENOENT' ? 'not_found' : 'unavailable'}
  }
}

/** 校验目录后交给 Electron Shell，统一返回可供界面处理的稳定结果。 */
async function openDirectoryInShell(input, shellOpenPath, dependencies = {}) {
  const resolved = await resolveOpenDirectory(input, dependencies)
  if (!resolved.ok) return resolved

  try {
    const error = await shellOpenPath(resolved.path)
    return error ? {ok: false, error: 'shell_open_failed'} : {ok: true}
  } catch {
    return {ok: false, error: 'shell_open_failed'}
  }
}

module.exports = {openDirectoryInShell, resolveOpenDirectory}
