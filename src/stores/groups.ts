import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useAuthStore } from './auth';
import { useApi } from '@/composables/useApi';

export interface NodeGroup {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export const useGroupStore = defineStore('groups', () => {
  const groups = ref<NodeGroup[]>([]);
  const loading = ref(false);
  const authStore = useAuthStore();

  async function fetchGroups() {
    const api = useApi();
    if (!authStore.token) return;
    loading.value = true;
    try {
      const response = await api.get('/groups');
      if (response.success && Array.isArray(response.data)) {
        groups.value = response.data;
      }
    } catch (error) {
      console.error('Failed to fetch groups:', error);
    } finally {
      loading.value = false;
    }
  }

  async function addGroup(name: string) {
    if (groups.value.length >= 10) {
      return { success: false, message: '最多只能创建10个分组。' };
    }
    const api = useApi();
    const response = await api.post('/groups', { name });
    if (response.success) {
      await fetchGroups(); // Refresh the list
    }
    return response;
  }

  async function updateGroup(id: string, name: string) {
    const api = useApi();
    const response = await api.put(`/groups/${id}`, { name });
    if (response.success) {
      await fetchGroups();
    }
    return response;
  }

  async function deleteGroup(id: string) {
    const api = useApi();
    const response = await api.delete(`/groups/${id}`);
    if (response.success) {
      await fetchGroups();
    }
    return response;
  }

  async function toggleGroup(id: string) {
    const api = useApi();
    const response = await api.patch(`/groups/${id}/toggle`, {});
    if (response.success) {
      await fetchGroups();
    }
    return response;
  }
  
  async function updateGroupOrder(groupIds: string[]) {
    const api = useApi();
    return await api.post('/groups/update-order', { groupIds });
  }

  return {
    groups,
    loading,
    fetchGroups,
    addGroup,
    updateGroup,
    deleteGroup,
    toggleGroup,
    updateGroupOrder,
  };
});