/**
 * 各子组件共享的类型定义
 * 从 WorkspaceView.vue 提取，跨组件复用
 */

/** 文件变更状态 */
export type FileStatus = 'unchanged' | 'added' | 'modified' | 'deleted'

/** 扁平化文件条目 */
export interface FlatFile {
  path: string
  size: number
  binary: boolean
  status: FileStatus
  added: number | null
  removed: number | null
}

/** 文件树节点 */
export interface TreeNode {
  name: string
  path: string
  isDir: boolean
  file?: FlatFile
  children?: TreeNode[]
}

/** 工具调用记录 */
export interface ToolUse {
  tool_name: string
  tool_use_id: string
  input: Record<string, any>
  elapsed?: number
  expanded?: boolean
}

/** 消息数据结构 */
export interface Message {
  role: 'user' | 'assistant' | 'thinking' | 'system' | 'error'
  text: string
  time: number
  thinkingContent?: string
  thinkingId?: number
  expanded?: boolean
  tools?: ToolUse[]
  toolsExpanded?: boolean
}

/** 项目数据结构 */
export interface Project {
  workDir: string
  encodedDir: string
  sessionCount: number
  lastActive: number
  sessions: { id: string; title?: string; size: number }[]
}

/** Diff 单行 */
export interface DiffLine {
  type: 'context' | 'add' | 'del'
  oldNo: number | null
  newNo: number | null
  text: string
}

/** Diff 完整结果 */
export interface DiffResult {
  path: string
  status: string
  added?: number
  removed?: number
  lines?: DiffLine[]
  binary?: boolean
  tooLarge?: boolean
}

/** 记录点文件 */
export interface CheckpointFile {
  path: string
  status: FileStatus
  notRevertible?: boolean
  added: number | null
  removed: number | null
}

/** 记录点 */
export interface Checkpoint {
  id: string
  prompt: string
  time: number
  revertible: boolean
  fileCount: number
  added: number
  removed: number
  files: CheckpointFile[]
}

/** Agent 运行状态 */
export interface AgentRun {
  id: string
  agentType: string
  description?: string
  status: 'spawning' | 'running' | 'done' | 'error'
  source: 'native' | 'workflow'
  spawnTime?: number
  startTime?: number
  doneTime?: number
  progress?: string
  currentTool?: string
  currentToolElapsed?: number
  transcriptPath?: string
  expanded?: boolean
}
