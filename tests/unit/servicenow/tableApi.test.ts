import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AxiosInstance } from 'axios';
import { TableApi } from '../../../src/servicenow/tableApi.js';
import { ServiceNowError } from '../../../src/servicenow/client.js';

// ---------------------------------------------------------------------------
// Mock axios instance — injected directly into TableApi constructor
// ---------------------------------------------------------------------------
const mockGet = vi.fn();
const mockPost = vi.fn();

const mockAxiosInstance = {
  get: mockGet,
  post: mockPost,
} as unknown as AxiosInstance;

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// createRecord()
// ---------------------------------------------------------------------------
describe('TableApi.createRecord()', () => {
  it('should POST to /<table> with fields as the request body', async () => {
    mockPost.mockResolvedValue({ data: { result: { sys_id: 'abc123', number: 'INC001' } } });
    const tableApi = new TableApi(mockAxiosInstance);

    await tableApi.createRecord({ table: 'incident', fields: { short_description: 'Test outage' } });

    expect(mockPost).toHaveBeenCalledWith(
      '/incident',
      { short_description: 'Test outage' },
      expect.anything(),
    );
  });

  it('should include sysparm_display_value=true in params', async () => {
    mockPost.mockResolvedValue({ data: { result: { sys_id: 'abc123' } } });
    const tableApi = new TableApi(mockAxiosInstance);

    await tableApi.createRecord({ table: 'incident', fields: {} });

    expect(mockPost).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        params: expect.objectContaining({ sysparm_display_value: 'true' }),
      }),
    );
  });

  it('should include sysparm_exclude_reference_link=true in params', async () => {
    mockPost.mockResolvedValue({ data: { result: { sys_id: 'abc123' } } });
    const tableApi = new TableApi(mockAxiosInstance);

    await tableApi.createRecord({ table: 'incident', fields: {} });

    expect(mockPost).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        params: expect.objectContaining({ sysparm_exclude_reference_link: 'true' }),
      }),
    );
  });

  it('should return the ServiceNowRecord from the response', async () => {
    const record = { sys_id: 'abc123', number: 'INC001', short_description: 'Test outage' };
    mockPost.mockResolvedValue({ data: { result: record } });
    const tableApi = new TableApi(mockAxiosInstance);

    const result = await tableApi.createRecord({ table: 'incident', fields: {} });

    expect(result).toEqual(record);
  });

  it('should propagate ServiceNowError without wrapping', async () => {
    const error = new ServiceNowError('Forbidden', 403, 'Insufficient privileges');
    mockPost.mockRejectedValue(error);
    const tableApi = new TableApi(mockAxiosInstance);

    await expect(
      tableApi.createRecord({ table: 'incident', fields: {} }),
    ).rejects.toThrow(error);
  });

  it('should work for any supported table (change_request)', async () => {
    mockPost.mockResolvedValue({ data: { result: { sys_id: 'xyz', number: 'CHG001' } } });
    const tableApi = new TableApi(mockAxiosInstance);

    await tableApi.createRecord({ table: 'change_request', fields: { short_description: 'Upgrade' } });

    expect(mockPost).toHaveBeenCalledWith('/change_request', expect.anything(), expect.anything());
  });
});

// ---------------------------------------------------------------------------
// getRecord()
// ---------------------------------------------------------------------------
describe('TableApi.getRecord()', () => {
  it('should GET /<table>/<sysId>', async () => {
    mockGet.mockResolvedValue({ data: { result: { sys_id: 'abc123' } } });
    const tableApi = new TableApi(mockAxiosInstance);

    await tableApi.getRecord({ table: 'incident', sysId: 'abc123456789012345678901234567890' });

    expect(mockGet).toHaveBeenCalledWith(
      '/incident/abc123456789012345678901234567890',
      expect.anything(),
    );
  });

  it('should include sysparm_display_value and sysparm_exclude_reference_link in params', async () => {
    mockGet.mockResolvedValue({ data: { result: { sys_id: 'abc123' } } });
    const tableApi = new TableApi(mockAxiosInstance);

    await tableApi.getRecord({ table: 'incident', sysId: 'abc123' });

    expect(mockGet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_display_value: 'true',
          sysparm_exclude_reference_link: 'true',
        }),
      }),
    );
  });

  it('should return the flat record from the response', async () => {
    const record = { sys_id: 'abc123', state: 'Open', number: 'INC0001234' };
    mockGet.mockResolvedValue({ data: { result: record } });
    const tableApi = new TableApi(mockAxiosInstance);

    const result = await tableApi.getRecord({ table: 'incident', sysId: 'abc123' });

    expect(result).toEqual(record);
  });

  it('should propagate ServiceNowError (e.g. 404) without wrapping', async () => {
    const error = new ServiceNowError('Record not found', 404, 'No row with that sys_id');
    mockGet.mockRejectedValue(error);
    const tableApi = new TableApi(mockAxiosInstance);

    await expect(
      tableApi.getRecord({ table: 'incident', sysId: 'nonexistent' }),
    ).rejects.toThrow(error);
  });
});

// ---------------------------------------------------------------------------
// queryRecords()
// ---------------------------------------------------------------------------
describe('TableApi.queryRecords()', () => {
  it('should GET /<table> with sysparm_query when provided', async () => {
    mockGet.mockResolvedValue({ data: { result: [] } });
    const tableApi = new TableApi(mockAxiosInstance);

    await tableApi.queryRecords({ table: 'incident', query: 'active=true' });

    expect(mockGet).toHaveBeenCalledWith(
      '/incident',
      expect.objectContaining({
        params: expect.objectContaining({ sysparm_query: 'active=true' }),
      }),
    );
  });

  it('should include sysparm_limit and sysparm_offset when provided', async () => {
    mockGet.mockResolvedValue({ data: { result: [] } });
    const tableApi = new TableApi(mockAxiosInstance);

    await tableApi.queryRecords({ table: 'incident', limit: 10, offset: 20 });

    expect(mockGet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        params: expect.objectContaining({ sysparm_limit: 10, sysparm_offset: 20 }),
      }),
    );
  });

  it('should NOT include sysparm_limit when limit is not provided', async () => {
    mockGet.mockResolvedValue({ data: { result: [] } });
    const tableApi = new TableApi(mockAxiosInstance);

    await tableApi.queryRecords({ table: 'incident' });

    const callParams = mockGet.mock.calls[0]?.[1]?.params as Record<string, unknown> | undefined;
    expect(callParams).not.toHaveProperty('sysparm_limit');
  });

  it('should NOT include sysparm_offset when offset is not provided', async () => {
    mockGet.mockResolvedValue({ data: { result: [] } });
    const tableApi = new TableApi(mockAxiosInstance);

    await tableApi.queryRecords({ table: 'incident' });

    const callParams = mockGet.mock.calls[0]?.[1]?.params as Record<string, unknown> | undefined;
    expect(callParams).not.toHaveProperty('sysparm_offset');
  });

  it('should comma-join the fields array into sysparm_fields', async () => {
    mockGet.mockResolvedValue({ data: { result: [] } });
    const tableApi = new TableApi(mockAxiosInstance);

    await tableApi.queryRecords({ table: 'incident', fields: ['sys_id', 'number', 'state'] });

    expect(mockGet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        params: expect.objectContaining({ sysparm_fields: 'sys_id,number,state' }),
      }),
    );
  });

  it('should NOT include sysparm_fields when fields is not provided', async () => {
    mockGet.mockResolvedValue({ data: { result: [] } });
    const tableApi = new TableApi(mockAxiosInstance);

    await tableApi.queryRecords({ table: 'incident' });

    const callParams = mockGet.mock.calls[0]?.[1]?.params as Record<string, unknown> | undefined;
    expect(callParams).not.toHaveProperty('sysparm_fields');
  });

  it('should return an empty array when result is empty', async () => {
    mockGet.mockResolvedValue({ data: { result: [] } });
    const tableApi = new TableApi(mockAxiosInstance);

    const result = await tableApi.queryRecords({ table: 'incident' });

    expect(result).toEqual([]);
  });

  it('should return all records from a non-empty result', async () => {
    const records = [
      { sys_id: 'aaa', number: 'INC001' },
      { sys_id: 'bbb', number: 'INC002' },
    ];
    mockGet.mockResolvedValue({ data: { result: records } });
    const tableApi = new TableApi(mockAxiosInstance);

    const result = await tableApi.queryRecords({ table: 'incident' });

    expect(result).toEqual(records);
  });

  it('should work with a ticket number query (number=INC0001234)', async () => {
    const record = { sys_id: 'abc123', number: 'INC0001234' };
    mockGet.mockResolvedValue({ data: { result: [record] } });
    const tableApi = new TableApi(mockAxiosInstance);

    const result = await tableApi.queryRecords({
      table: 'incident',
      query: 'number=INC0001234',
      limit: 1,
    });

    expect(result).toEqual([record]);
    expect(mockGet).toHaveBeenCalledWith(
      '/incident',
      expect.objectContaining({
        params: expect.objectContaining({ sysparm_query: 'number=INC0001234', sysparm_limit: 1 }),
      }),
    );
  });

  it('should propagate ServiceNowError without wrapping', async () => {
    const error = new ServiceNowError('Query failed', 400, 'Invalid query syntax');
    mockGet.mockRejectedValue(error);
    const tableApi = new TableApi(mockAxiosInstance);

    await expect(
      tableApi.queryRecords({ table: 'incident', query: 'invalid^' }),
    ).rejects.toThrow(error);
  });
});
