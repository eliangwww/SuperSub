<script setup lang="ts">
import { ref, onMounted, reactive, computed, h } from 'vue';
import axios from 'axios';
import { useRouter } from 'vue-router';
import { useMessage, useDialog, NButton, NSpace, NCode, NDataTable, NPageHeader, NModal, NForm, NFormItem, NInput, NSpin, NIcon, NSelect, NDivider, NCard, NGrid, NGi, NCheckboxGroup, NCheckbox, NScrollbar } from 'naive-ui';
import type { DataTableColumns, FormInst } from 'naive-ui';
import { Pencil as EditIcon, TrashBinOutline as DeleteIcon, CopyOutline as CopyIcon, EyeOutline as PreviewIcon } from '@vicons/ionicons5';
import { api } from '@/utils/api';
import type { ApiResponse, Profile, Subscription, Node, ConfigTemplate } from '@/types';

const message = useMessage();
const dialog = useDialog();
const router = useRouter();

const profiles = ref<Profile[]>([]);
const loading = ref(true);
const allSubscriptions = ref<Subscription[]>([]);
const allNodes = ref<Node[]>([]);
const allTemplates = ref<ConfigTemplate[]>([]);
const allBackends = ref<any[]>([]);
const allConfigs = ref<any[]>([]);

// For Edit/Add Modal
const showEditModal = ref(false);
const saveLoading = ref(false);
const editingProfile = ref<Profile | null>(null);
const formRef = ref<FormInst | null>(null);

const formState = reactive({
  id: '',
  name: '',
  description: '',
alias: '',
  // generation_mode is now fixed to 'online'
  generation_mode: 'online' as 'local' | 'online',
  subconverter_backend_id: null as number | null,
  subconverter_config_id: null as number | null,
  subscription_ids: [] as string[],
  nodeIds: [] as string[],
});

// For Preview Modal
const showPreviewModal = ref(false);
const previewContent = ref('');
const loadingPreview = ref(false);

// For custom multi-select
const subFilter = ref('');
const nodeFilter = ref('');

const filteredSubscriptionOptions = computed(() => {
  if (!subFilter.value) {
    return subscriptionOptions.value;
  }
  return subscriptionOptions.value.filter(opt => opt.label.toLowerCase().includes(subFilter.value.toLowerCase()));
});

const filteredNodeOptions = computed(() => {
  if (!nodeFilter.value) {
    return nodeOptions.value;
  }
  return nodeOptions.value.filter(opt => opt.label.toLowerCase().includes(nodeFilter.value.toLowerCase()));
});

// --- Select All Logic ---
const isAllSubsSelected = computed(() => {
  const filteredIds = new Set(filteredSubscriptionOptions.value.map(opt => opt.value));
  return filteredSubscriptionOptions.value.length > 0 && [...filteredIds].every(id => formState.subscription_ids.includes(id));
});

const isAllNodesSelected = computed(() => {
  const filteredIds = new Set(filteredNodeOptions.value.map(opt => opt.value));
  return filteredNodeOptions.value.length > 0 && [...filteredIds].every(id => formState.nodeIds.includes(id));
});

const isSubsIndeterminate = computed(() => {
  const filteredIds = new Set(filteredSubscriptionOptions.value.map(opt => opt.value));
  const selectedCount = formState.subscription_ids.filter(id => filteredIds.has(id)).length;
  return selectedCount > 0 && selectedCount < filteredIds.size;
});

const isNodesIndeterminate = computed(() => {
  const filteredIds = new Set(filteredNodeOptions.value.map(opt => opt.value));
  const selectedCount = formState.nodeIds.filter(id => filteredIds.has(id)).length;
  return selectedCount > 0 && selectedCount < filteredIds.size;
});

const handleSelectAllSubs = (checked: boolean) => {
  const filteredIds = filteredSubscriptionOptions.value.map(opt => opt.value);
  if (checked) {
    // Add only filtered items to selection, avoiding duplicates
    const newIds = new Set([...formState.subscription_ids, ...filteredIds]);
    formState.subscription_ids = Array.from(newIds);
  } else {
    // Remove only filtered items from selection
    formState.subscription_ids = formState.subscription_ids.filter(id => !filteredIds.includes(id));
  }
};

const handleSelectAllNodes = (checked: boolean) => {
  const filteredIds = filteredNodeOptions.value.map(opt => opt.value);
  if (checked) {
    const newIds = new Set([...formState.nodeIds, ...filteredIds]);
    formState.nodeIds = Array.from(newIds);
  } else {
    formState.nodeIds = formState.nodeIds.filter(id => !filteredIds.includes(id));
  }
};

const rules = {
  name: {
    required: true,
    message: '请输入名称',
    trigger: ['input', 'blur'],
  },
};

// For Logs Modal

const modalTitle = computed(() => (editingProfile.value ? '编辑配置' : '新增配置'));


const subscriptionOptions = computed(() => allSubscriptions.value.map(s => ({ label: s.name, value: s.id })));
const nodeOptions = computed(() => allNodes.value.map(n => ({ label: n.name, value: n.id })));
const backendOptions = computed(() => allBackends.value.map(b => ({ label: b.name, value: b.id })));
const configOptions = computed(() => allConfigs.value.map(c => ({ label: c.name, value: c.id })));


const generatedUrl = computed(() => {
  if (formState.alias) {
    return `${window.location.origin}/sub/${formState.alias}`;
  }
  return '';
});

const copyGeneratedUrl = () => {
  if (generatedUrl.value) {
    navigator.clipboard.writeText(generatedUrl.value).then(() => {
      message.success('链接已复制');
    });
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
    { title: '描述', key: 'description', ellipsis: { tooltip: true } },
    {
      title: '订阅链接',
      key: 'alias',
      render(row) {
        let alias = row.alias;
        try {
          if (row.content) {
            const contentData = JSON.parse(row.content);
            if (contentData.alias) {
              alias = contentData.alias;
            }
          }
        } catch (e) {
          // Ignore parsing errors
        }

        const url = alias
          ? `${window.location.origin}/sub/${alias}`
          : `${window.location.origin}/api/profiles/${row.id}/generate`;
        
        if (!alias) {
            return h('span', { style: 'color: #999; font-style: italic;' }, '无别名，使用ID生成');
        }

        return h(NButton, {
          text: true,
          tag: 'a',
          href: url,
          target: '_blank',
          type: 'primary',
        }, { default: () => url });
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
  // Fetch all available sources first
  await fetchAllSources();

  if (profile) {
    editingProfile.value = profile;
    
    // Safely parse the content field
    let contentData = { alias: '', description: '', subconverter_backend_id: null, subconverter_config_id: null, subscription_ids: [], nodeIds: [] };
    try {
      if (profile.content) {
        contentData = { ...contentData, ...JSON.parse(profile.content) };
      }
    } catch (e) {
      console.error("Failed to parse profile content:", e);
    }

    // The profile object is now expanded on the backend, so we can access properties directly.
    formState.id = profile.id;
    formState.name = profile.name;
    formState.description = contentData.description || profile.description || '';
    formState.alias = contentData.alias || profile.alias || '';
    formState.generation_mode = 'online'; // Always online
    formState.subconverter_backend_id = contentData.subconverter_backend_id || profile.subconverter_backend_id || null;
    formState.subconverter_config_id = contentData.subconverter_config_id || profile.subconverter_config_id || null;
    formState.subscription_ids = contentData.subscription_ids || profile.subscription_ids || [];
    formState.nodeIds = contentData.nodeIds || profile.nodeIds || [];

  } else {
    editingProfile.value = null;
    formState.id = '';
    formState.name = '';
    formState.description = '';
    formState.alias = '';
    formState.generation_mode = 'online';
    
    // Auto-select default backend and config
    const defaultBackend = allBackends.value.find(b => b.is_default);
    const defaultConfig = allConfigs.value.find(c => c.is_default);
    formState.subconverter_backend_id = defaultBackend ? defaultBackend.id : null;
    formState.subconverter_config_id = defaultConfig ? defaultConfig.id : null;

    formState.subscription_ids = [];
    formState.nodeIds = [];
  }
  showEditModal.value = true;
};

const fetchProfiles = async () => {
  loading.value = true;
  try {
    const response = await api.get<ApiResponse<Profile[]>>('/profiles');
    if (response.data.success && response.data.data) {
      profiles.value = response.data.data;
    } else {
      message.error(response.data.message || '获取配置列表失败');
    }
  } catch (err: any) {
    if (!axios.isCancel(err)) {
      message.error(err.message || '请求失败，请稍后重试');
    }
  } finally {
    loading.value = false;
  }
};

const fetchAllSources = async () => {
  try {
    const [subsRes, nodesRes, tplRes, assetsRes] = await Promise.all([
      api.get<ApiResponse<Subscription[]>>('/subscriptions'),
      api.get<ApiResponse<Node[]>>('/nodes'),
      api.get<ApiResponse<ConfigTemplate[]>>('/config-templates'),
      api.get<ApiResponse<any[]>>('/subconverter-assets'),
    ]);
    if (subsRes.data.success && subsRes.data.data) {
      allSubscriptions.value = subsRes.data.data;
    }
    if (nodesRes.data.success && nodesRes.data.data) {
      allNodes.value = nodesRes.data.data;
    }
    if (tplRes.data.success && tplRes.data.data) {
      allTemplates.value = tplRes.data.data;
    }
    if (assetsRes.data.success && assetsRes.data.data) {
      allBackends.value = assetsRes.data.data.filter(a => a.type === 'backend');
      allConfigs.value = assetsRes.data.data.filter(a => a.type === 'config');
    }
  } catch (err: any) {
    if (!axios.isCancel(err)) {
      message.error("获取订阅、节点、模板或转换资源列表失败");
    }
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
      // Consolidate all profile settings into a single 'content' object
      const contentPayload = {
        description: formState.description,
        alias: formState.alias || null,
        generation_mode: 'online', // Hardcoded to online
        subconverter_backend_id: formState.subconverter_backend_id,
        subconverter_config_id: formState.subconverter_config_id,
        subscription_ids: formState.subscription_ids,
        nodeIds: formState.nodeIds,
      };

      // The final payload sent to the backend
      const payload = {
        name: formState.name,
        content: JSON.stringify(contentPayload), // All details are in 'content'
      };

      const response = editingProfile.value
        ? await api.put<ApiResponse>(`/profiles/${formState.id}`, payload)
        : await api.post<ApiResponse>('/profiles', payload);

      if (response.data.success) {
        message.success(editingProfile.value ? '配置更新成功' : '配置新增成功');
        showEditModal.value = false;
        fetchProfiles();
      } else {
        message.error(response.data.message || '保存失败');
      }
    } catch (err: any) {
      if (!axios.isCancel(err)) {
        message.error(err.message || '请求失败，请稍后重试');
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
        if (!axios.isCancel(err)) {
          message.error(err.message || '请求失败，请稍后重试');
        }
      }
    },
  });
};

const handleCopyLink = (row: Profile) => {
  let alias = row.alias;
  try {
    if (row.content) {
      const contentData = JSON.parse(row.content);
      if (contentData.alias) {
        alias = contentData.alias;
      }
    }
  } catch (e) {
    // Ignore parsing errors
  }

  const url = alias
    ? `${window.location.origin}/sub/${alias}`
    : `${window.location.origin}/api/profiles/${row.id}/generate`;
  
  navigator.clipboard.writeText(url).then(() => {
    message.success('链接已复制到剪贴板');
  }, () => {
    message.error('复制失败');
  });
};

const handlePreview = async (row: Profile) => {
  previewContent.value = '';
  loadingPreview.value = true;
  showPreviewModal.value = true;
  try {
    // The generate endpoint returns plain text, so we handle it directly
    const response = await api.get<string>(`/profiles/${row.id}/generate`);
    const textContent = response.data;
    if (textContent) {
      previewContent.value = atob(textContent);
    }
  } catch (err: any) {
    if (!axios.isCancel(err)) {
      message.error(err.message || '生成预览失败');
      showPreviewModal.value = false;
    }
  } finally {
    loadingPreview.value = false;
  }
};

const columns = createColumns({
    onCopy: handleCopyLink,
    onPreview: handlePreview,
    onEdit: openEditModal,
    onDelete: handleDelete,
});

onMounted(fetchProfiles);

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

    <n-data-table
      :columns="columns"
      :data="profiles"
      :loading="loading"
      :pagination="{ pageSize: 10 }"
      :bordered="false"
      class="mt-4"
    />

    <!-- Edit/Add Modal -->
    <n-modal
      v-model:show="showEditModal"
      preset="card"
      :title="modalTitle"
      style="width: 1000px;"
      class="profile-builder-modal"
    >
      <n-form ref="formRef" :model="formState" :rules="rules">
        <n-grid :cols="2" :x-gap="24">
          <!-- Left Column -->
          <n-gi>
            <n-divider title-placement="left">基本信息</n-divider>
            <n-form-item label="名称" path="name">
              <n-input v-model:value="formState.name" />
            </n-form-item>
            <n-form-item label="描述">
              <n-input v-model:value="formState.description" />
            </n-form-item>
            <n-form-item label="链接别名">
              <n-input v-model:value="formState.alias" placeholder="例如 my-clash-config" />
            </n-form-item>
            <n-form-item v-if="formState.alias" label="生成链接">
                <n-input :value="generatedUrl" readonly>
                  <template #suffix>
                    <n-button text @click="copyGeneratedUrl">
                      <n-icon :component="CopyIcon" />
                    </n-button>
                  </template>
                </n-input>
            </n-form-item>

            <n-divider title-placement="left">生成设置 (在线转换)</n-divider>
             <n-form-item label="转换后端">
              <n-select
                v-model:value="formState.subconverter_backend_id"
                :options="backendOptions"
                placeholder="留空则使用全局默认后端"
                clearable
              />
            </n-form-item>
            <n-form-item label="转换配置">
              <n-select
                v-model:value="formState.subconverter_config_id"
                :options="configOptions"
                placeholder="留空则使用全局默认配置"
                clearable
              />
            </n-form-item>
          </n-gi>

          <!-- Right Column -->
          <n-gi>
            <n-divider title-placement="left">数据源</n-divider>
            <n-card title="包含的订阅" size="small" :bordered="true" class="mb-4">
              <template #header-extra>
                <n-space>
                  <n-checkbox
                    :checked="isAllSubsSelected"
                    :indeterminate="isSubsIndeterminate"
                    @update:checked="handleSelectAllSubs"
                  >
                    全选
                  </n-checkbox>
                  <n-input v-model:value="subFilter" size="small" placeholder="筛选" clearable />
                </n-space>
              </template>
              <n-scrollbar style="max-height: 200px;">
                <n-checkbox-group v-model:value="formState.subscription_ids">
                  <n-space vertical>
                    <n-checkbox v-for="sub in filteredSubscriptionOptions" :key="sub.value" :value="sub.value" :label="sub.label" />
                  </n-space>
                </n-checkbox-group>
              </n-scrollbar>
            </n-card>
            
            <n-card title="包含的节点" size="small" :bordered="true">
              <template #header-extra>
                <n-space>
                  <n-checkbox
                    :checked="isAllNodesSelected"
                    :indeterminate="isNodesIndeterminate"
                    @update:checked="handleSelectAllNodes"
                  >
                    全选
                  </n-checkbox>
                  <n-input v-model:value="nodeFilter" size="small" placeholder="筛选" clearable />
                </n-space>
              </template>
              <n-scrollbar style="max-height: 200px;">
                <n-checkbox-group v-model:value="formState.nodeIds">
                  <n-space vertical>
                    <n-checkbox v-for="node in filteredNodeOptions" :key="node.value" :value="node.value" :label="node.label" />
                  </n-space>
                </n-checkbox-group>
              </n-scrollbar>
            </n-card>
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

    <!-- Preview Modal -->
    <n-modal
        v-model:show="showPreviewModal"
        preset="card"
        style="width: 800px;"
        title="配置预览"
        :bordered="false"
        size="huge"
    >
        <n-spin :show="loadingPreview">
            <n-code :code="previewContent" language="text" word-wrap style="max-height: 60vh;"></n-code>
        </n-spin>
    </n-modal>

  </div>
</template>