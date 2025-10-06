<template>
  <div>
    <n-space justify="space-between" align="center" class="mb-4">
      <h3 class="text-lg font-semibold">{{ title }}</h3>
      <n-button type="primary" @click="openModal(null)">添加新{{ assetName }}</n-button>
    </n-space>

    <n-data-table
      :columns="columns"
      :data="assets"
      :loading="loading"
      :row-key="row => row.id"
    />

    <n-modal v-model:show="showModal" preset="card" style="width: 600px;" :title="modalTitle">
      <n-form ref="formRef" :model="currentAsset" :rules="rules">
        <n-form-item label="名称" path="name">
          <n-input v-model:value="currentAsset.name" placeholder="为此资源指定一个易于识别的名称" />
        </n-form-item>
        <n-form-item label="URL" path="url">
          <n-input v-model:value="currentAsset.url" placeholder="输入完整的 URL 地址" />
        </n-form-item>
        <n-form-item>
          <n-button type="primary" @click="handleSave" :loading="saveLoading">保存</n-button>
        </n-form-item>
      </n-form>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, h } from 'vue';
import {
  NButton, NDataTable, NSpace, NModal, NForm, NFormItem, NInput, useMessage, NPopconfirm, NIcon, NTooltip
} from 'naive-ui';
import { Star as StarIcon, StarOutline as StarOutlineIcon } from '@vicons/ionicons5';
import type { DataTableColumns } from 'naive-ui';
import { api } from '@/utils/api';
import { useAuthStore } from '@/stores/auth';

type SubconverterAsset = {
  id: number;
  name: string;
  url: string;
  type: 'backend' | 'config';
};

type UserDefaults = {
  default_backend_id?: number;
  default_config_id?: number;
};

const props = defineProps<{
  assetType: 'backend' | 'config';
  title: string;
  assetName: string;
}>();

const emit = defineEmits(['assets-updated']);

const authStore = useAuthStore();
const message = useMessage();
const assets = ref<SubconverterAsset[]>([]);
const userDefaults = ref<UserDefaults>({});
const loading = ref(true);
const showModal = ref(false);
const saveLoading = ref(false);
const formRef = ref<any>(null);

const isAdmin = computed(() => authStore.user?.role === 'admin');

const defaultAsset: Omit<SubconverterAsset, 'id'> = {
  name: '',
  url: '',
  type: props.assetType,
};

const currentAsset = ref<Partial<SubconverterAsset>>({ ...defaultAsset });

const modalTitle = computed(() => (currentAsset.value.id ? `编辑${props.assetName}` : `添加${props.assetName}`));

const rules = {
  name: { required: true, message: '请输入名称', trigger: 'blur' },
  url: { required: true, message: '请输入 URL', trigger: 'blur' },
};

const fetchUserDefaults = async () => {
  if (!authStore.isAuthenticated) return;
  try {
    const response = await api.get('/user/defaults');
    if (response.data.success) {
      userDefaults.value = response.data.data;
    }
  } catch (error) {
    console.warn('Could not fetch user defaults.', error);
  }
};

const fetchAssets = async () => {
  if (!authStore.isAuthenticated) return;
  loading.value = true;
  try {
    const response = await api.get(`/assets?type=${props.assetType}`);
    if (response.data.success) {
      assets.value = response.data.data;
      emit('assets-updated', assets.value);
    }
  } catch (error) {
    message.error('加载资源列表失败');
  } finally {
    loading.value = false;
  }
};

const openModal = (asset: SubconverterAsset | null) => {
  if (asset) {
    currentAsset.value = { ...asset };
  } else {
    currentAsset.value = { ...defaultAsset, type: props.assetType };
  }
  showModal.value = true;
};

const handleSave = async () => {
  await formRef.value?.validate();
  saveLoading.value = true;
  try {
    if (currentAsset.value.id) {
      await api.put(`/assets/${currentAsset.value.id}`, currentAsset.value);
      message.success('更新成功');
    } else {
      await api.post('/assets', currentAsset.value);
      message.success('添加成功');
    }
    showModal.value = false;
    await fetchAssets();
  } catch (error: any) {
    message.error(error.response?.data?.message || '保存失败');
  } finally {
    saveLoading.value = false;
  }
};

const handleDelete = async (id: number) => {
  try {
    await api.delete(`/assets/${id}`);
    message.success('删除成功');
    await fetchAssets();
  } catch (error: any) {
    message.error(error.response?.data?.message || '删除失败');
  }
};

const handleSetDefault = async (id: number) => {
  const payload: Partial<UserDefaults> = {};
  if (props.assetType === 'backend') {
    payload.default_backend_id = id;
  } else {
    payload.default_config_id = id;
  }

  try {
    await api.put('/user/defaults', payload);
    message.success('默认设置成功');
    await fetchUserDefaults(); // Refresh defaults state
  } catch (error) {
    message.error('设置默认失败');
  }
};

const isDefault = (row: SubconverterAsset) => {
  if (props.assetType === 'backend') {
    return userDefaults.value.default_backend_id === row.id;
  }
  return userDefaults.value.default_config_id === row.id;
};

const createColumns = (): DataTableColumns<SubconverterAsset> => [
  {
    title: '默认',
    key: 'is_default',
    width: 60,
    align: 'center',
    render(row) {
      const isRowDefault = isDefault(row);
      return h(NTooltip, null, {
        trigger: () => h(NButton, {
          quaternary: true,
          circle: true,
          onClick: () => handleSetDefault(row.id),
          disabled: isRowDefault,
        }, {
          icon: () => h(NIcon, {
            component: isRowDefault ? StarIcon : StarOutlineIcon,
            color: isRowDefault ? '#fdd835' : undefined,
            size: 20
          })
        }),
        default: () => isRowDefault ? '当前默认项' : '设为默认'
      });
    }
  },
  {
    title: '名称',
    key: 'name',
  },
  {
    title: 'URL',
    key: 'url',
    ellipsis: {
      tooltip: true,
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 150,
    render(row) {
      if (!isAdmin.value) return null;

      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'small', onClick: () => openModal(row) }, { default: () => '编辑' }),
          h(NPopconfirm,
            { onPositiveClick: () => handleDelete(row.id) },
            {
              trigger: () => h(NButton, { size: 'small', type: 'error', ghost: true }, { default: () => '删除' }),
              default: () => '确定要删除这个资源吗？'
            }
          ),
        ]
      });
    },
  },
];

const columns = createColumns();

onMounted(async () => {
  await fetchUserDefaults();
  await fetchAssets();
});
</script>