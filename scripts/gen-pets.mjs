/**
 * gen-pets — 宠物资源扫描与 PhaserPet.vue PETS 数组自动生成
 * ── 功能说明 ──
 * 扫描 desktop-ui/public/media/ 目录下的所有 .png 精灵图文件，
 * 自动生成 PhaserPet.vue 中的 PETS 配置数组（id/label/imageSrc/frameSize/states 等），
 * 并原地替换源文件中的 PETS 常量定义。
 *
 * ── 精灵图标准 ──
 * 每个 PNG 文件应为 spritesheet，标准布局:
 *   - 128x128 单帧尺寸，9 行对应不同动作状态
 *   - 行 1: stand(1帧), 行 2: walk(4帧), 行 3: sit(1帧), 行 4: greet(8帧)
 *   - 行 5: jump(1帧), 行 6: fall(3帧), 行 7: drag(1帧), 行 8: crawl(8帧), 行 9: climb(8帧)
 *
 * ── 用法 ──
 * node scripts/gen-pets.mjs
 */

const entries = files.map(f => {
  const id = f.replace(/\.png$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
  return `  {
    id: '${id}', label: '${f}',
    imageSrc: 'media/${f}', frameSize: 128, highestFrameMax: 8, scale: 0.9,
    states: {
      stand:{spriteLine:1,frameMax:1}, walk:{spriteLine:2,frameMax:4},
      sit:{spriteLine:3,frameMax:1}, greet:{spriteLine:4,frameMax:8},
      jump:{spriteLine:5,frameMax:1}, fall:{spriteLine:6,frameMax:3},
      drag:{spriteLine:7,frameMax:1}, crawl:{spriteLine:8,frameMax:8},
      climb:{spriteLine:9,frameMax:8},
    },
  }`
})

const newArray = `const PETS: PetEntry[] = [\n${entries.join(',\n')}\n]`

let src = readFileSync(vueFile, 'utf-8')
src = src.replace(/const PETS: PetEntry\[\] = \[[\s\S]*?\n\]/, newArray)
writeFileSync(vueFile, src, 'utf-8')
console.log(`Updated PETS array with ${files.length} entries`)
