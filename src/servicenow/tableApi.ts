import type { AxiosInstance } from 'axios';
import type {
  ServiceNowRecord,
  ServiceNowListResponse,
  ServiceNowSingleResponse,
  CreateRecordOptions,
  GetRecordOptions,
  QueryRecordsOptions,
} from './types.js';

const DEFAULT_PARAMS = {
  sysparm_display_value: 'true',
  sysparm_exclude_reference_link: 'true',
} as const;

export class TableApi {
  constructor(private readonly client: AxiosInstance) {}

  async createRecord(options: CreateRecordOptions): Promise<ServiceNowRecord> {
    const response = await this.client.post<ServiceNowSingleResponse>(
      `/${options.table}`,
      options.fields,
      { params: DEFAULT_PARAMS },
    );
    return response.data.result;
  }

  async getRecord(options: GetRecordOptions): Promise<ServiceNowRecord> {
    const response = await this.client.get<ServiceNowSingleResponse>(
      `/${options.table}/${options.sysId}`,
      { params: DEFAULT_PARAMS },
    );
    return response.data.result;
  }

  async queryRecords(options: QueryRecordsOptions): Promise<ServiceNowRecord[]> {
    const params: Record<string, string | number> = { ...DEFAULT_PARAMS };

    if (options.query !== undefined) {
      params['sysparm_query'] = options.query;
    }
    if (options.limit !== undefined) {
      params['sysparm_limit'] = options.limit;
    }
    if (options.offset !== undefined) {
      params['sysparm_offset'] = options.offset;
    }
    if (options.fields !== undefined && options.fields.length > 0) {
      params['sysparm_fields'] = options.fields.join(',');
    }

    const response = await this.client.get<ServiceNowListResponse>(
      `/${options.table}`,
      { params },
    );
    return response.data.result;
  }
}
