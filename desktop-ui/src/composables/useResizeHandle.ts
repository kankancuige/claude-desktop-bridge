import { ref, onBeforeUnmount, type Ref } from 'vue'

export interface ResizeHandleOptions {
  /** 拖拽时要修改的宽度 ref */
  targetWidth: Ref<number>
  /** 最小宽度 (px) */
  minWidth: number
  /** 最大宽度 (px), 默认 800 */
  maxWidth?: number
  /**
   * 当 target 面板在 handle 右侧时为 true.
   * 拖拽方向取反: 向左拖 = 面板变宽.
   */
  reverse?: boolean
}

/**
 * 面板拖拽缩放 composable.
 * 在 handle 元素上绑定 @mousedown="onMouseDown" 即可.
 * 返回 `dragging` ref 用于 active 样式.
 */
export function useResizeHandle(options: ResizeHandleOptions) {
  const dragging = ref(false)
  const max = options.maxWidth ?? 800

  let startX = 0
  let startW = 0

  function onMouseMove(e: MouseEvent) {
    if (!dragging.value) return
    const rawDelta = e.clientX - startX
    const delta = options.reverse ? -rawDelta : rawDelta
    options.targetWidth.value = Math.max(options.minWidth, Math.min(max, startW + delta))
  }

  function onMouseUp() {
    dragging.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }

  function onMouseDown(e: MouseEvent) {
    e.preventDefault()
    dragging.value = true
    startX = e.clientX
    startW = options.targetWidth.value

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }

  onBeforeUnmount(() => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  })

  return { dragging, onMouseDown }
}
