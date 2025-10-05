import { defineStore } from 'pinia';
import axios from 'axios';
import { User } from '@/types';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as User | null,
    token: null,
    isLoggingOut: false,
  }),
  getters: {
    isAuthenticated: (state) => !!state.token,
    isAdmin: (state) => state.user?.role === 'admin',
  },
  actions: {
    async login(credentials: { username: string; password: any; }) {
      const response = await axios.post('/api/auth/login', credentials);
      const { token, user } = response.data.data;
      this.token = token;
      this.user = user;
      this.isLoggingOut = false; // Reset the flag on successful login
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    },
    logout() {
      this.isLoggingOut = true;
      this.user = null;
      this.token = null;
      delete axios.defaults.headers.common['Authorization'];
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