// 运行预算的稳定入口；实现集中在执行模式模块，避免两套预算语义漂移。
export {
    createTaskRunBudget,
    consumeTaskRunBudget,
    resolveContinuation,
} from './task-execution-mode.mjs'
