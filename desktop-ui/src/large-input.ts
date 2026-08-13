export const LARGE_INPUT_THRESHOLD_BYTES = 80 * 1024
export const LARGE_INPUT_PART_BYTES = 7 * 1024 * 1024
export const LARGE_INPUT_MAX_BYTES = 40 * 1024 * 1024

export interface LargeInputPlan {
  converted: boolean
  bytes: number
  filename: string
  prompt: string
}

export interface LargeInputPart {
  filename: string
  text: string
  bytes: number
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function timestampForFilename(now: number): string {
  const date = new Date(now)
  const part = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`
}

function previewText(text: string, headChars = 6000, tailChars = 2000): string {
  if (text.length <= headChars + tailChars) return text
  return `${text.slice(0, headChars)}\n\n...[中间内容仅保存在附件中]...\n\n${text.slice(-tailChars)}`
}

function buildPrompt(text: string, filenames: string[], bytes: number): string {
  const attachmentDescription = filenames.length === 1
    ? `UTF-8 文本附件：${filenames[0]}`
    : `${filenames.length} 个 UTF-8 文本分片附件：\n${filenames.map((name, index) => `${index + 1}. ${name}`).join('\n')}`
  const readInstruction = filenames.length === 1
    ? '请先使用 Read 工具完整读取附件路径对应的文件，再严格按照文件中的完整内容执行任务。'
    : '请先使用 Read 工具按编号顺序完整读取全部分片附件，将其视为一份连续文本，再严格按照完整内容执行任务。不得遗漏、跳读或改变分片顺序。'
  return [
    `本次任务的完整输入内容较长，已自动保存为${attachmentDescription}（共 ${bytes} 字节）。`,
    readInstruction,
    '下面的首尾预览仅用于识别任务类型，不得用预览替代完整附件：',
    '',
    previewText(text),
  ].join('\n')
}

function safeChunkEnd(text: string, start: number, maxBytes: number): number {
  let low = start + 1
  let high = Math.min(text.length, start + maxBytes)
  let best = start
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const end = middle < text.length && /[\uD800-\uDBFF]/.test(text[middle - 1]) ? middle - 1 : middle
    const bytes = utf8ByteLength(text.slice(start, end))
    if (bytes <= maxBytes) {
      best = Math.max(best, end)
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  if (best <= start) throw new Error('无法按 UTF-8 边界拆分超长输入')
  return best
}

export function createLargeInputParts(
  text: string,
  baseFilename: string,
  maxPartBytes = LARGE_INPUT_PART_BYTES,
): LargeInputPart[] {
  if (!text) return []
  if (!Number.isFinite(maxPartBytes) || maxPartBytes < 4) throw new Error('无效的附件分片大小')
  const chunks: Array<{text: string; bytes: number}> = []
  let start = 0
  while (start < text.length) {
    const end = safeChunkEnd(text, start, maxPartBytes)
    const chunkText = text.slice(start, end)
    chunks.push({text: chunkText, bytes: utf8ByteLength(chunkText)})
    start = end
  }
  if (chunks.length === 1) return [{filename: baseFilename, ...chunks[0]}]
  const stem = baseFilename.replace(/\.txt$/i, '')
  const width = Math.max(3, String(chunks.length).length)
  return chunks.map((chunk, index) => ({
    filename: `${stem}.part-${String(index + 1).padStart(width, '0')}-of-${String(chunks.length).padStart(width, '0')}.txt`,
    ...chunk,
  }))
}

export function buildLargeInputPrompt(text: string, filenames: string[], bytes = utf8ByteLength(text)): string {
  return buildPrompt(text, filenames, bytes)
}

export function planLargeInput(
  text: string,
  options: {now?: number; thresholdBytes?: number} = {},
): LargeInputPlan {
  const bytes = utf8ByteLength(text)
  const thresholdBytes = options.thresholdBytes ?? LARGE_INPUT_THRESHOLD_BYTES
  if (bytes <= thresholdBytes) return {converted: false, bytes, filename: '', prompt: text}

  const filename = `long-input-${timestampForFilename(options.now ?? Date.now())}.txt`
  const prompt = buildPrompt(text, [filename], bytes)
  return {converted: true, bytes, filename, prompt}
}
