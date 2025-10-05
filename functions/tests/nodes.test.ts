import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { app } from '../api/[[path]]'; // Adjust path as needed

// Mock D1Database for testing
class MockD1Database {
  private data: { [key: string]: any[] } = {};
  private initialData: { [key: string]: any[] } = {};

  constructor() {
    this.initialData = {
      users: [{ id: 'default-admin-id', username: 'admin', password: 'admin123', role: 'admin' }],
      nodes: [{
        id: 'node-1',
        group_id: 'group-1',
        name: 'Test Node 1',
        server: '1.1.1.1',
        port: 80,
        password: 'pass',
        type: 'test',
        params: '{}',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }],
    };
    this.reset();
  }

  reset() {
    this.data = JSON.parse(JSON.stringify(this.initialData));
  }

  prepare(query: string) {
    const self = this;
    let boundParams: any[] = [];

    const statement = {
      bind: (...params: any[]) => {
        boundParams = params;
        return statement; // Return self for chaining
      },
      first: async (col?: string) => {
        const results = self._executeSelect(query, boundParams);
        const firstResult = results.length > 0 ? results[0] : null;
        if (col && firstResult) {
          return firstResult[col] ?? null;
        }
        return firstResult;
      },
      all: async () => {
        const results = self._executeSelect(query, boundParams);
        return { results };
      },
      run: async () => {
        return self._executeModification(query, boundParams);
      },
    };

    return statement;
  }

  batch(stmts: D1PreparedStatement[]): Promise<D1Result<any>[]> {
    const results = Promise.all(stmts.map(stmt => stmt.run()));
    return results as Promise<D1Result<any>[]>;
  }

  private _executeSelect(query: string, params: any[]): any[] {
    const tableMatch = query.match(/FROM\s+(\w+)/i);
    if (!tableMatch) return [];
    const table = tableMatch[1];

    if (!this.data[table]) return [];

    let results = [...this.data[table]];

    const whereMatch = query.match(/WHERE\s+(.*)/i);
    if (whereMatch) {
      const conditions = whereMatch[1].split(/\s+AND\s+/i);
      let paramIndex = 0;
      for (const condition of conditions) {
        const [field, operator] = condition.split(/\s*([=?])\s*/).filter(Boolean);
        if (operator === '=') {
          const param = params[paramIndex++];
          results = results.filter(row => row[field] == param);
        }
      }
    }
    return results;
  }

  private _executeModification(query: string, params: any[]) {
    if (query.trim().toUpperCase().startsWith('INSERT')) {
      return this._executeInsert(query, params);
    }
    if (query.trim().toUpperCase().startsWith('UPDATE')) {
      return this._executeUpdate(query, params);
    }
    if (query.trim().toUpperCase().startsWith('DELETE')) {
      return this._executeDelete(query, params);
    }
    return { success: false, meta: { changes: 0, last_row_id: 0 } };
  }

  private _executeInsert(query: string, params: any[]) {
    const tableMatch = query.match(/INTO\s+(\w+)/i);
    if (!tableMatch) return { success: false, meta: { changes: 0, last_row_id: 0 } };
    const table = tableMatch[1];

    const colsMatch = query.match(/\(([^)]+)\)/);
    if (!colsMatch) return { success: false, meta: { changes: 0, last_row_id: 0 } };
    const cols = colsMatch[1].split(',').map(c => c.trim());

    const newRow: { [key: string]: any } = {};
    cols.forEach((col, index) => {
      newRow[col] = params[index];
    });

    if (!this.data[table]) this.data[table] = [];
    this.data[table].push(newRow);

    return { success: true, meta: { changes: 1, last_row_id: this.data[table].length } };
  }

  private _executeUpdate(query: string, params: any[]) {
     const tableMatch = query.match(/UPDATE\s+(\w+)/i);
    if (!tableMatch) return { success: false, meta: { changes: 0, last_row_id: 0 } };
    const table = tableMatch[1];

    const setMatch = query.match(/SET\s+(.*?)\s+WHERE/i);
    if (!setMatch) return { success: false, meta: { changes: 0, last_row_id: 0 } };
    const setClauses = setMatch[1].split(',').map(s => s.split('=')[0].trim());

    const whereMatch = query.match(/WHERE\s+(.*)/i);
    if (!whereMatch) return { success: false, meta: { changes: 0, last_row_id: 0 } };
    const whereField = whereMatch[1].split('=')[0].trim();
    const whereValue = params[params.length - 1];

    let changes = 0;
    this.data[table].forEach(row => {
      if (row[whereField] == whereValue) {
        setClauses.forEach((col, index) => {
          row[col] = params[index];
        });
        changes++;
      }
    });

    return { success: true, meta: { changes, last_row_id: 0 } };
  }

  private _executeDelete(query: string, params: any[]) {
    const tableMatch = query.match(/FROM\s+(\w+)/i);
    if (!tableMatch) return { success: false, meta: { changes: 0, last_row_id: 0 } };
    const table = tableMatch[1];

    const whereMatch = query.match(/WHERE\s+(.*)/i);
    if (!whereMatch) return { success: false, meta: { changes: 0, last_row_id: 0 } };
    
    const initialLength = this.data[table]?.length || 0;
    const whereClauses = whereMatch[1].split(/\s+AND\s+/i);
    const fieldsToDelete = whereClauses.map(c => c.split('=')[0].trim());
    const valuesToDelete = params;

    if (fieldsToDelete.length === 1 && fieldsToDelete[0] === 'id' && Array.isArray(valuesToDelete[0])) {
        // Handle batch delete: DELETE FROM table WHERE id IN (?)
        const idsToDelete = new Set(valuesToDelete[0]);
        this.data[table] = this.data[table].filter(row => !idsToDelete.has(row.id));
    } else {
        // Handle single delete: DELETE FROM table WHERE id = ?
        this.data[table] = this.data[table].filter(row => {
            for(let i = 0; i < fieldsToDelete.length; i++) {
                if (row[fieldsToDelete[i]] == valuesToDelete[i]) {
                    return false; // don't keep
                }
            }
            return true; // keep
        });
    }

    const changes = initialLength - (this.data[table]?.length || 0);
    return { success: true, meta: { changes, last_row_id: 0 } };
  }
}

describe('Node API', () => {
  let bindings: { DB: MockD1Database };
  let mockDB: MockD1Database;

  beforeAll(() => {
    mockDB = new MockD1Database();
    bindings = { DB: mockDB };
  });

  beforeEach(() => {
    // Reset nodes before each test
    mockDB.reset();
  });

  it('should get all nodes', async () => {
    const res = await app.request('/api/nodes', { method: 'GET' }, bindings);
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: any[] };
    expect(json.success).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);
  });

  it('should create a new node', async () => {
    const newNode = {
      name: 'New Node',
      server: '2.2.2.2',
      port: 8888,
      type: 'v2ray',
      params: { key: 'value' },
    };
    const res = await app.request('/api/nodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newNode),
    }, bindings);
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: { id: string } };
    expect(json.success).toBe(true);
    expect(json.data.id).toBeTypeOf('string');
  });

  it('should get a single node by id', async () => {
    const res = await app.request('/api/nodes/node-1', { method: 'GET' }, bindings);
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: any };
    expect(json.success).toBe(true);
    expect(json.data.name).toBe('Test Node 1');
  });

  it('should update a node', async () => {
    const updatedNode = {
      name: 'Updated Node 1',
      server: '3.3.3.3',
      port: 9999,
      type: 'shadowsocks',
      params: { key2: 'value2' },
    };
    const res = await app.request('/api/nodes/node-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedNode),
    }, bindings);
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean };
    expect(json.success).toBe(true);
  });

  it('should batch import nodes', async () => {
    const newNodes = [
      { name: 'Batch Node 1', server: '4.4.4.4', port: 1000, type: 'vless' },
      { name: 'Batch Node 2', server: '5.5.5.5', port: 2000, type: 'trojan' },
    ];
    const res = await app.request('/api/nodes/batch-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes: newNodes }),
    }, bindings);
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: { successCount: number } };
    expect(json.success).toBe(true);
    expect(json.data.successCount).toBe(2);
  });

  it('should batch delete nodes', async () => {
    const res = await app.request('/api/nodes/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['node-1'] }),
    }, bindings);
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean };
    expect(json.success).toBe(true);
  });
});