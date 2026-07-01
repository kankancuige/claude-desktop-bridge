import { defineConfig, Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import pkg from 'vite-plugin-monaco-editor'
import { readdirSync } from 'fs'
import { resolve } from 'path'

const monacoEditorPlugin: any = (pkg as any).default || pkg

// 构建时自动扫描 public/media/ 下所有 PNG，生成宠物列表虚拟模块
function petScanner(): Plugin {
  const VIRTUAL_ID = 'virtual:pet-list'
  return {
    name: 'pet-scanner',
    resolveId(id) {
      if (id === VIRTUAL_ID) return '\0' + VIRTUAL_ID
    },
    load(id) {
      if (id === '\0' + VIRTUAL_ID) {
        const mediaDir = resolve(__dirname, 'public/media')
        let files: string[] = []
        try { files = readdirSync(mediaDir).filter(f => f.endsWith('.png')) } catch { console.warn('[petScanner] public/media/ 目录未找到，宠物列表为空') }
        const pets = files.map(f => {
          const id = f.replace(/\.png$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
          return { id, label: f, src: `media/${f}` }
        })
        return `export default ${JSON.stringify(pets)}`
      }
    },
  }
}

// 构建时常量注入 —— 编译进 bundle，防止盗用
const __DEFINES__ = {
  __REPO_URL__: JSON.stringify('https://github.com/kankancuige/claude-desktop-bridge'),
  __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  __COPYRIGHT__: JSON.stringify('Copyright (c) Claude Desktop Bridge. Unauthorized distribution prohibited.'),
}

export default defineConfig({
  plugins: [
    vue(),
    monacoEditorPlugin({
      languageWorkers: ['editorWorkerService', 'typescript', 'json', 'css', 'html'],
    }),
    petScanner(),
  ],
  define: __DEFINES__,
  base: './',
  server: {
    port: parseInt(process.env.PORT || '5173', 10),
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
