<script setup lang="ts">
import { ref, onMounted, reactive, computed, h } from 'vue';
import axios from 'axios';
import { useRouter } from 'vue-router';
import { useMessage, useDialog, NButton, NSpace, NCode, NDataTable, NPageHeader, NModal, NForm, NFormItem, NInput, NSpin, NIcon, NDynamicInput, NSelect, NRadioGroup, NRadioButton, NDivider, NSteps, NStep, NCard, NList, NListItem, NThing, NGrid, NGi, NCheckboxGroup, NCheckbox, NScrollbar } from 'naive-ui';
import type { DataTableColumns, FormInst } from 'naive-ui';
import { AnalyticsOutline as LogsIcon, Pencil as EditIcon, TrashBinOutline as DeleteIcon, CopyOutline as CopyIcon, EyeOutline as PreviewIcon, DownloadOutline as DownloadIcon, FunnelOutline as PipelineIcon, SettingsOutline as SettingsIcon } from '@vicons/ionicons5';
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
const currentStep = ref(1);
const stepStatus = ref<'process' | 'finish' | 'error'>('process');

const formState = reactive({
  id: '',
  name: '',
  description: '',
  alias: '',
  client_type: 'CLASH' as 'CLASH' | 'SURGE' | 'QUANTUMULT_X' | 'V2RAYN' | 'GENERIC',
  generation_mode: 'online' as 'local' | 'online',
  template_id: null as number | null,
  template_variables: [] as { key: string, value: string }[],
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
  client_type: {
    required: true,
    message: '请选择客户端类型',
    trigger: 'change',
  },
};

// For Logs Modal

const modalTitle = computed(() => (editingProfile.value ? '编辑配置' : '新增配置'));

const clientTypeOptions = [
  { label: 'Clash', value: 'CLASH' },
  { label: 'Surge', value: 'SURGE' },
  { label: 'Quantumult X', value: 'QUANTUMULT_X' },
  { label: 'V2RayN', value: 'V2RAYN' },
  { label: 'Generic', value: 'GENERIC' },
];

const subscriptionOptions = computed(() => allSubscriptions.value.map(s => ({ label: s.name, value: s.id })));
const nodeOptions = computed(() => allNodes.value.map(n => ({ label: n.name, value: n.id })));
const templateOptions = computed(() => allTemplates.value.map(t => ({ label: t.name, value: t.id })));
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

const createColumns = ({ onCopy, onPreview, onDownload, onEdit, onDelete, onManagePipeline }: {
    onCopy: (row: Profile) => void,
    onPreview: (row: Profile) => void,
    onDownload: (row: Profile) => void,
    onEdit: (row: Profile) => void,
    onDelete: (row: Profile) => void,
    onManagePipeline: (row: Profile) => void,
}): DataTableColumns<Profile> => {
  return [
    { title: '名称', key: 'name', sorter: 'default', width: 200 },
    { title: '客户端', key: 'client_type', width: 120 },
    { title: '描述', key: 'description', ellipsis: { tooltip: true } },
    {
      title: '订阅链接',
      key: 'alias',
      render(row) {
        if (!row.alias) return h('span', {}, '-');
        const url = `${window.location.origin}/sub/${row.alias}`;
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
      width: 360,
      render(row) {
        return h(NSpace, null, {
          default: () => [
            h(NButton, { size: 'small', circle: true, title: '管理处理规则', onClick: () => onManagePipeline(row) }, { icon: () => h(NIcon, null, { default: () => h(PipelineIcon) }) }),
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
  // Reset step to the beginning
  currentStep.value = 1;
  stepStatus.value = 'process';

  // Fetch all available sources first
  await fetchAllSources();

  if (profile) {
    editingProfile.value = profile;
    // The profile object is now expanded on the backend, so we can access properties directly.
    formState.id = profile.id;
    formState.name = profile.name;
    formState.description = profile.description || '';
    formState.alias = profile.alias || '';
    formState.client_type = profile.client_type || 'CLASH';
    formState.generation_mode = profile.generation_mode || 'online';
    formState.template_id = profile.template_id ? Number(profile.template_id) : null;
    formState.subconverter_backend_id = profile.subconverter_backend_id || null;
    formState.subconverter_config_id = profile.subconverter_config_id || null;
    formState.subscription_ids = profile.subscription_ids || [];
    formState.nodeIds = profile.nodeIds || [];

    // Handle template_variables, which might be an object
    if (profile.template_variables && typeof profile.template_variables === 'object') {
        formState.template_variables = Object.entries(profile.template_variables).map(([key, value]) => ({ key, value: String(value) }));
    } else {
        formState.template_variables = [];
    }
  } else {
    editingProfile.value = null;
    formState.id = '';
    formState.name = '';
    formState.description = '';
    formState.alias = '';
    formState.client_type = 'CLASH';
    formState.generation_mode = 'online';
    formState.template_id = null;
    formState.template_variables = [];
    formState.subconverter_backend_id = null;
    formState.subconverter_config_id = null;
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
  saveLoading.value = true;
  try {
    // Convert template_variables from object array to a simple object
    const variablesObject = formState.template_variables.reduce((acc, item) => {
      if (item.key) {
        acc[item.key] = item.value;
      }
      return acc;
    }, {} as Record<string, string>);

    // Consolidate all profile settings into a single 'content' object
    const contentPayload = {
      description: formState.description,
      alias: formState.alias || null,
      generation_mode: formState.generation_mode,
      template_id: formState.template_id,
      template_variables: variablesObject, // Store as object, not string
      subconverter_backend_id: formState.subconverter_backend_id,
      subconverter_config_id: formState.subconverter_config_id,
      subscription_ids: formState.subscription_ids,
      nodeIds: formState.nodeIds,
    };

    // The final payload sent to the backend
    const payload = {
      name: formState.name,
      client_type: formState.client_type,
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
  const url = row.alias
    ? `${window.location.origin}/sub/${row.alias}`
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

const handleDownload = async (row: Profile) => {
  message.info('正在准备下载...');
  try {
    const response = await api.get<string>(`/profiles/${row.id}/generate`);
    const textContent = response.data;
    if (textContent) {
      const decodedContent = atob(textContent);
      const blob = new Blob([decodedContent], { type: 'text/plain;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${row.name || 'profile'}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      message.success('下载已开始');
    } else {
      throw new Error('下载内容为空');
    }
  } catch (err: any) {
    if (!axios.isCancel(err)) {
      message.error(err.message || '准备下载失败');
    }
  }
};


const handleManagePipeline = (row: Profile) => {
  router.push({ name: 'profile-pipeline', params: { id: row.id } });
};

const columns = createColumns({
    onCopy: handleCopyLink,
    onPreview: handlePreview,
    onDownload: handleDownload,
    onEdit: openEditModal,
    onDelete: handleDelete,
    onManagePipeline: handleManagePipeline,
});

onMounted(fetchProfiles);

const prevStep = () => {
  if (currentStep.value > 1) {
    currentStep.value--;
    stepStatus.value = 'process';
  }
};

const nextStep = () => {
  const validateAndProceed = (fieldsToValidate: string[]) => {
    formRef.value?.validate(
      (errors) => {
        if (!errors) {
          if (currentStep.value < 4) {
            currentStep.value++;
            stepStatus.value = 'process';
          }
        } else {
          stepStatus.value = 'error';
          message.error('请填写所有必填项后再继续');
        }
      },
      (rule) => fieldsToValidate.includes(rule?.key as string)
    ).catch(() => {
      stepStatus.value = 'error';
    });
  };

  switch (currentStep.value) {
    case 1:
      validateAndProceed(['name', 'client_type']);
      break;
    case 2:
      // No validation needed for step 2, just proceed
      if (currentStep.value < 4) {
        currentStep.value++;
        stepStatus.value = 'process';
      }
      break;
    case 3:
      // Add validation for step 3 if needed in the future
      if (currentStep.value < 4) {
        currentStep.value++;
        stepStatus.value = 'process';
      }
      break;
    default:
      if (currentStep.value < 4) {
        currentStep.value++;
      }
  }
};

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
      style="width: 900px;"
      class="profile-builder-modal"
    >
      <n-steps :current="currentStep" :status="stepStatus" class="mb-6">
        <n-step title="基本信息" />
        <n-step title="数据源" />
        <n-step title="生成规则" />
        <n-step title="完成" />
      </n-steps>

      <n-form ref="formRef" :model="formState" :rules="rules">
        <!-- Step 1: Basic Info -->
        <div v-if="currentStep === 1">
            <n-form-item label="名称" path="name">
              <n-input v-model:value="formState.name" />
            </n-form-item>
           <n-form-item label="客户端类型" path="client_type">
             <n-select v-model:value="formState.client_type" :options="clientTypeOptions" />
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
        </div>

        <!-- Step 2: Data Sources -->
        <div v-if="currentStep === 2">
          <n-divider title-placement="left">数据源</n-divider>
          <n-grid :cols="2" :x-gap="24">
            <n-gi>
              <n-card title="包含的订阅" size="small" :bordered="true">
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
                <n-scrollbar style="max-height: 300px;">
                  <n-checkbox-group v-model:value="formState.subscription_ids">
                    <n-space vertical>
                      <n-checkbox v-for="sub in filteredSubscriptionOptions" :key="sub.value" :value="sub.value" :label="sub.label" />
                    </n-space>
                  </n-checkbox-group>
                </n-scrollbar>
              </n-card>
            </n-gi>
            <n-gi>
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
                <n-scrollbar style="max-height: 300px;">
                  <n-checkbox-group v-model:value="formState.nodeIds">
                    <n-space vertical>
                      <n-checkbox v-for="node in filteredNodeOptions" :key="node.value" :value="node.value" :label="node.label" />
                    </n-space>
                  </n-checkbox-group>
                </n-scrollbar>
              </n-card>
            </n-gi>
          </n-grid>
        </div>

        <!-- Step 3: Generation Settings -->
        <div v-if="currentStep === 3">
            <n-divider title-placement="left">生成设置</n-divider>
            <n-form-item label="生成模式">
                <n-radio-group v-model:value="formState.generation_mode" name="generation_mode">
                    <n-radio-button value="online">在线转换</n-radio-button>
                    <n-radio-button value="local">本地模板</n-radio-button>
                </n-radio-group>
            </n-form-item>

            <template v-if="formState.generation_mode === 'local'">
              <n-form-item label="配置模板" required>
                <n-select
                  v-model:value="formState.template_id"
                  :options="templateOptions"
                  placeholder="选择一个配置模板"
                />
              </n-form-item>
              <n-form-item label="模板变量">
                <n-dynamic-input v-model:value="formState.template_variables" preset="pair" key-placeholder="变量名" value-placeholder="变量值" />
              </n-form-item>
            </template>

            <template v-if="formState.generation_mode === 'online'">
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
            </template>
        </div>

        <!-- Step 4: Finish -->
        <div v-if="currentStep === 4">
            <p>完成</p>
        </div>
      </n-form>

      <template #footer>
        <n-space justify="end">
          <n-button @click="showEditModal = false">取消</n-button>
          <n-button v-if="currentStep > 1" @click="prevStep">上一步</n-button>
          <n-button v-if="currentStep < 4" type="primary" @click="nextStep">下一步</n-button>
          <n-button v-if="currentStep === 4" type="primary" :loading="saveLoading" @click="handleSave">完成</n-button>
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