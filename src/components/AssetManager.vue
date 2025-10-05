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
import { ref, onMounted, computed, h, reactive } from 'vue';
import {
  NButton, NDataTable, NSpace, NModal, NCard, NForm, NFormItem, NInput, useMessage, NPopconfirm
} from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { api } from '@/utils/api';

type SubconverterAsset = {
  id: number;
  name: string;
  url: string;
  type: 'backend' | 'config';
};

const props = defineProps<{
  assetType: 'backend' | 'config';
  title: string;
  assetName: string;
}>();

const emit = defineEmits(['assets-updated']);

const message = useMessage();
const assets = ref<SubconverterAsset[]>([]);
const loading = ref(true);
const showModal = ref(false);
const saveLoading = ref(false);
const formRef = ref<any>(null);

const defaultAsset: SubconverterAsset = {
  id: 0,
  name: '',
  url: '',
  type: props.assetType,
};

const currentAsset = ref<SubconverterAsset>({ ...defaultAsset });

const modalTitle = computed(() => (currentAsset.value.id ? `编辑${props.assetName}` : `添加${props.assetName}`));

const rules = {
  name: { required: true, message: '请输入名称', trigger: 'blur' },
  url: { required: true, message: '请输入 URL', trigger: 'blur' },
};

const fetchAssets = async () => {
  loading.value = true;
  try {
    const response = await api.get('/subconverter-assets');
    if (response.data.success) {
      assets.value = response.data.data.filter((asset: SubconverterAsset) => asset.type === props.assetType);
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
      // Update
      await api.put(`/subconverter-assets/${currentAsset.value.id}`, currentAsset.value);
      message.success('更新成功');
    } else {
      // Create
      await api.post('/subconverter-assets', currentAsset.value);
      message.success('添加成功');
    }
    showModal.value = false;
    await fetchAssets();
  } catch (error) {
    message.error('保存失败');
  } finally {
    saveLoading.value = false;
  }
};

const handleDelete = async (id: number) => {
  try {
    await api.delete(`/subconverter-assets/${id}`);
    message.success('删除成功');
    await fetchAssets();
  } catch (error) {
    message.error('删除失败');
  }
};

const createColumns = (): DataTableColumns<SubconverterAsset> => [
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
    render(row) {
      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'small', onClick: () => openModal(row) }, { default: () => '编辑' }),
          h(NPopconfirm,
            { onPositiveClick: () => handleDelete(row.id) },
            {
              trigger: () => h(NButton, { size: 'small', type: 'error' }, { default: () => '删除' }),
              default: () => '确定要删除这个资源吗？'
            }
          ),
        ],
      });
    },
  },
];

const columns = createColumns();

onMounted(fetchAssets);
</script>