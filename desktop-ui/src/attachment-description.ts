const ATTACHMENT_KIND_LABELS: Record<string, string> = {
  image: '图片',
  pdf: 'PDF 文档',
  word: 'Word 文档',
  spreadsheet: '表格',
  presentation: '演示文稿',
  text: '文本文件',
  archive: '压缩包',
  binary: '二进制文件',
}

export function attachmentKindLabel(kind: string | undefined, filename: string): string {
  if (kind && ATTACHMENT_KIND_LABELS[kind]) return ATTACHMENT_KIND_LABELS[kind]
  const dot = filename.lastIndexOf('.')
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : ''
  if (ext === '.docx' || ext === '.doc' || ext === '.rtf' || ext === '.odt') return 'Word 文档'
  if (ext === '.xlsx' || ext === '.xls' || ext === '.csv' || ext === '.ods') return '表格'
  if (ext === '.pptx' || ext === '.ppt' || ext === '.odp') return '演示文稿'
  if (ext === '.pdf') return 'PDF 文档'
  return '文件'
}
