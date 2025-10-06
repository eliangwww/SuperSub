<script setup lang="ts">
import { ref, onMounted, reactive, computed, h } from 'vue';
import axios from 'axios';
import { useMessage, useDialog, NButton, NSpace, NDataTable, NPageHeader, NModal, NForm, NFormItem, NInput, NSpin, NIcon, NSelect, NDivider, NCard, NGrid, NGi, NCheckboxGroup, NCheckbox, NScrollbar, NTabs, NTabPane, NCollapse, NCollapseItem, NSwitch } from 'naive-ui';
import type { DataTableColumns, FormInst } from 'naive-ui';
import { Pencil as EditIcon, TrashBinOutline as DeleteIcon, CopyOutline as CopyIcon, EyeOutline as PreviewIcon } from '@vicons/ionicons5';
import { api } from '@/utils/api';
import { useAuthStore } from '@/stores/auth';
import type { ApiResponse, Profile, Subscription, Node } from '@/types';

const message = useMessage();
const dialog = useDialog();

const profiles = ref<Profile[]>([]);
const loading = ref(true);
const allSubscriptions = ref<Subscription[]>([]);
const allManualNodes = ref<Record<string, { id: string; name: string }[]>>({});
const allBackends = ref<any[]>([]);
const allConfigs = ref<any[]>([]);
const subToken = ref('');

// For Edit/Add Modal
const showEditModal = ref(false);
const saveLoading = ref(false);
const editingProfile = ref<Profile | null>(null);
const formRef = ref<FormInst | null>(null);

const defaultFormState = () => ({
  id: '',
  name: '',
  alias: '',
  subscription_ids: [] as string[],
  node_ids: [] as string[],
  node_prefix_settings: {
    enable_subscription_prefix: false,
    manual_node_prefix: '',
  },
  subconverter_backend_id: null as number | null,
  subconverter_config_id: null as number | null,
});

const formState = reactive(defaultFormState());

// For Nodes Preview Modal
const showNodesPreviewModal = ref(false);
const loadingNodesPreview = ref(false);
const currentProfileForPreview = ref<Profile | null>(null);
const nodesPreviewData = ref<{
  nodes: Partial<Node>[];
  analysis: {
    total: number;
    protocols: Record<string, number>;
    regions: Record<string, number>;
  };
} | null>(null);

// For custom multi-select filtering
const subFilter = ref('');
const nodeFilter = ref('');

const subscriptionOptions = computed(() => allSubscriptions.value.map(s => ({ label: s.name, value: s.id })));

const filteredSubscriptionOptions = computed(() => {
  if (!subFilter.value) return subscriptionOptions.value;
  return subscriptionOptions.value.filter(opt => opt.label.toLowerCase().includes(subFilter.value.toLowerCase()));
});

const handleGroupSelectAll = (group: { id: string; name: string }[], checked: boolean) => {
  const groupNodeIds = group.map(node => node.id);
  if (checked) {
    formState.node_ids = [...new Set([...formState.node_ids, ...groupNodeIds])];
  } else {
    formState.node_ids = formState.node_ids.filter(id => !groupNodeIds.includes(id));
  }
};

const isGroupSelected = (group: { id: string; name: string }[]) => {
  const groupNodeIds = new Set(group.map(node => node.id));
  return group.length > 0 && [...groupNodeIds].every(id => formState.node_ids.includes(id));
};

const isGroupIndeterminate = (group: { id: string; name: string }[]) => {
  const groupNodeIds = new Set(group.map(node => node.id));
  const selectedCount = formState.node_ids.filter(id => groupNodeIds.has(id)).length;
  return selectedCount > 0 && selectedCount < groupNodeIds.size;
};


const rules = {
  name: { required: true, message: '请输入名称', trigger: ['input', 'blur'] },
};

const modalTitle = computed(() => (editingProfile.value ? '编辑配置' : '新增配置'));

const previewNodeColumns: DataTableColumns<Partial<Node>> = [
  { title: '节点名称', key: 'name', ellipsis: { tooltip: true } },
  { title: '类型', key: 'type', width: 80, align: 'center' },
  { title: '服务器', key: 'server', width: 150, ellipsis: { tooltip: true } },
  { title: '端口', key: 'port', width: 80, align: 'center' },
];

const backendOptions = computed(() => allBackends.value.map(b => ({ label: b.name, value: b.id })));
const configOptions = computed(() => allConfigs.value.map(c => ({ label: c.name, value: c.id })));

const generatedUrl = computed(() => {
  if (!subToken.value || !formState.alias) return '';
  return `${window.location.origin}/s/${subToken.value}/${formState.alias}/subscribe`;
});

const copyGeneratedUrl = () => {
  if (generatedUrl.value) {
    navigator.clipboard.writeText(generatedUrl.value).then(() => message.success('链接已复制'));
  }
};

const createColumns = ({ onCopy, onPreview, onEdit, onDelete }: {
    onCopy: (row: Profile) => void,
    onPreview: (row: Profile) => void,
    onEdit: (row: Profile) => void,
    onDelete: (row: Profile) => void,
}): DataTableColumns<Profile> => {
  return [
    { title: '名称', key: 'name', sorter: 'default', width: 200 },
    {
      title: '订阅链接',
      key: 'alias',
      render(row) {
        if (!subToken.value || !row.alias) {
          return h('span', '请设置链接别名');
        }
        const url = `${window.location.origin}/s/${subToken.value}/${row.alias}/subscribe`;
        return h(NButton, { text: true, tag: 'a', href: url, target: '_blank', type: 'primary' }, { default: () => url });
      }
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render(row) {
        return h(NSpace, null, {
          default: () => [
            h(NButton, { size: 'small', circle: true, title: '复制链接', onClick: () => onCopy(row) }, { icon: () => h(NIcon, null, { default: () => h(CopyIcon) }) }),
            h(NButton, { size: 'small', circle: true, title: '预览', onClick: () => onPreview(row) }, { icon: () => h(NIcon, null, { default: () => h(PreviewIcon) }) }),
            h(NButton, { size: 'small', circle: true, type: 'primary', title: '编辑', onClick: () => onEdit(row) }, { icon: () => h(NIcon, null, { default: () => h(EditIcon) }) }),
            h(NButton, { size: 'small', circle: true, type: 'error', title: '删除', onClick: () => onDelete(row) }, { icon: () => h(NIcon, null, { default: () => h(DeleteIcon) }) }),
          ]
        });
      }
    }
  ];
};

const openEditModal = async (profile: Profile | null = null) => {
  const authStore = useAuthStore();
  if (!authStore.isAuthenticated) return;
  await fetchAllSources();
  // Reset form state to default
  Object.assign(formState, defaultFormState());

  if (profile) {
    // Editing an existing profile
    editingProfile.value = profile;
    formState.id = profile.id;
    formState.name = profile.name;
    formState.alias = profile.alias || '';

    // Parse content if it exists
    if (profile.content) {
      try {
        const content = JSON.parse(profile.content);
        formState.subscription_ids = content.subscription_ids || [];
        formState.node_ids = content.node_ids || [];
        formState.node_prefix_settings = {
          ...defaultFormState().node_prefix_settings,
          ...content.node_prefix_settings
        };
        formState.subconverter_backend_id = content.subconverter_backend_id || null;
        formState.subconverter_config_id = content.subconverter_config_id || null;
      } catch (e) {
        message.error('解析配置内容失败，将使用默认值。');
        // In case of parsing error, fall back to defaults for content-related fields
        formState.subscription_ids = [];
        formState.node_ids = [];
        formState.node_prefix_settings = { ...defaultFormState().node_prefix_settings };
        formState.subconverter_backend_id = null;
        formState.subconverter_config_id = null;
      }
    } else {
      // Fallback for profiles that might not have the content field populated
      formState.subscription_ids = profile.subscription_ids || [];
      formState.node_ids = profile.node_ids || [];
      formState.node_prefix_settings = {
        ...defaultFormState().node_prefix_settings,
        ...profile.node_prefix_settings
      };
      formState.subconverter_backend_id = profile.subconverter_backend_id || null;
      formState.subconverter_config_id = profile.subconverter_config_id || null;
    }
  } else {
    // Creating a new profile
    editingProfile.value = null;
    try {
      const defaultsResponse = await api.get('/user/defaults');
      if (defaultsResponse.data.success && defaultsResponse.data.data) {
        const userDefaults = defaultsResponse.data.data;
        formState.subconverter_backend_id = userDefaults.default_backend_id || null;
        formState.subconverter_config_id = userDefaults.default_config_id || null;
      }
    } catch (e) {
      console.warn("Could not fetch user defaults, falling back to global defaults.", e);
      // Fallback to global defaults if user-specific ones aren't available
      const defaultBackend = allBackends.value.find(b => b.is_default);
      const defaultConfig = allConfigs.value.find(c => c.is_default);
      formState.subconverter_backend_id = defaultBackend ? defaultBackend.id : null;
      formState.subconverter_config_id = defaultConfig ? defaultConfig.id : null;
    }
  }
  showEditModal.value = true;
};

const fetchProfiles = async () => {
  const authStore = useAuthStore();
  if (!authStore.isAuthenticated) return;
  loading.value = true;
  try {
    const response = await api.get<ApiResponse<Profile[]>>('/profiles');
    if (response.data.success) {
      profiles.value = response.data.data || [];
    } else {
      message.error(response.data.message || '获取配置列表失败');
    }
  } catch (err: any) {
    if (!axios.isCancel(err)) message.error(err.message || '请求失败');
  } finally {
    loading.value = false;
  }
};

const fetchSubToken = async () => {
  const authStore = useAuthStore();
  if (!authStore.isAuthenticated) return;
  try {
    const response = await api.get('/user/sub-token');
    if (response.data.success) {
      subToken.value = response.data.data.token;
    }
  } catch (error) {
    message.error('获取订阅令牌失败');
  }
};

const fetchAllSources = async () => {
  const authStore = useAuthStore();
  if (!authStore.isAuthenticated) return;
  try {
    const [subsRes, nodesRes, backendRes, configRes, ] = await Promise.all([
      api.get<ApiResponse<Subscription[]>>('/subscriptions'),
      api.get<ApiResponse<Record<string, any[]>>>('/nodes/grouped'),
      api.get<ApiResponse<any[]>>('/assets?type=backend'),
      api.get<ApiResponse<any[]>>('/assets?type=config'),
    ]);
    if (subsRes.data.success) allSubscriptions.value = subsRes.data.data || [];
    if (nodesRes.data.success) allManualNodes.value = nodesRes.data.data || {};
    if (backendRes.data.success) allBackends.value = backendRes.data.data || [];
    if (configRes.data.success) allConfigs.value = configRes.data.data || [];
  } catch (err: any) {
    if (!axios.isCancel(err)) message.error("获取订阅、节点或模板资源失败");
  }
};

const handleSave = async () => {
  formRef.value?.validate(async (errors) => {
    if (errors) {
      message.error('请填写所有必填项');
      return;
    }
    saveLoading.value = true;
    try {
      // Explicitly build the content payload, ensuring all fields are included.
      const contentPayload = {
        subscription_ids: formState.subscription_ids,
        node_ids: formState.node_ids,
        node_prefix_settings: formState.node_prefix_settings,
        subconverter_backend_id: formState.subconverter_backend_id,
        subconverter_config_id: formState.subconverter_config_id,
        generation_mode: 'online',
      };

      // Explicitly build the top-level payload.
      const payload = {
        name: formState.name,
        alias: formState.alias || null,
        content: JSON.stringify(contentPayload),
      };

      const response = editingProfile.value
        ? await api.put<ApiResponse>(`/profiles/${formState.id}`, payload)
        : await api.post<ApiResponse>('/profiles', payload);

      if (response.data.success) {
        message.success(editingProfile.value ? '配置更新成功' : '配置新增成功');
        showEditModal.value = false;
        await fetchProfiles(); // Use await to ensure list is updated before user sees it
      } else {
        message.error(response.data.message || '保存失败');
      }
    } catch (err: any) {
      if (!axios.isCancel(err)) {
        const errorMsg = err.response?.data?.message || err.message || '请求失败';
        message.error(errorMsg);
      }
    } finally {
      saveLoading.value = false;
    }
  });
};

const handleDelete = (row: Profile) => {
  dialog.warning({
    title: '确认删除',
    content: `确定要删除配置 "${row.name}" 吗？`,
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const response = await api.delete<ApiResponse>(`/profiles/${row.id}`);
        if (response.data.success) {
          message.success('配置删除成功');
          fetchProfiles();
        } else {
          message.error(response.data.message || '删除失败');
        }
      } catch (err: any) {
        if (!axios.isCancel(err)) message.error(err.message || '请求失败');
      }
    },
  });
};

const handleCopyLink = (row: Profile) => {
  if (!subToken.value || !row.alias) {
    message.error('无法复制链接：缺少订阅令牌或链接别名。');
    return;
  }
  const url = `${window.location.origin}/s/${subToken.value}/${row.alias}/subscribe`;
  navigator.clipboard.writeText(url).then(() => message.success('链接已复制'), () => message.error('复制失败'));
};

const onPreview = async (row: Profile) => {
  currentProfileForPreview.value = row;
  nodesPreviewData.value = null;
  loadingNodesPreview.value = true;
  showNodesPreviewModal.value = true;
  try {
    const response = await api.get<ApiResponse<typeof nodesPreviewData.value>>(`/profiles/${row.id}/preview-nodes`);
    if (response.data.success) {
      if (response.data.data) {
        nodesPreviewData.value = response.data.data;
      }
    } else {
      message.error(response.data.message || '加载预览失败');
      showNodesPreviewModal.value = false;
    }
  } catch (err: any) {
    if (!axios.isCancel(err)) {
      message.error(err.message || '请求预览失败');
      showNodesPreviewModal.value = false;
    }
  } finally {
    loadingNodesPreview.value = false;
  }
};

const columns = createColumns({ onCopy: handleCopyLink, onPreview, onEdit: openEditModal, onDelete: handleDelete });

onMounted(() => {
  fetchProfiles();
  fetchSubToken();
});

</script>

<template>
  <div>
    <n-page-header>
      <template #title>配置管理</template>
      <template #extra>
        <n-space>
          <n-button type="primary" @click="openEditModal(null)">新增配置</n-button>
        </n-space>
      </template>
    </n-page-header>

    <n-data-table :columns="columns" :data="profiles" :loading="loading" :pagination="{ pageSize: 10 }" :bordered="false" class="mt-4" />

    <!-- Edit/Add Modal -->
    <n-modal v-model:show="showEditModal" preset="card" :title="modalTitle" style="width: 1000px;" :trap-focus="false">
      <n-form ref="formRef" :model="formState" :rules="rules">
        <!-- Region 1: Core Definition -->
        <n-divider title-placement="left">核心定义</n-divider>
        <n-grid :cols="2" :x-gap="24">
          <n-gi>
            <n-form-item label="配置名称" path="name">
              <n-input v-model:value="formState.name" />
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="链接别名">
              <n-input v-model:value="formState.alias" placeholder="例如 my-clash-config" />
            </n-form-item>
          </n-gi>
        </n-grid>
        <n-form-item v-if="generatedUrl" label="生成链接">
          <n-input :value="generatedUrl" readonly>
            <template #suffix>
              <n-button text @click="copyGeneratedUrl">
                <n-icon :component="CopyIcon" />
              </n-button>
            </template>
          </n-input>
        </n-form-item>

        <!-- Region 2: Data Sources & Processing -->
        <n-divider title-placement="left">数据源与内容处理</n-divider>
        <n-tabs type="line" animated>
          <n-tab-pane name="subscriptions" tab="订阅">
            <n-card size="small" :bordered="true">
              <template #header-extra>
                <n-input v-model:value="subFilter" size="small" placeholder="筛选" clearable />
              </template>
              <n-scrollbar style="max-height: 300px;">
                <n-checkbox-group v-model:value="formState.subscription_ids">
                  <n-space vertical>
                    <n-checkbox v-for="sub in filteredSubscriptionOptions" :key="sub.value" :value="sub.value" :label="sub.label" />
                  </n-space>
                </n-checkbox-group>
              </n-scrollbar>
            </n-card>
          </n-tab-pane>
          <n-tab-pane name="manual-nodes" tab="手工节点">
            <n-card size="small" :bordered="true">
               <template #header-extra>
                <n-input v-model:value="nodeFilter" size="small" placeholder="筛选节点名称" clearable />
              </template>
              <n-scrollbar style="max-height: 300px;">
                <n-collapse>
                  <n-collapse-item v-for="(nodes, groupName) in allManualNodes" :key="groupName" :title="`${groupName} (${nodes.length})`">
                     <template #header-extra>
                      <n-checkbox
                        :checked="isGroupSelected(nodes)"
                        :indeterminate="isGroupIndeterminate(nodes)"
                        @update:checked="handleGroupSelectAll(nodes, $event)"
                        @click.stop
                      >
                        全选
                      </n-checkbox>
                    </template>
                    <n-checkbox-group v-model:value="formState.node_ids">
                      <n-space vertical>
                        <n-checkbox v-for="node in nodes.filter(n => n.name.toLowerCase().includes(nodeFilter.toLowerCase()))" :key="node.id" :value="node.id" :label="node.name" />
                      </n-space>
                    </n-checkbox-group>
                  </n-collapse-item>
                </n-collapse>
              </n-scrollbar>
            </n-card>
          </n-tab-pane>
          <n-tab-pane name="processing" tab="节点处理">
             <n-form-item label="机场订阅节点前缀">
                <n-switch v-model:value="formState.node_prefix_settings.enable_subscription_prefix" />
                <template #feedback>开启后，来自订阅的节点名称将自动变为 "订阅名称 - 节点名称"。</template>
            </n-form-item>
            <n-form-item label="手工节点前缀">
                <n-input v-model:value="formState.node_prefix_settings.manual_node_prefix" placeholder="例如 MyNodes" clearable />
                <template #feedback>设置后，所有手工添加的节点名称将变为 "前缀 - 节点名称"。</template>
            </n-form-item>
          </n-tab-pane>
        </n-tabs>

        <!-- Region 3: Output Target -->
        <n-divider title-placement="left">输出目标</n-divider>
        <n-grid :cols="2" :x-gap="24">
          <n-gi>
            <n-form-item label="转换后端">
              <n-select v-model:value="formState.subconverter_backend_id" :options="backendOptions" placeholder="留空则使用全局默认后端" clearable />
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="转换配置">
              <n-select v-model:value="formState.subconverter_config_id" :options="configOptions" placeholder="留空则使用全局默认配置" clearable />
            </n-form-item>
          </n-gi>
        </n-grid>
      </n-form>

      <template #footer>
        <n-space justify="end">
          <n-button @click="showEditModal = false">取消</n-button>
          <n-button type="primary" :loading="saveLoading" @click="handleSave">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- Nodes Preview Modal -->
    <n-modal v-model:show="showNodesPreviewModal" preset="card" :title="`节点预览 - ${currentProfileForPreview?.name}`" style="width: 800px;" :mask-closable="true" :trap-focus="false">
      <n-spin :show="loadingNodesPreview">
        <template v-if="nodesPreviewData">
          <n-card title="订阅分析" :bordered="false" class="mt-4">
            <n-grid :cols="3" :x-gap="12">
              <n-gi><n-statistic label="节点总数" :value="nodesPreviewData.analysis.total" /></n-gi>
              <n-gi>
                <n-statistic label="协议分布">
                  <n-space>
                    <n-tag v-for="(count, protocol) in nodesPreviewData.analysis.protocols" :key="protocol" type="info">{{ protocol.toUpperCase() }}: {{ count }}</n-tag>
                  </n-space>
                </n-statistic>
              </n-gi>
              <n-gi>
                <n-statistic label="地区分布">
                   <n-space :size="'small'" style="flex-wrap: wrap;">
                    <n-tag v-for="(count, region) in nodesPreviewData.analysis.regions" :key="region" type="success">{{ region }}: {{ count }}</n-tag>
                  </n-space>
                </n-statistic>
              </n-gi>
            </n-grid>
          </n-card>
          <n-data-table :columns="previewNodeColumns" :data="nodesPreviewData.nodes" :pagination="{ pageSize: 10 }" :max-height="400" class="mt-4" />
        </template>
        <div v-else-if="!loadingNodesPreview" style="text-align: center; padding: 20px;">没有获取到节点数据。</div>
      </n-spin>
    </n-modal>
  </div>
</template>