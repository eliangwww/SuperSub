import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useAuthStore } from './auth'
import { HealthStatus } from '@/types'
import { useMessage } from 'naive-ui'

export const useNodeStatusStore = defineStore('nodeStatus', () => {
  const statuses = ref<Record<string, HealthStatus>>({})
  const loading = ref(false)
  const authStore = useAuthStore()
  // const message = useMessage() // This cannot be called at the top level of a store.

  const getStatusByNodeId = computed(() => {
    return (nodeId: string) => statuses.value[nodeId]
  })

  const fetchStatuses = async () => {
    if (!authStore.token) return

    loading.value = true
    try {
      const response = await fetch('/api/node-statuses', {
        headers: { 'Authorization': `Bearer ${authStore.token}` }
      })
      const result: { success: boolean, data?: HealthStatus[], message?: string } = await response.json()
      if (result.success && result.data) {
        const newStatuses: Record<string, HealthStatus> = {}
        for (const status of result.data) {
          newStatuses[status.node_id] = status
        }
        statuses.value = newStatuses
      } else {
        // Do not show error message on every fetch, as it can be annoying during polling
        console.error('Failed to fetch node statuses:', result.message)
      }
    } catch (err) {
      console.error('Error fetching node statuses:', err)
    } finally {
      loading.value = false
    }
  }

  const checkNodesHealth = async (nodeIds: string[]): Promise<{ success: boolean; message: string }> => {
    if (!authStore.token || nodeIds.length === 0) {
      return { success: false, message: '未选择节点或用户未认证' }
    }

    try {
      const response = await fetch('/api/nodes/health-check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authStore.token}`
        },
        body: JSON.stringify({ nodeIds })
      })
      const result: { success: boolean, message?: string } = await response.json()
      if (response.ok && result.success) {
        // After initiating the check, wait a bit and then refresh the statuses
        setTimeout(() => {
          fetchStatuses()
        }, 3000) // Wait 3 seconds before the first refresh
        return { success: true, message: result.message || '节点健康检查已启动' }
      } else {
        return { success: false, message: result.message || '启动健康检查失败' }
      }
    } catch (err) {
      return { success: false, message: '请求健康检查失败' }
    }
  }


  return {
    statuses,
    loading,
    getStatusByNodeId,
    fetchStatuses,
    checkNodesHealth,
  }
})