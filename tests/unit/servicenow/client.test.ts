import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mock setup so the factories below can reference these variables
// ---------------------------------------------------------------------------
const { mockCreateFn, mockAxiosInstance, mockRequestUseFn, mockResponseUseFn } = vi.hoisted(() => {
  const mockRequestUseFn = vi.fn();
  const mockResponseUseFn = vi.fn();
  const mockAxiosInstance = {
    interceptors: {
      request: { use: mockRequestUseFn },
      response: { use: mockResponseUseFn },
    },
  };
  const mockCreateFn = vi.fn(() => mockAxiosInstance);
  return { mockCreateFn, mockAxiosInstance, mockRequestUseFn, mockResponseUseFn };
});

vi.mock('axios', () => ({
  default: { create: mockCreateFn },
}));

vi.mock('../../../src/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Imports come after vi.mock so they receive the mocked versions
import { createServiceNowClient, ServiceNowError } from '../../../src/servicenow/client.js';
import { logger } from '../../../src/logger.js';
import type { AuthManager } from '../../../src/auth/authManager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const BASE_ENV = {
  SERVICENOW_INSTANCE_URL: 'https://dev12345.service-now.com',
  AUTH_TYPE: 'api_key',
  SERVICENOW_API_KEY: 'test-key-abc123',
};

function makeMockAuthManager(headers = { 'x-sn-apikey': 'test-key-abc123' }): AuthManager {
  return { getHeaders: vi.fn().mockResolvedValue(headers) } as unknown as AuthManager;
}

function makeAxiosError(
  status: number,
  data: unknown,
  message = `Request failed with status code ${status}`,
) {
  return { response: { status, data }, message };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// ServiceNowError class
// ---------------------------------------------------------------------------
describe('ServiceNowError', () => {
  it('should be an instance of Error', () => {
    const err = new ServiceNowError('Record not found', 404, 'No row with that sys_id');
    expect(err).toBeInstanceOf(Error);
  });

  it('should have name "ServiceNowError"', () => {
    const err = new ServiceNowError('msg', 404, 'detail');
    expect(err.name).toBe('ServiceNowError');
  });

  it('should expose statusCode', () => {
    const err = new ServiceNowError('msg', 422, 'detail');
    expect(err.statusCode).toBe(422);
  });

  it('should expose detail', () => {
    const err = new ServiceNowError('msg', 500, 'something exploded');
    expect(err.detail).toBe('something exploded');
  });

  it('should expose message', () => {
    const err = new ServiceNowError('Field not found', 400, '');
    expect(err.message).toBe('Field not found');
  });
});

// ---------------------------------------------------------------------------
// createServiceNowClient — axios.create configuration
// ---------------------------------------------------------------------------
describe('createServiceNowClient', () => {
  describe('axios.create call', () => {
    it('should call axios.create with baseURL = SERVICENOW_INSTANCE_URL + /api/now/table', () => {
      vi.stubEnv('SERVICENOW_INSTANCE_URL', BASE_ENV.SERVICENOW_INSTANCE_URL);
      vi.stubEnv('AUTH_TYPE', BASE_ENV.AUTH_TYPE);
      vi.stubEnv('SERVICENOW_API_KEY', BASE_ENV.SERVICENOW_API_KEY);

      createServiceNowClient(makeMockAuthManager());

      expect(mockCreateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://dev12345.service-now.com/api/now/table',
        }),
      );
    });

    it('should set timeout from SERVICENOW_TIMEOUT env var', () => {
      vi.stubEnv('SERVICENOW_INSTANCE_URL', BASE_ENV.SERVICENOW_INSTANCE_URL);
      vi.stubEnv('AUTH_TYPE', BASE_ENV.AUTH_TYPE);
      vi.stubEnv('SERVICENOW_API_KEY', BASE_ENV.SERVICENOW_API_KEY);
      vi.stubEnv('SERVICENOW_TIMEOUT', '15000');

      createServiceNowClient(makeMockAuthManager());

      expect(mockCreateFn).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 15000 }),
      );
    });

    it('should use default timeout of 30000 when SERVICENOW_TIMEOUT is not set', () => {
      vi.stubEnv('SERVICENOW_INSTANCE_URL', BASE_ENV.SERVICENOW_INSTANCE_URL);
      vi.stubEnv('AUTH_TYPE', BASE_ENV.AUTH_TYPE);
      vi.stubEnv('SERVICENOW_API_KEY', BASE_ENV.SERVICENOW_API_KEY);
      // SERVICENOW_TIMEOUT intentionally not set

      createServiceNowClient(makeMockAuthManager());

      expect(mockCreateFn).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 30000 }),
      );
    });

    it('should register one request interceptor and one response interceptor', () => {
      vi.stubEnv('SERVICENOW_INSTANCE_URL', BASE_ENV.SERVICENOW_INSTANCE_URL);
      vi.stubEnv('AUTH_TYPE', BASE_ENV.AUTH_TYPE);
      vi.stubEnv('SERVICENOW_API_KEY', BASE_ENV.SERVICENOW_API_KEY);

      createServiceNowClient(makeMockAuthManager());

      expect(mockRequestUseFn).toHaveBeenCalledTimes(1);
      expect(mockResponseUseFn).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Request interceptor
  // -------------------------------------------------------------------------
  describe('request interceptor', () => {
    function setupAndGetRequestHandler() {
      vi.stubEnv('SERVICENOW_INSTANCE_URL', BASE_ENV.SERVICENOW_INSTANCE_URL);
      vi.stubEnv('AUTH_TYPE', BASE_ENV.AUTH_TYPE);
      vi.stubEnv('SERVICENOW_API_KEY', BASE_ENV.SERVICENOW_API_KEY);
      createServiceNowClient(makeMockAuthManager({ 'x-sn-apikey': 'test-key-abc123' }));
      // The first argument passed to interceptors.request.use is the success handler
      return mockRequestUseFn.mock.calls[0]?.[0] as (config: Record<string, unknown>) => Promise<Record<string, unknown>>;
    }

    it('should inject x-sn-apikey header from authManager.getHeaders()', async () => {
      const handler = setupAndGetRequestHandler();
      const config = { headers: {} };
      const result = await handler(config);
      expect(result['headers']).toMatchObject({ 'x-sn-apikey': 'test-key-abc123' });
    });

    it('should preserve existing headers alongside the injected auth header', async () => {
      const handler = setupAndGetRequestHandler();
      const config = { headers: { 'Content-Type': 'application/json' } };
      const result = await handler(config);
      expect(result['headers']).toMatchObject({
        'Content-Type': 'application/json',
        'x-sn-apikey': 'test-key-abc123',
      });
    });

    it('should return the modified config object', async () => {
      const handler = setupAndGetRequestHandler();
      const config = { headers: {}, url: '/incident' };
      const result = await handler(config);
      expect(result).toMatchObject({ url: '/incident' });
    });
  });

  // -------------------------------------------------------------------------
  // Response interceptor — success path
  // -------------------------------------------------------------------------
  describe('response interceptor (success)', () => {
    function setupAndGetSuccessHandler() {
      vi.stubEnv('SERVICENOW_INSTANCE_URL', BASE_ENV.SERVICENOW_INSTANCE_URL);
      vi.stubEnv('AUTH_TYPE', BASE_ENV.AUTH_TYPE);
      vi.stubEnv('SERVICENOW_API_KEY', BASE_ENV.SERVICENOW_API_KEY);
      createServiceNowClient(makeMockAuthManager());
      return mockResponseUseFn.mock.calls[0]?.[0] as (res: unknown) => unknown;
    }

    it('should pass 2xx responses through unchanged', () => {
      const handler = setupAndGetSuccessHandler();
      const mockResponse = { status: 200, data: { result: { sys_id: 'abc' } } };
      expect(handler(mockResponse)).toBe(mockResponse);
    });
  });

  // -------------------------------------------------------------------------
  // Response interceptor — error path
  // -------------------------------------------------------------------------
  describe('response interceptor (error)', () => {
    function setupAndGetErrorHandler() {
      vi.stubEnv('SERVICENOW_INSTANCE_URL', BASE_ENV.SERVICENOW_INSTANCE_URL);
      vi.stubEnv('AUTH_TYPE', BASE_ENV.AUTH_TYPE);
      vi.stubEnv('SERVICENOW_API_KEY', BASE_ENV.SERVICENOW_API_KEY);
      createServiceNowClient(makeMockAuthManager());
      return mockResponseUseFn.mock.calls[0]?.[1] as (error: unknown) => never;
    }

    it('should throw ServiceNowError on a 404 response', () => {
      const handler = setupAndGetErrorHandler();
      const error = makeAxiosError(404, null);
      expect(() => handler(error)).toThrow(ServiceNowError);
    });

    it('should extract message and detail from ServiceNow error body', () => {
      const handler = setupAndGetErrorHandler();
      const error = makeAxiosError(422, {
        error: { message: 'Field not found', detail: 'sys_class_name is invalid' },
        status: 'failure',
      });
      expect(() => handler(error)).toThrowError(
        expect.objectContaining({
          message: 'Field not found',
          detail: 'sys_class_name is invalid',
          statusCode: 422,
        }),
      );
    });

    it('should use the axios error message as fallback when body is not a ServiceNow error', () => {
      const handler = setupAndGetErrorHandler();
      const error = makeAxiosError(500, null, 'Internal Server Error');
      expect(() => handler(error)).toThrowError(
        expect.objectContaining({ message: 'Internal Server Error' }),
      );
    });

    it('should set statusCode from the HTTP response status', () => {
      const handler = setupAndGetErrorHandler();
      const error = makeAxiosError(403, { error: { message: 'Forbidden', detail: '' }, status: 'failure' });
      expect(() => handler(error)).toThrowError(
        expect.objectContaining({ statusCode: 403 }),
      );
    });

    it('should call logger.error before throwing', () => {
      const handler = setupAndGetErrorHandler();
      const error = makeAxiosError(500, null);
      expect(() => handler(error)).toThrow();
      expect(vi.mocked(logger.error)).toHaveBeenCalledOnce();
    });

    it('should handle a missing response (network error) with statusCode 0', () => {
      const handler = setupAndGetErrorHandler();
      const networkError = { message: 'Network Error' }; // no .response
      expect(() => handler(networkError)).toThrowError(
        expect.objectContaining({ statusCode: 0 }),
      );
    });
  });
});
