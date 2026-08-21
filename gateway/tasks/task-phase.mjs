const PHASES = new Set(['prime', 'plan', 'implement', 'validate', 'review', 'report'])

export function resolveTaskPhases(decision = {}, context = {}) {
    const complexity = decision.complexity === 'power' ? 'power'
        : decision.complexity === 'light' && decision.action === 'inspect' ? 'focused'
            : decision.complexity === 'light' ? 'light' : 'balanced'
    let phases
    if (complexity === 'light') phases = ['report']
    else if (complexity === 'focused') phases = ['prime', 'report']
    else if (complexity === 'power') phases = ['prime', 'plan', 'implement', 'validate', 'review', 'report']
    else phases = ['implement', 'validate', 'report']
    if (!['implement', 'operate', 'refactor'].includes(decision.action)) phases = phases.filter(phase => phase !== 'implement')
    if (decision.finalReview === 'none') phases = phases.filter(phase => phase !== 'review')
    const unique = [...new Set(phases.filter(phase => PHASES.has(phase)))]
    return {
        version: 1,
        complexity,
        phases: unique,
        requiresProjectContext: complexity !== 'light',
        maxAgents: complexity === 'light' ? 0 : complexity === 'focused' ? 1 : complexity === 'balanced' ? 2 : Math.min(8, Math.max(3, Number(context.maxAgents) || 6)),
    }
}
