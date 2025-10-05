import { useAuthStore } from '@/stores/auth';
import { useMessage } from 'naive-ui';

const BASE_URL = '/api';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export const useApi = () => {
  const authStore = useAuthStore();
  const message = useMessage();

  const request = async <T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> => {
    if (authStore.isLoggingOut) {
      console.log(`Request to ${endpoint} cancelled due to logout.`);
      return new Promise(() => {}); // Prevent request from being sent
    }
    const headers = new Headers(options.headers || {});
    if (authStore.token) {
      headers.set('Authorization', `Bearer ${authStore.token}`);
    }
    if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    const config: RequestInit = {
      ...options,
      headers,
    };

    try {
      const response = await fetch(`${BASE_URL}${endpoint}`, config);

      // Handle different response types based on Accept header
      const acceptHeader = headers.get('Accept');
      if (acceptHeader && acceptHeader.includes('text/plain')) {
        if (!response.ok) {
          const errorMsg = await response.text() || `Request failed with status ${response.status}`;
          throw new Error(errorMsg);
        }
        // For text responses, we can't assume the ApiResponse wrapper, so we return it directly.
        // The calling function will need to handle this.
        return await response.text() as any;
      }

      const responseData: ApiResponse<T> = await response.json();

      if (!response.ok || (responseData.success === false)) { // Check for explicit false
        const errorMsg = responseData.message || `Request failed with status ${response.status}`;
        throw new Error(errorMsg);
      }

      return responseData;
    } catch (error: any) {
      console.error(`API call to ${endpoint} failed:`, error);
      // Optionally, show a global error message
      // message.error(error.message || 'An unknown network error occurred.');
      throw error;
    }
  };

  return {
    get: <T>(endpoint: string, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'GET' }),
    post: <T>(endpoint: string, body: any, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'POST', body: JSON.stringify(body) }),
    put: <T>(endpoint: string, body: any, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'PUT', body: JSON.stringify(body) }),
    delete: <T>(endpoint: string, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'DELETE' }),
    patch: <T>(endpoint: string, body: any, options?: RequestInit) => request<T>(endpoint, { ...options, method: 'PATCH', body: JSON.stringify(body) }),
    getBaseUrl: () => BASE_URL,
  };
};