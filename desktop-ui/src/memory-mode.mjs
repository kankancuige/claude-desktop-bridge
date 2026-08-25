const READY_MODE = 'postgres'

export function isMemoryIndexReady(mode) {
  return mode === READY_MODE
}

export function memoryModeLabelKey(mode) {
  return isMemoryIndexReady(mode) ? 'mem.indexReady' : 'mem.fileMode'
}
