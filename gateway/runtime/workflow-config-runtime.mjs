/** Workflow 全局配置的持久化端口。 */
export function createWorkflowConfigRuntime({filePath, readJSON, writeJSON} = {}) {
    if (!filePath || typeof readJSON !== 'function' || typeof writeJSON !== 'function') throw new TypeError('workflow config dependencies are required')

    function loadWfConfig() {
        return {
            enabled: false,
            journalCacheTTL: 30,
            modelTiers: {power: null, balanced: null, light: null},
            ...(readJSON(filePath) || {}),
        }
    }

    function saveWfConfig(config) {
        writeJSON(filePath, config)
    }

    return {loadWfConfig, saveWfConfig}
}
