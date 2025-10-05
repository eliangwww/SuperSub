<template>
  <div class="p-4">
    <n-card title="设置">
      <n-tabs type="line" animated>
        <n-tab-pane name="general" tab="通用设置">
          <GeneralSettings />
        </n-tab-pane>
        <n-tab-pane name="conversion" tab="订阅转换">
          <ConversionSettings />
        </n-tab-pane>
      </n-tabs>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { NCard, NTabs, NTabPane } from 'naive-ui';
import GeneralSettings from '@/components/settings/GeneralSettings.vue';
import ConversionSettings from '@/components/settings/ConversionSettings.vue';
</script>