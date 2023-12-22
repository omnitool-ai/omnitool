import { type OMNITOOL_DOCUMENT_TYPES, type QueryResult } from 'services/DBService.js';
import { DBServiceProvider, DBServiceProviders } from './DBServiceProvider.js';
import { type IService } from 'omni-shared/lib/core/Service.js';
import { type IKVStorageConfig, KVStorage } from 'core/KVStorage.js';
import { DBCouchToSQLiteQuerifier } from './DBCouchToSQLiteQuerifier.js';
import { User } from 'omni-shared';

interface DBSQLiteProviderConfig {
  kvStorage: {
    dbPath: string;
  };
}

interface KVStoreRow {
  value: string;
  valueType: string;
  blob: Buffer;
  expiry: number;
  tags: string;
}

const OMNI_ID = (document_type: OMNITOOL_DOCUMENT_TYPES, docId: string) => `${document_type}:${docId}`;
const DB_MONO_DBNAME = 'legacy_monolith.db';

class DBSQLiteServiceProvider extends DBServiceProvider {
  db: KVStorage;

  constructor(service: IService, config: DBSQLiteProviderConfig) {
    super(DBServiceProviders.SQLite, service, config);
    this.db = new KVStorage(this.service.app, {
      dbPath: config.kvStorage.dbPath,
      dbName: DB_MONO_DBNAME
    } satisfies IKVStorageConfig);
  }

  async getDocumentsByOwnerId(
    document_type: OMNITOOL_DOCUMENT_TYPES,
    ownerIds: string | string[],
    allowPublic: boolean,
    limit?: number | undefined,
    skip?: number | undefined,
    bookmark?: string | undefined
  ): Promise<QueryResult> {
    throw new Error('Method deprecated. Use getDocumentsByOwnerIdV2() instead.');
  }
  async getDocumentsByOwnerIdV2(
    document_type: OMNITOOL_DOCUMENT_TYPES,
    ownerIds: string[],
    page: number,
    limitPerPage: number,
    customFilters?: Map<string, string> | undefined
  ): Promise<QueryResult> {
    // Base query for documents
    let baseQuery = `FROM kvstore WHERE key LIKE '${document_type}:%' AND (${ownerIds
      .map((id) => `json_extract(value, '$.owner') = '${id}'`)
      .join(' OR ')}) `;

    // Custom filters using LIKE
    if (customFilters && customFilters.size > 0) {
      baseQuery += 'AND (';
      customFilters.forEach((value, key) => {
        baseQuery += `json_extract(value, '$.${key}') LIKE '%${value}%' OR `;
      });
      baseQuery = baseQuery.slice(0, -3);
      baseQuery += ') ';
    }

    // Query for fetching documents
    let query = `SELECT * ${baseQuery}`;

    // Pagination
    const offset = (page - 1) * limitPerPage;
    query += `LIMIT ${limitPerPage} OFFSET ${offset}`;

    // Query for counting total documents
    const countQuery = `SELECT COUNT(*) AS total ${baseQuery}`;

    // Execute query
    let docs = this.db.db.prepare(query).all() as KVStoreRow[];
    docs = docs.map((doc) => { return this.db._getRowValue(doc)});
    const totalDocsResult = this.db.db.prepare(countQuery).get();
    // @ts-ignore
    const totalDocs = Number(totalDocsResult.total);
    const totalPages = Math.ceil(totalDocs / limitPerPage);
    return {
      docs,
      totalPages,
      totalDocs,
      page,
      docsPerPage: limitPerPage
    };
  }
  async putDocumentById(
    document_type: OMNITOOL_DOCUMENT_TYPES,
    document_id: string,
    value: any,
    _rev?: string | undefined
  ): Promise<object> {
    this.db.set(OMNI_ID(document_type, document_id), value);
    return value;
  }
  async deleteDocumentById(document_type: OMNITOOL_DOCUMENT_TYPES, document_id: string, _rev: string): Promise<void> {
    this.db.del(OMNI_ID(document_type, document_id));
  }
  async getDocumentById(
    document_type: OMNITOOL_DOCUMENT_TYPES,
    document_id: string,
    ownerIds: string | string[],
    allowPublic: boolean
  ): Promise<any> {
    return this.db.get(OMNI_ID(document_type, document_id));
  }
  async createIndex(indexDefinition: any): Promise<boolean> {
    throw new Error('Method not implemented.');
  }
  async connect(): Promise<boolean> {
    return await this.db.init();
  }
  async put(doc: object): Promise<object> {
    if (!doc.hasOwnProperty('_id')) {
      throw new Error('Legacy document must have an _id property');
    }
    // @ts-ignore
    const omni_id: string = doc['_id'];
    this.db.set(omni_id, doc);
    return doc;
  }
  async get(id: string): Promise<object | null> {
    // @ts-ignore
    return this.db.get(id);
  }
  async delete(doc: object): Promise<any> {
    if (!doc.hasOwnProperty('_id')) {
      throw new Error('Legacy document must have an _id property');
    }
    // @ts-ignore
    const omni_id: string = doc['_id'];
    this.db.del(omni_id);
    return true;
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
  ): Promise<any[] | undefined> {
    const query = { selector, fields, limit, skip, bookmark, use_index };
    const sql: string = DBCouchToSQLiteQuerifier.translateQuery(query);
    let result = this.db.db.prepare(sql).all() as KVStoreRow[];
    result = result.map((doc) => {
      return this.db._getRowValue(doc)});
    return result;
  }
  async authWithPassword(username: string, password: string): Promise<any> {
    throw new Error('Method not implemented.');
  }
  async authAsAdmin(): Promise<User | undefined> {
    // Legacy user linked from pocketbase
    const query = {
      authType: 'pocketbase'
    }

    const result = await this.find(query, undefined, undefined, undefined, undefined, 'externalId')
    if (result && Array.isArray(result) && result.length > 0) {
      const user = User.fromJSON(result[0]);
      return user;
    }

    // Legacy user doesn't exist
    return undefined
  }
  async hasTable(tablename: string): Promise<boolean> {
    throw new Error('Method not implemented.');
  }
  async flushLog(level: string, msg: string, tag?: string | undefined): Promise<void> {
    //throw new Error('Method not implemented.');
  }
}

export { DBSQLiteServiceProvider };
