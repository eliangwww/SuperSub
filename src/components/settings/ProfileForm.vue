<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useMessage, NButton, NSpace, NForm, NFormItem, NInput, NIcon, NSelect, NDivider, NCard, NGrid, NGi, NCheckboxGroup, NCheckbox, NScrollbar, NTabs, NTabPane, NCollapse, NCollapseItem, NSwitch } from 'naive-ui';
import { CopyOutline as CopyIcon } from '@vicons/ionicons5';
import type { FormInst } from 'naive-ui';
import type { Profile, Subscription } from '@/types';
import { api } from '@/utils/api';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{
  profileId?: string | null;
}>();

const emit = defineEmits(['save-success']);

const message = useMessage();
const authStore = useAuthStore();

const formRef = ref<FormInst | null>(null);
const saveLoading = ref(false);
const loadingData = ref(false);

const allGroupedSubscriptions = ref<Record<string, { id: string; name: string }[]>>({});
const allManualNodes = ref<Record<string, { id: string; name: string }[]>>({});
const allBackends = ref<any[]>([]);
const allConfigs = ref<any[]>([]);
const subToken = computed(() => authStore.user?.sub_token || '');

const subFilter = ref('');
const nodeFilter = ref('');

const defaultFormState = () => ({
  id: '',
  name: '',
  alias: '',
  subscription_ids: [] as string[],
  node_ids: [] as string[],
  airport_subscription_options: {
    polling_mode: 'none' as 'none' | 'hourly' | 'request',
    random: false,
  },
  node_prefix_settings: {
    enable_subscription_prefix: false,
    manual_node_prefix: '',
    enable_group_name_prefix: false,
  },
  subconverter_backend_id: null as number | null,
  subconverter_config_id: null as number | null,
});

const formState = reactive(defaultFormState());

const rules = {
  name: { required: true, message: '请输入名称', trigger: ['input', 'blur'] },
};

const generatedUrl = computed(() => {
  if (!subToken.value || !formState.alias) return '';
  return `${window.location.origin}/api/public/${subToken.value}/${formState.alias}`;
});

const copyGeneratedUrl = () => {
  if (generatedUrl.value) {
    navigator.clipboard.writeText(generatedUrl.value).then(() => message.success('链接已复制'));
  }
};

// --- Data Fetching ---
const fetchAllSources = async () => {
  if (!authStore.isAuthenticated) return;
  try {
    const [subsRes, nodesRes, backendRes, configRes] = await Promise.all([
      api.get<any>('/subscriptions/grouped'),
      api.get<any>('/nodes/grouped'),
      api.get<any>('/assets?type=backend'),
      api.get<any>('/assets?type=config'),
    ]);
    if (subsRes.data.success) allGroupedSubscriptions.value = subsRes.data.data || {};
    if (nodesRes.data.success) allManualNodes.value = nodesRes.data.data || {};
    if (backendRes.data.success) allBackends.value = backendRes.data.data || [];
    if (configRes.data.success) allConfigs.value = configRes.data.data || [];
  } catch (err) {
    message.error("获取订阅、节点或模板资源失败");
  }
};

const fetchProfileData = async (id: string) => {
  loadingData.value = true;
  try {
    const response = await api.get<any>(`/profiles/${id}`);
    if (response.data.success) {
      const profile = response.data.data;
      // The full profile data including content is in the response.
      // We need to assign values from the profile and its content to the formState.
      formState.id = profile.id;
      formState.name = profile.name;
      formState.alias = profile.alias || '';
      
      // Values from the parsed 'content' field
      formState.subscription_ids = profile.subscription_ids || [];
      formState.node_ids = profile.node_ids || [];
      formState.node_prefix_settings = { ...defaultFormState().node_prefix_settings, ...profile.node_prefix_settings };
      formState.airport_subscription_options = {
        polling_mode: profile.airport_subscription_options?.polling ? (profile.airport_subscription_options.polling_mode || 'hourly') : 'none',
        random: profile.airport_subscription_options?.random || false,
      };
      formState.subconverter_backend_id = profile.subconverter_backend_id || null;
      formState.subconverter_config_id = profile.subconverter_config_id || null;
    } else {
      message.error('获取配置详情失败');
    }
  } catch (error) {
    message.error('请求配置详情失败');
  } finally {
    loadingData.value = false;
  }
};

// --- Checkbox Group Logic ---
const handleSubscriptionGroupSelectAll = (group: { id: string; name: string }[], checked: boolean) => {
  const groupSubIds = group.map(sub => sub.id);
  if (checked) {
    formState.subscription_ids = [...new Set([...formState.subscription_ids, ...groupSubIds])];
  } else {
    formState.subscription_ids = formState.subscription_ids.filter(id => !groupSubIds.includes(id));
  }
};

const isSubscriptionGroupSelected = (group: { id: string; name: string }[]) => {
  const groupSubIds = new Set(group.map(sub => sub.id));
  return group.length > 0 && [...groupSubIds].every(id => formState.subscription_ids.includes(id));
};

const isSubscriptionGroupIndeterminate = (group: { id: string; name: string }[]) => {
  const groupSubIds = new Set(group.map(sub => sub.id));
  const selectedCount = formState.subscription_ids.filter(id => groupSubIds.has(id)).length;
  return selectedCount > 0 && selectedCount < groupSubIds.size;
};

const handleNodeGroupSelectAll = (group: { id: string; name: string }[], checked: boolean) => {
  const groupNodeIds = group.map(node => node.id);
  if (checked) {
    formState.node_ids = [...new Set([...formState.node_ids, ...groupNodeIds])];
  } else {
    formState.node_ids = formState.node_ids.filter(id => !groupNodeIds.includes(id));
  }
};

const isNodeGroupSelected = (group: { id: string; name: string }[]) => {
  const groupNodeIds = new Set(group.map(node => node.id));
  return group.length > 0 && [...groupNodeIds].every(id => formState.node_ids.includes(id));
};

const isNodeGroupIndeterminate = (group: { id: string; name: string }[]) => {
  const groupNodeIds = new Set(group.map(node => node.id));
  const selectedCount = formState.node_ids.filter(id => groupNodeIds.has(id)).length;
  return selectedCount > 0 && selectedCount < groupNodeIds.size;
};

// --- Watchers ---
watch(() => formState.node_prefix_settings.enable_group_name_prefix, (newValue: boolean) => {
  if (newValue) formState.node_prefix_settings.manual_node_prefix = '';
});
watch(() => formState.airport_subscription_options.polling_mode, (newValue: string) => {
  if (newValue !== 'none') formState.airport_subscription_options.random = false;
});
watch(() => formState.airport_subscription_options.random, (newValue: boolean) => {
  if (newValue) formState.airport_subscription_options.polling_mode = 'none';
});

// --- Save Logic ---
const handleSave = async () => {
  formRef.value?.validate(async (errors) => {
    if (errors) {
      message.error('请填写所有必填项');
      return;
    }
    saveLoading.value = true;
    try {
      const contentPayload = {
        subscription_ids: formState.subscription_ids,
        node_ids: formState.node_ids,
        node_prefix_settings: formState.node_prefix_settings,
        airport_subscription_options: {
          polling: formState.airport_subscription_options.polling_mode !== 'none',
          polling_mode: formState.airport_subscription_options.polling_mode,
          random: formState.airport_subscription_options.random,
        },
        subconverter_backend_id: formState.subconverter_backend_id,
        subconverter_config_id: formState.subconverter_config_id,
        generation_mode: 'online',
      };
      const payload = {
        name: formState.name,
        alias: formState.alias || null,
        content: JSON.stringify(contentPayload),
      };
      const response = props.profileId
        ? await api.put<any>(`/profiles/${props.profileId}`, payload)
        : await api.post<any>('/profiles', payload);

      if (response.data.success) {
        message.success(props.profileId ? '配置更新成功' : '配置新增成功');
        emit('save-success');
      } else {
        message.error(response.data.message || '保存失败');
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.message || err.message || '请求失败';
      message.error(errorMsg);
    } finally {
      saveLoading.value = false;
    }
  });
};

onMounted(async () => {
  loadingData.value = true;
  // Ensure all select options are loaded first
  await fetchAllSources();

  if (props.profileId) {
    // Then fetch the specific profile data to populate the form
    await fetchProfileData(props.profileId);
  } else {
    // For new profiles, set defaults after sources are loaded
    const defaultsResponse = await api.get('/user/defaults');
    if (defaultsResponse.data.success && defaultsResponse.data.data) {
      const userDefaults = defaultsResponse.data.data;
      formState.subconverter_backend_id = userDefaults.default_backend_id || null;
      formState.subconverter_config_id = userDefaults.default_config_id || null;
    } else {
      // Fallback to global defaults if user-specific ones aren't available
      const defaultBackend = allBackends.value.find(b => b.is_default);
      const defaultConfig = allConfigs.value.find(c => c.is_default);
      formState.subconverter_backend_id = defaultBackend ? defaultBackend.id : null;
      formState.subconverter_config_id = defaultConfig ? defaultConfig.id : null;
    }
  }
  loadingData.value = false;
});

const backendOptions = computed(() => allBackends.value.map(b => ({ label: b.name, value: b.id })));
const configOptions = computed(() => allConfigs.value.map(c => ({ label: c.name, value: c.id })));

</script>

<template>
  <n-spin :show="loadingData">
    <n-form ref="formRef" :model="formState" :rules="rules">
      <n-grid :cols="5" :x-gap="24">
        <!-- Left Column -->
        <n-gi :span="2">
          <n-space vertical size="large">
            <n-card title="核心定义">
              <n-form-item label="配置名称" path="name">
                <n-input v-model:value="formState.name" />
              </n-form-item>
              <n-form-item label="链接别名">
                <n-input v-model:value="formState.alias" placeholder="例如 my-clash-config" />
              </n-form-item>
              <n-form-item v-if="generatedUrl" label="生成链接">
                <n-input :value="generatedUrl" readonly>
                  <template #suffix>
                    <n-button text @click="copyGeneratedUrl">
                      <n-icon :component="CopyIcon" />
                    </n-button>
                  </template>
                </n-input>
              </n-form-item>
            </n-card>

            <n-card title="输出目标">
              <n-form-item label="转换后端">
                <n-select v-model:value="formState.subconverter_backend_id" :options="backendOptions" placeholder="留空则使用全局默认后端" clearable />
              </n-form-item>
              <n-form-item label="转换配置">
                <n-select v-model:value="formState.subconverter_config_id" :options="configOptions" placeholder="留空则使用全局默认配置" clearable />
              </n-form-item>
            </n-card>
          </n-space>
        </n-gi>

        <!-- Right Column -->
        <n-gi :span="3">
          <n-card title="数据源与内容处理">
            <n-tabs type="line" animated>
              <n-tab-pane name="subscriptions" tab="机场订阅">
                <n-card size="small" :bordered="true">
                  <template #header-extra>
                    <n-input v-model:value="subFilter" size="small" placeholder="筛选订阅名称" clearable />
                  </template>
                  <n-scrollbar style="max-height: 300px;">
                    <n-collapse>
                      <n-collapse-item v-for="(subs, groupName) in allGroupedSubscriptions" :key="groupName" :title="`${groupName} (${subs.length})`">
                        <template #header-extra>
                          <n-checkbox
                            :checked="isSubscriptionGroupSelected(subs)"
                            :indeterminate="isSubscriptionGroupIndeterminate(subs)"
                            @update:checked="handleSubscriptionGroupSelectAll(subs, $event)"
                            @click.stop
                          >
                            全选
                          </n-checkbox>
                        </template>
                        <n-checkbox-group v-model:value="formState.subscription_ids">
                          <n-space vertical>
                            <n-checkbox v-for="sub in subs.filter(s => s.name.toLowerCase().includes(subFilter.toLowerCase()))" :key="sub.id" :value="sub.id" :label="sub.name" />
                          </n-space>
                        </n-checkbox-group>
                      </n-collapse-item>
                    </n-collapse>
                  </n-scrollbar>
                  <template #footer>
                    <n-space align="center" justify="space-between">
                      <n-form-item label="订阅选择策略" label-placement="left" class="mb-0">
                        <n-select
                          v-model:value="formState.airport_subscription_options.polling_mode"
                          :options="[
                            { label: '全部使用', value: 'none' },
                            { label: '按小时轮换', value: 'hourly' },
                            { label: '按次访问轮换', value: 'request' },
                          ]"
                          style="width: 150px"
                        />
                      </n-form-item>
                      <n-form-item label="随机选择一个" label-placement="left" class="mb-0">
                        <n-switch v-model:value="formState.airport_subscription_options.random" />
                      </n-form-item>
                    </n-space>
                  </template>
                </n-card>
              </n-tab-pane>
              <n-tab-pane name="manual-nodes" tab="手工节点">
                <n-card size="small" :bordered="true">
                  <template #header-extra>
                    <n-input v-model:value="nodeFilter" size="small" placeholder="筛选节点名称" clearable />
                  </template>
                  <n-scrollbar style="max-height: 300px;">
                    <n-collapse>
                      <n-collapse-item v-for="(nodes, groupName) in allManualNodes" :key="groupName" :title="`${groupName} (${nodes.length})`">
                        <template #header-extra>
                          <n-checkbox
                            :checked="isNodeGroupSelected(nodes)"
                            :indeterminate="isNodeGroupIndeterminate(nodes)"
                            @update:checked="handleNodeGroupSelectAll(nodes, $event)"
                            @click.stop
                          >
                            全选
                          </n-checkbox>
                        </template>
                        <n-checkbox-group v-model:value="formState.node_ids">
                          <n-space vertical>
                            <n-checkbox v-for="node in nodes.filter(n => n.name.toLowerCase().includes(nodeFilter.toLowerCase()))" :key="node.id" :value="node.id" :label="node.name" />
                          </n-space>
                        </n-checkbox-group>
                      </n-collapse-item>
                    </n-collapse>
                  </n-scrollbar>
                </n-card>
              </n-tab-pane>
              <n-tab-pane name="processing" tab="节点处理">
                <n-form-item label="机场订阅节点前缀">
                  <n-switch v-model:value="formState.node_prefix_settings.enable_subscription_prefix" />
                  <template #feedback>开启后，来自订阅的节点名称将自动变为 "订阅名称 - 节点名称"</template>
                </n-form-item>
                <n-form-item label="使用分组名作为手工节点前缀">
                  <n-switch v-model:value="formState.node_prefix_settings.enable_group_name_prefix" />
                  <template #feedback>开启后，手工节点将使用其所属的分组名作为前缀。此选项优先于下方的自定义前缀。</template>
                </n-form-item>
                <n-form-item label="手工节点自定义前缀">
                  <n-input
                    v-model:value="formState.node_prefix_settings.manual_node_prefix"
                    placeholder="例如 MyNodes"
                    clearable
                    :disabled="formState.node_prefix_settings.enable_group_name_prefix"
                  />
                  <template #feedback>设置后，所有手工添加的节点名称将变为 "前缀 - 节点名称"。当“使用分组名作为前缀”开启时，此项无效。</template>
                </n-form-item>
              </n-tab-pane>
            </n-tabs>
          </n-card>
        </n-gi>
      </n-grid>
    </n-form>
    <n-space justify="end" class="mt-6">
      <n-button @click="$router.back()">取消</n-button>
      <n-button type="primary" :loading="saveLoading" @click="handleSave">保存配置</n-button>
    </n-space>
  </n-spin>
</template>