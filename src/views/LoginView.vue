<template>
  <div class="flex items-center justify-center min-h-screen bg-gray-100">
    <n-card class="w-full max-w-md" title="Login" :bordered="false" size="huge">
      <n-form @submit.prevent="handleLogin">
        <n-form-item-row label="Username">
          <n-input v-model:value="username" placeholder="Enter your username" />
        </n-form-item-row>
        <n-form-item-row label="Password">
          <n-input
            v-model:value="password"
            type="password"
            show-password-on="mousedown"
            placeholder="Enter your password"
          />
        </n-form-item-row>
        <n-button type="primary" attr-type="submit" block :loading="loading">
          Login
        </n-button>
      </n-form>
      <template #footer>
        <p v-if="authStore.isRegistrationAllowed" class="text-sm text-center text-gray-600">
          Don't have an account?
          <router-link to="/register" class="font-medium text-indigo-600 hover:underline">Register</router-link>
        </p>
      </template>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { NCard, NForm, NFormItemRow, NInput, NButton, useMessage } from 'naive-ui';

const username = ref('');
const password = ref('');
const loading = ref(false);
const router = useRouter();
const authStore = useAuthStore();
const message = useMessage();

onMounted(() => {
  authStore.checkRegistrationStatus();
});

const handleLogin = async () => {
  loading.value = true;
  try {
    await authStore.login({ username: username.value, password: password.value });
    router.push('/'); // Redirect to dashboard after login
  } catch (error: any) {
    console.error('Login failed:', error);
    message.error(error.response?.data?.message || 'Login failed. Please check your credentials.');
  } finally {
    loading.value = false;
  }
};
</script>