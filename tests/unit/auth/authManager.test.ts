import { describe, it, expect, afterEach, vi } from 'vitest';
import { AuthManager, AuthError } from '../../../src/auth/authManager.js';

// Base valid env shared across tests — override per-test with vi.stubEnv()
const BASE_ENV = {
  SERVICENOW_INSTANCE_URL: 'https://dev12345.service-now.com',
  AUTH_TYPE: 'api_key',
  SERVICENOW_API_KEY: 'test-api-key-abc123',
};

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// parseConfig integration (via AuthManager) — config validation behaviour
// ---------------------------------------------------------------------------
describe('parseConfig (via AuthManager)', () => {
  it('should throw when SERVICENOW_INSTANCE_URL is missing', async () => {
    vi.stubEnv('AUTH_TYPE', 'api_key');
    vi.stubEnv('SERVICENOW_API_KEY', 'some-key');
    // SERVICENOW_INSTANCE_URL intentionally not set
    const manager = new AuthManager();
    await expect(manager.getHeaders()).rejects.toThrow('Config validation failed');
  });

  it('should throw when SERVICENOW_INSTANCE_URL has a trailing slash', async () => {
    vi.stubEnv('SERVICENOW_INSTANCE_URL', 'https://dev12345.service-now.com/');
    vi.stubEnv('AUTH_TYPE', 'api_key');
    vi.stubEnv('SERVICENOW_API_KEY', 'some-key');
    const manager = new AuthManager();
    await expect(manager.getHeaders()).rejects.toThrow('Config validation failed');
  });

  it('should throw when AUTH_TYPE is an unsupported value', async () => {
    vi.stubEnv('SERVICENOW_INSTANCE_URL', 'https://dev12345.service-now.com');
    vi.stubEnv('AUTH_TYPE', 'magic_token');
    vi.stubEnv('SERVICENOW_API_KEY', 'some-key');
    const manager = new AuthManager();
    await expect(manager.getHeaders()).rejects.toThrow('Config validation failed');
  });

  it('should throw when AUTH_TYPE=api_key but SERVICENOW_API_KEY is absent', async () => {
    vi.stubEnv('SERVICENOW_INSTANCE_URL', 'https://dev12345.service-now.com');
    vi.stubEnv('AUTH_TYPE', 'api_key');
    // SERVICENOW_API_KEY intentionally not set
    const manager = new AuthManager();
    await expect(manager.getHeaders()).rejects.toThrow('Config validation failed');
  });
});

// ---------------------------------------------------------------------------
// AuthManager.getHeaders() — api_key mode
// ---------------------------------------------------------------------------
describe('AuthManager', () => {
  describe('getHeaders()', () => {
    it('should return x-sn-apikey header with the configured key', async () => {
      vi.stubEnv('SERVICENOW_INSTANCE_URL', BASE_ENV.SERVICENOW_INSTANCE_URL);
      vi.stubEnv('AUTH_TYPE', BASE_ENV.AUTH_TYPE);
      vi.stubEnv('SERVICENOW_API_KEY', BASE_ENV.SERVICENOW_API_KEY);

      const manager = new AuthManager();
      const headers = await manager.getHeaders();

      expect(headers).toEqual({ 'x-sn-apikey': 'test-api-key-abc123' });
    });

    it('should not include an Authorization header', async () => {
      vi.stubEnv('SERVICENOW_INSTANCE_URL', BASE_ENV.SERVICENOW_INSTANCE_URL);
      vi.stubEnv('AUTH_TYPE', BASE_ENV.AUTH_TYPE);
      vi.stubEnv('SERVICENOW_API_KEY', BASE_ENV.SERVICENOW_API_KEY);

      const manager = new AuthManager();
      const headers = await manager.getHeaders();

      expect(headers).not.toHaveProperty('Authorization');
      expect(headers).not.toHaveProperty('authorization');
    });

    it('should return exactly one header key', async () => {
      vi.stubEnv('SERVICENOW_INSTANCE_URL', BASE_ENV.SERVICENOW_INSTANCE_URL);
      vi.stubEnv('AUTH_TYPE', BASE_ENV.AUTH_TYPE);
      vi.stubEnv('SERVICENOW_API_KEY', BASE_ENV.SERVICENOW_API_KEY);

      const manager = new AuthManager();
      const headers = await manager.getHeaders();

      expect(Object.keys(headers)).toHaveLength(1);
    });

    it('should reflect the exact value of SERVICENOW_API_KEY', async () => {
      const customKey = 'my-custom-key-xyz-9999';
      vi.stubEnv('SERVICENOW_INSTANCE_URL', BASE_ENV.SERVICENOW_INSTANCE_URL);
      vi.stubEnv('AUTH_TYPE', 'api_key');
      vi.stubEnv('SERVICENOW_API_KEY', customKey);

      const manager = new AuthManager();
      const headers = await manager.getHeaders();

      expect(headers['x-sn-apikey']).toBe(customKey);
    });

    it('should throw AuthError when SERVICENOW_API_KEY is missing', async () => {
      vi.stubEnv('SERVICENOW_INSTANCE_URL', BASE_ENV.SERVICENOW_INSTANCE_URL);
      vi.stubEnv('AUTH_TYPE', 'api_key');
      // SERVICENOW_API_KEY intentionally not set

      const manager = new AuthManager();
      await expect(manager.getHeaders()).rejects.toThrow('Config validation failed');
    });

    it('should throw AuthError for unsupported AUTH_TYPE', async () => {
      vi.stubEnv('SERVICENOW_INSTANCE_URL', BASE_ENV.SERVICENOW_INSTANCE_URL);
      vi.stubEnv('AUTH_TYPE', 'basic'); // defined but not implemented in api_key-only build
      vi.stubEnv('SERVICENOW_USERNAME', 'user');
      vi.stubEnv('SERVICENOW_PASSWORD', 'pass');

      const manager = new AuthManager();
      await expect(manager.getHeaders()).rejects.toThrow(AuthError);
    });
  });
});

// ---------------------------------------------------------------------------
// AuthError
// ---------------------------------------------------------------------------
describe('AuthError', () => {
  it('should be an instance of Error', () => {
    const err = new AuthError('something went wrong');
    expect(err).toBeInstanceOf(Error);
  });

  it('should have name "AuthError"', () => {
    const err = new AuthError('something went wrong');
    expect(err.name).toBe('AuthError');
  });

  it('should carry the provided message', () => {
    const err = new AuthError('missing api key');
    expect(err.message).toBe('missing api key');
  });
});
