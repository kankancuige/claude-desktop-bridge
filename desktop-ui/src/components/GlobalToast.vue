<script setup lang="ts">
/**
 * GlobalToast — 全局 toast 通知组件
 * 底部居中，淡入淡出动画。非空字符串时显示，由父组件控制。
 * 用于镜像开关提示、费用阈值提醒等非阻塞通知。
 */
defineProps<{
  /** toast 消息文本，空字符串时隐藏 */
  text: string
}>()
</script>

<template>
  <!--
    全局 toast 通知：底部居中，淡入淡出。
    text 非空时显示，空字符串时 v-if=false 触发 leave 动画。
  -->
  <transition name="toast-fade">
    <div v-if="text" class="toast">{{ text }}</div>
  </transition>
</template>

<style scoped>
.toast {
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-raised, #1e1e2e);
  color: var(--text-primary, #e0e0e0);
  padding: 10px 24px;
  border-radius: 10px;
  font-size: 14px;
  z-index: 310;
  border: 1px solid var(--border, rgba(255,255,255,.08));
  box-shadow: 0 6px 24px rgba(0,0,0,.3);
  pointer-events: none;
}

.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
