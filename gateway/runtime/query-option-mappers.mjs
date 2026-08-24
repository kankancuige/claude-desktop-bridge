/** SDK thinking 参数映射。 */
export function mapThinkingLevel(level) {
    switch (level) {
        case 'off': return {type: 'disabled'}
        case 'low': return {type: 'enabled', budgetTokens: 2000}
        case 'medium': return {type: 'enabled', budgetTokens: 8000}
        case 'high': return {type: 'enabled', budgetTokens: 16000}
        case 'xhigh': return {type: 'enabled', budgetTokens: 24000}
        case 'max': return {type: 'enabled', budgetTokens: 32000}
        default: return {type: 'enabled', budgetTokens: 16000}
    }
}
