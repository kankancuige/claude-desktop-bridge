const os = require('os')
const path = require('path')

function resolveBridgeHome({env = process.env, homeDir = os.homedir()} = {}) {
  const configured = typeof env.BRIDGE_HOME === 'string' ? env.BRIDGE_HOME.trim() : ''
  if (configured && !path.isAbsolute(configured)) {
    const error = new Error('BRIDGE_HOME 必须是绝对路径')
    error.code = 'BRIDGE_HOME_NOT_ABSOLUTE'
    throw error
  }
  return path.normalize(path.resolve(configured || path.join(homeDir, '.claude-desktop-bridge')))
}

module.exports = {resolveBridgeHome}
