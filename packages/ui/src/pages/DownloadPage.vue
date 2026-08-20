<script setup lang="ts">
import DownloadCard from '@/components/common/DownloadCard.vue';
</script>

<template>
  <div class="page">
    <div class="content">
      <DownloadCard />
    </div>
  </div>
</template>

<style scoped lang="scss">
.page {
  padding: 18px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
</style>
