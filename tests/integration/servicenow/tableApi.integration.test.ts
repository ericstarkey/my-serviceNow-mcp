import 'dotenv/config';
import { describe, it, expect, beforeAll } from 'vitest';
import { AuthManager } from '../../../src/auth/authManager.js';
import { createServiceNowClient } from '../../../src/servicenow/client.js';
import { TableApi } from '../../../src/servicenow/tableApi.js';

const RUN = process.env['INTEGRATION_TESTS'] === 'true';

describe.skipIf(!RUN)('TableApi integration tests (live ServiceNow instance)', () => {
  let tableApi: TableApi;

  beforeAll(() => {
    const authManager = new AuthManager();
    const client = createServiceNowClient(authManager);
    tableApi = new TableApi(client);
  });

  it('should create an incident and return sys_id and number', async () => {
    const record = await tableApi.createRecord({
      table: 'incident',
      fields: {
        short_description: '[MCP Integration Test] Create test',
        impact: '3',
        urgency: '3',
      },
    });

    expect(record.sys_id).toBeTruthy();
    expect(typeof record['number']).toBe('string');
    expect((record['number'] as string).startsWith('INC')).toBe(true);
  });

  it('should get a created incident by sys_id', async () => {
    const created = await tableApi.createRecord({
      table: 'incident',
      fields: {
        short_description: '[MCP Integration Test] Get by sys_id test',
        impact: '3',
        urgency: '3',
      },
    });

    const fetched = await tableApi.getRecord({
      table: 'incident',
      sysId: created.sys_id,
    });

    expect(fetched.sys_id).toBe(created.sys_id);
    expect(fetched['number']).toBe(created['number']);
  });

  it('should query an incident by ticket number', async () => {
    const created = await tableApi.createRecord({
      table: 'incident',
      fields: {
        short_description: '[MCP Integration Test] Query by number test',
        impact: '3',
        urgency: '3',
      },
    });

    const number = created['number'] as string;
    const results = await tableApi.queryRecords({
      table: 'incident',
      query: `number=${number}`,
      limit: 1,
    });

    expect(results).toHaveLength(1);
    expect(results.at(0)?.sys_id).toBe(created.sys_id);
  });
});
