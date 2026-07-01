<script setup lang="ts">
/**
 * PhaserPet — 桌面宠物组件
 * 画布填满整个 session 窗口，宠物在窗口内自由走动。
 * 透明手柄覆在精灵上方接收拖拽事件，手柄外点击全部穿透。
 * 优化: FPS 20、Visibility API 暂停渲染、小碰撞体。
 */
import { ref, watch, onMounted, onActivated, onBeforeUnmount, nextTick, computed } from 'vue'
import Phaser from 'phaser'
import petListRaw from 'virtual:pet-list'

const props = defineProps<{
  state?: string
  message?: string
  bubble?: string
  isThinking?: boolean
  sessionDuration?: number
  petId?: string
}>()
const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'compact'): void
  (e: 'switch-pet', id: string): void
}>()

const el = ref<HTMLDivElement>()
const gameContainer = ref<HTMLDivElement>()
const handleEl = ref<HTMLDivElement>()
let game: Phaser.Game | null = null

interface PetDef { id: string; label: string; src: string }
interface PetConfig { id: string; label: string; imageSrc: string; frameSize: number; highestFrameMax: number; scale: number; states: Record<string, { spriteLine: number; frameMax: number }> }

const defaultStates = {
  stand:{spriteLine:1,frameMax:1}, walk:{spriteLine:2,frameMax:4},
  sit:{spriteLine:3,frameMax:1}, greet:{spriteLine:4,frameMax:8},
  jump:{spriteLine:5,frameMax:1}, fall:{spriteLine:6,frameMax:3},
  drag:{spriteLine:7,frameMax:1}, crawl:{spriteLine:8,frameMax:8},
  climb:{spriteLine:9,frameMax:8},
}

const list = petListRaw as unknown as PetDef[]
const PETS: PetConfig[] = list.map(p => ({
  id: p.id, label: p.label, imageSrc: p.src,
  frameSize: 128, highestFrameMax: 8, scale: 0.9, states: defaultStates,
}))

const currentPetId = computed(() => props.petId || PETS[0]?.id || '')
const currentPet = computed(() => PETS.find(p => p.id === currentPetId.value) || PETS[0])
const petList = computed(() => PETS.map(p => ({ id: p.id, label: p.label })))

function switchPet(id: string) {
  if (id === currentPetId.value) return
  ctxMenu.value = false
  emit('switch-pet', id)
}

watch(() => props.petId, (newId, oldId) => {
  if (!game) return
  if (newId && newId !== oldId) {
    destroyGame()
    nextTick(() => initPhaser())
  }
})

// ── 右键菜单 ──
const ctxMenu = ref(false)
const ctxPos = ref({ x: 0, y: 0 })

function onCtx(e: MouseEvent) {
  e.preventDefault()
  let x = e.clientX
  let y = e.clientY
  if (x + 210 > window.innerWidth) x = window.innerWidth - 210
  if (y + 400 > window.innerHeight) y = window.innerHeight - 400
  ctxPos.value = { x, y }
  ctxMenu.value = true
}
function closeCtx() { ctxMenu.value = false }

// ═══════════════════════════════════════════
// ── DOM ↔ Phaser 通信桥（module 级简单变量）──
// ═══════════════════════════════════════════
const BRIDGE = {
  scene: null as PetScene | null,
  handle: null as HTMLElement | null,
}

// ── DOM 拖拽手柄 ──

const HANDLE_SIZE = 96
let dragState: { sx: number; sy: number } | null = null

function onHandleMouseDown(e: MouseEvent) {
  if (e.button !== 0 || !BRIDGE.scene) return
  BRIDGE.scene.beginDrag()
  dragState = { sx: e.screenX, sy: e.screenY }
  e.preventDefault()
  e.stopPropagation()
}

function onDocMouseMove(e: MouseEvent) {
  if (!dragState || !BRIDGE.scene) return
  const s = BRIDGE.scene
  const dx = e.screenX - dragState.sx
  const dy = e.screenY - dragState.sy
  dragState.sx = e.screenX
  dragState.sy = e.screenY
  s.movePetBy(dx, dy)
}

function onDocMouseUp(_e: MouseEvent) {
  if (!dragState) return
  dragState = null
  BRIDGE.scene?.endDrag()
}

// ═══════════════════════════════════════════
// ── Phaser 场景 ──
// ═══════════════════════════════════════════
const FRAME_RATE = 9
const MARGIN = 36

class PetScene extends Phaser.Scene {
  pet!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody
  private currentState = 'stand'
  private idleTimer = 0
  private idleThreshold = 0
  private walkTarget: { x: number; y: number } | null = null
  private lastPetState = ''
  private cfg!: PetConfig
  private bubbleContainer: Phaser.GameObjects.Container | null = null
  private lastBubble = ''
  dragging = false

  constructor() { super('PetScene') }

  preload() {
    this.cfg = currentPet.value
    this.load.spritesheet('pet', this.cfg.imageSrc, {
      frameWidth: this.cfg.frameSize,
      frameHeight: this.cfg.frameSize,
    })
  }

  create() {
    const { width, height } = this.scale
    const hfm = this.cfg.highestFrameMax
    for (const [state, s] of Object.entries(this.cfg.states)) {
      const start = (s.spriteLine - 1) * hfm
      const end = start + s.frameMax - 1
      const key = this.animKey(state)
      if (!this.anims.exists(key)) {
        this.anims.create({
          key, frames: this.anims.generateFrameNumbers('pet', { start, end, first: start }),
          frameRate: FRAME_RATE, repeat: -1,
        })
      }
    }
    this.pet = this.physics.add.sprite(width / 2, height / 2, 'pet')
    this.pet.setScale(this.cfg.scale)
    this.pet.setCollideWorldBounds(true)
    this.pet.body!.setAllowGravity(false)
    this.pet.body!.setBounce(0)
    this.pet.body!.setSize(60, 30)
    this.pet.body!.setOffset((this.cfg.frameSize - 60) / 2, this.cfg.frameSize - 30)
    this.physics.world.setBounds(MARGIN, MARGIN, width - MARGIN * 2, height - MARGIN * 2)
    this.physics.world.setBoundsCollision(true, true, true, true)
    this.pet.play(this.animKey('stand'))
    this.lastPetState = this.game.registry.get('petState') || 'idle'
    this.resetIdleThreshold()

    // 注册到通信桥
    BRIDGE.scene = this
    this.syncHandle()
  }

  /** DOM 手柄开始拖拽 */
  beginDrag() {
    this.dragging = true
    this.stopMove()
    this.switchState('drag')
    if (this.pet.body) this.pet.body.moves = false
  }

  /** DOM 手柄增量移动 pet */
  movePetBy(dx: number, dy: number) {
    const { width, height } = this.scale
    this.pet.x = Phaser.Math.Clamp(this.pet.x + dx, MARGIN, width - MARGIN)
    this.pet.y = Phaser.Math.Clamp(this.pet.y + dy, MARGIN, height - MARGIN)
    if (this.pet.body) this.pet.body.reset(this.pet.x, this.pet.y)
    this.syncHandle()
  }

  /** DOM 手柄停止拖拽 */
  endDrag() {
    this.dragging = false
    if (this.pet.body) this.pet.body.moves = true
    this.switchState('stand')
    this.idleTimer = 0
    this.idleThreshold = 3000 + Math.random() * 4000
  }

  /** 同步 DOM 手柄位置到 pet 的屏幕坐标，向下偏移覆盖身体 */
  private syncHandle() {
    if (!BRIDGE.handle) return
    const hh = HANDLE_SIZE / 2
    // bodyOffset: 手柄中心下移到身体区域（pet 中心在头部，下移 40px 到躯干）
    BRIDGE.handle.style.left = (this.pet.x - hh) + 'px'
    BRIDGE.handle.style.top = (this.pet.y - hh + 40) + 'px'
  }

  private animKey(s: string): string { return `${s}-pet` }

  private resetIdleThreshold() {
    this.idleTimer = 0
    this.idleThreshold = 2500 + Math.random() * 5000
  }

  private switchState(s: string) {
    if (this.currentState === s) return
    this.currentState = s
    if (this.anims.exists(this.animKey(s))) this.pet.play(this.animKey(s))
    if (s === 'stand') this.resetIdleThreshold()
  }

  private pickTarget() {
    const { width, height } = this.scale
    this.walkTarget = { x: Phaser.Math.Between(MARGIN + 30, width - MARGIN - 30), y: Phaser.Math.Between(MARGIN + 20, height - MARGIN - 20) }
  }
  private stopMove() { this.pet.body!.setVelocity(0, 0); this.walkTarget = null }

  update(_time: number, delta: number) {
    // 同步手柄位置（拖拽中由 movePetBy 同步，空闲时跟随 AI 走动）
    if (!this.dragging) this.syncHandle()
    if (this.dragging) return

    this.idleTimer += delta
    const ps: string = this.game.registry.get('petState') || 'idle'
    const bub: string = this.game.registry.get('petBubble') || ''

    if (bub !== this.lastBubble) {
      this.lastBubble = bub
      if (this.bubbleContainer) { this.bubbleContainer.destroy(true); this.bubbleContainer = null }
      if (bub) {
        const maxW = 240; const pad = 9; const fontSize = 14
        const txt = this.add.text(0, 0, bub, {
          fontSize: `${fontSize}px`, fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#e0e0e0', wordWrap: { width: maxW - pad * 2 },
          align: 'center', lineSpacing: 2,
        })
        const w = Math.min(txt.width + pad * 2, maxW)
        const h = txt.height + pad * 2
        txt.setPosition(-w / 2 + pad, -h + pad)
        const gfx = this.add.graphics()
        gfx.fillStyle(0x1e1e2e, 0.92)
        gfx.fillRoundedRect(-w / 2, -h, w, h, 6)
        gfx.lineStyle(1, 0x444466, 0.5)
        gfx.strokeRoundedRect(-w / 2, -h, w, h, 6)
        gfx.fillStyle(0x1e1e2e, 0.92)
        gfx.fillTriangle(0, 2, -5, -2, 5, -2)
        this.bubbleContainer = this.add.container(0, 0, [gfx, txt])
      }
    }
    if (bub && this.bubbleContainer) {
      this.bubbleContainer.setPosition(
        this.pet.x, this.pet.y - (this.cfg.frameSize * this.cfg.scale) / 2 - 8
      )
    }
    if (ps !== this.lastPetState) {
      this.stopMove()
      const s = ps
      if (s === 'idle') this.switchState('stand')
      else if (s === 'connected') { this.switchState('greet'); this.time.delayedCall(2000, () => { this.switchState('stand'); this.game.registry.set('petState', 'idle') }) }
      else if (s === 'tool_use') this.switchState('greet')
      else if (s === 'building') { this.switchState('climb'); this.pet.body!.setVelocityY(-FRAME_RATE * 8); this.pet.body!.setAllowGravity(false) }
      else if (s === 'success') { this.switchState('jump'); this.pet.body!.setVelocityY(-250); this.time.delayedCall(700, () => this.switchState('stand')) }
      else if (s === 'error') { this.switchState('jump'); this.pet.body!.setVelocityY(-350); this.time.delayedCall(1200, () => this.switchState('sit')) }
      else if (s === 'disconnected') this.switchState('sit')
      else if (s === 'thinking') this.switchState('stand')
      this.lastPetState = ps
    }
    const ps2 = this.game.registry.get('petState') || 'idle'
    if (ps2 === 'thinking') {
      if (this.currentState === 'walk' && this.walkTarget) {
        const dx = this.walkTarget.x - this.pet.x; const dy = this.walkTarget.y - this.pet.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 15) { this.stopMove(); this.switchState('stand') }
        else { const sp = FRAME_RATE * 9; this.pet.body!.setVelocity((dx / dist) * sp, (dy / dist) * sp); this.pet.setFlipX(dx < 0) }
      } else if (this.currentState !== 'walk') { this.pickTarget(); this.switchState('walk') }
      else if (!this.walkTarget) { this.pickTarget() }
    } else if (ps2 !== 'tool_use' && ps2 !== 'disconnected' && ps2 !== 'building' && ps2 !== 'error') {
      if (this.currentState === 'walk' && this.walkTarget) {
        const dx = this.walkTarget.x - this.pet.x; const dy = this.walkTarget.y - this.pet.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 15) { this.stopMove(); this.switchState('stand') }
        else { const sp = FRAME_RATE * 5; this.pet.body!.setVelocity((dx / dist) * sp, (dy / dist) * sp); this.pet.setFlipX(dx < 0) }
      }
      if (this.idleTimer > this.idleThreshold && this.currentState === 'stand') {
        this.resetIdleThreshold()
        const r = Math.random()
        if (r < 0.55) { this.pickTarget(); this.switchState('walk') }
        else if (r < 0.8) { this.switchState('greet'); this.time.delayedCall(2500, () => { if (this.currentState === 'greet') this.switchState('stand') }) }
        else if (r < 0.92) { this.switchState('sit'); this.time.delayedCall(3000, () => { if (this.currentState === 'sit') this.switchState('stand') }) }
      }
    }
    if (ps2 === 'building' && this.pet.body!.blocked.top) {
      this.switchState('crawl'); this.pet.body!.setVelocityY(0)
      this.pet.body!.setVelocityX(this.pet.flipX ? FRAME_RATE * 6 : -FRAME_RATE * 6)
    }
  }
}

// ═══════════════════════════════════════════
// ── 游戏生命周期 ──
// ═══════════════════════════════════════════

let _initPhaserRetries = 0
function initPhaser() {
  if (!gameContainer.value || game) return
  const w = gameContainer.value.clientWidth
  const h = gameContainer.value.clientHeight
  if (w === 0 || h === 0) {
    if (++_initPhaserRetries > 50) return  // 50 次重试上限（~5s），放弃初始化
    setTimeout(initPhaser, 100); return
  }
  _initPhaserRetries = 0
  game = new Phaser.Game({
    type: Phaser.CANVAS, parent: gameContainer.value, width: w, height: h,
    transparent: true, backgroundColor: undefined,
    physics: { default: 'arcade', arcade: { gravity: { y: 0, x: 0 }, debug: false } },
    scene: [PetScene], audio: { noAudio: true },
    fps: { target: 20, min: 10, smoothStep: true },
    input: { activePointers: 1 },
  })
  game.registry.set('petState', props.state || 'idle')
  // 注册手柄元素到通信桥
  BRIDGE.handle = handleEl.value!
}

function destroyGame() {
  BRIDGE.scene = null
  BRIDGE.handle = null
  if (!game) return
  game.destroy(true)
  game = null
}

watch(() => props.state, (s) => { if (game) game.registry.set('petState', s || 'idle') })
watch(() => props.bubble, (b) => { if (game) game.registry.set('petBubble', b || '') })

if (typeof window !== 'undefined') (window as any).__petInfo = {
  getPets: () => PETS.map(p => ({ id: p.id, label: p.label })),
}

function onVisibility() {
  if (!game) return
  if (document.hidden) {
    game.scene.pause('PetScene')
  } else {
    game.scene.resume('PetScene')
  }
}

let _firstMounted = false
onMounted(() => {
  _firstMounted = true
  nextTick(() => initPhaser())
  document.addEventListener('mousemove', onDocMouseMove)
  document.addEventListener('mouseup', onDocMouseUp)
  document.addEventListener('click', closeCtx)
  document.addEventListener('visibilitychange', onVisibility)
})
onActivated(() => {
  // 首次挂载 onMounted 已 initPhaser，跳过避免 create→destroy→create 闪烁
  if (_firstMounted) { _firstMounted = false; return }
  destroyGame()
  nextTick(() => initPhaser())
})
onBeforeUnmount(() => {
  destroyGame()
  document.removeEventListener('mousemove', onDocMouseMove)
  document.removeEventListener('mouseup', onDocMouseUp)
  document.removeEventListener('click', closeCtx)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
<div ref="el" class="pet-layer">
  <div ref="gameContainer" class="pet-canvas" />
  <!-- 透明手柄覆在 pet 上方，唯一接收鼠标事件的元素 -->
  <div
    ref="handleEl"
    class="pet-handle"
    @mousedown="onHandleMouseDown"
    @contextmenu="onCtx"
  />
</div>

<Teleport to="body">
  <div v-if="ctxMenu" class="ctx-overlay" @click.stop="closeCtx">
    <div
      class="ctx-menu"
      :style="{ left: ctxPos.x + 'px', top: ctxPos.y + 'px' }"
      @click.stop
    >
      <div class="ctx-header">切换宠物 ({{ petList.length }})</div>
      <div class="ctx-list">
        <button
          v-for="p in petList" :key="p.id"
          class="ctx-item" :class="{ active: p.id === currentPetId }"
          @click="switchPet(p.id)"
        >
          <span class="ctx-label">{{ p.label }}</span>
          <span v-if="p.id === currentPetId" class="ctx-check">&#10003;</span>
        </button>
      </div>
    </div>
  </div>
</Teleport>
</template>

<style scoped>
/* 填满父容器 .pet-overlay，但不接收点击 */
.pet-layer {
  width: 100%;
  height: 100%;
  user-select: none;
  pointer-events: none;
}
.pet-canvas {
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.pet-canvas canvas { display: block; }

/* 透明拖拽手柄，覆在 pet 上方，唯一接收鼠标事件的元素 */
.pet-handle {
  position: absolute;
  width: v-bind(HANDLE_SIZE + 'px');
  height: v-bind(HANDLE_SIZE + 'px');
  border-radius: 50%;
  cursor: grab;
  pointer-events: auto;
  z-index: 1;
  /* 完全透明，不显示 */
  background: transparent;
}
.pet-handle:active { cursor: grabbing; }
</style>

<style>
.ctx-overlay {
  position: fixed; inset: 0; z-index: 2147483647;
  background: transparent;
}
.ctx-menu {
  position: fixed;
  z-index: 2147483647;
  background: var(--bg-raised, #1e1e2e);
  border: 1px solid var(--border, rgba(255,255,255,.08));
  border-radius: 10px;
  padding: 6px 4px;
  min-width: 210px;
  max-width: 280px;
  box-shadow: 0 12px 40px rgba(0,0,0,.5);
  display: flex;
  flex-direction: column;
}
.ctx-header {
  padding: 6px 10px 6px;
  font-size: 11px;
  font-family: system-ui, -apple-system, sans-serif;
  color: var(--text-secondary, #888);
  border-bottom: 1px solid var(--border, rgba(255,255,255,.06));
  margin-bottom: 2px;
  flex-shrink: 0;
}
.ctx-list {
  max-height: 320px;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--border, rgba(255,255,255,.1)) transparent;
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: none;
  color: var(--text-primary, #e0e0e0);
  font-size: 12px;
  line-height: 1.4;
  font-family: var(--font-body, system-ui, -apple-system, sans-serif);
  cursor: pointer;
  border-radius: 6px;
  text-align: left;
  transition: background .12s;
}
.ctx-item:hover { background: var(--bg-deep, rgba(255,255,255,.06)); }
.ctx-item.active { background: var(--accent-bg, rgba(99,102,241,.12)); }
.ctx-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.ctx-check {
  margin-left: auto;
  color: var(--accent-blue, #818cf8);
  font-size: 14px;
  flex-shrink: 0;
}
</style>
