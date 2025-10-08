<script setup lang="ts">
import { ref, onMounted, reactive, h, computed, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage, useDialog, NButton, NSpace, NTag, NDataTable, NPageHeader, NModal, NForm, NFormItem, NInput, NTooltip, NGrid, NGi, NStatistic, NCard, NSwitch, NSelect, NDynamicTags, NRadioGroup, NRadioButton, NInputGroup, NIcon, NTabs, NTabPane, NDropdown, NProgress, NCollapse, NCollapseItem } from 'naive-ui'
import { EyeOutline, FilterOutline, CreateOutline, SyncOutline, TrashOutline, EllipsisVertical as MoreIcon } from '@vicons/ionicons5'
import type { DataTableColumns, FormInst, DropdownOption } from 'naive-ui'
import { Subscription, Node, ApiResponse } from '@/types'
import { api } from '@/utils/api'
import { useAuthStore } from '@/stores/auth'
import { useSubscriptionGroupStore } from '@/stores/subscriptionGroups'
import { useGroupStore as useNodeGroupStore } from '@/stores/groups'
import SubscriptionNodesPreview from '@/components/SubscriptionNodesPreview.vue'
import { format } from 'date-fns'

const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const subscriptionGroupStore = useSubscriptionGroupStore()
const nodeGroupStore = useNodeGroupStore()

const subscriptions = ref<Subscription[]>([])
const loading = ref(true)
const showModal = ref(false)
const saveLoading = ref(false)
const updatingId = ref<string | null>(null)
const editingSubscription = ref<Subscription | null>(null)
const updatingIds = ref(new Set<string>()) // For individual and batch updates
const activeTab = ref('all')

// For bulk import
const showImportModal = ref(false)
const importUrls = ref('')
const importLoading = ref(false)
const importGroupId = ref<string | undefined>(undefined)

// For batch actions
const checkedRowKeys = ref<string[]>([])

// For moving subscriptions to a group
const showMoveToGroupModal = ref(false)
const moveToGroupId = ref<string | null>(null)
const moveToGroupLoading = ref(false)

// For adding a new subscription group
const showAddGroupModal = ref(false)
const newGroupName = ref('')
const addGroupLoading = ref(false)

// For Group Management
const showEditGroupModal = ref(false)
const editingGroup = ref<import('@/stores/subscriptionGroups').SubscriptionGroup | null>(null)
const editingGroupName = ref('')
const editGroupLoading = ref(false)
const showDropdown = ref(false)
const dropdownX = ref(0)
const dropdownY = ref(0)
const activeDropdownGroup = ref<import('@/stores/subscriptionGroups').SubscriptionGroup | null>(null)


// For Node Preview in Modal
const showNodePreviewModal = ref(false)
const currentSubscriptionForPreview = ref<Subscription | null>(null)
const nodePreviewRef = ref<{ fetchPreview: () => void } | null>(null)

// For Update All Log
const showUpdateLogModal = ref(false)
const updateLog = ref<{
  success: { name: string }[]
  failed: Subscription[]
}>({ success: [], failed: [] })
const updateLogLoading = ref(false)
const updateProgress = ref({ current: 0, total: 0 })
let updateAbortController: AbortController | null = null

// For Subscription Rules
const showRulesModal = ref(false)
const rulesLoading = ref(false)
const currentSubscriptionForRules = ref<Subscription | null>(null)
const subscriptionRules = ref<import('@/types').SubscriptionRule[]>([])
const showRuleFormModal = ref(false)
const ruleFormRef = ref<FormInst | null>(null)
const editingRule = ref<import('@/types').SubscriptionRule | null>(null)
const ruleSaveLoading = ref(false)

const ruleFormState = reactive({
  id: 0,
  name: '',
  type: 'filter_by_name_keyword' as import('@/types').SubscriptionRule['type'] | 'exclude_by_name_keyword',
  value: '',
  enabled: 1,
  keywords: [] as string[],
  renameRegex: '',
  renameFormat: '',
  regex: '',
})

const ruleModalTitle = computed(() => (editingRule.value ? '编辑规则' : '新增规则'))
const ruleTypeOptions = [
  { label: '按名称关键词过滤 (保留)', value: 'filter_by_name_keyword' },
  { label: '按名称关键词排除', value: 'exclude_by_name_keyword' },
  { label: '按名称正则过滤', value: 'filter_by_name_regex' },
  { label: '按正则重命名', value: 'rename_by_regex' },
]

const commonKeywords = [
  '香港', 'HK', '🇭🇰',
  '台湾', 'TW', '🇹🇼',
  '日本', 'JP', '🇯🇵',
  '美国', 'US', '🇺🇸',
  '新加坡', 'SG', '🇸🇬',
  '韩国', 'KR', '🇰🇷',
  '英国', 'UK', '🇬🇧',
  'IEPL', 'IPLC', '专线', 'BGP',
]

const addKeyword = (keyword: string) => {
  if (!ruleFormState.keywords.includes(keyword)) {
    ruleFormState.keywords.push(keyword)
  }
}

const formState = reactive({
  id: '',
  name: '',
  url: '',
})

const modalTitle = computed(() => (editingSubscription.value ? '编辑订阅' : '新增订阅'))

const filteredSubscriptions = computed(() => {
  return subscriptions.value.filter(sub => {
    if (activeTab.value === 'all') return true
    if (activeTab.value === 'ungrouped') return !sub.group_id
    return sub.group_id === activeTab.value
  })
})

const groupCounts = computed(() => {
  const counts: { all: number; ungrouped: number; [key: string]: number } = {
    all: subscriptions.value.length,
    ungrouped: 0,
  }
  subscriptions.value.forEach(sub => {
    if (sub.group_id) {
      counts[sub.group_id] = (counts[sub.group_id] || 0) + 1
    } else {
      counts.ungrouped++
    }
  })
  return counts
})

const formatBytes = (bytes: number, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}


const createColumns = ({ onEdit, onUpdate, onDelete, onPreviewNodes, onManageRules }: {
    onEdit: (row: Subscription) => void,
    onUpdate: (row: Subscription) => void,
    onDelete: (row: Subscription) => void,
    onPreviewNodes: (row: Subscription) => void,
    onManageRules: (row: Subscription) => void,
}): DataTableColumns<Subscription> => {
  return [
    { type: 'selection' },
    { title: '名称', key: 'name', sorter: 'default', width: 150, ellipsis: { tooltip: true } },
    { title: '订阅链接', key: 'url', ellipsis: { tooltip: true }, width: 150 },
    {
      title: '状态',
      key: 'status',
      align: 'center',
      width: 100,
      sorter: (a, b) => {
        const getStatusValue = (row: Subscription) => {
          if (row.error) return 2; // 失败
          if (row.last_updated) return 1; // 成功
          return 0; // 待更新
        };
        return getStatusValue(a) - getStatusValue(b);
      },
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
      title: '剩余流量',
      key: 'subscription_info',
      width: 120,
      sorter: (a, b) => {
        const valA = a.remaining_traffic;
        const valB = b.remaining_traffic;
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;
        return valA - valB;
      },
      render(row) {
        const remaining = row.remaining_traffic;
        if (remaining === null || remaining === undefined || remaining < 0) {
          return h(NTag, { size: 'small', round: true }, { default: () => 'N/A' });
        }
        
        // Since we don't have total/used, we can't show a percentage-based color.
        // We can, however, create a simple color scheme based on remaining data.
        let tagType: 'success' | 'warning' | 'error' = 'success';
        const GB = 1024 * 1024 * 1024;
        if (remaining < 1 * GB) tagType = 'error';
        else if (remaining < 5 * GB) tagType = 'warning';

        return h(NTag, { type: tagType, size: 'small', round: true }, { default: () => formatBytes(remaining) });
      }
    },
    {
      title: '剩余天数',
      key: 'remaining_days',
      width: 120,
      sorter: (a, b) => {
        const valA = a.remaining_days;
        const valB = b.remaining_days;
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;
        return valA - valB;
      },
      render(row) {
        const diffDays = row.remaining_days;
        if (diffDays === null || diffDays === undefined) {
            return h(NTag, { size: 'small', round: true }, { default: () => 'N/A' });
        }
        if (diffDays < 0) {
            return h(NTag, { type: 'error', size: 'small', round: true }, { default: () => '已过期' });
        }
        
        let tagType: 'success' | 'warning' | 'error' = 'success';
        if (diffDays <= 3) tagType = 'error';
        else if (diffDays <= 7) tagType = 'warning';
        
        const tooltipContent = row.expires_at ? `到期时间: ${format(new Date(row.expires_at), 'yyyy-MM-dd HH:mm')}` : '无到期时间信息';

        return h(NTooltip, null, {
          trigger: () => h(NTag, { type: tagType, size: 'small', round: true }, { default: () => `${diffDays} 天` }),
          default: () => tooltipContent,
        });
      }
    },
    {
      title: '上次更新',
      key: 'last_updated',
      width: 180,
      sorter: (a, b) => new Date(a.last_updated || 0).getTime() - new Date(b.last_updated || 0).getTime(),
      render(row) {
        return row.last_updated ? format(new Date(row.last_updated), 'yyyy-MM-dd HH:mm:ss') : 'N/A'
      }
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 200,
      render(row) {
        const createTooltipButton = (tooltip: string, icon: any, onClick: () => void, props: any = {}) => {
          return h(NTooltip, null, {
            trigger: () => h(NButton, { circle: true, tertiary: true, size: 'small', onClick, ...props }, { icon: () => h(NIcon, { component: icon }) }),
            default: () => tooltip,
          });
        };
        return h(NSpace, null, {
          default: () => [
            createTooltipButton('预览节点', EyeOutline, () => onPreviewNodes(row)),
            createTooltipButton('规则', FilterOutline, () => onManageRules(row), { type: 'info' }),
            createTooltipButton('编辑', CreateOutline, () => onEdit(row)),
            createTooltipButton('更新', SyncOutline, () => onUpdate(row), { type: 'primary', loading: updatingId.value === row.id || updatingIds.value.has(row.id) }),
            createTooltipButton('删除', TrashOutline, () => onDelete(row), { type: 'error' }),
          ]
        })
      }
    }
  ]
}

const openModal = (sub: Subscription | null = null) => {
  if (sub) {
    editingSubscription.value = { ...sub }
    formState.id = sub.id
    formState.name = sub.name
    formState.url = sub.url
  } else {
    editingSubscription.value = null
    formState.id = ''
    formState.name = ''
    formState.url = ''
  }
  showModal.value = true
}

const closeModal = () => {
  showModal.value = false
}

const fetchSubscriptions = async () => {
  const authStore = useAuthStore()
  if (!authStore.isAuthenticated) return
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
    const payload = { name: formState.name, url: formState.url }
    const response = editingSubscription.value
      ? await api.put<ApiResponse>(`/subscriptions/${editingSubscription.value.id}`, payload)
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

const handleUpdate = async (row: Subscription, silent = false, signal?: AbortSignal): Promise<{ success: boolean; data: Subscription; error?: string }> => {
  updatingId.value = row.id
  updatingIds.value.add(row.id)
  if (!silent) {
    message.info(`正在更新订阅 [${row.name}]...`)
  }
  try {
    const response = await api.post<ApiResponse<Subscription>>(`/subscriptions/${row.id}/update`, {}, { signal })
    const updatedSub = response.data.data
    
    const index = subscriptions.value.findIndex(s => s.id === row.id)
    if (index !== -1 && updatedSub) {
      subscriptions.value[index] = updatedSub
    }

    if (response.data.success && updatedSub) {
      if (!silent) message.success(`订阅 [${row.name}] 更新成功`)
      return { success: true, data: updatedSub }
    } else {
      const errorMsg = response.data.message || `订阅 [${row.name}] 更新失败`
      if (!silent) message.error(errorMsg)
      // Even on failure, the backend returns the subscription state, so we use it.
      return { success: false, data: updatedSub || row, error: errorMsg }
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { success: false, data: row, error: '已中止' }
    }
    const errorMsg = err.message || '请求失败，请稍后重试'
    if (!silent) message.error(errorMsg)
    return { success: false, data: row, error: errorMsg }
  } finally {
    updatingId.value = null
    updatingIds.value.delete(row.id)
  }
}


const handlePreviewNodes = (row: Subscription) => {
    currentSubscriptionForPreview.value = row
    showNodePreviewModal.value = true
    nextTick(() => {
        nodePreviewRef.value?.fetchPreview()
    })
}

const openImportModal = () => {
  importUrls.value = ''
  importGroupId.value = undefined
  showImportModal.value = true
}

// A generic function to execute updates in a concurrent pool with progress
const executeSubscriptionUpdates = async (subsToUpdate: Subscription[]) => {
  if (subsToUpdate.length === 0) {
    message.info('没有需要更新的订阅')
    return
  }

  message.info(`开始更新 ${subsToUpdate.length} 个订阅...`)
  updateLog.value = { success: [], failed: [] }
  updateProgress.value = { current: 0, total: subsToUpdate.length }
  showUpdateLogModal.value = true
  updateLogLoading.value = true

  updateAbortController = new AbortController()
  const signal = updateAbortController.signal

  const CONCURRENT_LIMIT = 5
  const tasks = subsToUpdate.map(sub => () => handleUpdate(sub, true, signal))
  
  const executing = new Set<Promise<any>>()

  try {
    for (const [index, task] of tasks.entries()) {
      if (signal.aborted) {
        // Mark remaining tasks as aborted in the log
        subsToUpdate.slice(index).forEach(sub => {
          updateLog.value.failed.push({ ...sub, error: '已中止' })
        })
        break
      }
      const p = task().then(result => {
        updateProgress.value.current++
        if (result.success) {
          updateLog.value.success.push({ name: result.data.name })
        } else {
          const failedSub = { ...result.data, error: result.error || '未知错误' }
          updateLog.value.failed.push(failedSub)
        }
      })
      executing.add(p)
      p.finally(() => executing.delete(p))
      if (executing.size >= CONCURRENT_LIMIT) {
        await Promise.race(executing)
      }
    }
    await Promise.all(executing)
  } catch (error) {
    // This should not be reached if errors are handled inside `handleUpdate`
    console.error('An unexpected error occurred during update execution:', error)
  } finally {
    updateLogLoading.value = false
    if (signal.aborted) {
      message.warning('更新任务已中止')
    } else {
      message.success('订阅更新任务完成！')
    }
    updateAbortController = null
  }
}

const handleUpdateAll = () => {
  // If there are checked rows, update them. Otherwise, update all enabled.
  const subsToUpdate = checkedRowKeys.value.length > 0
    ? subscriptions.value.filter(s => checkedRowKeys.value.includes(s.id))
    : subscriptions.value.filter(s => s.enabled)
  
  executeSubscriptionUpdates(subsToUpdate)
}

const handleRetryFailed = () => {
  const failedSubsInfo = [...updateLog.value.failed].filter(s => s.error !== '已中止')
  if (failedSubsInfo.length === 0) {
    message.info('没有失败的订阅可以重试')
    return
  }
  // The failed array now contains full subscription objects
  executeSubscriptionUpdates(failedSubsInfo)
}

const handleCancelUpdate = () => {
  if (updateLogLoading.value && updateAbortController) {
    updateAbortController.abort()
  } else {
    showUpdateLogModal.value = false
  }
}

const handleClearFailed = () => {
  const subsToClear = updateLog.value.failed.filter(sub =>
    sub.error !== '已中止' && (
      sub.error || // Condition 1: Has an error (failed update)
      sub.remaining_traffic === 0 || // Condition 2: Remaining traffic is exactly 0
      (sub.remaining_days !== null && sub.remaining_days !== undefined && sub.remaining_days <= 0) // Condition 3: Remaining days is 0 or less
    )
  );

  if (subsToClear.length === 0) {
    message.info('没有符合条件的失效订阅可以清除');
    return;
  }

  dialog.warning({
    title: '确认清除失效订阅',
    content: `即将删除 ${subsToClear.length} 个失效订阅，此操作不可恢复。确定要继续吗？`,
    positiveText: '确定清除',
    negativeText: '取消',
    onPositiveClick: async () => {
      const idsToClear = subsToClear.map(sub => sub.id);
      try {
        const response = await api.post('/subscriptions/batch-delete', { ids: idsToClear });
        if (response.data.success) {
          message.success(`成功清除了 ${idsToClear.length} 个失效订阅`);
          // Remove cleared subs from the log
          updateLog.value.failed = updateLog.value.failed.filter(sub => !idsToClear.includes(sub.id));
          fetchSubscriptions(); // Refresh the main list
        } else {
          message.error(response.data.message || '清除失败');
        }
      } catch (err) {
        message.error('请求失败，请稍后重试');
      }
    }
  });
};

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
      try {
        const urlObj = new URL(parts[0])
        const name = urlObj.hostname
        subscriptionsToCreate.push({ name: name, url: parts[0] })
      } catch (e) { /* Ignore invalid URL */ }
    }
  }
  if (subscriptionsToCreate.length === 0) {
    message.warning('没有找到有效的订阅链接。格式应为 "名称,链接" 或直接是链接。')
    importLoading.value = false
    return
  }
  try {
    const response = await api.post<ApiResponse>('/subscriptions/batch-import', {
      subscriptions: subscriptionsToCreate,
      groupId: importGroupId.value
    })
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

const handleBatchDelete = () => {
  if (checkedRowKeys.value.length === 0) {
    message.warning('请至少选择一个订阅');
    return;
  }
  dialog.warning({
    title: '确认批量删除',
    content: `确定要删除选中的 ${checkedRowKeys.value.length} 个订阅吗？`,
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const response = await api.post('/subscriptions/batch-delete', { ids: checkedRowKeys.value });
        if (response.data.success) {
          message.success('批量删除成功');
          fetchSubscriptions();
          checkedRowKeys.value = [];
        } else {
          message.error(response.data.message || '批量删除失败');
        }
      } catch (err) {
        message.error('请求失败，请稍后重试');
      }
    }
  });
};

const handleMoveToGroup = async () => {
  if (checkedRowKeys.value.length === 0) {
    message.warning('请至少选择一个订阅');
    return;
  }
  moveToGroupLoading.value = true;
  try {
    const response = await api.post('/subscriptions/batch-update-group', {
      subscriptionIds: checkedRowKeys.value,
      groupId: moveToGroupId.value,
    });
    if (response.data.success) {
      message.success('订阅分组更新成功');
      showMoveToGroupModal.value = false;
      checkedRowKeys.value = [];
      fetchSubscriptions();
    } else {
      message.error(response.data.message || '移动失败');
    }
  } catch (error: any) {
    message.error(error.message || '请求失败');
  } finally {
    moveToGroupLoading.value = false;
  }
};

const handleSaveGroup = async () => {
  if (!newGroupName.value.trim()) {
    message.warning('分组名称不能为空');
    return;
  }
  addGroupLoading.value = true;
  try {
    const response = await subscriptionGroupStore.addGroup(newGroupName.value);
    if (response.success) {
      message.success('分组创建成功');
      showAddGroupModal.value = false;
      newGroupName.value = '';
    } else {
      message.error(response.message || '创建失败');
    }
  } catch (error: any) {
    message.error(error.message || '创建失败');
  } finally {
    addGroupLoading.value = false;
  }
};

const handleUpdateGroup = async () => {
  if (!editingGroup.value || !editingGroupName.value.trim()) {
    message.warning('分组名称不能为空')
    return
  }
  editGroupLoading.value = true
  try {
    const response = await subscriptionGroupStore.updateGroup(editingGroup.value.id, editingGroupName.value)
    if (response.success) {
      message.success('分组更新成功')
      showEditGroupModal.value = false
    } else {
      message.error(response.message || '更新失败')
    }
  } catch (error: any) {
    message.error(error.message || '更新失败')
  } finally {
    editGroupLoading.value = false
  }
}

const getDropdownOptions = (group: import('@/stores/subscriptionGroups').SubscriptionGroup): DropdownOption[] => {
  return [
    { label: '更新本组', key: 'update-group' },
    { label: '重命名', key: 'rename' },
    { label: group.is_enabled ? '禁用' : '启用', key: 'toggle' },
    { type: 'divider', key: 'd1' },
    { label: '删除', key: 'delete', props: { style: 'color: red;' } }
  ]
}

const handleGroupAction = (key: string) => {
  showDropdown.value = false
  const group = activeDropdownGroup.value
  if (!group) return

  switch (key) {
    case 'update-group':
      handleUpdateGroupSubscriptions(group.id)
      break
    case 'rename':
      editingGroup.value = group
      editingGroupName.value = group.name
      showEditGroupModal.value = true
      break
    case 'toggle':
      subscriptionGroupStore.toggleGroup(group.id).catch((err: any) => message.error(err.message || '操作失败'))
      break
    case 'delete':
      dialog.warning({
        title: '确认删除',
        content: `确定要删除分组 "${group.name}" 吗？分组下的订阅将变为“未分组”。`,
        positiveText: '确定',
        negativeText: '取消',
        onPositiveClick: async () => {
          try {
            const response = await subscriptionGroupStore.deleteGroup(group.id)
            if (response.success) {
              message.success('分组删除成功')
              if (activeTab.value === group.id) {
                activeTab.value = 'all'
              }
              fetchSubscriptions() // Refresh subscriptions to update their group status
            } else {
              message.error(response.message || '删除失败')
            }
          } catch (error: any) {
            message.error(error.message || '删除失败')
          }
        }
      })
      break
  }
}

const handleTabClick = (group: import('@/stores/subscriptionGroups').SubscriptionGroup, event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (target.closest('.group-actions-button')) {
    showDropdown.value = true
    dropdownX.value = event.clientX
    dropdownY.value = event.clientY
    activeDropdownGroup.value = group
  } else {
    activeTab.value = group.id
  }
}

const handleContextMenu = (group: import('@/stores/subscriptionGroups').SubscriptionGroup, event: MouseEvent) => {
  event.preventDefault()
  showDropdown.value = false
  setTimeout(() => {
    showDropdown.value = true
    dropdownX.value = event.clientX
    dropdownY.value = event.clientY
    activeDropdownGroup.value = group
  }, 50)
}

const handleUpdateGroupSubscriptions = (groupId: string) => {
  const subsToUpdate = subscriptions.value.filter(s => s.group_id === groupId && s.enabled)
  // The generic function will handle the case where there are no subscriptions to update.
  executeSubscriptionUpdates(subsToUpdate)
}


// --- Subscription Rules Logic ---
const fetchRules = async (subscriptionId: string) => {
  rulesLoading.value = true
  try {
    const response = await api.get<ApiResponse<import('@/types').SubscriptionRule[]>>(`/subscriptions/${subscriptionId}/rules`)
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

const handleDeleteRule = (rule: import('@/types').SubscriptionRule) => {
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
          fetchRules(subId)
        } else {
          message.error(response.data.message || '删除失败')
        }
      } catch (err) {
        message.error('请求失败，请稍后重试')
      }
    },
  })
}

const openRuleFormModal = (rule: import('@/types').SubscriptionRule | null) => {
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
    ruleFormState.value = rule.value
    ruleFormState.enabled = rule.enabled
    try {
      const parsedValue = JSON.parse(rule.value)
      if ((rule.type === 'filter_by_name_keyword' || rule.type === 'exclude_by_name_keyword') && parsedValue.keywords) {
        ruleFormState.keywords = parsedValue.keywords
      } else if (rule.type === 'rename_by_regex' && parsedValue.regex && parsedValue.format) {
        ruleFormState.renameRegex = parsedValue.regex
        ruleFormState.renameFormat = parsedValue.format
      } else if (rule.type === 'filter_by_name_regex' && parsedValue.regex) {
        ruleFormState.regex = parsedValue.regex
      }
    } catch (e) {
      console.error("Failed to parse rule value JSON:", e)
    }
  }
  showRuleFormModal.value = true
}

const handleSaveRule = async () => {
  if (!currentSubscriptionForRules.value) return
  const subId = currentSubscriptionForRules.value.id
  ruleSaveLoading.value = true
  try {
    let jsonValue = {}
    if (ruleFormState.type === 'filter_by_name_keyword' || ruleFormState.type === 'exclude_by_name_keyword') {
      jsonValue = { keywords: ruleFormState.keywords }
    } else if (ruleFormState.type === 'rename_by_regex') {
      jsonValue = { regex: ruleFormState.renameRegex, format: ruleFormState.renameFormat }
    } else if (ruleFormState.type === 'filter_by_name_regex') {
      jsonValue = { regex: ruleFormState.regex }
    } else {
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
      enabled: ruleFormState.enabled === 1,
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
    onEdit: (row: import('@/types').SubscriptionRule) => void,
    onDelete: (row: import('@/types').SubscriptionRule) => void,
}): DataTableColumns<import('@/types').SubscriptionRule> => {
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
              await api.put<ApiResponse>(`/subscriptions/${subId}/rules/${row.id}`, { enabled: value })
              message.success('状态更新成功')
            } catch (e) {
              message.error('状态更新失败')
              row.enabled = !value ? 1 : 0
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

const columns = createColumns({
    onEdit: openModal,
    onUpdate: handleUpdate,
    onDelete: handleDelete,
    onPreviewNodes: handlePreviewNodes,
    onManageRules: onManageRules,
})

onMounted(() => {
  fetchSubscriptions()
  subscriptionGroupStore.fetchGroups()
  nodeGroupStore.fetchGroups()
})
</script>

<template>
  <div>
    <n-page-header>
      <template #title>
        订阅管理
      </template>
      <template #extra>
        <n-space>
          <n-button type="primary" ghost @click="handleUpdateAll" :loading="updatingIds.size > 0">
            {{ checkedRowKeys.length > 0 ? `更新选中 (${checkedRowKeys.length})` : '更新全部' }}
          </n-button>
          <n-button type="primary" @click="openModal(null)">新增订阅</n-button>
          <n-button type="info" @click="openImportModal">批量导入</n-button>
          <n-button type="primary" ghost @click="showAddGroupModal = true">新增分组</n-button>
          <n-button type="primary" ghost @click="showMoveToGroupModal = true" :disabled="checkedRowKeys.length === 0">移动到分组</n-button>
          <n-button type="error" ghost @click="handleBatchDelete" :disabled="checkedRowKeys.length === 0">批量删除</n-button>
        </n-space>
      </template>
    </n-page-header>

    <n-tabs type="card" class="mt-4" v-model:value="activeTab" @update:value="showDropdown = false">
      <n-tab-pane name="all" :tab="`全部 (${groupCounts.all})`" />
      <n-tab-pane name="ungrouped" :tab="`未分组 (${groupCounts.ungrouped})`" />
      <n-tab-pane
        v-for="group in subscriptionGroupStore.groups"
        :key="group.id"
        :name="group.id"
      >
        <template #tab>
          <div
            class="group-tab-wrapper"
            @click.prevent="handleTabClick(group, $event)"
            @contextmenu.prevent="handleContextMenu(group, $event)"
          >
            <span :style="{ color: group.is_enabled ? '' : '#999', marginRight: '8px' }">
              {{ group.name }} ({{ groupCounts[group.id] || 0 }})
            </span>
            <n-button text class="group-actions-button">
              <n-icon :component="MoreIcon" />
            </n-button>
          </div>
        </template>
      </n-tab-pane>
    </n-tabs>

    <n-dropdown
      placement="bottom-start"
      trigger="manual"
      :x="dropdownX"
      :y="dropdownY"
      :options="activeDropdownGroup ? getDropdownOptions(activeDropdownGroup) : []"
      :show="showDropdown"
      @select="handleGroupAction"
      @clickoutside="showDropdown = false"
    />

    <n-data-table
      :columns="columns"
      :data="filteredSubscriptions"
      :loading="loading"
      :pagination="{ pageSize: 10 }"
      :bordered="false"
      class="mt-4"
      v-model:checked-row-keys="checkedRowKeys"
      :row-key="(row: Subscription) => row.id"
      :scroll-x="1800"
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
        <n-form-item label="导入到分组">
          <n-select
            v-model:value="importGroupId"
            placeholder="默认导入到“未分组”"
            :options="subscriptionGroupStore.groups.map(g => ({ label: g.name, value: g.id }))"
            clearable
          />
        </n-form-item>
        <n-space justify="end">
          <n-button @click="showImportModal = false">取消</n-button>
          <n-button type="primary" @click="handleBulkImport" :loading="importLoading">导入</n-button>
        </n-space>
      </n-form>
    </n-modal>


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
        <n-form-item v-if="ruleFormState.type === 'filter_by_name_keyword' || ruleFormState.type === 'exclude_by_name_keyword'" label="关键词" required>
          <n-dynamic-tags v-model:value="ruleFormState.keywords" />
          <template #feedback>
            <span v-if="ruleFormState.type === 'filter_by_name_keyword'">保留节点名包含任意一个关键词的节点。输入后按回车确认。</span>
            <span v-else>排除节点名包含任意一个关键词的节点。输入后按回车确认。</span>
          </template>
          
          <div class="mt-2">
            <p class="text-xs text-gray-500 mb-1">常用标签 (点击添加):</p>
            <n-space :size="'small'" style="flex-wrap: wrap;">
              <n-tag
                v-for="keyword in commonKeywords"
                :key="keyword"
                size="small"
                :bordered="false"
                type="info"
                style="cursor: pointer;"
                @click="addKeyword(keyword)"
              >
                {{ keyword }}
              </n-tag>
            </n-space>
          </div>
        </n-form-item>

        <n-form-item v-else-if="ruleFormState.type === 'rename_by_regex'" label="重命名规则" required>
          <n-space vertical style="width: 100%;">
            <n-input v-model:value="ruleFormState.renameRegex" placeholder="匹配规则 (Regex)" />
            <div class="text-xs text-gray-400 mt-1">
              <p>示例 1: 从 "[HK] Node 01" 提取 "HK" 和 "01", 可用 `^\[(.*)\]\s.*(\d+)$`</p>
              <p>示例 2: 提取 "HK-专线-01" 中的 "HK" 和 "专线", 可用 `(HK)-(专线)`</p>
            </div>
            <n-input v-model:value="ruleFormState.renameFormat" placeholder="重命名格式" class="mt-2" />
            <div class="text-xs text-gray-400 mt-1">
              <p>用法: `$1`, `$2` 代表上方匹配规则中的第1、2个括号捕获的内容。</p>
              <p>示例 1: `NewName-$1-$2` 会得到 "NewName-HK-01"。</p>
              <p>示例 2: `[$2] $1` 会得到 "[专线] HK"。</p>
            </div>
          </n-space>
        </n-form-item>

        <n-form-item v-else-if="ruleFormState.type === 'filter_by_name_regex'" label="正则表达式" required>
          <n-input
            v-model:value="ruleFormState.regex"
            placeholder="输入用于过滤的正则表达式"
          />
          <template #feedback>
            <p>保留节点名匹配正则表达式的节点。</p>
            <p><b>用法示例:</b></p>
            <ul class="list-disc list-inside">
              <li>匹配多个关键词 (香港或澳门): `香港|澳门`</li>
              <li>匹配IEPL且不含广州: `IEPL.*(?!广州)`</li>
              <li>不区分大小写匹配 "iepl": `(?i)iepl`</li>
              <li>匹配包含 "VIP" 但不包含 "过期" 的节点: `^(?=.*VIP)(?!.*过期)`</li>
            </ul>
          </template>
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

    <n-modal
      v-model:show="showMoveToGroupModal"
      preset="card"
      title="移动订阅到分组"
      style="width: 400px;"
      :mask-closable="false"
    >
      <n-form @submit.prevent="handleMoveToGroup">
        <n-form-item label="目标分组" required>
          <n-select
            v-model:value="moveToGroupId"
            placeholder="请选择目标分组（可清空变为未分组）"
            :options="subscriptionGroupStore.groups.map(g => ({ label: g.name, value: g.id }))"
            clearable
          />
        </n-form-item>
        <n-space justify="end">
          <n-button @click="showMoveToGroupModal = false">取消</n-button>
          <n-button type="primary" @click="handleMoveToGroup" :loading="moveToGroupLoading">确认移动</n-button>
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

    <n-modal
      v-model:show="showUpdateLogModal"
      preset="card"
      title="更新日志"
      style="width: 600px;"
      :mask-closable="false"
    >
      <div v-if="updateLogLoading" class="text-center mb-4">
        <n-progress
          type="line"
          :percentage="updateProgress.total > 0 ? Math.floor((updateProgress.current / updateProgress.total) * 100) : 0"
          :indicator-placement="'inside'"
          processing
        />
        <p class="mt-2">正在更新: {{ updateProgress.current }} / {{ updateProgress.total }}</p>
      </div>
      <n-collapse>
        <n-collapse-item :title="`更新成功 (${updateLog.success.length})`" name="success">
          <div style="max-height: 200px; overflow-y: auto;">
            <n-tag v-for="sub in updateLog.success" :key="sub.name" type="success" class="m-1">
              {{ sub.name }}
            </n-tag>
            <n-text v-if="updateLog.success.length === 0">没有订阅成功更新。</n-text>
          </div>
        </n-collapse-item>
        <n-collapse-item :title="`更新失败 (${updateLog.failed.length})`" name="failed">
           <div style="max-height: 200px; overflow-y: auto;">
            <div v-if="updateLog.failed.length > 0">
              <div v-for="sub in updateLog.failed" :key="sub.id" class="mb-2 p-2 border rounded">
                 <div class="flex justify-between items-center">
                   <n-tag type="error">{{ sub.name }}</n-tag>
                   <n-space :size="4">
                     <n-tag v-if="sub.remaining_traffic !== null && sub.remaining_traffic !== undefined" size="small" :type="sub.remaining_traffic === 0 ? 'error' : 'default'">
                       流量: {{ formatBytes(sub.remaining_traffic) }}
                     </n-tag>
                      <n-tag v-if="sub.remaining_days !== null && sub.remaining_days !== undefined" size="small" :type="sub.remaining_days === 0 ? 'error' : 'default'">
                       天数: {{ sub.remaining_days }} 天
                     </n-tag>
                   </n-space>
                 </div>
                 <n-text class="text-xs text-gray-500 mt-1 block">{{ sub.error }}</n-text>
              </div>
            </div>
            <n-text v-else>没有订阅更新失败。</n-text>
          </div>
        </n-collapse-item>
      </n-collapse>
      <template #footer>
        <n-space justify="end">
          <n-button @click="handleCancelUpdate">{{ updateLogLoading ? '中止' : '关闭' }}</n-button>
          <n-button
            type="primary"
            ghost
            @click="handleRetryFailed"
            :disabled="updateLog.failed.filter(s => s.error !== '已中止').length === 0 || updateLogLoading"
            :loading="updateLogLoading"
          >
            重试失败的订阅
          </n-button>
           <n-button
            type="error"
            ghost
            @click="handleClearFailed"
            :disabled="updateLog.failed.filter(s => s.error || s.remaining_traffic === 0 || (s.remaining_days !== null && s.remaining_days !== undefined && s.remaining_days <= 0)).length === 0 || updateLogLoading"
          >
            清除失效订阅
          </n-button>
        </n-space>
      </template>
    </n-modal>

  </div>
</template>

<style scoped>
.group-tab-wrapper {
  display: flex;
  align-items: center;
  padding: 0 4px;
}

.group-actions-button {
  opacity: 0.5;
  transition: opacity 0.2s;
}

.group-tab-wrapper:hover .group-actions-button {
  opacity: 1;
}
</style>