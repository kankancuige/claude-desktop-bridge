/**
 * 从剪贴板提取文件附件。
 * Windows 资源管理器复制普通文件时，文件可能只出现在 clipboardData.files，
 * 也可能通过 items 暴露；两条路径都读取，并按文件元数据去重。
 */
export function collectClipboardFiles(clipboardData: DataTransfer | null | undefined): File[] {
  if (!clipboardData) return []

  const files: File[] = []
  const seen = new Set<string>()
  const add = (file: File | null | undefined) => {
    if (!file) return
    const key = `${file.name}\u0000${file.size}\u0000${file.lastModified}\u0000${file.type}`
    if (seen.has(key)) return
    seen.add(key)
    files.push(file)
  }

  for (const item of Array.from(clipboardData.items || [])) {
    try {
      add(item.getAsFile())
    } catch {
      // 某些浏览器对非文件剪贴板项调用 getAsFile 会抛异常，继续读取 files 回退路径。
    }
  }
  for (const file of Array.from(clipboardData.files || [])) add(file)
  return files
}
