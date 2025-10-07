<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { NPageHeader } from 'naive-ui';
import ProfileForm from '@/components/settings/ProfileForm.vue';

const props = defineProps<{
  id?: string;
}>();

const router = useRouter();

const pageTitle = computed(() => (props.id ? '编辑配置' : '新增配置'));

const handleSaveSuccess = () => {
  router.push({ name: 'profiles' });
};
</script>

<template>
  <div>
    <n-page-header @back="() => router.back()">
      <template #title>{{ pageTitle }}</template>
    </n-page-header>
    <div class="mt-6">
      <ProfileForm :profile-id="id" @save-success="handleSaveSuccess" />
    </div>
  </div>
</template>