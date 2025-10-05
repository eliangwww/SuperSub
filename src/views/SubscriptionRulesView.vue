<script setup lang="ts">
import { ref, onMounted, reactive, h, computed } from 'vue'
import { useMessage, useDialog, NButton, NSpace, NTag, NDataTable, NPageHeader, NModal, NForm, NFormItem, NInput, NSelect } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type { SubscriptionRule } from '@/types'
import { useAuthStore } from '@/stores/auth'

const message = useMessage()
const dialog = useDialog()
const authStore = useAuthStore()

const rules = ref<SubscriptionRule[]>([])
const loading = ref(true)
const showModal = ref(false)
const saveLoading = ref(false)
const editingRule = ref<SubscriptionRule | null>(null)

// Define a more detailed form state that handles the structured 'value' field
const defaultFormState = {
  name: '',
  // Use a valid default type from the SubscriptionRule interface
  type: 'filter_by_name_keyword' as SubscriptionRule['type'],
  // The 'value' field will hold the parameters for the rule
  value: {
    pattern: '',
    replace: ''
  },
  subscription_id: '', // Will be set when opening modal for a specific subscription
  enabled: 1,
}

const formState = reactive({ ...JSON.parse(JSON.stringify(defaultFormState)) })

const modalTitle = computed(() => (editingRule.value ? '编辑规则' : '新增规则'))

const ruleTypeOptions = [
  { label: '过滤 (关键词)', value: 'filter_by_name_keyword' },
  { label: '过滤 (正则)', value: 'filter_by_name_regex' },
  { label: '重命名 (正则)', value: 'rename_by_regex' }
]

const typeMeta: Record<SubscriptionRule['type'], { label: string; tag: 'info' | 'success' | 'warning' }> = {
  'filter_by_name_keyword': { label: '关键词过滤', tag: 'info' },
  'filter_by_name_regex': { label: '正则过滤', tag: 'warning' },
  'rename_by_regex': { label: '正则重命名', tag: 'success' },
}

const createColumns = ({ onEdit, onDelete }: {
    onEdit: (row: SubscriptionRule) => void,
    onDelete: (row: SubscriptionRule) => void,
}): DataTableColumns<SubscriptionRule> => {
  return [
    { title: '名称', key: 'name', sorter: 'default' },
    {
      title: '类型',
      key: 'type',
      width: 150,
      render(row) {
        const meta = typeMeta[row.type]
        return h(NTag, { type: meta.tag }, { default: () => meta.label })
      }
    },
    {
      title: '规则内容',
      key: 'value',
      ellipsis: { tooltip: true },
      render(row) {
        try {
          const val = JSON.parse(row.value)
          if (row.type === 'rename_by_regex') {
            return `匹配: ${val.pattern}, 替换为: ${val.replace}`
          }
          return `模式: ${val.pattern}`
        } catch {
          return '无效的规则内容'
        }
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

const openModal = (rule: SubscriptionRule | null = null) => {
  if (rule) {
    editingRule.value = rule
    // Deep copy and parse value
    formState.name = rule.name
    formState.type = rule.type
    formState.enabled = rule.enabled
    formState.subscription_id = rule.subscription_id
    try {
      formState.value = JSON.parse(rule.value)
    } catch {
      formState.value = { pattern: '', replace: '' } // Fallback
    }
  } else {
    editingRule.value = null
    // Reset with deep copy
    Object.assign(formState, JSON.parse(JSON.stringify(defaultFormState)))
    // This part is tricky, we need to know which subscription we are adding rule to.
    // For now, let's assume we get it from somewhere, maybe a route param or a selection.
    // This will need to be properly implemented when integrating with the subscription view.
    // formState.subscription_id = current_subscription_id;
  }
  showModal.value = true
}

const closeModal = () => {
  showModal.value = false
}

const fetchRules = async () => {
  loading.value = true
  try {
    const response = await fetch('/api/subscription-rules', {
      headers: { 'Authorization': `Bearer ${authStore.token}` }
    })
    const result: { success: boolean, data?: SubscriptionRule[], message?: string } = await response.json()
    if (result.success && result.data) {
      rules.value = result.data
    } else {
      message.error(result.message || '获取规则列表失败')
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
    // We need to get the subscription ID. This is a placeholder.
    // In a real scenario, this would come from the context, e.g., a dropdown or route param.
    const subscriptionId = editingRule.value?.subscription_id || rules.value[0]?.subscription_id;
    if (!subscriptionId) {
        message.error("无法确定订阅ID，无法保存规则。");
        return;
    }

    const payload = {
      name: formState.name,
      type: formState.type,
      enabled: formState.enabled,
      value: JSON.stringify(formState.value) // Serialize the value object
    }
    
    const url = editingRule.value
      ? `/api/subscriptions/${subscriptionId}/rules/${editingRule.value.id}`
      : `/api/subscriptions/${subscriptionId}/rules`
    const method = editingRule.value ? 'PUT' : 'POST'

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authStore.token}`
      },
      body: JSON.stringify(payload)
    })
    const result: { success: boolean, message?: string } = await response.json()

    if (result.success) {
      message.success(editingRule.value ? '规则更新成功' : '规则新增成功')
      closeModal()
      fetchRules()
    } else {
      message.error(result.message || '保存失败')
    }
  } catch (err) {
    message.error('请求失败，请稍后重试')
  } finally {
    saveLoading.value = false
  }
}

const handleDelete = (row: SubscriptionRule) => {
  dialog.warning({
    title: '确认删除',
    content: `确定要删除规则 "${row.name}" 吗？`,
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const response = await fetch(`/api/subscriptions/${row.subscription_id}/rules/${row.id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${authStore.token}` }
        })
        const result: { success: boolean, message?: string } = await response.json()
        if (result.success) {
          message.success('规则删除成功')
          fetchRules()
        } else {
          message.error(result.message || '删除失败')
        }
      } catch (err) {
        message.error('请求失败，请稍后重试')
      }
    },
  })
}

const columns = createColumns({
    onEdit: openModal,
    onDelete: handleDelete,
})

onMounted(fetchRules)
</script>

<template>
  <div>
    <n-page-header>
      <template #title>
        订阅规则管理
      </template>
      <template #extra>
        <n-space>
          <n-button type="primary" @click="openModal(null)">新增规则</n-button>
        </n-space>
      </template>
    </n-page-header>

    <n-data-table
      :columns="columns"
      :data="rules"
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
        <n-form-item label="规则名称" required>
          <n-input v-model:value="formState.name" placeholder="为规则起个名字" />
        </n-form-item>
        <n-form-item label="规则类型" required>
          <n-select v-model:value="formState.type" :options="ruleTypeOptions" />
        </n-form-item>
        
        <n-form-item v-if="formState.type.includes('keyword')" label="关键词" required>
          <n-input v-model:value="formState.value.pattern" placeholder="输入关键词，多个用逗号隔开" />
        </n-form-item>
        
        <n-form-item v-if="formState.type.includes('regex')" label="正则表达式" required>
          <n-input v-model:value="formState.value.pattern" placeholder="输入正则表达式" />
        </n-form-item>

        <n-form-item v-if="formState.type === 'rename_by_regex'" label="替换为" required>
          <n-input v-model:value="formState.value.replace" placeholder="例如: [New] $1" />
        </n-form-item>
      </n-form>
    </n-modal>
  </div>
</template>