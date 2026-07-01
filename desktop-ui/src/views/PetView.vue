<script setup lang="ts">
/**
 * PetView — 桌面宠物组件（像素精灵版）
 * ── 功能说明 ──
 * 使用 SVG rect 像素块渲染的桌面宠物，支持多种行为动画和状态响应：
 *   1. 随机行为: 眨眼/摇尾巴/耳朵抖动/自由走动（3-8秒间隔随机触发）
 *   2. 响应式状态: thinking 时来回踱步、disconnected 时灰度+静止、contextPercent>80% 点击触发 compact
 *   3. 提示信息: hover 时显示模型/状态/上下文用量/费用等 tooltip
 * ── 实现方式 ──
 * 宠物由 PET_PARTS 数据（petRects.ts）按身体部位（尾巴→身体→头部→耳朵→眼睛→鼻子）分层渲染，
 * 每个部位是一组 SVG <rect>；动画通过 CSS keyframes（呼吸/眨眼/摇尾巴/走路/弹跳/抖动）实现。
 * 行为状态机由 scheduleBehavior 定时器驱动，循环调度随机行为。
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { PET_PARTS } from '../data/petRects'

const props = defineProps<{
  state?: string; message?: string; contextPercent?: number
  costTotal?: number; isThinking?: boolean; sessionDuration?: number; model?: string
}>()
const emit = defineEmits<{ (e: 'cancel'): void; (e: 'compact'): void }>()

// ── 提示 ──
const tip = ref(false); let t0: any = null, t1: any = null
function on() { t0 = setTimeout(() => tip.value = true, 500) }
function off() { clearTimeout(t0); tip.value = false }
const petting = ref(false)
function click() {
  if (props.isThinking) return emit('cancel')
  if (props.contextPercent && props.contextPercent > 80) return emit('compact')
  if (petting.value) return
  petting.value = true; clearTimeout(t1); t1 = setTimeout(() => petting.value = false, 600)
}

const tips = computed(() => {
  const a: string[] = []
  if (props.model) a.push(props.model)
  if (props.isThinking) a.push('思考中...'); else if (props.state === 'disconnected') a.push('断线中...')
  if (props.contextPercent !== undefined) a.push('上下文 ' + props.contextPercent + '%')
  if (props.costTotal) a.push('¥' + props.costTotal.toFixed(4))
  return a
})

// ── 部位数据 ──
const partRects = PET_PARTS

// ── 渲染顺序（后到前） ──
const partOrder = ['tail','right_legs','left_legs','body','head','right_ear','left_ear','right_eye','left_eye','nose_mouth'] as const

// ── 行为状态机 ──
// 功能说明: 宠物在空闲(idle)状态下随机触发四种动作：
//   blinking(眨眼 200ms) / tail_wagging(摇尾巴 1.5s) / ear_twitch(耳朵抖动 400ms) / walking(走动 3.5s)
// 实现方式: scheduleBehavior() 递归调度 → 3-8 秒随机间隔 → 按概率(40%/30%/20%/10%)分发行为
//   thinking/disconnected 状态下暂停随机行为（thinking 由 watch 独立控制踱步）
type Behavior = 'idle' | 'blinking' | 'tail_wagging' | 'ear_twitch' | 'walking'
const behavior = ref<Behavior>('idle')
const walkDir = ref<'left'|'right'>('right')
const walkOffset = ref(0)

let behaviorTimer: ReturnType<typeof setTimeout> | null = null
let walkTimer: ReturnType<typeof setTimeout> | null = null
let _mounted = false

function clearTimers() {
  if (behaviorTimer) { clearTimeout(behaviorTimer); behaviorTimer = null }
  if (walkTimer) { clearTimeout(walkTimer); walkTimer = null }
}

function scheduleBehavior() {
  if (!_mounted) return
  if (props.state === 'disconnected' || props.state === 'thinking') return
  const delay = 3000 + Math.random() * 5000
  behaviorTimer = setTimeout(() => {
    if (!_mounted) return
    if (props.state === 'disconnected' || props.state === 'thinking') { scheduleBehavior(); return }
    const r = Math.random()
    if (r < 0.4) doBlink()
    else if (r < 0.7) doTailWag()
    else if (r < 0.9) doEarTwitch()
    else doWalk()
  }, delay)
}

function doBlink() {
  if (!_mounted) return
  behavior.value = 'blinking'
  setTimeout(() => { if (!_mounted) return; behavior.value = 'idle'; scheduleBehavior() }, 200)
}
function doTailWag() {
  if (!_mounted) return
  behavior.value = 'tail_wagging'
  setTimeout(() => { if (!_mounted) return; behavior.value = 'idle'; scheduleBehavior() }, 1500)
}
function doEarTwitch() {
  if (!_mounted) return
  behavior.value = 'ear_twitch'
  setTimeout(() => { if (!_mounted) return; behavior.value = 'idle'; scheduleBehavior() }, 400)
}
function doWalk() {
  if (!_mounted) return
  behavior.value = 'walking'
  walkDir.value = walkDir.value === 'right' ? 'left' : 'right'
  walkOffset.value = walkDir.value === 'right' ? 35 : -35
  walkTimer = setTimeout(() => {
    if (!_mounted) return
    behavior.value = 'idle'
    walkOffset.value = 0
    scheduleBehavior()
  }, 3500)
}

// ── thinking 状态 → 踱步 ──
watch(() => props.isThinking, (v) => {
  clearTimers()
  if (v) {
    behavior.value = 'walking'
    // 来回踱步
    let flip = true
    walkDir.value = 'left'
    walkOffset.value = -35
    walkTimer = setInterval(() => {
      if (!_mounted) { clearTimers(); return }
      flip = !flip
      walkDir.value = flip ? 'right' : 'left'
      walkOffset.value = flip ? 35 : -35
    }, 2000) as any
  } else {
    behavior.value = 'idle'
    walkOffset.value = 0
    scheduleBehavior()
  }
})

watch(() => props.state, (s) => {
  if (s === 'disconnected') clearTimers()
})

// ── 容器 class ──
const stateClass = computed(() => props.state || 'idle')
const containerClass = computed(() => ({
  [stateClass.value]: true,
  'blinking': behavior.value === 'blinking',
  'tail-wagging': behavior.value === 'tail_wagging',
  'ear-twitch': behavior.value === 'ear_twitch',
  'walking': behavior.value === 'walking',
}))

const svgStyle = computed(() => ({
  transform: walkDir.value === 'left' ? 'scaleX(-1)' : 'scaleX(1)',
  transition: 'transform 0.3s ease-in-out',
}))

onMounted(() => { _mounted = true; scheduleBehavior() })
onBeforeUnmount(() => { _mounted = false; clearTimers(); clearTimeout(t0); clearTimeout(t1) })
</script>

<template>
<div
  class="pet" :class="containerClass"
  :style="{ transform: `translateX(${walkOffset}px)` }"
  @click.stop="click" @mouseenter="on" @mouseleave="off"
>
  <div v-if="message" class="bub">{{ message }}</div>
  <div v-if="tip && tips.length" class="t"><div v-for="(l,i) in tips" :key="i" class="tl">{{ l }}</div></div>

  <svg viewBox="0 0 728 560" class="s" shape-rendering="crispEdges" :style="svgStyle">
    <rect width="728" height="560" fill="none"/>
    <g
      v-for="part in partOrder" :key="part"
      :class="['pet-part', `pet-${part}`]"
    >
      <rect
        v-for="r in partRects[part]" :key="`${r.x}-${r.y}`"
        :x="r.x" :y="r.y" width="14" height="14" :fill="r.fill"
      />
    </g>
  </svg>

  <!-- 状态覆盖层 -->
  <div v-if="state==='thinking'" class="dot"><i>.</i><i>.</i><i>.</i></div>
  <div v-if="state==='disconnected'" class="zz">Zzz</div>
  <div v-if="state==='tool_use'" class="bdg">&#9881;</div>
  <div v-if="state==='building'" class="bdg">&#x26D1;</div>
  <div v-if="state==='error'" class="bdg">&#x1F4A7;</div>
  <div v-if="state==='success'" class="bdg">&#x2728;</div>
  <div v-if="state==='typing'" class="bdg">&#9000;</div>
</div>
</template>

<style scoped>
/* ── 容器 ── */
.pet {
  position:relative; width:78px; height:64px; cursor:pointer; user-select:none;
  transition: transform 1.2s ease-in-out, filter .3s;
  display:flex; align-items:center; justify-content:center; flex-shrink:0;
}
.pet:hover { filter:brightness(1.1); }
.pet.disconnected { filter:grayscale(.5) opacity(.4); }
.s { display:block; width:100%; height:100%; }

/* ── 部位动画 ── */

/* 呼吸 — body 缩放 */
.pet-body { transform-origin: 490px 322px; }
.idle .pet-body { animation: breathe 4s ease-in-out infinite; }
@keyframes breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1, 1.03); } }

/* 眨眼 — 眼睛 scaleY */
.pet-left_eye, .pet-right_eye { transform-origin: center; }
.blinking .pet-left_eye,
.blinking .pet-right_eye { animation: blink 0.15s ease-in-out; }
@keyframes blink { 0%,100% { transform: scaleY(1); } 50% { transform: scaleY(0.05); } }

/* 摇尾巴 — rotate */
.pet-tail { transform-origin: 644px 252px; }
.tail-wagging .pet-tail { animation: wag .5s ease-in-out infinite; }
@keyframes wag { 0%,100% { transform: rotate(0); } 30% { transform: rotate(12deg); } 70% { transform: rotate(-8deg); } }

/* 耳朵抖动 */
.pet-left_ear { transform-origin: 350px 70px; }
.pet-right_ear { transform-origin: 658px 70px; }
.ear-twitch .pet-left_ear,
.ear-twitch .pet-right_ear { animation: ear-tw 0.3s ease-out; }
@keyframes ear-tw { 0%,100% { transform: rotate(0); } 40% { transform: rotate(-10deg); } 70% { transform: rotate(5deg); } }

/* 走路 — 腿交替 */
.pet-left_legs { transform-origin: 364px 336px; }
.pet-right_legs { transform-origin: 644px 336px; }
.walking .pet-left_legs  { animation: leg-l 0.45s linear infinite; }
.walking .pet-right_legs { animation: leg-r 0.45s linear infinite; }
@keyframes leg-l { 0%,100% { transform: rotate(0); } 50% { transform: rotate(-8deg); } }
@keyframes leg-r { 0%,100% { transform: rotate(8deg); } 50% { transform: rotate(0); } }

/* 走路时身体晃动 */
.walking .pet-body { animation: body-walk 0.45s linear infinite; }
@keyframes body-walk { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }

/* ── thinking 状态 ── */
.thinking .pet-body { animation: breathe 2s ease-in-out infinite; }
.thinking .pet-head { animation: head-bob 0.9s ease-in-out infinite; }
@keyframes head-bob { 0%,100% { transform: rotate(0); } 50% { transform: rotate(3deg); } }
.thinking .dot { position:absolute; top:-10px; left:50%; transform:translateX(-50%); font:12px monospace; color:#E7B552; letter-spacing:2px; z-index:15; }
.thinking .dot i { animation:db .5s infinite alternate; font-style:normal; }
.thinking .dot i:nth-child(2){ animation-delay:.15s } .thinking .dot i:nth-child(3){ animation-delay:.3s }
@keyframes db { from{opacity:.2;transform:translateY(0)} to{opacity:1;transform:translateY(-3px)} }

/* ── success — 弹跳 ── */
.success .pet-body { animation: bnc .4s ease-out 3; }
@keyframes bnc { 0%{transform:translateY(0)} 30%{transform:translateY(-8px)} 55%{transform:translateY(-1px)} 70%{transform:translateY(-5px)} 100%{transform:translateY(0)} }

/* ── error — 抖动 ── */
.error .pet-body { animation: shk .1s ease-in-out 5; }
@keyframes shk { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-2px)} 75%{transform:translateX(2px)} }

/* ── typing / tool_use / connected / building — 加速呼吸 ── */
.typing .pet-body,
.tool_use .pet-body,
.connected .pet-body { animation: breathe 3s ease-in-out infinite; }
.building .pet-body { animation: breathe 2s ease-in-out infinite; }

/* ── 气泡/提示/状态标记 ── */
.bub{position:absolute;bottom:calc(100%+2px);left:50%;transform:translateX(-50%);background:var(--bg-raised);color:var(--text-primary);font:10px/1.2 system-ui;padding:3px 7px;border-radius:4px;white-space:nowrap;z-index:20;border:1px solid var(--border);box-shadow:0 2px 6px rgba(0,0,0,.1);}
.t{position:absolute;bottom:calc(100%+2px);left:50%;transform:translateX(-50%);background:var(--bg-raised);border:1px solid var(--border);border-radius:6px;padding:5px 9px;z-index:25;box-shadow:0 4px 12px rgba(0,0,0,.18);white-space:nowrap;min-width:90px;text-align:center;}
.tl{font:10px/1.4 var(--font-mono,monospace);color:var(--text-secondary);}
.tl:first-child{color:var(--text-primary);font-weight:600;font-size:11px;}
.zz{position:absolute;top:2px;right:2px;font:9px monospace;color:#888;animation:fz 1.8s infinite;z-index:15;}
@keyframes fz { 0%{opacity:.15;transform:translate(0,0)scale(.7)} 50%{opacity:.8;transform:translate(3px,-6px)scale(1)} 100%{opacity:.1;transform:translate(0,-12px)scale(.7)} }
.bdg{position:absolute;top:-6px;right:-2px;font-size:11px;z-index:15;pointer-events:none;text-shadow:0 0 4px rgba(0,0,0,.2);}
</style>
