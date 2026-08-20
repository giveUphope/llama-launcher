<script setup lang="ts">
</script>

<template>
  <router-view v-slot="{ Component }">
    <!-- 页面切换：仅淡入（opacity，无 transform）；leave 时长 0 = 新页立即挂载，
         不做串行等待（原 out-in 120ms×2 串行 = 切换明显迟缓的主因） -->
    <transition name="page" mode="out-in" :duration="{ leave: 0, enter: 90 }">
      <keep-alive>
        <component :is="Component" />
      </keep-alive>
    </transition>
  </router-view>
</template>

<style scoped lang="scss">
.page-enter-active,
.page-leave-active {
  transition: opacity var(--dur-fast) var(--ease-jelly);
}

.page-enter-from,
.page-leave-to {
  opacity: 0;
}
</style>
