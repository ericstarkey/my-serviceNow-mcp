import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { parseConfig } from '../auth/config.js';
import type { AuthManager } from '../auth/authManager.js';
import { logger } from '../logger.js';
import type { ServiceNowErrorBody } from './types.js';

export class ServiceNowError extends Error {
  readonly statusCode: number;
  readonly detail: string;

  constructor(message: string, statusCode: number, detail: string) {
    super(message);
    this.name = 'ServiceNowError';
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

function isServiceNowErrorBody(data: unknown): data is ServiceNowErrorBody {
  return (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof (data as ServiceNowErrorBody).error?.message === 'string'
  );
}

function hasResponse(
  error: unknown,
): error is { response: { status: number; data: unknown }; message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as Record<string, unknown>)['response'] === 'object' &&
    (error as Record<string, unknown>)['response'] !== null
  );
}

export function createServiceNowClient(authManager: AuthManager): AxiosInstance {
  const config = parseConfig(process.env);
  const baseURL = `${config.SERVICENOW_INSTANCE_URL}/api/now/table`;

  const instance = axios.create({
    baseURL,
    timeout: config.SERVICENOW_TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  // Request interceptor: inject auth headers on every outbound request
  instance.interceptors.request.use(async (requestConfig) => {
    const authHeaders = await authManager.getHeaders();
    Object.assign(requestConfig.headers, authHeaders);
    return requestConfig;
  });

  // Response interceptor: normalise errors into ServiceNowError
  instance.interceptors.response.use(
    (response) => response,
    (error: unknown) => {
      let statusCode = 0;
      let message: string;
      let detail = '';

      if (hasResponse(error)) {
        statusCode = (error.response as { status: number }).status;
        const data = (error.response as { data: unknown }).data;

        if (isServiceNowErrorBody(data)) {
          message = data.error.message;
          detail = data.error.detail;
        } else {
          message = (error as { message: string }).message;
        }
      } else {
        message =
          typeof (error as Record<string, unknown>)['message'] === 'string'
            ? ((error as Record<string, unknown>)['message'] as string)
            : 'Unknown error';
      }

      logger.error(`ServiceNow API error ${statusCode}: ${message}`, { detail });
      throw new ServiceNowError(message, statusCode, detail);
    },
  );

  return instance;
}
