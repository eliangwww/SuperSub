<template>
  <div class="p-4">
    <AssetManager 
      asset-type="backend"
      title="订阅转换后端管理"
      asset-name="后端"
      @assets-updated="fetchAssets"
      class="mb-8"
    />

    <AssetManager
      asset-type="config"
      title="订阅转换配置管理"
      asset-name="配置"
      @assets-updated="fetchAssets"
      class="mb-8"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import AssetManager from '@/components/AssetManager.vue';
import { api } from '@/utils/api';
import { useMessage } from 'naive-ui';

const message = useMessage();

const fetchAssets = async () => {
  // This component doesn't display assets directly, but we might need to refresh
  // some parent state in the future. For now, this can be a placeholder.
  // Or, if AssetManager handles its own data, we might not need this at all.
  // Let's assume for now we might want to bubble up an event.
  console.log('Assets updated, parent can refetch if needed.');
};

onMounted(() => {
  // Initial data fetch if needed
});
</script>