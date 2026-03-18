import { z } from 'zod';

export const ServerConfigSchema = z.object({
  SERVICENOW_INSTANCE_URL: z
    .string()
    .url({ message: 'SERVICENOW_INSTANCE_URL must be a valid URL' })
    .refine((url) => !url.endsWith('/'), {
      message: 'SERVICENOW_INSTANCE_URL must not have a trailing slash',
    }),
  AUTH_TYPE: z.enum(['api_key', 'basic', 'oauth'], {
    message: "AUTH_TYPE must be one of: api_key, basic, oauth",
  }),
  SERVICENOW_API_KEY: z.string().optional(),
  SERVICENOW_USERNAME: z.string().optional(),
  SERVICENOW_PASSWORD: z.string().optional(),
  SERVICENOW_TIMEOUT: z.coerce.number().positive().default(30000),
  MCP_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),
  MCP_PORT: z.coerce.number().positive().default(8080),
  MCP_SERVER_API_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.string().optional(),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

const ApiKeyAuthConfigSchema = ServerConfigSchema.refine(
  (cfg) => cfg.AUTH_TYPE !== 'api_key' || cfg.SERVICENOW_API_KEY !== undefined,
  {
    message: 'SERVICENOW_API_KEY is required when AUTH_TYPE=api_key',
    path: ['SERVICENOW_API_KEY'],
  },
);

export function parseConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const result = ApiKeyAuthConfigSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Config validation failed:\n${result.error.toString()}`);
  }
  return result.data;
}
