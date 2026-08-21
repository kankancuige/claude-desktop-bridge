export const meta = {
  name: 'root-cause-analysis',
  description: '重复失败后执行只读根因分析，并由结构化证据决定是否允许新策略修复',
  phases: [
    {title: 'Diagnose', detail: '建立完整故障因果链'},
    {title: 'Decide', detail: '判断复现、外部阻塞与架构边界'},
  ],
}

// Workflow 子进程不暴露 process；目标目录只能由 Gateway 受控注入。
const target = args.path || args.target || '.'
const evidence = args.evidence && typeof args.evidence === 'object' ? args.evidence : {}
phase('Diagnose')
const diagnosis = await agent(
  '只读分析以下重复失败，不修改任何文件。必须按触发输入、数据转换、状态变化、持久化或消息传递、下游消费、生命周期、并发和架构边界建立因果链。没有代码或运行证据时不得猜测新根因。\n目标目录: ' + target + '\n失败证据:\n' + JSON.stringify(evidence),
  {
    label: 'root-cause-analysis',
    phase: 'Diagnose',
    agentType: 'root-cause-agent',
    modelTier: 'power',
    permissionMode: 'plan',
    schema: {
      type: 'object',
      properties: {
        newRootCause: {type: 'boolean'},
        newStrategy: {type: 'boolean'},
        reproducible: {type: 'boolean'},
        externalBlocker: {type: 'boolean'},
        architectureBoundary: {type: 'boolean'},
        summary: {type: 'string'},
        nextStrategy: {type: 'string'},
        causalChain: {
          type: 'object',
          properties: {
            trigger: {type: 'string'}, transformation: {type: 'string'}, stateChange: {type: 'string'},
            persistenceOrMessaging: {type: 'string'}, downstream: {type: 'string'}, lifecycle: {type: 'string'},
            concurrency: {type: 'string'}, architectureBoundary: {type: 'string'},
          },
        },
      },
      required: ['newRootCause', 'newStrategy', 'reproducible', 'externalBlocker', 'architectureBoundary', 'summary', 'nextStrategy', 'causalChain'],
    },
  },
)
phase('Decide')
return diagnosis
