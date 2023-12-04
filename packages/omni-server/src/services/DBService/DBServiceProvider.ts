/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type IService, type User } from 'omni-shared';
import { type OMNITOOL_DOCUMENT_TYPES, type QueryResult } from '../DBService.js';

enum DBServiceProviders {
  CouchDB,
  PocketBase,
  SQLite
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface IDBServiceProviderConfig {}

abstract class DBServiceProvider {
  id: DBServiceProviders;

  service: IService;
  _config: IDBServiceProviderConfig;

  constructor(id: DBServiceProviders, service: IService, config: IDBServiceProviderConfig) {
    this.id = id;
    this.service = service;
    this._config = config;
  }

  abstract getDocumentsByOwnerId(
    document_type: OMNITOOL_DOCUMENT_TYPES,
    ownerIds: string | string[],
    allowPublic: boolean,
    limit?: number,
    skip?: number,
    bookmark?: string
  ): Promise<QueryResult>;
  abstract getDocumentsByOwnerIdV2(
    document_type: OMNITOOL_DOCUMENT_TYPES,
    ownerIds: string[],
    page: number,
    limitPerPage: number,
    customFilters?: Map<string, string>
  ): Promise<QueryResult>;
  abstract putDocumentById(
    document_type: OMNITOOL_DOCUMENT_TYPES,
    document_id: string,
    value: any,
    _rev?: string
  ): Promise<object>;
  abstract deleteDocumentById(document_type: OMNITOOL_DOCUMENT_TYPES, document_id: string, _rev: string): Promise<void>;
  abstract getDocumentById(
    document_type: OMNITOOL_DOCUMENT_TYPES,
    document_id: string,
    ownerIds: string | string[],
    allowPublic: boolean
  ): Promise<any>;
  abstract createIndex(indexDefinition: any): Promise<boolean>;
  abstract connect(): Promise<boolean>;
  abstract put(doc: object): Promise<object>;
  abstract get(id: string): Promise<object | null>;
  abstract delete(doc: object): Promise<any>;
  abstract deleteMany(docs: object[]): Promise<any>;
  abstract list(
    startkey: string | undefined,
    endkey: string | undefined,
    include_docs: boolean,
    limit?: number
  ): Promise<any>;
  abstract find(
    selector: any,
    fields?: Array<string>,
    limit?: number,
    skip?: number,
    bookmark?: string,
    use_index?: string
  ): Promise<any>;
  abstract authWithPassword(username: string, password: string): Promise<any>;
  abstract authAsAdmin(): Promise<User | undefined>;
  abstract hasTable(tablename: string): Promise<boolean>;
  abstract flushLog(level: string, msg: string, tag?: string): Promise<void>;
}

export { DBServiceProvider, DBServiceProviders, type IDBServiceProviderConfig };
