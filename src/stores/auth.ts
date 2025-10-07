import { defineStore } from 'pinia';
import { nextTick } from 'vue';
import axios from 'axios';
import { User } from '@/types';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as User | null,
    token: null as string | null,
    isLoggingOut: false,
    isRegistrationAllowed: true, // Default to true
  }),
  getters: {
    isAuthenticated: (state) => !!state.token,
    isAdmin: (state) => state.user?.role === 'admin',
  },
  actions: {
    async checkRegistrationStatus() {
      try {
        // This endpoint is public, so no auth is needed.
        const response = await axios.get('/api/system/settings');
        if (response.data.success) {
          this.isRegistrationAllowed = response.data.data.allow_registration === 'true';
        }
      } catch (error) {
        console.error('Failed to check registration status:', error);
        // In case of error, default to allowing registration to not block users if the API fails.
        this.isRegistrationAllowed = true;
      }
    },
    async login(credentials: { username: string; password: any; }) {
      try {
        const response = await axios.post('/api/auth/login', credentials);
        const { token, user } = response.data.data;
        this.token = token;
        this.user = user;
        this.isLoggingOut = false; // Reset the flag on successful login
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      } catch (error) {
        // Re-throw the error to be caught by the component
        throw error;
      }
    },
    async logout() {
      this.isLoggingOut = true;
      try {
        this.user = null;
        this.token = null;
        delete axios.defaults.headers.common['Authorization'];
        // Wait for the next DOM update cycle to ensure the logout state has propagated
        await nextTick();
      } finally {
        this.isLoggingOut = false; // Reset the flag after logout is complete
      }
    },
    updateTokenAndUser(data: { jwt: string, user: User }) {
      this.token = data.jwt;
      this.user = data.user;
      axios.defaults.headers.common['Authorization'] = `Bearer ${data.jwt}`;
    },
    async fetchUser() {
      if (this.token && !this.user) {
        try {
          axios.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;
          const response = await axios.get('/api/auth/me');
          this.user = response.data.data;
        } catch (error) {
          this.logout(); // Token is invalid, logout
        }
      }
    },
    async register(credentials: { username: string; password: any; }) {
      await axios.post('/api/auth/register', credentials);
    }
  },
  persist: true,
});