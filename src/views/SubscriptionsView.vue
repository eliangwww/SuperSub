<script setup lang="ts">
import { ref, onMounted, reactive, h, computed, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage, useDialog, NButton, NSpace, NTag, NDataTable, NPageHeader, NModal, NForm, NFormItem, NInput, NTooltip, NGrid, NGi, NStatistic, NCard, NSwitch, NSelect, NDynamicTags } from 'naive-ui'
import type { DataTableColumns, FormInst } from 'naive-ui'
import { Subscription, Node, SubscriptionRule, ApiResponse } from '@/types'
import { api } from '@/utils/api'
import SubscriptionNodesPreview from '@/components/SubscriptionNodesPreview.vue'
import { format } from 'date-fns'

const router = useRouter()
const message = useMessage()
const dialog = useDialog()

const subscriptions = ref<Subscription[]>([])
const loading = ref(true)
const showModal = ref(false)
const saveLoading = ref(false)
const updatingId = ref<string | null>(null)
const editingSubscription = ref<Subscription | null>(null)
const updatingAll = ref(false)

// For bulk import
const showImportModal = ref(false)
const importUrls = ref('')
const importLoading = ref(false)

// For subscription preview
const showPreviewModal = ref(false)
const previewUrl = ref('')
const previewLoading = ref(false)
const previewData = ref<{
  nodes: Partial<Node>[];
  analysis: {
    total: number;
    protocols: Record<string, number>;
    regions: Record<string, number>;
  };
} | null>(null)

// For Node Preview in Modal
const showNodePreviewModal = ref(false)
const currentSubscriptionForPreview = ref<Subscription | null>(null)
const nodePreviewRef = ref<{ fetchPreview: () => void } | null>(null)

// For Subscription Rules
const showRulesModal = ref(false)
const rulesLoading = ref(false)
const currentSubscriptionForRules = ref<Subscription | null>(null)
const subscriptionRules = ref<SubscriptionRule[]>([])
const showRuleFormModal = ref(false)
const ruleFormRef = ref<FormInst | null>(null)
const editingRule = ref<SubscriptionRule | null>(null)
const ruleSaveLoading = ref(false)

const ruleFormState = reactive({
  id: 0,
  name: '',
  type: 'filter_by_name_keyword' as SubscriptionRule['type'],
  value: '',
  enabled: 1,
  // Fields for user-friendly forms
  keywords: [] as string[],
  renameRegex: '',
  renameFormat: '',
  regex: '',
})

const ruleModalTitle = computed(() => (editingRule.value ? '编辑规则' : '新增规则'))
const ruleTypeOptions = [
  { label: '按名称关键词过滤', value: 'filter_by_name_keyword' },
  { label: '按名称正则过滤', value: 'filter_by_name_regex' },
  { label: '按正则重命名', value: 'rename_by_regex' },
]


const formState = reactive({
  id: '',
  name: '',
  url: '',
  include_keywords: '',
  exclude_keywords: '',
})

const modalTitle = computed(() => (editingSubscription.value ? '编辑订阅' : '新增订阅'))

const createColumns = ({ onEdit, onUpdate, onDelete, onPreviewNodes, onManageRules }: {
    onEdit: (row: Subscription) => void,
    onUpdate: (row: Subscription) => void,
    onDelete: (row: Subscription) => void,
    onPreviewNodes: (row: Subscription) => void,
    onManageRules: (row: Subscription) => void,
}): DataTableColumns<Subscription> => {
  return [
    { title: '名称', key: 'name', sorter: 'default' },
    {
      title: '状态',
      key: 'status',
      align: 'center',
      width: 100,
      render(row) {
        if (row.error) {
          return h(NTooltip, null, {
            trigger: () => h(NTag, { type: 'error' }, { default: () => '失败' }),
            default: () => row.error
          })
        }
        if (row.last_updated) {
          return h(NTag, { type: 'success' }, { default: () => '成功' })
        }
        return h(NTag, { type: 'default' }, { default: () => '待更新' })
      }
    },
    {
      title: '节点数',
      key: 'node_count',
      align: 'center',
      width: 100,
      sorter: 'default',
      render(row) {
        const count = row.node_count ?? 0
        return h(NTag, { type: count > 0 ? 'info' : 'default', round: true }, { default: () => count })
      }
    },
    {
      title: '上次更新',
      key: 'last_updated',
      sorter: (a, b) => new Date(a.last_updated || 0).getTime() - new Date(b.last_updated || 0).getTime(),
      render(row) {
        return row.last_updated ? format(new Date(row.last_updated), 'yyyy-MM-dd HH:mm:ss') : 'N/A'
      }
    },
    {
      title: '操作',
      key: 'actions',
      render(row) {
        return h(NSpace, null, {
          default: () => [
            h(NButton, { size: 'small', onClick: () => onPreviewNodes(row) }, { default: () => '预览节点' }),
            h(NButton, { size: 'small', type: 'info', ghost: true, onClick: () => onManageRules(row) }, { default: () => '规则' }),
            h(NButton, { size: 'small', onClick: () => onEdit(row) }, { default: () => '编辑' }),
            h(NButton, {
                size: 'small',
                type: 'primary',
                ghost: true,
                loading: updatingId.value === row.id,
                onClick: () => onUpdate(row)
            }, { default: () => '更新' }),
            h(NButton, { size: 'small', type: 'error', ghost: true, onClick: () => onDelete(row) }, { default: () => '删除' }),
          ]
        })
      }
    }
  ]
}

const openModal = (sub: Subscription | null = null) => {
  if (sub) {
    editingSubscription.value = sub
    formState.id = sub.id
    formState.name = sub.name
    formState.url = sub.url
    formState.include_keywords = sub.include_keywords || ''
    formState.exclude_keywords = sub.exclude_keywords || ''
  } else {
    editingSubscription.value = null
    formState.id = ''
    formState.name = ''
    formState.url = ''
    formState.include_keywords = ''
    formState.exclude_keywords = ''
  }
  showModal.value = true
}

const closeModal = () => {
  showModal.value = false
}

const fetchSubscriptions = async () => {
  loading.value = true
  try {
    const subsResponse = await api.get<ApiResponse<Subscription[]>>('/subscriptions')
    if (subsResponse.data.success && subsResponse.data.data) {
      subscriptions.value = subsResponse.data.data
    } else {
      message.error(subsResponse.data.message || '获取订阅列表失败')
    }
  } catch (err) {
    message.error('请求失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

const handleSave = async () => {
  saveLoading.value = true
  try {
    const payload = {
      name: formState.name,
      url: formState.url,
      include_keywords: formState.include_keywords,
      exclude_keywords: formState.exclude_keywords,
    }
    const response = editingSubscription.value
      ? await api.put<ApiResponse>(`/subscriptions/${formState.id}`, payload)
      : await api.post<ApiResponse>('/subscriptions', payload)

    if (response.data.success) {
      message.success(editingSubscription.value ? '订阅更新成功' : '订阅新增成功')
      closeModal()
      fetchSubscriptions()
    } else {
      message.error(response.data.message || '保存失败')
    }
  } catch (err) {
    message.error('请求失败，请稍后重试')
  } finally {
    saveLoading.value = false
  }
}

const handleDelete = (row: Subscription) => {
  dialog.warning({
    title: '确认删除',
    content: `确定要删除订阅 "${row.name}" 吗？`,
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const response = await api.delete<ApiResponse>(`/subscriptions/${row.id}`)
        if (response.data.success) {
          message.success('订阅删除成功')
          fetchSubscriptions()
        } else {
          message.error(response.data.message || '删除失败')
        }
      } catch (err) {
        message.error('请求失败，请稍后重试')
      }
    },
  })
}

const handleUpdate = async (row: Subscription) => {
  updatingId.value = row.id
  message.info('正在更新订阅，请稍候...')
  try {
    const response = await api.post<ApiResponse>(`/subscriptions/${row.id}/update`)
    if (response.data.success) {
      message.success(response.data.message || '更新成功')
    } else {
      message.error(response.data.message || '更新失败')
    }
    fetchSubscriptions()
  } catch (err) {
    message.error('请求失败，请稍后重试')
  } finally {
    updatingId.value = null
  }
}

const handlePreview = async () => {
  if (!previewUrl.value.trim()) {
    message.warning('请输入需要预览的订阅链接')
    return
  }
  previewLoading.value = true
  previewData.value = null
  try {
    const response = await api.post<ApiResponse>('/subscriptions/preview', { url: previewUrl.value })
    if (response.data.success && response.data.data) {
      previewData.value = response.data.data
      showPreviewModal.value = true
    } else {
      message.error(response.data.message || '预览失败')
    }
  } catch (err) {
    message.error('请求失败，请检查链接或网络')
  } finally {
    previewLoading.value = false
  }
}

const openPreviewModal = () => {
  previewUrl.value = ''
  previewData.value = null
  showPreviewModal.value = true
}

const previewNodeColumns: DataTableColumns<Partial<Node>> = [
  { title: '节点名称', key: 'name', ellipsis: { tooltip: true } },
  { title: '类型', key: 'type', width: 80, align: 'center' },
  { title: '服务器', key: 'server', width: 150, ellipsis: { tooltip: true } },
  { title: '端口', key: 'port', width: 80, align: 'center' },
]

const handleImportFromPreview = async () => {
  if (!previewData.value || !previewData.value.nodes || previewData.value.nodes.length === 0) {
    message.warning('没有可导入的节点');
    return;
  }

  importLoading.value = true;
  try {
    // Send the array of parsed node objects directly
    const response = await api.post<ApiResponse>('/nodes/batch-import', { nodes: previewData.value.nodes });
    if (response.data.success) {
      message.success(response.data.message || '节点导入成功');
      showPreviewModal.value = false;
    } else {
      message.error(response.data.message || '导入失败');
    }
  } catch (error) {
    message.error('请求失败，请稍后重试');
  } finally {
    importLoading.value = false;
  }
};

const handlePreviewNodes = (row: Subscription) => {
    currentSubscriptionForPreview.value = row
    showNodePreviewModal.value = true
    // Use nextTick to ensure the component is mounted before calling its method
    nextTick(() => {
        nodePreviewRef.value?.fetchPreview()
    })
}

const openImportModal = () => {
  importUrls.value = ''
  showImportModal.value = true
}

const handleUpdateAll = async () => {
  updatingAll.value = true
  message.info('已启动所有订阅的后台更新...')
  try {
    const response = await api.post<ApiResponse>('/subscriptions/update-all')
    if (response.data.success) {
      message.success(response.data.message || '后台更新任务已启动')
      // Wait a few seconds for the background job to process, then refresh
      setTimeout(() => {
        fetchSubscriptions()
      }, 5000)
    } else {
      message.error(response.data.message || '启动更新失败')
    }
  } catch (err) {
    message.error('请求失败，请稍后重试')
  } finally {
    updatingAll.value = false
  }
}

const handleBulkImport = async () => {
  if (!importUrls.value.trim()) {
    message.warning('请输入订阅链接')
    return
  }
  importLoading.value = true

  const lines = importUrls.value.split('\n').map(line => line.trim()).filter(Boolean)
  const subscriptionsToCreate: { name: string; url: string }[] = []

  for (const line of lines) {
    const parts = line.split(',').map(part => part.trim())
    if (parts.length === 2 && parts[1].startsWith('http')) {
      subscriptionsToCreate.push({ name: parts[0], url: parts[1] })
    } else if (parts.length === 1 && parts[0].startsWith('http')) {
      // Try to derive a name from the URL
      try {
        const urlObj = new URL(parts[0])
        const name = urlObj.hostname
        subscriptionsToCreate.push({ name: name, url: parts[0] })
      } catch (e) {
        // Ignore invalid URL
      }
    }
  }

  if (subscriptionsToCreate.length === 0) {
    message.warning('没有找到有效的订阅链接。格式应为 "名称,链接" 或直接是链接。')
    importLoading.value = false
    return
  }

  try {
    const response = await api.post<ApiResponse>('/subscriptions/batch-import', { subscriptions: subscriptionsToCreate })

    if (response.data.success) {
      message.success(response.data.data?.message || `成功导入 ${response.data.data?.created || 0} 个订阅`)
      showImportModal.value = false
      fetchSubscriptions()
    } else {
      message.error(response.data.message || '导入失败')
    }
  } catch (error) {
    message.error('请求失败，请稍后重试')
  } finally {
    importLoading.value = false
  }
}

// --- Subscription Rules Logic ---

const fetchRules = async (subscriptionId: string) => {
  rulesLoading.value = true
  try {
    const response = await api.get<ApiResponse<SubscriptionRule[]>>(`/subscriptions/${subscriptionId}/rules`)
    if (response.data.success) {
      subscriptionRules.value = response.data.data || []
    } else {
      message.error(response.data.message || '获取规则列表失败')
    }
  } catch (e) {
    message.error('请求规则列表失败')
  } finally {
    rulesLoading.value = false
  }
}

const onManageRules = (sub: Subscription) => {
  currentSubscriptionForRules.value = sub
  showRulesModal.value = true
  fetchRules(sub.id)
}

const handleDeleteRule = (rule: SubscriptionRule) => {
  if (!currentSubscriptionForRules.value) return
  const subId = currentSubscriptionForRules.value.id

  dialog.warning({
    title: '确认删除规则',
    content: `确定要删除规则 "${rule.name}" 吗？`,
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const response = await api.delete<ApiResponse>(`/subscriptions/${subId}/rules/${rule.id}`)
        if (response.data.success) {
          message.success('规则删除成功')
          fetchRules(subId) // Refresh list
        } else {
          message.error(response.data.message || '删除失败')
        }
      } catch (err) {
        message.error('请求失败，请稍后重试')
      }
    },
  })
}

const openRuleFormModal = (rule: SubscriptionRule | null) => {
  // Reset all fields first
  ruleFormState.id = 0
  ruleFormState.name = ''
  ruleFormState.type = 'filter_by_name_keyword'
  ruleFormState.value = ''
  ruleFormState.enabled = 1
  ruleFormState.keywords = []
  ruleFormState.renameRegex = ''
  ruleFormState.renameFormat = ''
  ruleFormState.regex = ''
  editingRule.value = null

  if (rule) {
    editingRule.value = rule
    ruleFormState.id = rule.id
    ruleFormState.name = rule.name
    ruleFormState.type = rule.type
    ruleFormState.value = rule.value // Keep original JSON value for reference
    ruleFormState.enabled = rule.enabled

    // Parse JSON value into user-friendly fields
    try {
      const parsedValue = JSON.parse(rule.value)
      if (rule.type === 'filter_by_name_keyword' && parsedValue.keywords) {
        ruleFormState.keywords = parsedValue.keywords
      } else if (rule.type === 'rename_by_regex' && parsedValue.regex && parsedValue.format) {
        ruleFormState.renameRegex = parsedValue.regex
        ruleFormState.renameFormat = parsedValue.format
      } else if (rule.type === 'filter_by_name_regex' && parsedValue.regex) {
        ruleFormState.regex = parsedValue.regex
      }
    } catch (e) {
      console.error("Failed to parse rule value JSON:", e)
      // If parsing fails, the raw JSON can still be edited in the fallback input
    }
  }
  
  showRuleFormModal.value = true
}

const handleSaveRule = async () => {
  if (!currentSubscriptionForRules.value) return
  const subId = currentSubscriptionForRules.value.id
  
  ruleSaveLoading.value = true
  try {
    // Construct the JSON value based on the rule type
    let jsonValue = {}
    if (ruleFormState.type === 'filter_by_name_keyword') {
      jsonValue = { keywords: ruleFormState.keywords }
    } else if (ruleFormState.type === 'rename_by_regex') {
      jsonValue = { regex: ruleFormState.renameRegex, format: ruleFormState.renameFormat }
    } else if (ruleFormState.type === 'filter_by_name_regex') {
      jsonValue = { regex: ruleFormState.regex }
    } else {
      // For unknown types, try to parse the raw value to ensure it's valid JSON
      try {
        jsonValue = JSON.parse(ruleFormState.value)
      } catch (e) {
        message.error('规则值的JSON格式无效')
        ruleSaveLoading.value = false
        return
      }
    }

    const payload = {
      name: ruleFormState.name,
      type: ruleFormState.type,
      value: JSON.stringify(jsonValue),
      enabled: ruleFormState.enabled === 1, // Ensure it's a boolean for the API
    }

    let response;
    if (editingRule.value) {
      response = await api.put<ApiResponse>(`/subscriptions/${subId}/rules/${editingRule.value.id}`, payload)
    } else {
      response = await api.post<ApiResponse>(`/subscriptions/${subId}/rules`, payload)
    }

    if (response.data.success) {
      message.success(editingRule.value ? '规则更新成功' : '规则创建成功')
      showRuleFormModal.value = false
      fetchRules(subId)
    } else {
      message.error(response.data.message || '保存失败')
    }
  } catch (err) {
    message.error('请求失败')
  } finally {
    ruleSaveLoading.value = false
  }
}

const createRuleColumns = ({ onEdit, onDelete }: {
    onEdit: (row: SubscriptionRule) => void,
    onDelete: (row: SubscriptionRule) => void,
}): DataTableColumns<SubscriptionRule> => {
  return [
    { title: '名称', key: 'name', width: 150 },
    {
      title: '类型',
      key: 'type',
      width: 180,
      render(row) {
        const option = ruleTypeOptions.find(o => o.value === row.type)
        return option ? option.label : row.type
      }
    },
    { title: '规则值', key: 'value', ellipsis: { tooltip: true } },
    {
      title: '启用',
      key: 'enabled',
      width: 80,
      align: 'center',
      render(row) {
        return h(NSwitch, {
          value: row.enabled === 1,
          onUpdateValue: async (value) => {
            if (!currentSubscriptionForRules.value) return
            const subId = currentSubscriptionForRules.value.id
            row.enabled = value ? 1 : 0
            try {
              await api.put<ApiResponse>(`/api/subscriptions/${subId}/rules/${row.id}`, { enabled: value })
              message.success('状态更新成功')
            } catch (e) {
              message.error('状态更新失败')
              row.enabled = !value ? 1 : 0 // Revert on failure
            }
          }
        })
      }
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render(row) {
        return h(NSpace, null, {
          default: () => [
            h(NButton, { size: 'small', onClick: () => onEdit(row) }, { default: () => '编辑' }),
            h(NButton, { size: 'small', type: 'error', ghost: true, onClick: () => onDelete(row) }, { default: () => '删除' }),
          ]
        })
      }
    }
  ]
}

const ruleColumns = createRuleColumns({
  onEdit: openRuleFormModal,
  onDelete: handleDeleteRule,
})

// --- End of Subscription Rules Logic ---

const columns = createColumns({
    onEdit: openModal,
    onUpdate: handleUpdate,
    onDelete: handleDelete,
    onPreviewNodes: handlePreviewNodes,
    onManageRules: onManageRules,
})

onMounted(fetchSubscriptions)
</script>

<template>
  <div>
    <n-page-header>
      <template #title>
        订阅管理
      </template>
      <template #extra>
        <n-space>
          <n-button type="primary" ghost @click="handleUpdateAll" :loading="updatingAll">更新全部</n-button>
          <n-button type="primary" @click="openModal(null)">新增订阅</n-button>
          <n-button type="info" @click="openImportModal">批量导入</n-button>
          <n-button type="warning" ghost @click="openPreviewModal">链接预览</n-button>
        </n-space>
      </template>
    </n-page-header>

    <n-data-table
      :columns="columns"
      :data="subscriptions"
      :loading="loading"
      :pagination="{ pageSize: 10 }"
      :bordered="false"
      class="mt-4"
    />

    <n-modal
      v-model:show="showModal"
      :mask-closable="false"
      preset="dialog"
      :title="modalTitle"
      :positive-button-props="{ loading: saveLoading }"
      positive-text="保存"
      negative-text="取消"
      @positive-click="handleSave"
      @negative-click="closeModal"
    >
      <n-form>
        <n-form-item label="名称" required>
          <n-input v-model:value="formState.name" placeholder="为订阅起个名字" />
        </n-form-item>
        <n-form-item label="URL" required>
          <n-input v-model:value="formState.url" placeholder="输入订阅链接" />
        </n-form-item>
        <n-form-item label="包含关键词">
          <n-input
            type="textarea"
            v-model:value="formState.include_keywords"
            placeholder="每行一个关键词，只保留名称包含这些词的节点"
          />
        </n-form-item>
        <n-form-item label="排除关键词">
          <n-input
            type="textarea"
            v-model:value="formState.exclude_keywords"
            placeholder="每行一个关键词，排除名称包含这些词的节点"
          />
        </n-form-item>
      </n-form>
    </n-modal>

    <n-modal
      v-model:show="showImportModal"
      preset="card"
      title="批量导入订阅"
      style="width: 600px;"
      :mask-closable="false"
    >
      <n-form @submit.prevent="handleBulkImport">
        <n-form-item label="订阅链接">
          <n-input
            v-model:value="importUrls"
            type="textarea"
            placeholder="每行一个订阅，格式为 “名称,链接” 或直接是链接。"
            :autosize="{ minRows: 10, maxRows: 20 }"
          />
        </n-form-item>
        <n-space justify="end">
          <n-button @click="showImportModal = false">取消</n-button>
          <n-button type="primary" @click="handleBulkImport" :loading="importLoading">导入</n-button>
        </n-space>
      </n-form>
    </n-modal>

    <n-modal
      v-model:show="showPreviewModal"
      preset="card"
      title="订阅链接预览"
      style="width: 800px;"
      :mask-closable="true"
    >
      <n-form @submit.prevent="handlePreview">
        <n-form-item label="订阅链接 URL">
          <n-input v-model:value="previewUrl" placeholder="粘贴需要预览的订阅链接地址" />
        </n-form-item>
        <n-space justify="end">
          <n-button type="primary" @click="handlePreview" :loading="previewLoading">开始预览</n-button>
        </n-space>
      </n-form>

      <template v-if="previewData">
        <n-card title="订阅分析" :bordered="false" class="mt-4">
          <n-grid :cols="3" :x-gap="12">
            <n-gi>
              <n-statistic label="节点总数" :value="previewData.analysis.total" />
            </n-gi>
            <n-gi>
              <n-statistic label="协议分布">
                <n-space>
                  <n-tag v-for="(count, protocol) in previewData.analysis.protocols" :key="protocol" type="info">
                    {{ protocol.toUpperCase() }}: {{ count }}
                  </n-tag>
                </n-space>
              </n-statistic>
            </n-gi>
            <n-gi>
              <n-statistic label="地区分布">
                 <n-space :size="'small'" style="flex-wrap: wrap;">
                  <n-tag v-for="(count, region) in previewData.analysis.regions" :key="region" type="success">
                    {{ region }}: {{ count }}
                  </n-tag>
                </n-space>
              </n-statistic>
            </n-gi>
          </n-grid>
        </n-card>

        <n-data-table
          :columns="previewNodeColumns"
          :data="previewData.nodes"
          :pagination="{ pageSize: 5 }"
          :max-height="300"
          class="mt-4"
        />
        <n-space justify="end" class="mt-4">
          <n-button type="success" @click="handleImportFromPreview" :loading="importLoading">
            导入为手动节点
          </n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
    <n-modal
      v-model:show="showNodePreviewModal"
      preset="card"
      :title="`节点预览 - ${currentSubscriptionForPreview?.name}`"
      style="width: 800px;"
      :mask-closable="true"
    >
      <SubscriptionNodesPreview
        ref="nodePreviewRef"
        v-if="currentSubscriptionForPreview"
        :subscription-id="currentSubscriptionForPreview.id"
        :subscription-url="currentSubscriptionForPreview.url"
        :show="showNodePreviewModal"
      />
    </n-modal>

    <n-modal
      v-model:show="showRulesModal"
      preset="card"
      :title="`规则管理 - ${currentSubscriptionForRules?.name}`"
      style="width: 900px;"
      :mask-closable="false"
    >
      <n-space justify="end" class="mb-4">
        <n-button type="primary" @click="openRuleFormModal(null)">添加规则</n-button>
      </n-space>
      <n-data-table
        :columns="ruleColumns"
        :data="subscriptionRules"
        :loading="rulesLoading"
        :bordered="false"
      />
    </n-modal>

    <n-modal
      v-model:show="showRuleFormModal"
      :mask-closable="false"
      preset="dialog"
      :title="ruleModalTitle"
      positive-text="保存"
      negative-text="取消"
      :positive-button-props="{ loading: ruleSaveLoading }"
      @positive-click="handleSaveRule"
    >
      <n-form ref="ruleFormRef">
        <n-form-item label="规则名称" required>
          <n-input v-model:value="ruleFormState.name" placeholder="为规则起个名字" />
        </n-form-item>
        <n-form-item label="规则类型" required>
          <n-select v-model:value="ruleFormState.type" :options="ruleTypeOptions" />
        </n-form-item>
        <n-form-item v-if="ruleFormState.type === 'filter_by_name_keyword'" label="关键词" required>
          <n-dynamic-tags v-model:value="ruleFormState.keywords" />
          <template #feedback>
            输入关键词后按回车确认
          </template>
        </n-form-item>

        <n-form-item v-else-if="ruleFormState.type === 'rename_by_regex'" label="重命名规则" required>
          <n-space vertical style="width: 100%;">
            <n-input v-model:value="ruleFormState.renameRegex" placeholder="输入用于匹配的正则表达式" />
            <n-input v-model:value="ruleFormState.renameFormat" placeholder="输入重命名格式, 如 $1-$2" />
          </n-space>
        </n-form-item>

        <n-form-item v-else-if="ruleFormState.type === 'filter_by_name_regex'" label="正则表达式" required>
          <n-input
            v-model:value="ruleFormState.regex"
            placeholder="输入用于过滤的正则表达式"
          />
        </n-form-item>

        <n-form-item v-else label="规则值 (JSON)" required>
          <n-input
            v-model:value="ruleFormState.value"
            type="textarea"
            placeholder='这是一个兼容旧版或未知规则类型的输入框'
            :autosize="{ minRows: 3, maxRows: 5 }"
          />
        </n-form-item>
        <n-form-item label="启用">
          <n-switch v-model:value="ruleFormState.enabled" :checked-value="1" :unchecked-value="0" />
        </n-form-item>
      </n-form>
    </n-modal>
</template>