<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { NStatistic, NGrid, NGi, NCard, NSkeleton, NAlert, NPageHeader } from 'naive-ui';
import { useAuthStore } from '@/stores/auth';
import { useNodeStatusStore } from '@/stores/nodeStatus';

const authStore = useAuthStore();
const nodeStatusStore = useNodeStatusStore();

const stats = ref({
  subscriptions: 0,
  nodes: 0,
  profiles: 0,
});

const loading = ref(true);
const error = ref<string | null>(null);

interface StatsData {
  subscriptions: number;
  nodes: number;
  profiles: number;
}

interface ApiResponse {
  success: boolean;
  data?: StatsData;
  message?: string;
}

const onlineNodes = computed(() => Object.values(nodeStatusStore.statuses).filter(s => s.status === 'healthy').length);
const offlineNodes = computed(() => stats.value.nodes - onlineNodes.value);


onMounted(async () => {
  try {
    const response = await fetch('/api/stats', {
      headers: {
        'Authorization': `Bearer ${authStore.token}`,
      },
    });
    const result: ApiResponse = await response.json();
    if (result.success && result.data) {
      stats.value = result.data;
    } else {
      throw new Error(result.message || 'Failed to fetch stats');
    }
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
  
  // Fetch node statuses if not already fetched
  if (Object.keys(nodeStatusStore.statuses).length === 0) {
    await nodeStatusStore.fetchStatuses();
  }
});
</script>

<template>
  <div>
    <n-page-header>
        <template #title>仪表盘</template>
        <template #subtitle>欢迎回来, {{ authStore.user?.username }}</template>
    </n-page-header>

    <div v-if="error" class="mt-4">
      <n-alert title="错误" type="error">
        {{ error }}
      </n-alert>
    </div>

    <n-grid cols="2 s:3 m:5" responsive="screen" :x-gap="16" :y-gap="16" class="mt-4">
      <n-gi>
        <n-card>
          <n-skeleton v-if="loading" text :repeat="2" />
          <n-statistic v-else label="订阅数" :value="stats.subscriptions" />
        </n-card>
      </n-gi>
      <n-gi>
        <n-card>
          <n-skeleton v-if="loading" text :repeat="2" />
          <n-statistic v-else label="节点总数" :value="stats.nodes" />
        </n-card>
      </n-gi>
       <n-gi>
        <n-card>
          <n-skeleton v-if="loading" text :repeat="2" />
          <n-statistic v-else label="在线节点" :value="onlineNodes" />
        </n-card>
      </n-gi>
       <n-gi>
        <n-card>
          <n-skeleton v-if="loading" text :repeat="2" />
          <n-statistic v-else label="离线节点" :value="offlineNodes" />
        </n-card>
      </n-gi>
      <n-gi>
        <n-card>
          <n-skeleton v-if="loading" text :repeat="2" />
          <n-statistic v-else label="配置文件" :value="stats.profiles" />
        </n-card>
      </n-gi>
    </n-grid>
  </div>
</template>