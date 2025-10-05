<template>
  <div class="page-container">
    <n-page-header @back="router.back">
      <template #title>
        <n-spin :show="loadingProfile">
          管理处理规则: {{ profile?.name || '...' }}
        </n-spin>
      </template>
      <template #extra>
        <n-dropdown
          trigger="click"
          :options="unitTypeOptions"
          @select="handleCreateUnit"
        >
          <n-button type="primary">
            <template #icon>
              <n-icon :component="AddIcon" />
            </template>
            Add Processing Unit
          </n-button>
        </n-dropdown>
      </template>
    </n-page-header>

    <div v-if="loadingUnits" class="loading-container">
      <n-spin size="large" />
    </div>
    <div v-else-if="units.length === 0" class="empty-state">
      <n-empty description="该配置下暂无处理规则，请点击右上角添加。" />
    </div>
    <draggable
      v-else
      v-model="units"
      class="units-list"
      item-key="id"
      handle=".unit-card"
      @end="onDragEnd"
    >
      <template #item="{ element: unit }">
        <n-card class="unit-card" :title="unit.type">
          <template #header-extra>
              <n-space>
                <n-switch :value="unit.is_enabled === 1" @update:value="(val) => toggleUnitEnabled(unit, val)" />
                <n-button size="small" circle @click="handleEditUnit(unit)">
                  <template #icon><n-icon :component="EditIcon" /></template>
                </n-button>
                <n-button size="small" circle type="error" @click="handleDeleteUnit(unit)">
                  <template #icon><n-icon :component="DeleteIcon" /></template>
                </n-button>
              </n-space>
          </template>
          <pre>{{ unit.config }}</pre>
        </n-card>
      </template>
    </draggable>

    <n-modal
      v-model:show="showModal"
      preset="card"
      :title="isEditing ? 'Edit Unit' : 'Add New Unit'"
      style="width: 600px;"
      :mask-closable="false"
    >
      <n-form ref="formRef" :model="currentUnit" label-placement="top">
        <n-form-item label="Unit Type" path="type">
          <n-select
            v-model:value="currentUnit.type"
            placeholder="Select unit type"
            :options="unitTypeOptions"
            :disabled="isEditing"
          />
        </n-form-item>
        
        <!-- Dynamic form for config -->
        <div v-if="currentUnit.type === 'FILTER_BY_KEYWORD'">
            <n-form-item label="Keywords (comma-separated)" path="config.keywords">
                <n-input v-model:value="currentUnit.config.keywords" placeholder="e.g., HK,JP,US" />
            </n-form-item>
            <n-form-item label="Exclude Mode">
                <n-switch v-model:value="currentUnit.config.exclude" />
            </n-form-item>
        </div>

        <div v-if="currentUnit.type === 'FILTER_BY_REGEX'">
            <n-form-item label="Regex Pattern" path="config.pattern">
                <n-input v-model:value="currentUnit.config.pattern" placeholder="e.g., US|SG" />
            </n-form-item>
            <n-form-item label="Exclude Mode">
                <n-switch v-model:value="currentUnit.config.exclude" />
            </n-form-item>
        </div>

        <div v-if="currentUnit.type === 'SORT_BY_NAME'">
            <n-form-item label="Direction" path="config.direction">
                 <n-radio-group v-model:value="currentUnit.config.direction" name="radiogroup">
                    <n-space>
                        <n-radio value="asc">Ascending</n-radio>
                        <n-radio value="desc">Descending</n-radio>
                    </n-space>
                </n-radio-group>
            </n-form-item>
        </div>

        <div v-if="currentUnit.type === 'RENAME_BY_REGEX'">
            <n-form-item label="Regex Pattern" path="config.pattern">
                <n-input v-model:value="currentUnit.config.pattern" placeholder="e.g., ^.*(US).*" />
            </n-form-item>
            <n-form-item label="Replacement String" path="config.replace">
                <n-input v-model:value="currentUnit.config.replace" placeholder="e.g., $1 Node" />
            </n-form-item>
        </div>

        <div v-if="currentUnit.type === 'SORT_BY_HEALTH'">
            <n-form-item label="Direction" path="config.direction">
                 <n-radio-group v-model:value="currentUnit.config.direction" name="radiogroup">
                    <n-space>
                        <n-radio value="healthy-first">Healthy First</n-radio>
                        <n-radio value="unhealthy-first">Unhealthy First</n-radio>
                    </n-space>
                </n-radio-group>
            </n-form-item>
            <n-form-item label="Sort by Latency (for healthy nodes)">
                <n-switch v-model:value="currentUnit.config.sortByLatency" />
            </n-form-item>
        </div>

        <div v-if="currentUnit.type === 'FILTER_BY_REGION'">
            <n-form-item label="Region Codes (comma-separated)" path="config.codes">
                <n-input v-model:value="currentUnit.config.codes" placeholder="e.g., US,JP,HK" />
            </n-form-item>
            <n-form-item label="Exclude Mode">
                <n-switch v-model:value="currentUnit.config.exclude" />
            </n-form-item>
        </div>

      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showModal = false">Cancel</n-button>
          <n-button type="primary" @click="handleSaveUnit" :loading="saveLoading">Save</n-button>
        </n-space>
      </template>
    </n-modal>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, h, watch, computed } from 'vue';
import { useRouter } from 'vue-router';
import draggable from 'vuedraggable';
import {
  NPageHeader,
  NButton,
  NSpace,
  NIcon,
  NSpin,
  NEmpty,
  NCard,
  NSwitch,
  NModal,
  NForm,
  NFormItem,
  NSelect,
  NInput,
  NGrid,
  NGi,
  NDataTable,
  NDropdown,
  NRadioGroup,
  NRadio,
  useDialog,
  useMessage,
} from 'naive-ui';
import type { FormInst, DataTableColumns } from 'naive-ui';
import { NTag } from 'naive-ui';
import { Add as AddIcon, Pencil as EditIcon, TrashBinOutline as DeleteIcon } from '@vicons/ionicons5';
import { useApi } from '@/composables/useApi';
import type { Profile, ProcessingUnit, Node } from '@/types';

const props = defineProps<{
  id: string;
}>();

const router = useRouter();
const api = useApi();
const dialog = useDialog();
const message = useMessage();

const profile = ref<Profile | null>(null);
const units = ref<ProcessingUnit[]>([]);
const loadingProfile = ref(false);
const loadingUnits = ref(false);
const saveLoading = ref(false);

const showModal = ref(false);
const isEditing = ref(false);
const formRef = ref<FormInst | null>(null);
const currentUnit = ref<Partial<ProcessingUnit>>({});

const unitTypeOptions = [
    { label: 'Filter by Keyword', key: 'FILTER_BY_KEYWORD' },
    { label: 'Filter by Regex', key: 'FILTER_BY_REGEX' },
    { label: 'Sort by Name', key: 'SORT_BY_NAME' },
    { label: 'Sort by Health', key: 'SORT_BY_HEALTH' },
    { label: 'Rename by Regex', key: 'RENAME_BY_REGEX' },
    { label: 'Filter by Region', key: 'FILTER_BY_REGION' },
];


const fetchProfile = async () => {
  loadingProfile.value = true;
  try {
    const response = await api.get<Profile>(`/profiles/${props.id}`);
    if (response.success && response.data) {
      profile.value = response.data;
    } else {
      message.error('Failed to fetch profile details.');
    }
  } catch (error) {
    message.error('An error occurred while fetching profile details.');
  } finally {
    loadingProfile.value = false;
  }
};

const fetchUnits = async () => {
  loadingUnits.value = true;
  try {
    const response = await api.get<ProcessingUnit[]>(`/profiles/${props.id}/processing_units`);
    if (response.success && response.data) {
      units.value = response.data;
    } else {
      message.error('Failed to fetch processing units.');
    }
  } catch (error) {
    message.error('An error occurred while fetching processing units.');
  } finally {
    loadingUnits.value = false;
  }
};


const handleCreateUnit = (type: 'FILTER_BY_KEYWORD' | 'SORT_BY_NAME' | 'RENAME_BY_REGEX' | 'FILTER_BY_REGEX' | 'SORT_BY_HEALTH' | 'FILTER_BY_REGION') => {
    isEditing.value = false;
    let config = {};
    switch (type) {
        case 'FILTER_BY_KEYWORD':
            config = { keywords: '', exclude: false };
            break;
        case 'FILTER_BY_REGEX':
            config = { pattern: '', exclude: false };
            break;
        case 'SORT_BY_NAME':
            config = { direction: 'asc' };
            break;
        case 'SORT_BY_HEALTH':
            config = { direction: 'healthy-first', sortByLatency: true };
            break;
        case 'RENAME_BY_REGEX':
            config = { pattern: '', replace: '' };
            break;
        case 'FILTER_BY_REGION':
            config = { codes: '', exclude: false };
            break;
    }
    currentUnit.value = { type, config, is_enabled: 1 };
    showModal.value = true;
};

const handleEditUnit = (unit: ProcessingUnit) => {
    isEditing.value = true;
    currentUnit.value = JSON.parse(JSON.stringify(unit));
    showModal.value = true;
};

const handleSaveUnit = async () => {
    formRef.value?.validate(async (errors) => {
        if (errors) return;

        saveLoading.value = true;
        try {
            const payload = {
                type: currentUnit.value.type,
                config: currentUnit.value.config,
                is_enabled: currentUnit.value.is_enabled,
                order_index: currentUnit.value.order_index ?? units.value.length,
                profile_id: props.id,
            };

            const response = isEditing.value
                ? await api.put(`/processing-units/${currentUnit.value.id}`, payload)
                : await api.post(`/processing-units`, payload);

            if (response.success) {
                message.success(`Unit ${isEditing.value ? 'updated' : 'created'} successfully.`);
                showModal.value = false;
                await fetchUnits();
            } else {
                message.error(response.message || 'Failed to save unit.');
            }
        } catch (error: any) {
            message.error(error.message || 'An unknown error occurred.');
        } finally {
            saveLoading.value = false;
        }
    });
};

const handleDeleteUnit = (unit: ProcessingUnit) => {
    dialog.warning({
        title: 'Confirm Deletion',
        content: `Are you sure you want to delete the unit "${unit.type}"?`,
        positiveText: 'Delete',
        negativeText: 'Cancel',
        onPositiveClick: async () => {
            try {
                const response = await api.delete(`/processing-units/${unit.id}`);
                if (response.success) {
                    message.success('Unit deleted successfully.');
                    await fetchUnits();
                } else {
                    message.error(response.message || 'Failed to delete unit.');
                }
            } catch (error: any) {
                message.error(error.message || 'An unknown error occurred.');
            }
        },
    });
};

const toggleUnitEnabled = async (unit: ProcessingUnit, enabled: boolean) => {
    const originalState = unit.is_enabled;
    unit.is_enabled = enabled ? 1 : 0;

    try {
        const response = await api.put(`/processing-units/${unit.id}`, { is_enabled: enabled });
        if (!response.success) {
            unit.is_enabled = originalState;
            message.error(response.message || 'Failed to update unit status.');
        } else {
            message.success('Unit status updated.');
        }
    } catch (error: any) {
        unit.is_enabled = originalState;
        message.error(error.message || 'An unknown error occurred.');
    }
};

const onDragEnd = async () => {
    // Re-fetch units to get the new order from the server
    await fetchUnits();
    const unitIds = units.value.map(u => u.id);
    try {
        // This API endpoint needs to be created in the backend.
        // It should accept a list of unit IDs in the desired order.
        const response = await api.post(`/processing-units/batch-update-order`, { unit_ids: unitIds });
        if (response.success) {
            message.success('Pipeline order updated.');
        } else {
            message.error(response.message || 'Failed to update order.');
            fetchUnits(); // Revert order on failure
        }
    } catch (error: any) {
        message.error(error.message || 'An error occurred while updating order.');
        fetchUnits();
    }
};

onMounted(() => {
  fetchProfile();
  fetchUnits();
});
</script>

<style scoped>
.page-container {
  padding: 24px;
}
.main-content {
    margin-top: 24px;
}
.loading-container, .empty-state {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 50vh;
}
.empty-state-inner {
    height: 40vh;
    display: flex;
    justify-content: center;
    align-items: center;
}
.units-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.unit-card {
    cursor: grab;
}
</style>