<template>
  <div class="p-4">
    <n-card title="通用设置">
      <n-form ref="formRef" :model="formState" label-placement="top">
        
        <n-divider title-placement="left">系统设置 (仅管理员可见)</n-divider>
        <n-grid v-if="authStore.isAdmin" :cols="2" :x-gap="24">
          <n-form-item-gi label="允许新用户注册">
            <n-switch v-model:value="formState.allow_registration" />
          </n-form-item-gi>
        </n-grid>

        <n-divider title-placement="left">订阅转换设置</n-divider>
        
        <n-grid :cols="2" :x-gap="24">
          <n-form-item-gi label="默认订阅转换后端">
            <n-select
              v-model:value="formState.default_subconverter_backend_id"
              :options="backendOptions"
              placeholder="从下方列表中选择一个作为默认后端"
              clearable
            />
          </n-form-item-gi>
          <n-form-item-gi label="默认订阅转换配置">
            <n-select
              v-model:value="formState.default_subconverter_config_id"
              :options="configOptions"
              placeholder="从下方列表中选择一个作为默认配置"
              clearable
            />
          </n-form-item-gi>
        </n-grid>

        <AssetManager 
          asset-type="backend"
          title="订阅转换后端管理"
          asset-name="后端"
          @assets-updated="updateBackends"
          class="mb-8"
        />

        <AssetManager
          asset-type="config"
          title="订阅转换配置管理"
          asset-name="配置"
          @assets-updated="updateConfigs"
          class="mb-8"
        />

        <n-divider title-placement="left">Telegram 通知设置</n-divider>
        <n-grid :cols="2" :x-gap="24">
            <n-form-item-gi label="Bot Token" path="telegram_bot_token">
              <n-input
                v-model:value="formState.telegram_bot_token"
                placeholder="输入您的 Telegram Bot Token"
              />
            </n-form-item-gi>
            <n-form-item-gi label="Chat ID" path="telegram_chat_id">
              <n-input
                v-model:value="formState.telegram_chat_id"
                placeholder="输入接收通知的频道或用户 Chat ID"
              />
            </n-form-item-gi>
        </n-grid>
        
        <n-form-item>
            <n-space>
                <n-button type="primary" @click="handleSave" :loading="saveLoading">
                    保存全部设置
                </n-button>
                <n-button @click="handleTestTelegram" :loading="testLoading">
                    发送测试通知
                </n-button>
            </n-space>
        </n-form-item>
      </n-form>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import {
  NCard, NForm, NFormItem, NInput, NButton, useMessage, NDivider, NSpace, NSelect, NGrid, NFormItemGi, NSwitch
} from 'naive-ui';
import { api } from '@/utils/api';
import AssetManager from '@/components/AssetManager.vue';
import { useAuthStore } from '@/stores/auth';

type SubconverterAsset = {
  id: number;
  name: string;
  url: string;
  type: 'backend' | 'config';
};

const message = useMessage();
const authStore = useAuthStore();
const formRef = ref<any>(null);
const saveLoading = ref(false);
const testLoading = ref(false);

const allBackends = ref<SubconverterAsset[]>([]);
const allConfigs = ref<SubconverterAsset[]>([]);

const formState = ref({
  default_subconverter_backend_id: null as number | null,
  default_subconverter_config_id: null as number | null,
  telegram_bot_token: '',
  telegram_chat_id: '',
  allow_registration: false,
});

const backendOptions = computed(() => allBackends.value.map(b => ({ label: b.name, value: b.id })));
const configOptions = computed(() => allConfigs.value.map(c => ({ label: c.name, value: c.id })));

const updateBackends = (assets: SubconverterAsset[]) => {
  allBackends.value = assets;
};

const updateConfigs = (assets: SubconverterAsset[]) => {
  allConfigs.value = assets;
};

const fetchSettings = async () => {
  try {
    // Fetch user-specific settings
    const userSettingsPromise = api.get('/settings');
    
    // Fetch system settings if admin
    const systemSettingsPromise = authStore.isAdmin ? api.get('/admin/system-settings') : Promise.resolve(null);

    const [userSettingsResponse, systemSettingsResponse] = await Promise.all([userSettingsPromise, systemSettingsPromise]);

    // Process user settings
    if (userSettingsResponse.data.success && Array.isArray(userSettingsResponse.data.data)) {
      const settings = userSettingsResponse.data.data.reduce((acc: Record<string, any>, setting: { key: string, value: any }) => {
        acc[setting.key] = setting.value;
        return acc;
      }, {});
      formState.value.default_subconverter_backend_id = settings.default_subconverter_backend_id ? Number(settings.default_subconverter_backend_id) : null;
      formState.value.default_subconverter_config_id = settings.default_subconverter_config_id ? Number(settings.default_subconverter_config_id) : null;
      formState.value.telegram_bot_token = settings.telegram_bot_token || '';
      formState.value.telegram_chat_id = settings.telegram_chat_id || '';
    }

    // Process system settings
    if (systemSettingsResponse && systemSettingsResponse.data.success) {
        const systemSettings = systemSettingsResponse.data.data as Record<string, string>;
        formState.value.allow_registration = systemSettings.allow_registration === 'true';
    }

  } catch (error) {
    console.warn('Could not fetch settings.', error);
    message.error('加载设置失败');
  }
};

const handleSave = async () => {
  saveLoading.value = true;
  try {
    // User-specific settings
    const userSettingsPayload = [
      {
        key: 'default_subconverter_backend_id',
        value: formState.value.default_subconverter_backend_id,
        type: 'number',
        category: 'subconverter',
        description: '默认的在线订阅转换后端资源 ID'
      },
      {
        key: 'default_subconverter_config_id',
        value: formState.value.default_subconverter_config_id,
        type: 'number',
        category: 'subconverter',
        description: '默认的在线订阅转换配置资源 ID'
      },
      {
        key: 'telegram_bot_token',
        value: formState.value.telegram_bot_token,
        type: 'string',
        category: 'telegram',
        description: 'Telegram Bot Token'
      },
      {
        key: 'telegram_chat_id',
        value: formState.value.telegram_chat_id,
        type: 'string',
        category: 'telegram',
        description: 'Telegram Chat ID'
      }
    ];

    const userSettingsPromise = api.post('/settings', userSettingsPayload);

    // System settings (if admin)
    let systemSettingsPromise = Promise.resolve();
    if (authStore.isAdmin) {
      const systemSettingsPayload = {
        allow_registration: String(formState.value.allow_registration)
      };
      systemSettingsPromise = api.post('/admin/system-settings', systemSettingsPayload);
    }

    await Promise.all([userSettingsPromise, systemSettingsPromise]);
    
    message.success('设置已保存');
  } catch (error) {
    message.error('保存设置失败，请检查后端服务');
    console.error('Failed to save settings:', error);
  } finally {
    saveLoading.value = false;
  }
};

const handleTestTelegram = async () => {
    testLoading.value = true;
    try {
        await api.post('/settings/test-telegram', {
            message: '这是一条来自 SuperSub 的测试消息！'
        });
        message.success('测试消息已发送，请检查您的 Telegram');
    } catch (error: any) {
        message.error(error.response?.data?.message || '发送测试消息失败');
        console.error('Failed to send test message:', error);
    } finally {
        testLoading.value = false;
    }
};

onMounted(() => {
  fetchSettings();
});
</script>