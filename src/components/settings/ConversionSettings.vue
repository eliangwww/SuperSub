<template>
  <div class="p-4">
    <AssetManager 
      asset-type="backend"
      title="订阅转换后端管理"
      asset-name="后端"
      class="mb-8"
    />

    <AssetManager
      asset-type="config"
      title="订阅转换配置管理"
      asset-name="配置"
      class="mb-8"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import AssetManager from '@/components/AssetManager.vue';

onMounted(() => {
  // Initial data fetch if needed
});
</script>