/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { CreateQueryResult, type OMNITOOL_DOCUMENT_TYPES, type QueryResult } from '../DBService.js';
import { DBServiceProvider, DBServiceProviders } from './DBServiceProvider.js';
import PocketBase, { type ClientResponseError, type RecordModel as Record } from 'pocketbase';
import { type IService, omnilog } from 'omni-shared';
import { DBCouchToPocketQuerifier } from './DBCouchToPocketQuerifier.js';
import pb_schemas from './pb_schema.json' assert { type: 'json' };
import { User } from 'omni-shared';

const MONO_COLLECTION_ID = 'legacyMonoCollection';
const LOG_COLLECTION = 'logs';

const OMNI_ID = (document_type: OMNITOOL_DOCUMENT_TYPES, docId: string) => `${document_type}:${docId}`;
const OMNI_PREFIX = (document_type: OMNITOOL_DOCUMENT_TYPES) => `${document_type}:`;
const PB_NOT_FOUND = 404;

interface DBPocketBaseProviderConfig {
  pocketbaseDbUrl: string;
  pocketbaseDbAdmin: string;
}

class DBPocketBaseServiceProvider extends DBServiceProvider {
  db: PocketBase | null;

  constructor(service: IService, config: DBPocketBaseProviderConfig) {
    super(DBServiceProviders.PocketBase, service, config);
    this.db = null;
  }

  get config(): DBPocketBaseProviderConfig {
    return this._config as DBPocketBaseProviderConfig;
  }

  _transformParamFilterQuery(input: Map<string, string>): string {
    let query: string = '';
    input.forEach((value, key) => {
      query += `blob.${key}~'${value}'`;
      query += ' || ';
    });
    query = query.slice(0, -4);
    return query;
  }

  async getDocumentsByOwnerIdV2(
    document_type: OMNITOOL_DOCUMENT_TYPES,
    ownerIds: string[],
    page: number,
    limitPerPage: number,
    customFilters?: Map<string, string>
  ): Promise<QueryResult> {
    const flatOwnerIds = JSON.stringify(ownerIds);
    // API assumes zero-index paging but PocketBase starts from 1...
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const pktbase_page = page + 1;
    const result: QueryResult = CreateQueryResult();
    let pkbFilter = `omni_id~'${OMNI_PREFIX(document_type)}' && '${flatOwnerIds}'~blob.owner`;
    if (customFilters !== undefined && customFilters.size > 0) {
      pkbFilter += ' && (';
      pkbFilter += this._transformParamFilterQuery(customFilters);
      pkbFilter += ')';
    }
    try {
      const pkbResult = await this.db?.collection(MONO_COLLECTION_ID).getList(pktbase_page, limitPerPage, {
        filter: pkbFilter
      });
      if (pkbResult?.items !== undefined) {
        result.docs = pkbResult.items.map((r) => r.blob);
        result.page = page;
        result.docsPerPage = limitPerPage;
        result.totalPages = pkbResult.totalPages;
        result.totalDocs = pkbResult.totalItems;
        return result;
      }
    } catch (e) {
      const pbe = e as ClientResponseError;
      if (pbe.status === 404) {
        return result;
      }
      this._throwPocketExceptions(pbe);
    }
    return result;
  }

  async getDocumentsByOwnerId(
    document_type: OMNITOOL_DOCUMENT_TYPES,
    ownerIds: string | string[],
    allowPublic: boolean,
    limit?: number | undefined,
    skip?: number | undefined,
    bookmark?: string | undefined
  ): Promise<QueryResult> {
    const flatOwnerIds = JSON.stringify(ownerIds);
    const result: QueryResult = CreateQueryResult();
    try {
      const pkbResult = await this.db?.collection(MONO_COLLECTION_ID).getFullList({
        filter: `omni_id~'${OMNI_PREFIX(
          document_type
        )}' && '${flatOwnerIds}'~blob.owner || '${flatOwnerIds}'~blob.meta.owner`
      });
      if (pkbResult !== undefined) {
        result.docs = pkbResult.map((r) => r.blob);
        return result;
      }
    } catch (e) {
      const pbe = e as ClientResponseError;
      if (pbe.status === 404) {
        return result;
      }
      this._throwPocketExceptions(pbe);
    }
    return result;
  }

  async putDocumentById(
    document_type: OMNITOOL_DOCUMENT_TYPES,
    document_id: string,
    value: {},
    _rev?: string | undefined
  ): Promise<any> {
    const record = await this._updateCreateRecord(OMNI_ID(document_type, document_id), value);
    if (record !== undefined) {
      return record.blob;
    }
    return undefined;
  }

  async deleteDocumentById(document_type: OMNITOOL_DOCUMENT_TYPES, document_id: string, _rev: string): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async getDocumentById(
    document_type: OMNITOOL_DOCUMENT_TYPES,
    document_id: string,
    ownerIds: string | string[],
    _allowPublic: boolean
  ): Promise<any> {
    const record = await this._getRecord(OMNI_ID(document_type, document_id));
    if (record === undefined) {
      return undefined;
    }
    const doc = record.blob;
    // enforcement
    if (ownerIds.length > 0 && doc.owner !== undefined) {
      return ownerIds.includes(doc.owner) ? doc : undefined;
    }
    // no enforcement
    else {
      return doc;
    }
  }

  // eslint-disable-next-line @typescript-eslint/promise-function-async
  createIndex(indexDefinition: any): Promise<boolean> {
    throw new Error('Method not implemented.');
  }

  async connect(): Promise<boolean> {
    if (this.db !== null) {
      throw new Error('Attempting to re-init over existing DB connection');
    }
    this.db = new PocketBase(this.config.pocketbaseDbUrl);
    this.db.autoCancellation(false);
    await this.ensureCollections();
    return true;
  }

  async ensureCollections(): Promise<void> {
    for (const schema of pb_schemas) {
      if (!(await this.hasTable(schema.name))) {
        await this.createTable(schema.name, schema);
        // verify integrity or throw
        void (await this.db?.collection(schema.name).getList());
      } else {
        // verify integrity or throw
        void (await this.db?.collection(schema.name).getList());
      }
    }
  }

  async hasTable(tablename: string): Promise<boolean> {
    try {
      const record = this.db?.collection(tablename);
      await record?.getList();
      // if it doesn't throw it means it exists
      return true;
    } catch (e) {
      const pbe = e as ClientResponseError;
      if (pbe.status === undefined) {
        throw e;
      }
      switch (pbe.status) {
        case 404:
          return false; // not found
        default:
          this._throwPocketExceptions(pbe);
          return false;
      }
    }
  }

  async createTable(tablename: string, schema: any): Promise<void> {
    try {
      await this.authAsAdmin();
      schema.name = tablename;
      void (await this.db?.collections.create(schema));
      omnilog.info(`Created table ${tablename}`);
    } catch (e) {
      this._throwPocketExceptions(e as ClientResponseError);
    } finally {
      this.logout();
    }
  }

  async flushLog(level: string, msg: string, tag: string = 'omni-server'): Promise<void> {
    if (!this.db) {
      return;
    }

    await this.db.collection(LOG_COLLECTION).create({
      tag,
      level,
      blob: {
        msg
      }
    });
  }

  async _getRecord(omni_id: string): Promise<Record | undefined> {
    try {
      const collection = this.db?.collection(MONO_COLLECTION_ID);

      if (collection === undefined) {
        omnilog.warn('Unable to get collection');
        return undefined;
      }
      const first_item = await collection.getFirstListItem(`omni_id='${omni_id}'`);
      return first_item;
    } catch (e) {
      const pbe = e as ClientResponseError;
      if (pbe.status === undefined) {
        throw e;
      }
      switch (pbe.status) {
        case 404:
          return undefined; // not found
        default:
          this._throwPocketExceptions(pbe);
          break;
      }
    }
  }

  _throwPocketExceptions(e: ClientResponseError) {
    // eslint-disable-next-line no-prototype-builtins
    if (e.originalError?.cause?.hasOwnProperty('code')) {
      if (e.originalError.cause.code === 'ECONNREFUSED') {
        omnilog.error(`Please make sure POCKETBASE DB is running on ${this.db?.baseUrl}!`);
      }
    }
    throw new Error(e.originalError);
  }

  async _createRecord(omni_id: string, doc: object): Promise<Record | undefined> {
    return await this.db?.collection(MONO_COLLECTION_ID).create({
      omni_id,
      blob: doc
    });
  }

  async _updateCreateRecord(omni_id: string, doc: object): Promise<Record> {
    let record = await this._getRecord(omni_id);
    if (record === undefined) {
      record = await this._createRecord(omni_id, doc);
    }
    if (record === undefined) {
      throw new Error('Unable to create record ' + omni_id);
    }
    // @ts-ignore
    return await this.db.collection(MONO_COLLECTION_ID).update(record.id, {
      blob: doc
    });
  }

  async _deleteRecord(omni_id: string): Promise<boolean> {
    const record = await this._getRecord(omni_id);
    if (record === undefined) {
      throw new Error('Unable to find record to delete ' + omni_id);
    }
    // @ts-ignore
    return await this.db.collection(MONO_COLLECTION_ID).delete(record.id);
  }

  async put(doc: object): Promise<object> {
    if (!doc.hasOwnProperty('_id')) {
      throw new Error('Unexpected legacy document');
    }
    // @ts-ignore migrate couch DB id to pocketbase lookup
    const omni_id = doc._id;
    const record = await this._updateCreateRecord(omni_id, doc);
    return record ? record.blob : undefined;
  }

  async get(id: string): Promise<object | null> {
    const record = await this._getRecord(id);
    return record ? record.blob : null;
  }

  async delete(doc: object): Promise<any> {
    if (!doc.hasOwnProperty('_id')) {
      throw new Error('Unexpected legacy document');
    }
    // @ts-ignore migrate couch DB id to pocketbase lookup
    const omni_id = doc._id;
    return await this._deleteRecord(omni_id);
  }

  async deleteMany(docs: object[]): Promise<any> {
    throw new Error('Method not implemented.');
  }

  async list(
    startkey: string | undefined,
    endkey: string | undefined,
    include_docs: boolean,
    limit?: number | undefined
  ): Promise<any> {
    throw new Error('Method not implemented.');
  }

  async find(
    selector: any,
    fields?: string[] | undefined,
    limit?: number | undefined,
    skip?: number | undefined,
    bookmark?: string | undefined,
    use_index?: string | undefined
  ): Promise<any> {
    const query = { selector, fields, limit, skip, bookmark, use_index };
    const filter: string = DBCouchToPocketQuerifier.translateQuery(query);
    try {
      const result = await this.db?.collection(MONO_COLLECTION_ID).getFullList({ filter });
      if (result !== undefined) {
        return result.map((r) => r.blob);
      }
      return undefined;
    } catch (e) {
      const pbe = e as ClientResponseError;
      if (pbe.status === PB_NOT_FOUND) {
        return undefined;
      }
      this._throwPocketExceptions(pbe);
    }
  }

  async authWithPassword(username: string, password: string): Promise<any> {
    return await this.db?.admins.authWithPassword(username, password);
  }

  async authAsAdmin(): Promise<User | undefined> {
    const config = this.config;
    const authData = await this.authWithPassword(config.pocketbaseDbAdmin, config.pocketbaseDbAdmin);
    if (authData) {
      const query = {
        externalId: authData.admin.id,
        authType: 'pocketbase'
      };

      const result = this.find(query, undefined, undefined, undefined, undefined, 'externalId')
      if (result && Array.isArray(result) && result.length > 0) {
        const user = User.fromJSON(result[0]);
        return user;
      }
      return undefined
    } else {
      throw new Error("Invalid pocketdb login")
    }
  }

  logout(): void {
    this.db?.authStore.clear();
  }
}

export { DBPocketBaseServiceProvider, type DBPocketBaseProviderConfig };
