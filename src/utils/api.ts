import axios from 'axios';
import { useAuthStore } from '@/stores/auth';

const api = axios.create({
  baseURL: '/api',
});

api.interceptors.request.use(config => {
  const authStore = useAuthStore();

  // If the app is in the process of logging out, cancel all outgoing requests.
  if (authStore.isLoggingOut) {
    return {
      ...config,
      cancelToken: new axios.CancelToken((cancel) => cancel('Logout in progress')),
    };
  }

  // Add token to headers
  const token = authStore.token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Cloudflare Pages/Functions doesn't properly handle PUT/DELETE with [[path]].
  // As a workaround, we tunnel these methods through POST using a header.
  const method = config.method?.toUpperCase();
  if (method === 'PUT' || method === 'DELETE') {
    config.headers['X-HTTP-Method-Override'] = method;
    config.method = 'POST';
  }

  return config;
});

// Add a response interceptor to handle token expiration or other auth errors
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response && error.response.status === 401) {
      const authStore = useAuthStore();
      authStore.logout(); // This will clear user data and redirect to login
    }
    return Promise.reject(error);
  }
);

export { api };