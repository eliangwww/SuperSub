import { useAuthStore } from '@/stores/auth';

const BASE_URL = '/api';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export const useApi = () => {
  const authStore = useAuthStore();

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

      if (response.status === 204) {
        return { success: true, data: {} as T }; // Return success with empty data
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const responseData: ApiResponse<T> = await response.json();
        if (!response.ok || (responseData.success === false)) {
          const errorMsg = responseData.message || `Request failed with status ${response.status}`;
          throw new Error(errorMsg);
        }
        return responseData;
      }

      // Handle non-JSON responses
      if (!response.ok) {
        const errorMsg = await response.text() || `Request failed with status ${response.status}`;
        throw new Error(errorMsg);
      }
      
      // For text/plain or other non-json successful responses
      return { success: true, data: await response.text() as any };

    } catch (error: any) {
      console.error(`API call to ${endpoint} failed:`, error);
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