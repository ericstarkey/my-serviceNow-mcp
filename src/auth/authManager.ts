import { parseConfig } from './config.js';
import { logger } from '../logger.js';

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class AuthManager {
  async getHeaders(): Promise<Record<string, string>> {
    const config = parseConfig(process.env);

    if (config.AUTH_TYPE === 'api_key') {
      // parseConfig guarantees SERVICENOW_API_KEY is present for api_key auth,
      // but the type system marks it optional — assert here for safety.
      if (!config.SERVICENOW_API_KEY) {
        throw new AuthError('SERVICENOW_API_KEY is required when AUTH_TYPE=api_key');
      }
      logger.debug('Using API key auth (x-sn-apikey header)');
      return { 'x-sn-apikey': config.SERVICENOW_API_KEY };
    }

    throw new AuthError(`AUTH_TYPE "${config.AUTH_TYPE}" is not supported by this server`);
  }
}
