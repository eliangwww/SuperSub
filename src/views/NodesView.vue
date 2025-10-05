<script setup lang="ts">
import { ref, onMounted, h, reactive, computed, watch, onBeforeUnmount } from 'vue';
import { useMessage, useDialog, NButton, NSpace, NTag, NIcon, NPageHeader, NDataTable, NModal, NForm, NFormItem, NInput, NInputNumber, NSelect, NSpin, NTabs, NTabPane, NDropdown } from 'naive-ui';
import { debounce } from 'lodash-es';
import type { DataTableColumns } from 'naive-ui';
import { Node } from '@/types';
import { useAuthStore } from '@/stores/auth';
import { useGroupStore, type NodeGroup } from '@/stores/groups';
import { FlashOutline as FlashIcon } from '@vicons/ionicons5';
import { parseNodeLinks, ParsedNode } from '@/utils/nodeParser';
import { useApi } from '@/composables/useApi';

const api = useApi();
const message = useMessage();
const dialog = useDialog();
const authStore = useAuthStore();
const groupStore = useGroupStore();
const nodes = ref<Node[]>([]);
const loading = ref(true);
const checkingAll = ref(false); // Keep for future "check all" feature
const checkedRowKeys = ref<string[]>([]);
const filterKeyword = ref('');
const activeTab = ref('all');

const handleBatchAction = (action: 'sort' | 'deduplicate' | 'clear') => {
  const groupName = activeTab.value === 'all'
    ? '所有'
    : activeTab.value === 'ungrouped'
      ? '未分组'
      : groupStore.groups.find(g => g.id === activeTab.value)?.name || '未知';

  const actionTextMap = {
    sort: '排序',
    deduplicate: '去重',
    clear: '清空',
  };
  const actionText = actionTextMap[action];

  dialog.warning({
    title: `确认${actionText}`,
    content: `确定要对【${groupName}】分组下的节点执行【${actionText}】操作吗？`,
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const response = await api.post('/nodes/batch-actions', {
          action,
          groupId: activeTab.value,
        });
        if (response.success) {
          message.success(response.message || '操作成功');
          fetchData(); // Refresh data
        } else {
          message.error(response.message || '操作失败');
        }
      } catch (error: any) {
        message.error(error.message || '请求失败');
      }
    },
  });
};

const filteredNodes = computed(() => {
  const keyword = filterKeyword.value.toLowerCase();
  
  return nodes.value.filter(node => {
    // Group filter
    const inGroup = activeTab.value === 'all'
      ? true
      : activeTab.value === 'ungrouped'
        ? !node.group_id
        : node.group_id === activeTab.value;

    if (!inGroup) return false;

    // Keyword filter
    if (!keyword) return true;
    return node.name.toLowerCase().includes(keyword);
  });
});

const createColumns = ({ onTest, onEdit, onDelete, onMove }: {
    onTest: (row: Node) => void,
    onEdit: (row: Node) => void,
    onDelete: (row: Node) => void,
    onMove: (index: number, direction: 'up' | 'down') => void,
}): DataTableColumns<Node> => {
  return [
    {
      type: 'selection',
    },
    {
      title: '状态',
      key: 'status',
      width: 80,
      align: 'center',
      render(row) {
        switch (row.status) {
          case 'healthy':
            return h(NIcon, { color: '#63e2b7', size: 20 }, { default: () => '●' }); // Green circle
          case 'unhealthy':
            return h(NIcon, { color: '#e88080', size: 20 }, { default: () => '●' }); // Red circle
          case 'testing':
            return h(NSpin, { size: 'small' });
          case 'pending':
          default:
            return h(NIcon, { color: '#cccccc', size: 20 }, { default: () => '●' }); // Grey circle
        }
      }
    },
    { title: '名称', key: 'name', sorter: 'default', ellipsis: { tooltip: true } },
    { title: '服务器', key: 'server', sorter: 'default', ellipsis: { tooltip: true } },
    { title: '端口', key: 'port', sorter: 'default', width: 100 },
    {
      title: '类型',
      key: 'protocol',
      sorter: 'default',
      width: 120,
      render(row) {
        const protocol = row.protocol || row.type;
        if (!protocol) return h('span', {}, 'N/A');

        const colorMap: Record<string, string> = {
          vmess: '#ff69b4',
          vless: '#8a2be2',
          trojan: '#dc143c',
          ss: '#00bfff',
          hysteria2: '#20b2aa',
          tuic: '#7b68ee',
        };
        
        const tagColor = {
          color: colorMap[protocol.toLowerCase()] || '#7f8c8d',
          textColor: '#ffffff',
          borderColor: 'transparent'
        };

        return h(NTag, { size: 'small', round: true, color: tagColor }, { default: () => protocol.toUpperCase() });
      }
    },
    {
      title: '延迟',
      key: 'latency',
      width: 100,
      sorter: (a, b) => (a.latency ?? Infinity) - (b.latency ?? Infinity),
      render(row) {
        if (row.latency === undefined || row.latency === null) {
          return h(NTag, { type: 'default', size: 'small', round: true }, { default: () => 'N/A' });
        }
        const type = row.latency < 200 ? 'success' : row.latency < 500 ? 'warning' : 'error';
        return h(NTag, { type, size: 'small', round: true }, { default: () => `${row.latency}ms` });
      }
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render(row, index) {
        return h(NSpace, null, {
          default: () => [
            h(NButton, { size: 'small', circle: true, tertiary: true, onClick: () => onTest(row), disabled: true /*row.status === 'testing'*/ }, { icon: () => h(NIcon, null, { default: () => h(FlashIcon) }) }),
            h(NButton, { size: 'small', onClick: () => onEdit(row) }, { default: () => '编辑' }),
            h(NButton, { size: 'small', type: 'error', ghost: true, onClick: () => onDelete(row) }, { default: () => '删除' }),
            h(NButton, { size: 'small', disabled: index === 0, onClick: () => onMove(index, 'up') }, { default: () => '上移' }),
            h(NButton, { size: 'small', disabled: index === nodes.value.length - 1, onClick: () => onMove(index, 'down') }, { default: () => '下移' }),
          ]
        });
      }
    }
  ];
};

const fetchData = async () => {
  if (authStore.isLoggingOut) return; // Logout guard
  loading.value = true;
  try {
    const url = '/api/nodes';
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${authStore.token}` }
    });
    const result: { success: boolean, data?: Node[], message?: string } = await response.json();
    if (result.success && result.data) {
      nodes.value = result.data;
    } else {
      message.error(result.message || '获取节点列表失败');
    }
  } catch (err) {
    message.error('请求失败，请稍后重试');
  } finally {
    loading.value = false;
  }
};

const testNode = async (node: Node) => {
  // Optimistic UI update
  const nodeInArray = nodes.value.find(n => n.id === node.id);
  if (nodeInArray) {
    nodeInArray.status = 'testing';
  }

  try {
    const response = await fetch(`/api/nodes/${node.id}/test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authStore.token}`
      }
    });
    const result: { success: boolean, message?: string } = await response.json();
    if (response.status === 202 && result.success) {
      message.info(result.message || `节点 "${node.name}" 的健康检查已启动`);
      // The UI will be updated via SSE, no need for polling.
    } else {
      message.error(result.message || '启动健康检查失败');
      // Revert optimistic update on failure
      if (nodeInArray) {
        nodeInArray.status = 'pending'; // Or its previous status
      }
    }
  } catch (err) {
    message.error('请求失败，请稍后重试');
    if (nodeInArray) {
      nodeInArray.status = 'pending'; // Or its previous status
    }
  }
};

const testAllNodes = () => {
  message.warning('该功能正在维护中，已暂时禁用。');
  // if (nodes.value.length === 0) {
  //   message.warning('没有可检查的节点。');
  //   return;
  // }
  //
  // checkingAll.value = true;
  // // Optimistic UI update: set all nodes to 'testing'
  // nodes.value.forEach(node => {
  //   node.status = 'testing';
  // });
  //
  // const nodeIds = nodes.value.map(node => node.id);
  // fetch('/api/nodes/health-check', {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     'Authorization': `Bearer ${authStore.token}`,
  //   },
  //   body: JSON.stringify({ nodeIds }),
  // }).then(response => response.json()).then(result => {
  //   const res = result as { success: boolean, message?: string };
  //   if (res.success) {
  //     message.info(res.message || `已启动对 ${nodeIds.length} 个节点的健康检查。`);
  //   } else {
  //     message.error(res.message || '启动批量健康检查失败');
  //     checkingAll.value = false;
  //     fetchData(); // Revert UI
  //   }
  // }).catch(err => {
  //   message.error('请求启动健康检查失败，请稍后重试');
  //   checkingAll.value = false;
  //   fetchData(); // Revert UI
  // });
};

// SSE functionality is temporarily disabled.
// let eventSource: EventSource | null = null;
// const isSseConnected = ref(false);
//
// const closeSSE = () => {
//   if (eventSource) {
//     eventSource.close();
//     eventSource = null;
//   }
//   isSseConnected.value = false;
//   console.log('SSE connection explicitly closed.');
// };
//
// const setupSSE = () => {
//   // Prevent multiple connections
//   if (isSseConnected.value || !authStore.token) {
//     return;
//   }
//
//   // Defensive close, in case of HMR or other issues leaving a zombie connection
//   closeSSE();
//
//   eventSource = new EventSource(`/api/nodes/health-check-stream?token=${authStore.token}`);
//   isSseConnected.value = true;
//
//   eventSource.onopen = () => {
//     console.log('SSE connection opened.');
//   };
//
//   eventSource.addEventListener('update', (event) => {
//     const data = JSON.parse(event.data);
//     const node = nodes.value.find(n => n.id === data.nodeId);
//     if (node) {
//       node.status = data.status;
//       node.latency = data.latency;
//       node.last_checked = data.last_checked;
//       node.error = data.error;
//     }
//   });
//
//   eventSource.addEventListener('finished', (event) => {
//     const data = JSON.parse(event.data);
//     message.success(data.message || '所有节点检查完成。');
//     checkingAll.value = false;
//     // We don't close the connection here, to allow for single node tests
//   });
//
//   eventSource.onerror = (err) => {
//     console.error('SSE Error:', err);
//     message.error('与服务器的实时连接中断。');
//     checkingAll.value = false;
//     closeSSE(); // Close and reset state on error
//   };
// };

const showModal = ref(false);
const editingNode = ref<Node | null>(null);
const saveLoading = ref(false);

// For Add from Link modal
const showAddFromLinkModal = ref(false);
const addLink = ref('');
const addFromLinkLoading = ref(false);
const previewNodes = ref<(ParsedNode & { id: string; raw: string; })[]>([]);
const importGroupId = ref<string | undefined>(undefined);

// For Move to Group modal
const showMoveToGroupModal = ref(false);
const moveToGroupId = ref<string | null>(null);
const moveToGroupLoading = ref(false);

// For Add Group modal
const showAddGroupModal = ref(false);
const newGroupName = ref('');
const addGroupLoading = ref(false);

// For Edit Group modal
const showEditGroupModal = ref(false);
const editingGroup = ref<NodeGroup | null>(null);
const editingGroupName = ref('');
const editGroupLoading = ref(false);

// Columns for the preview table in the modal
const previewColumns: DataTableColumns<ParsedNode> = [
  { title: '名称', key: 'name', ellipsis: { tooltip: true } },
  { title: '协议', key: 'protocol', width: 80 },
  { title: '服务器', key: 'server', ellipsis: { tooltip: true } },
  { title: '端口', key: 'port', width: 70 },
];

// Watch for changes in the textarea and parse nodes for preview
watch(addLink, debounce((newVal: string) => {
  if (newVal.trim()) {
    previewNodes.value = parseNodeLinks(newVal);
  } else {
    previewNodes.value = [];
  }
}, 300));


const defaultFormState: Partial<Node> = {
  name: '',
  link: '',
};

const formState = reactive({ ...defaultFormState });

const nodeTypeOptions = [
  { label: 'VMess', value: 'vmess' },
  { label: 'VLESS', value: 'vless' },
  { label: 'Shadowsocks', value: 'ss' },
  { label: 'Trojan', value: 'trojan' },
  { label: 'Hysteria2', value: 'hysteria2' },
  { label: 'TUIC', value: 'tuic' },
];

const modalTitle = computed(() => (editingNode.value ? '编辑节点' : '新增节点'));

const openModal = (node: Node | null = null) => {
  if (node) {
    editingNode.value = node;
    formState.name = node.name;
    formState.link = node.link; // Directly use the original link
    showModal.value = true;
  } else {
    // This case is for "Add New Node", which is now handled by a different modal.
    handleOpenAddFromLinkModal();
  }
};

const handleSave = async () => {
  if (!editingNode.value) {
    // This should not happen as the add flow is separate now.
    message.error('发生意外错误：没有正在编辑的节点。');
    return;
  }

  saveLoading.value = true;
  try {
    // When editing, we only update the name and protocol_params.
    // The link remains unchanged to preserve its integrity.
    // When editing, we only update the name and the link.
    const payload = {
      name: formState.name,
      link: formState.link,
    };
    
    const url = `/api/nodes/${editingNode.value.id}`;
    const method = 'PUT';

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authStore.token}`,
      },
      body: JSON.stringify(payload),
    });

    const result: { success: boolean; message?: string } = await response.json();
    if (result.success) {
      message.success('节点更新成功');
      showModal.value = false;
      fetchData();
    } else {
      message.error(result.message || '保存失败');
    }
  } catch (err) {
    message.error('请求失败，请稍后重试');
  } finally {
    saveLoading.value = false;
  }
};


const handleOpenAddFromLinkModal = () => {
  addLink.value = '';
  previewNodes.value = [];
  showAddFromLinkModal.value = true;
};

const handleBatchImport = async () => {
  if (previewNodes.value.length === 0) {
    message.warning('没有可导入的有效节点。请在上方文本框中粘贴节点链接。');
    return;
  }
  addFromLinkLoading.value = true;
  try {
    const response = await fetch('/api/nodes/batch-import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authStore.token}`,
      },
      // The backend's batch-import endpoint can accept pre-parsed nodes.
      body: JSON.stringify({
        nodes: previewNodes.value,
        groupId: importGroupId.value || null, // Send null if undefined
      }),
    });

    const result: { success: boolean; message?: string } = await response.json();
    if (result.success) {
      message.success(result.message || `成功导入 ${previewNodes.value.length} 个节点`);
      showAddFromLinkModal.value = false;
      fetchData();
    } else {
      message.error(result.message || '导入失败');
    }
  } catch (error) {
    message.error('请求失败，请稍后重试');
  } finally {
    addFromLinkLoading.value = false;
  }
};

const handleEditNode = (row: Node) => {
    openModal(row);
};

const handleDeleteNode = (row: Node) => {
    dialog.warning({
        title: '确认删除',
        content: `确定要删除节点 "${row.name}" 吗？`,
        positiveText: '确定',
        negativeText: '取消',
        onPositiveClick: async () => {
            try {
                const response = await fetch(`/api/nodes/${row.id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${authStore.token}` }
                });
                const result: { success: boolean, message?: string } = await response.json();
                if (result.success) {
                    message.success('节点删除成功');
                    fetchData();
                } else {
                    message.error(result.message || '删除失败');
                }
            } catch (err) {
                message.error('请求失败，请稍后重试');
            }
        }
    });
};

const orderChanged = ref(false);
const saveOrderLoading = ref(false);

const moveNode = (index: number, direction: 'up' | 'down') => {
  if (direction === 'up' && index > 0) {
    [nodes.value[index], nodes.value[index - 1]] = [nodes.value[index - 1], nodes.value[index]];
    orderChanged.value = true;
  } else if (direction === 'down' && index < nodes.value.length - 1) {
    [nodes.value[index], nodes.value[index + 1]] = [nodes.value[index + 1], nodes.value[index]];
    orderChanged.value = true;
  }
};

const handleSaveOrder = async () => {
  saveOrderLoading.value = true;
  try {
    const nodeIds = nodes.value.map(node => node.id);
    const response = await fetch('/api/nodes/update-order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authStore.token}`
      },
      body: JSON.stringify({ nodeIds })
    });
    const result: { success: boolean, message?: string } = await response.json();
    if (result.success) {
      message.success('节点顺序已保存');
      orderChanged.value = false;
    } else {
      message.error(result.message || '保存顺序失败');
    }
  } catch (err) {
    message.error('请求失败，请稍后重试');
  } finally {
    saveOrderLoading.value = false;
  }
};

const columns = createColumns({
    onTest: testNode,
    onEdit: handleEditNode,
    onDelete: handleDeleteNode,
    onMove: moveNode,
});

const handleBatchDelete = () => {
  if (checkedRowKeys.value.length === 0) {
    message.warning('请至少选择一个节点');
    return;
  }
  dialog.warning({
    title: '确认批量删除',
    content: `确定要删除选中的 ${checkedRowKeys.value.length} 个节点吗？`,
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const response = await fetch('/api/nodes/batch-delete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authStore.token}`
          },
          body: JSON.stringify({ ids: checkedRowKeys.value })
        });
        const result: { success: boolean, message?: string } = await response.json();
        if (result.success) {
          message.success('批量删除成功');
          fetchData();
          checkedRowKeys.value = []; // Clear selection
        } else {
          message.error(result.message || '批量删除失败');
        }
      } catch (err) {
        message.error('请求失败，请稍后重试');
      }
    }
  });
};

const handleSaveGroup = async () => {
  if (!newGroupName.value.trim()) {
    message.warning('分组名称不能为空');
    return;
  }
  addGroupLoading.value = true;
  try {
    const response = await groupStore.addGroup(newGroupName.value);
    if (response.success) {
      message.success('分组创建成功');
      showAddGroupModal.value = false;
      newGroupName.value = '';
    } else {
      message.error(response.message || '创建失败');
    }
  } catch (error: any) {
    message.error(error.message || '请求失败');
  } finally {
    addGroupLoading.value = false;
  }
};

const getDropdownOptions = (group: NodeGroup) => {
  return [
    { label: '重命名', key: 'rename' },
    { label: group.is_enabled ? '禁用' : '启用', key: 'toggle' },
    { label: '删除', key: 'delete', props: { style: 'color: red;' } }
  ];
};

const handleGroupAction = (key: string, group: NodeGroup) => {
  switch (key) {
    case 'rename':
      editingGroup.value = group;
      editingGroupName.value = group.name;
      showEditGroupModal.value = true;
      break;
    case 'toggle':
      groupStore.toggleGroup(group.id);
      break;
    case 'delete':
      dialog.warning({
        title: '确认删除',
        content: `确定要删除分组 "${group.name}" 吗？分组下的节点将变为“未分组”。`,
        positiveText: '确定',
        negativeText: '取消',
        onPositiveClick: async () => {
          const response = await groupStore.deleteGroup(group.id);
          if (response.success) {
            message.success('分组删除成功');
          } else {
            message.error(response.message || '删除失败');
          }
        }
      });
      break;
  }
};

const handleUpdateGroup = async () => {
  if (!editingGroup.value || !editingGroupName.value.trim()) {
    message.warning('分组名称不能为空');
    return;
  }
  editGroupLoading.value = true;
  try {
    const response = await groupStore.updateGroup(editingGroup.value.id, editingGroupName.value);
    if (response.success) {
      message.success('分组更新成功');
      showEditGroupModal.value = false;
    } else {
      message.error(response.message || '更新失败');
    }
  } catch (error: any) {
    message.error(error.message || '请求失败');
  } finally {
    editGroupLoading.value = false;
  }
};

const handleMoveToGroup = async () => {
  if (checkedRowKeys.value.length === 0) {
    message.warning('请至少选择一个节点');
    return;
  }
  moveToGroupLoading.value = true;
  try {
    const response = await api.post('/nodes/batch-update-group', {
      nodeIds: checkedRowKeys.value,
      groupId: moveToGroupId.value,
    });
    if (response.success) {
      message.success('节点分组更新成功');
      showMoveToGroupModal.value = false;
      checkedRowKeys.value = [];
      fetchData(); // Refresh node list
    } else {
      message.error(response.message || '移动失败');
    }
  } catch (error: any) {
    message.error(error.message || '请求失败');
  } finally {
    moveToGroupLoading.value = false;
  }
};

onMounted(() => {
  fetchData();
  groupStore.fetchGroups();
  // setupSSE(); // Temporarily disabled
});

onBeforeUnmount(() => {
  // closeSSE(); // Temporarily disabled
});
</script>

<template>
  <div>
    <n-page-header>
      <template #title>
        手动节点管理
      </template>
      <template #extra>
        <n-space>
          <n-button v-if="orderChanged" type="success" @click="handleSaveOrder" :loading="saveOrderLoading">保存排序</n-button>
          <n-button @click="handleBatchAction('sort')">一键排序</n-button>
          <n-button @click="handleBatchAction('deduplicate')">一键去重</n-button>
          <n-button type="primary" @click="openModal(null)">导入节点</n-button>
          <n-button type="primary" ghost @click="showAddGroupModal = true">新增分组</n-button>
          <n-button type="error" @click="handleBatchAction('clear')">一键清空</n-button>
          <n-button type="primary" ghost @click="showMoveToGroupModal = true" :disabled="checkedRowKeys.length === 0">移动到分组</n-button>
          <n-button type="error" ghost @click="handleBatchDelete" :disabled="checkedRowKeys.length === 0">批量删除</n-button>
          <n-button type="primary" ghost @click="testAllNodes" :loading="checkingAll">检查所有节点</n-button>
        </n-space>
      </template>
    </n-page-header>

    <n-input
      v-model:value="filterKeyword"
      placeholder="按名称过滤节点..."
      clearable
      class="mt-4"
      style="max-width: 300px;"
    />

    <n-tabs type="card" class="mt-4" :value="activeTab" @update:value="activeTab = $event">
      <n-tab-pane name="all" tab="全部" />
      <n-tab-pane name="ungrouped" tab="未分组" />
      <n-tab-pane v-for="group in groupStore.groups" :key="group.id" :name="group.id">
        <template #tab>
          <n-dropdown
            trigger="click"
            :options="getDropdownOptions(group)"
            @select="(key) => handleGroupAction(key, group)"
          >
            <span :style="{ color: group.is_enabled ? '' : '#999' }">{{ group.name }}</span>
          </n-dropdown>
        </template>
      </n-tab-pane>
    </n-tabs>

    <n-data-table
      :columns="columns"
      :data="filteredNodes"
      :row-key="(row: Node) => row.id"
      v-model:checked-row-keys="checkedRowKeys"
      :loading="loading"
      :pagination="{ pageSize: 15 }"
      :bordered="false"
      class="mt-4"
    />

    <n-modal
      v-model:show="showModal"
      preset="card"
      :title="modalTitle"
      style="width: 600px;"
      :mask-closable="false"
    >
      <n-form @submit.prevent="handleSave">
        <n-form-item label="备注" required>
          <n-input v-model:value="formState.name" placeholder="为节点设置一个易于识别的名称" />
        </n-form-item>
        
        <n-form-item label="原始链接" required>
          <n-input
            v-model:value="formState.link"
            type="textarea"
            placeholder="节点的原始分享链接"
            :autosize="{ minRows: 4, maxRows: 8 }"
          />
        </n-form-item>

        <n-space justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" @click="handleSave" :loading="saveLoading">保存</n-button>
        </n-space>
      </n-form>
    </n-modal>

    <n-modal
      v-model:show="showAddFromLinkModal"
      preset="card"
      title="批量导入节点"
      style="width: 800px;"
      :mask-closable="false"
    >
      <n-form @submit.prevent="handleBatchImport">
        <n-form-item label="分享链接">
          <n-input
            v-model:value="addLink"
            type="textarea"
            placeholder="在此处粘贴一个或多个节点分享链接，每行一个..."
            :autosize="{ minRows: 5, maxRows: 10 }"
          />
        </n-form-item>

        <n-form-item label="节点预览" v-if="previewNodes.length > 0">
           <n-data-table
            :columns="previewColumns"
            :data="previewNodes"
            :row-key="(row: any) => row.id"
            :max-height="250"
            :pagination="false"
            :bordered="true"
            size="small"
          />
        </n-form-item>

        <n-form-item label="导入到分组">
          <n-select
            v-model:value="importGroupId"
            placeholder="默认导入到“未分组”"
            :options="groupStore.groups.map(g => ({ label: g.name, value: g.id }))"
            clearable
          />
        </n-form-item>

        <n-space justify="end">
          <n-button @click="showAddFromLinkModal = false">取消</n-button>
          <n-button type="primary" @click="handleBatchImport" :loading="addFromLinkLoading" :disabled="previewNodes.length === 0">
            导入 {{ previewNodes.length > 0 ? `(${previewNodes.length}个节点)`: '' }}
          </n-button>
        </n-space>
      </n-form>
    </n-modal>

    <n-modal
      v-model:show="showAddGroupModal"
      preset="card"
      title="新增分组"
      style="width: 400px;"
      :mask-closable="false"
    >
      <n-form @submit.prevent="handleSaveGroup">
        <n-form-item label="分组名称" required>
          <n-input v-model:value="newGroupName" placeholder="请输入分组名称" />
        </n-form-item>
        <n-space justify="end">
          <n-button @click="showAddGroupModal = false">取消</n-button>
          <n-button type="primary" @click="handleSaveGroup" :loading="addGroupLoading">保存</n-button>
        </n-space>
      </n-form>
    </n-modal>

    <n-modal
      v-model:show="showEditGroupModal"
      preset="card"
      title="重命名分组"
      style="width: 400px;"
      :mask-closable="false"
    >
      <n-form @submit.prevent="handleUpdateGroup">
        <n-form-item label="新名称" required>
          <n-input v-model:value="editingGroupName" placeholder="请输入新的分组名称" />
        </n-form-item>
        <n-space justify="end">
          <n-button @click="showEditGroupModal = false">取消</n-button>
          <n-button type="primary" @click="handleUpdateGroup" :loading="editGroupLoading">保存</n-button>
        </n-space>
      </n-form>
    </n-modal>

  </div>

    <n-modal
      v-model:show="showMoveToGroupModal"
      preset="card"
      title="移动节点到分组"
      style="width: 400px;"
      :mask-closable="false"
    >
      <n-form @submit.prevent="handleMoveToGroup">
        <n-form-item label="目标分组" required>
          <n-select
            v-model:value="moveToGroupId"
            placeholder="请选择目标分组（可清空变为未分组）"
            :options="groupStore.groups.map(g => ({ label: g.name, value: g.id }))"
            clearable
          />
        </n-form-item>
        <n-space justify="end">
          <n-button @click="showMoveToGroupModal = false">取消</n-button>
          <n-button type="primary" @click="handleMoveToGroup" :loading="moveToGroupLoading">确认移动</n-button>
        </n-space>
      </n-form>
    </n-modal>
</template>