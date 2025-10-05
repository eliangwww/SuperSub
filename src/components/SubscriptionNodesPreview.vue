<script setup lang="ts">
import { ref, onMounted, h, watch, computed } from 'vue';
import { useMessage, NDataTable, NSpin, NTag, NEmpty, NButton, NSpace, NSwitch, NTooltip } from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { Node, ApiResponse } from '@/types';
import { api } from '@/utils/api';

const props = defineProps({
  subscriptionId: {
    type: String,
    required: true,
  },
  subscriptionUrl: {
    type: String,
    required: true,
  },
  show: {
    type: Boolean,
    required: true,
  }
});

const message = useMessage();
const nodes = ref<Partial<Node>[]>([]);
const loading = ref(false);
const importLoading = ref(false);
const applyRules = ref(false);

const columns: DataTableColumns<Partial<Node>> = [
    { title: '名称', key: 'name', ellipsis: { tooltip: true }, fixed: 'left', width: 200 },
    {
        title: '类型',
        key: 'protocol',
        width: 100,
        align: 'center',
        render(row) {
            const protocol = row.protocol || row.type;
            if (!protocol) return h('span', {}, 'N/A');

            const colorMap: Record<string, string> = {
                vmess: '#ff69b4', vless: '#8a2be2', trojan: '#dc143c', ss: '#00bfff',
                hysteria2: '#20b2aa', tuic: '#7b68ee', 'http': '#2ecc71', 'https': '#27ae60',
                'socks5': '#f1c40f', 'hysteria': '#1abc9c', 'ssr': '#e67e22',
            };
            
            const tagColor = {
                color: colorMap[protocol.toLowerCase()] || '#7f8c8d',
                textColor: '#ffffff',
                borderColor: 'transparent'
            };

            return h(NTag, { size: 'small', round: true, color: tagColor }, { default: () => protocol.toUpperCase() });
        }
    },
    { title: '服务器', key: 'server', ellipsis: { tooltip: true }, width: 180 },
    { title: '端口', key: 'port', width: 80, align: 'center' },
    {
        title: '操作',
        key: 'actions',
        width: 100,
        align: 'center',
        fixed: 'right',
        render(row) {
            return h(NButton, {
                size: 'tiny',
                ghost: true,
                type: 'primary',
                onClick: () => {
                    navigator.clipboard.writeText(row.raw || '');
                    message.success('已复制原始链接');
                }
            }, { default: () => '复制链接' });
        }
    }
];

const fetchPreview = async () => {
  if (!props.subscriptionUrl) {
    nodes.value = [];
    return;
  }
  loading.value = true;
  nodes.value = [];
  try {
    const payload = {
      url: props.subscriptionUrl,
      subscription_id: props.subscriptionId,
      apply_rules: applyRules.value,
    };
    const response = await api.post<ApiResponse<{ nodes: Partial<Node>[] }>>('/subscriptions/preview', payload);
    if (response.data.success && response.data.data?.nodes) {
      nodes.value = response.data.data.nodes;
    } else {
      message.error(response.data.message || '获取节点预览失败');
    }
  } catch (err) {
    message.error('请求失败，请稍后重试');
  } finally {
    loading.value = false;
  }
};

const handleImport = async () => {
    if (!nodes.value || nodes.value.length === 0) {
        message.warning('没有可导入的节点');
        return;
    }
    importLoading.value = true;
    try {
        // Send the array of parsed node objects directly
        const response = await api.post<ApiResponse>('/nodes/batch-import', { nodes: nodes.value });
        if (response.data.success) {
            message.success(response.data.message || '节点导入成功');
        } else {
            message.error(response.data.message || '导入失败');
        }
    } catch (err) {
        message.error('导入请求失败');
    } finally {
        importLoading.value = false;
    }
};

// Expose the fetch function to the parent component
defineExpose({
  fetchPreview,
});

watch(applyRules, () => {
    fetchPreview();
});

// Re-fetch when the modal becomes visible, if it's not the initial load
watch(() => props.show, (newVal, oldVal) => {
    if (newVal && !oldVal) {
        fetchPreview();
    }
});
</script>

<template>
  <div>
    <n-space justify="space-between" class="mb-4" align="center">
      <n-space align="center">
        <n-switch v-model:value="applyRules" />
        <label>应用处理规则</label>
        <n-tooltip trigger="hover">
          <template #trigger>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2zm0 15c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1s1 .45 1 1v4c0 .55-.45 1-1 1zm1-8h-2V7h2v2z"/></svg>
          </template>
          启用后，将加载并应用您在此订阅上配置的所有规则（如过滤、重命名等）。
        </n-tooltip>
      </n-space>
      <n-button
        type="primary"
        @click="handleImport"
        :loading="importLoading"
        :disabled="loading || nodes.length === 0"
      >
        导入 {{ nodes.length }} 个节点
      </n-button>
    </n-space>
    <n-spin :show="loading">
      <n-data-table
        :columns="columns"
        :data="nodes"
        :pagination="{ pageSize: 10 }"
        :bordered="false"
        :max-height="400"
        :scroll-x="660"
      />
      <n-empty v-if="!loading && nodes.length === 0" description="无法预览或订阅为空" class="py-8">
        <template #extra>
          <n-button size="small" @click="fetchPreview">重试</n-button>
        </template>
      </n-empty>
    </n-spin>
  </div>
</template>