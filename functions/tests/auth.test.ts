import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../api/[[path]]'; // Adjust path as needed

// Mock D1Database for testing
class MockD1Database {
  users: any[] = [];
  nodes: any[] = []; // Add other tables as needed for more comprehensive tests

  constructor() {
    // Initialize with default admin user
    this.users.push({ id: 'default-admin-id', username: 'admin', password: 'admin123', role: 'admin' });
  }

  prepare(query: string) {
    if (query.includes('SELECT * FROM users WHERE username = ?')) {
      return {
        bind: (username: string) => ({
          first: async () => this.users.find(u => u.username === username),
        }),
      };
    }
    // Mock other queries if needed
    return {
      bind: () => ({
        first: async () => undefined,
        all: async () => ({ results: [] }),
        run: async () => {},
      }),
    };
  }
}

describe('Auth API', () => {
  let bindings: { DB: MockD1Database };

  beforeAll(() => {
    const mockDB = new MockD1Database();
    bindings = { DB: mockDB };
  });

  it('should login with valid credentials', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    }, bindings);
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data?: { username: string } };
    expect(json.success).toBe(true);
    expect(json.data?.username).toBe('admin');
  });

  it('should not login with invalid password', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrongpassword' }),
    }, bindings);
    expect(res.status).toBe(401);
    const json = await res.json() as { success: boolean; message: string };
    expect(json.success).toBe(false);
    expect(json.message).toBe('Invalid password');
  });

  it('should not login with user not found', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nonexistent', password: 'password' }),
    }, bindings);
    expect(res.status).toBe(404);
    const json = await res.json() as { success: boolean; message: string };
    expect(json.success).toBe(false);
    expect(json.message).toBe('User not found');
  });

  it('should logout successfully', async () => {
    const res = await app.request('/api/auth/logout', { method: 'POST' }, bindings);
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; message: string };
    expect(json.success).toBe(true);
  });

  it('should get current user info', async () => {
    const res = await app.request('/api/auth/me', { method: 'GET' }, bindings);
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data?: { username: string } };
    expect(json.success).toBe(true);
    expect(json.data?.username).toBe('admin');
  });
});