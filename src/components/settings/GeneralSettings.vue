<template>
  <div class="p-4">
    <n-form ref="formRef" :model="formState" label-placement="top">
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
            保存设置
          </n-button>
          <n-button @click="handleTestTelegram" :loading="testLoading">
            发送测试通知
          </n-button>
        </n-space>
      </n-form-item>
    </n-form>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  NForm, NFormItem, NInput, NButton, useMessage, NDivider, NSpace, NGrid, NFormItemGi
} from 'naive-ui';
import { api } from '@/utils/api';

const message = useMessage();
const formRef = ref<any>(null);
const saveLoading = ref(false);
const testLoading = ref(false);

const formState = ref({
  telegram_bot_token: '',
  telegram_chat_id: '',
});

const fetchSettings = async () => {
  try {
    const userSettingsResponse = await api.get('/settings');
    if (userSettingsResponse.data.success && Array.isArray(userSettingsResponse.data.data)) {
      const settings = userSettingsResponse.data.data.reduce((acc: Record<string, any>, setting: { key: string, value: any }) => {
        acc[setting.key] = setting.value;
        return acc;
      }, {});
      formState.value.telegram_bot_token = settings.telegram_bot_token || '';
      formState.value.telegram_chat_id = settings.telegram_chat_id || '';
    }
  } catch (error) {
    console.warn('Could not fetch settings.', error);
    message.error('加载设置失败');
  }
};

const handleSave = async () => {
  saveLoading.value = true;
  try {
    const userSettingsPayload = [
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
    await api.post('/settings', userSettingsPayload);
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