<template>
  <div class="page-container">
    <n-space justify="space-between" align="center" class="page-header">
      <h1>Config Templates</h1>
      <n-button type="primary" @click="handleCreate">
        <template #icon>
          <n-icon :component="AddIcon" />
        </template>
        Create Template
      </n-button>
    </n-space>

    <n-data-table
      :columns="columns"
      :data="templates"
      :loading="loading"
      :pagination="{ pageSize: 15 }"
      :bordered="false"
    />

    <n-modal
      v-model:show="showModal"
      preset="card"
      :title="isEditing ? 'Edit Template' : 'Create New Template'"
      style="width: 1000px;"
      :mask-closable="false"
    >
      <n-steps :current="currentStep" :status="stepStatus">
        <n-step title="Basic Info" description="Name and client type." />
        <n-step title="Data Sources" description="Select subscriptions." />
        <n-step title="Template Content" description="Write the template." />
      </n-steps>

      <n-form
        ref="formRef"
        :model="currentTemplate"
        :rules="formRules"
        label-placement="left"
        label-width="auto"
        style="margin-top: 24px;"
      >
        <!-- Step 1: Basic Info -->
        <div v-show="currentStep === 1">
          <n-form-item label="Template Name" path="name">
            <n-input v-model:value="currentTemplate.name" placeholder="Enter template name" />
          </n-form-item>
          <n-form-item label="Client Type" path="client_type">
            <n-select
              v-model:value="currentTemplate.client_type"
              placeholder="Select client type"
              :options="clientTypeOptions"
            />
          </n-form-item>
        </div>

        <!-- Step 2: Data Sources -->
        <div v-show="currentStep === 2">
          <n-form-item label="Subscriptions" path="subscription_ids">
            <n-transfer
              ref="transfer"
              v-model:value="currentTemplate.subscription_ids as string[]"
              :options="subscriptionOptions"
              :render-source-label="({ option }) => option.label"
              :render-target-label="({ option }) => option.label"
              source-filterable
              target-filterable
              style="width: 100%;"
            />
          </n-form-item>
        </div>

        <!-- Step 3: Template Content -->
        <div v-show="currentStep === 3">
          <n-form-item label="Content" path="content">
            <CodeEditor
              :model-value="currentTemplate.content ?? ''"
              @update:model-value="currentTemplate.content = $event"
              :language="editorLanguage"
              style="height: 400px;"
            />
            <n-space vertical size="small" style="margin-top: 8px;">
              <div>
                <n-text depth="3" style="font-size: 12px; margin-right: 8px;">Built-in:</n-text>
                <n-tag
                  v-for="variable in builtinVariables"
                  :key="variable"
                  size="small"
                  round
                  :bordered="false"
                  type="info"
                  style="cursor: pointer; margin-right: 4px;"
                  @click="insertVariable(variable)"
                >
                  {{ variable }}
                </n-tag>
              </div>
              <div v-if="dynamicVariables.length > 0">
                <n-text depth="3" style="font-size: 12px; margin-right: 8px;">Dynamic:</n-text>
                <n-tag
                  v-for="variable in dynamicVariables"
                  :key="variable"
                  size="small"
                  round
                  :bordered="false"
                  type="success"
                  style="cursor: pointer; margin-right: 4px;"
                  @click="insertVariable(variable)"
                >
                  {{ variable }}
                </n-tag>
              </div>
            </n-space>
          </n-form-item>
        </div>
      </n-form>

      <template #footer>
        <n-space justify="space-between">
          <n-button @click="showModal = false">Cancel</n-button>
          <n-space>
            <n-button @click="handlePreview" :loading="previewLoading" v-if="currentStep === 3">Preview</n-button>
            <n-button @click="prevStep" v-if="currentStep > 1">Previous</n-button>
            <n-button @click="nextStep" v-if="currentStep < 3">Next</n-button>
            <n-button type="primary" @click="handleSave" :loading="saveLoading" v-if="currentStep === 3">Save</n-button>
          </n-space>
        </n-space>
      </template>
    </n-modal>

    <n-modal
      v-model:show="showPreviewModal"
      preset="card"
      title="Generated Config Preview"
      style="width: 80vw; max-width: 1200px;"
    >
      <CodeEditor
        :model-value="previewContent"
        :language="editorLanguage"
        :read-only="true"
        style="height: 70vh;"
      />
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, h, computed } from 'vue';
import type { Component, VNode } from 'vue';
import {
  NSpace, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NSelect,
  NIcon, NTag, NText, useDialog, useMessage, NSteps, NStep, NTransfer
} from 'naive-ui';
import type { DataTableColumns, FormInst, FormRules, TransferOption } from 'naive-ui';
import { Add as AddIcon, Pencil as EditIcon, TrashBinOutline as DeleteIcon, CopyOutline as CopyIcon } from '@vicons/ionicons5';
import { useApi } from '@/composables/useApi';
import type { ConfigTemplate, ClientType } from '@/types';
import CodeEditor from '@/components/CodeEditor.vue';

const api = useApi();
const dialog = useDialog();
const message = useMessage();

const templates = ref<ConfigTemplate[]>([]);
const loading = ref(false);
const saveLoading = ref(false);
const previewLoading = ref(false);
const showModal = ref(false);
const showPreviewModal = ref(false);
const previewContent = ref('');
const isEditing = ref(false);
const formRef = ref<FormInst | null>(null);

// Stepper state
const currentStep = ref(1);
const stepStatus = ref<'process' | 'finish' | 'error'>('process');

const allSubscriptions = ref<{ id: string; name: string; }[]>([]);

const subscriptionOptions = computed<TransferOption[]>(() =>
  allSubscriptions.value.map(sub => ({
    label: sub.name,
    value: sub.id,
  }))
);

const defaultTemplate: () => Partial<ConfigTemplate> = () => ({
  name: '',
  client_type: 'CLASH',
  content: '',
  subscription_ids: [],
});

const currentTemplate = ref<Partial<ConfigTemplate>>(defaultTemplate());

const editorLanguage = computed(() => {
  switch (currentTemplate.value.client_type) {
    case 'CLASH':
      return 'yaml';
    default:
      return 'text';
  }
});

const clientTypeOptions: { label: string; value: ClientType }[] = [
  { label: 'Clash', value: 'CLASH' },
  { label: 'Surge', value: 'SURGE' },
  { label: 'V2RayN', value: 'V2RAYN' },
  { label: 'Quantumult X', value: 'QUANTUMULT_X' },
  { label: 'Generic', value: 'GENERIC' },
];

const formRules: FormRules = {
  name: [{ required: true, message: 'Please enter a template name', trigger: 'blur' }],
  client_type: [{ required: true, message: 'Please select a client type', trigger: 'change' }],
  content: [{ required: true, message: 'Please enter template content', trigger: 'blur' }],
};

const builtinVariables = ['{{nodes}}', '{{profile_name}}', '{{update_time}}'];

const dynamicVariables = computed(() => {
  if (!currentTemplate.value || !currentTemplate.value.subscription_ids) {
    return [];
  }
  // Ensure it's an array before mapping
  const ids = Array.isArray(currentTemplate.value.subscription_ids) ? currentTemplate.value.subscription_ids : [];
  return ids.map((id, index) => `{{sub_${index + 1}_nodes}}`);
});

const insertVariable = (variable: string) => {
  if (currentTemplate.value) {
    const content = currentTemplate.value.content || '';
    currentTemplate.value.content = content ? `${content}\n${variable}` : variable;
  }
};

const renderIcon = (icon: Component) => {
  return () => h(NIcon, null, { default: () => h(icon) });
};

const columns = computed<DataTableColumns<ConfigTemplate>>(() => [
  {
    title: 'Name',
    key: 'name',
    sorter: 'default',
    render(row) {
      return h(NSpace, { align: 'center' }, {
        default: () => [
          h('span', row.name),
          row.is_system ? h(NTag, { size: 'small', type: 'success', bordered: false }, { default: () => 'System' }) : null
        ]
      });
    }
  },
  { title: 'Client Type', key: 'client_type', width: 150, sorter: 'default' },
  {
    title: 'Last Updated',
    key: 'updated_at',
    width: 200,
    sorter: (a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(),
    render: (row) => new Date(row.updated_at).toLocaleString(),
  },
  {
    title: 'Actions',
    key: 'actions',
    width: 120,
    render: (row) => {
        const actions: VNode[] = [];
        if (row.is_system) {
            actions.push(h(
                NButton,
                { size: 'small', circle: true, type: 'primary', onClick: () => handleCopyToNew(row) },
                { icon: renderIcon(CopyIcon) }
            ));
        } else {
            actions.push(h(
                NButton,
                { size: 'small', circle: true, type: 'info', onClick: () => handleEdit(row) },
                { icon: renderIcon(EditIcon) }
            ));
            actions.push(h(
                NButton,
                { size: 'small', circle: true, type: 'error', onClick: () => handleDelete(row) },
                { icon: renderIcon(DeleteIcon) }
            ));
        }
        return h(NSpace, null, { default: () => actions });
    }
  },
]);

const fetchTemplates = async () => {
  loading.value = true;
  try {
    const response = await api.get<ConfigTemplate[]>('/config-templates');
    if (response && response.success && response.data) {
      templates.value = response.data;
    } else {
      templates.value = [];
      message.error(response?.message || 'Failed to fetch templates.');
    }
  } catch (error: any) {
    message.error(error.message || 'An unknown error occurred.');
  } finally {
    loading.value = false;
  }
};

const handleCreate = () => {
  isEditing.value = false;
  currentTemplate.value = defaultTemplate();
  currentStep.value = 1;
  stepStatus.value = 'process';
  showModal.value = true;
};

const handleEdit = (template: ConfigTemplate) => {
  isEditing.value = true;
  let subIds: string[] = [];
  if (template.subscription_ids) {
    try {
      subIds = typeof template.subscription_ids === 'string'
        ? JSON.parse(template.subscription_ids)
        : template.subscription_ids;
    } catch (e) {
      console.error('Failed to parse subscription_ids:', e);
      subIds = [];
    }
  }
  currentTemplate.value = {
    ...template,
    subscription_ids: Array.isArray(subIds) ? subIds : [],
  };
  currentStep.value = 1;
  stepStatus.value = 'process';
  showModal.value = true;
};

const handleCopyToNew = (template: ConfigTemplate) => {
  isEditing.value = false;
  currentTemplate.value = {
    ...defaultTemplate(),
    name: `${template.name} (Copy)`,
    client_type: template.client_type,
    content: template.content,
    subscription_ids: (() => {
      if (!template.subscription_ids) return [];
      if (typeof template.subscription_ids === 'string') {
        try {
          const parsed = JSON.parse(template.subscription_ids);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return Array.isArray(template.subscription_ids) ? template.subscription_ids : [];
    })()
  };
  currentStep.value = 1;
  stepStatus.value = 'process';
  showModal.value = true;
};

const handleSave = async () => {
  formRef.value?.validate(async (errors) => {
    if (!errors) {
      saveLoading.value = true;
      try {
        let response;
        const payload = { ...currentTemplate.value };
        if (isEditing.value) {
          response = await api.put(`/config-templates/${payload.id}`, payload);
        } else {
          response = await api.post<{ id: number }>('/config-templates', payload);
        }

        if (response && response.success) {
          message.success(`Template ${isEditing.value ? 'updated' : 'created'} successfully.`);
          showModal.value = false;
          fetchTemplates();
        } else {
          message.error(response.message || 'Failed to save template.');
        }
      } catch (error: any) {
        message.error(error.message || 'An unknown error occurred.');
      } finally {
        saveLoading.value = false;
      }
    }
  });
};

const handlePreview = async () => {
  previewLoading.value = true;
  try {
    const payload = {
      content: currentTemplate.value.content,
      client_type: currentTemplate.value.client_type,
      subscription_ids: currentTemplate.value.subscription_ids,
    };
    const response = await api.post<any>('/config-templates/preview', payload, {
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/plain' },
    });
    
    // The modified useApi returns the raw text string directly when Accept is 'text/plain'
    previewContent.value = response as unknown as string;
    
    showPreviewModal.value = true;
  } catch (error: any) {
    message.error(error.message || 'Failed to generate preview.');
  } finally {
    previewLoading.value = false;
  }
};

const handleDelete = (template: ConfigTemplate) => {
  dialog.warning({
    title: 'Confirm Deletion',
    content: `Are you sure you want to delete the template "${template.name}"? This action cannot be undone.`,
    positiveText: 'Delete',
    negativeText: 'Cancel',
    onPositiveClick: async () => {
      try {
        const response = await api.delete(`/config-templates/${template.id}`);
        if (response.success) {
          message.success('Template deleted successfully.');
          fetchTemplates();
        } else {
          message.error(response.message || 'Failed to delete template.');
        }
      } catch (error: any) {
        message.error(error.message || 'An unknown error occurred.');
      }
    },
  });
};

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
          if (currentStep.value < 3) {
            currentStep.value++;
            stepStatus.value = 'process';
          }
        } else {
          stepStatus.value = 'error';
          message.error('Please fill in all required fields before proceeding.');
        }
      },
      (rule) => fieldsToValidate.includes(rule?.key as string)
    ).catch(() => {
      stepStatus.value = 'error';
    });
  };

  if (currentStep.value === 1) {
    validateAndProceed(['name', 'client_type']);
  } else if (currentStep.value === 2) {
    // No validation needed for step 2, just proceed
    if (currentStep.value < 3) {
      currentStep.value++;
      stepStatus.value = 'process';
    }
  } else {
    // This case is for moving from step 3, which is handled by Save button
    // but we keep the logic for completeness.
    if (currentStep.value < 3) {
      currentStep.value++;
    }
  }
};

const fetchSubscriptionsForSelect = async () => {
  try {
    const response = await api.get<{ id: string; name: string; }[]>('/subscriptions/for-select');
    if (response.success && response.data) {
      allSubscriptions.value = response.data;
    } else {
      message.error(response.message || 'Failed to fetch subscriptions.');
    }
  } catch (error: any) {
    message.error(error.message || 'An unknown error occurred while fetching subscriptions.');
  }
};

onMounted(() => {
  fetchTemplates();
  fetchSubscriptionsForSelect();
});
</script>

<style scoped>
.page-container {
  padding: 24px;
}
.page-header {
  margin-bottom: 24px;
}
</style>