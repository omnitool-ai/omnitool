/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import type Nano from 'nano';
import { type DBServiceProvider } from './DBService/DBServiceProvider.js';
import { type IManager, type IServiceConfig, Service } from 'omni-shared';
import { DBSQLiteServiceProvider } from './DBService/DBSQLiteServiceProvider.js';

interface QueryResult {
  docs: Array<any>;
  totalPages: number | undefined;
  totalDocs: number | undefined;
  page: number | undefined;
  docsPerPage: number | undefined;
}
function CreateQueryResult(): QueryResult {
  return { docs: [], totalPages: undefined, totalDocs: undefined, page: undefined, docsPerPage: undefined };
}

interface IDBServerServiceConfig extends IServiceConfig {
  couchDbUrl: string;
  username: string;
  password: string;
  reauthAfterMs: number;
  pocketbase: {
    local: {
      dbUrl: string;
      login: string;
    };
    development: {
      dbUrl: string;
    };
  };
  kvStorage: {
    dbPath: string;
  }
  pocketbaseDbUrl: string;
  pocketbaseDbAdmin: string;
  flushLogs: boolean;
}

enum OMNITOOL_DOCUMENT_TYPES {
  WORKFLOW = 'wf',
  USER = 'user',
  USERDOC = 'udoc',
  CHAT = 'chat',
  GROUP = 'Group'
}

class DBService extends Service {
  db: any;
  nano: any;
  lastAuth: number = 0;

  provider: DBServiceProvider;

  constructor(id: string, manager: IManager, config: IDBServerServiceConfig) {
    super(id, manager, config || { id });

    this.provider = new DBSQLiteServiceProvider(this, config);
  }

  async getDocumentsByOwnerId(
    document_type: OMNITOOL_DOCUMENT_TYPES,
    ownerIds: string | string[],
    allowPublic: boolean = false,
    limit?: number,
    skip?: number,
    bookmark?: string
  ): Promise<QueryResult> {
    const result = await this.provider.getDocumentsByOwnerId(
      document_type,
      ownerIds,
      allowPublic,
      limit,
      skip,
      bookmark
    );
    return result;
  }

  async getDocumentsByOwnerIdV2(
    document_type: OMNITOOL_DOCUMENT_TYPES,
    ownerIds: string[],
    page: number,
    limitPerPage: number,
    customFilters?: Map<string, string>
  ): Promise<QueryResult> {
    const result = await this.provider.getDocumentsByOwnerIdV2(
      document_type,
      ownerIds,
      page,
      limitPerPage,
      customFilters
    );
    return result;
  }

  async putDocumentById(
    document_type: OMNITOOL_DOCUMENT_TYPES,
    document_id: string,
    value: any,
    _rev?: string
  ): Promise<Nano.MaybeDocument> {
    const result = await this.provider.putDocumentById(document_type, document_id, value, _rev);
    return result;
  }

  async deleteDocumentById(document_type: OMNITOOL_DOCUMENT_TYPES, document_id: string, _rev: string): Promise<any> {
    await this.provider.deleteDocumentById(document_type, document_id, _rev);
  }

  async getDocumentById(
    document_type: OMNITOOL_DOCUMENT_TYPES,
    document_id: string,
    ownerIds: string | string[] = [],
    allowPublic: boolean
  ): Promise<QueryResult> {
    const result = await this.provider.getDocumentById(document_type, document_id, ownerIds, allowPublic);
    return result;
  }

  async createIndex(indexDefinition: any): Promise<boolean> {
    const result = await this.provider.createIndex(indexDefinition);
    return result;
  }

  async start(): Promise<boolean> {
    return true;
  }

  async load(): Promise<boolean> {
    const result = await this.provider.connect();
    return result;
  }

  async put(doc: Nano.MaybeDocument): Promise<Nano.MaybeDocument> {
    const result = await this.provider.put(doc);
    return result;
  }

  async get(id: string): Promise<Nano.MaybeDocument | null> {
    const result = await this.provider.get(id);
    return result;
  }

  async delete(doc: Nano.MaybeDocument) {
    const result = await this.provider.delete(doc);
    return result;
  }

  async deleteMany(docs: Nano.MaybeDocument[]): Promise<any> {
    const result = await this.provider.deleteMany(docs);
    return result;
  }

  async list(startkey?: string, endkey?: string, include_docs: boolean = false, limit?: number): Promise<any> {
    const result = await this.provider.list(startkey, endkey, include_docs, limit);
    return result;
  }

  async find(
    selector: any,
    fields?: Array<string>,
    limit?: number,
    skip?: number,
    bookmark?: string,
    use_index?: string
  ): Promise<any[]> {
    const result = await this.provider.find(selector, fields, limit, skip, bookmark, use_index);
    return result;
  }

  async hasTable(tablename: string): Promise<boolean> {
    return await this.provider.hasTable(tablename);
  }

  async flushLog(level: string, msg: string, tag?: string): Promise<void> {
    await this.provider.flushLog(level, msg, tag);
  }
}

export { DBService, type IDBServerServiceConfig, type QueryResult, CreateQueryResult, OMNITOOL_DOCUMENT_TYPES };
