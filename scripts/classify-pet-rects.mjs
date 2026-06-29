/**
 * classify-pet-rects — 宠物精灵矩形数据归类脚本
 * ── 功能说明 ──
 * 从 PetView.vue 的 SVG 中提取所有 <rect> 元素，按身体部位坐标区域归类，
 * 自动生成 desktop-ui/src/data/petRects.ts 数据文件。
 *
 * ── 归类逻辑 ──
 * PARTS 数组定义了各部位的坐标边界框（xMin/xMax/yMin/yMax），
 * 按优先级顺序匹配（先匹配到的优先），未被任何边界覆盖的矩形标记为 unclassified。
 *
 * ── 用法 ──
 * node scripts/classify-pet-rects.mjs
 *
 * ── 输出 ──
 * desktop-ui/src/data/petRects.ts（自动生成，勿手动编辑）
 */
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(__dirname, '../desktop-ui/src/views/PetView.vue'), 'utf-8')

// 提取所有 <g fill="..."> 块及其内的 <rect>
const gRegex = /<g fill="([^"]+)">([\s\S]*?)<\/g>/g
const rectRegex = /<rect x="(\d+)" y="(\d+)" width="14" height="14"\/>/g

const rects = []
let gMatch
while ((gMatch = gRegex.exec(src)) !== null) {
  const fill = gMatch[1]
  const content = gMatch[2]
  let rMatch
  while ((rMatch = rectRegex.exec(content)) !== null) {
    rects.push({ x: parseInt(rMatch[1]), y: parseInt(rMatch[2]), fill })
  }
}

console.log(`Total rects extracted: ${rects.length}`)

// 部位边界定义（按优先级，先匹配到的优先；body 兜底）
const PARTS = [
  { name: 'right_eye',  xMin: 658, xMax: 700, yMin: 84,  yMax: 112 },
  { name: 'left_eye',   xMin: 364, xMax: 420, yMin: 84,  yMax: 112 },
  { name: 'nose_mouth', xMin: 448, xMax: 518, yMin: 126, yMax: 168 },
  { name: 'right_ear',  xMin: 630, xMax: 700, yMin: 28,  yMax: 98  },
  { name: 'left_ear',   xMin: 294, xMax: 392, yMin: 28,  yMax: 98  },
  { name: 'tail',       xMin: 630, xMax: 700, yMin: 98,  yMax: 294 },
  { name: 'right_legs', xMin: 602, xMax: 700, yMin: 308, yMax: 518 },
  { name: 'left_legs',  xMin: 294, xMax: 448, yMin: 308, yMax: 518 },
  { name: 'head',       xMin: 364, xMax: 616, yMin: 28,  yMax: 168 },
  { name: 'body',       xMin: 308, xMax: 644, yMin: 168, yMax: 518 },
]

// 归类
const partRects = {}
const classified = new Set()

for (const part of PARTS) {
  partRects[part.name] = []
  for (const r of rects) {
    const key = `${r.x},${r.y}`
    if (classified.has(key)) continue
    if (r.x >= part.xMin && r.x <= part.xMax && r.y >= part.yMin && r.y <= part.yMax) {
      partRects[part.name].push(r)
      classified.add(key)
    }
  }
}

// 未归类的
const unclassified = rects.filter(r => !classified.has(`${r.x},${r.y}`))
if (unclassified.length > 0) {
  console.log(`\nWARNING: ${unclassified.length} unclassified rects:`)
  unclassified.forEach(r => console.log(`  x=${r.x} y=${r.y} fill=${r.fill}`))
}

// 统计
let total = unclassified.length
for (const [name, arr] of Object.entries(partRects)) {
  console.log(`  ${name}: ${arr.length} rects`)
  total += arr.length
}
console.log(`  Total: ${total}`)

// 生成 TypeScript
const lines = []
lines.push('// 自动生成 — 从 PetView.vue SVG 按身体部位归类')
lines.push('// 重新运行 scripts/classify-pet-rects.mjs 可重新生成')
lines.push('')
lines.push('export interface PetRect { x: number; y: number; fill: string }')
lines.push('')
lines.push('export const PET_PARTS: Record<string, PetRect[]> = {')
for (const part of PARTS) {
  const arr = partRects[part.name]
  lines.push(`  ${part.name}: [`)
  for (const r of arr) {
    lines.push(`    { x: ${r.x}, y: ${r.y}, fill: '${r.fill}' },`)
  }
  lines.push(`  ],`)
}
lines.push('}')
lines.push('')

const outPath = resolve(__dirname, '../desktop-ui/src/data/petRects.ts')
writeFileSync(outPath, lines.join('\n'), 'utf-8')
console.log(`\nWritten to ${outPath}`)
