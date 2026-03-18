export interface ServiceNowRecord {
  sys_id: string;
  number?: string;
  [key: string]: unknown;
}

export interface ServiceNowListResponse<T = ServiceNowRecord> {
  result: T[];
}

export interface ServiceNowSingleResponse<T = ServiceNowRecord> {
  result: T;
}

export interface ServiceNowErrorBody {
  error: {
    message: string;
    detail: string;
  };
  status: 'failure';
}

export interface CreateRecordOptions {
  table: string;
  fields: Record<string, unknown>;
}

export interface GetRecordOptions {
  table: string;
  sysId: string;
}

export interface QueryRecordsOptions {
  table: string;
  query?: string;
  fields?: string[];
  limit?: number;
  offset?: number;
}
