/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type IService, type User } from 'omni-shared';
import Nano, { type MangoQuery } from 'nano';
import { DBServiceProvider, DBServiceProviders, type IDBServiceProviderConfig } from './DBServiceProvider.js';
import { OMNITOOL_DOCUMENT_TYPES, type QueryResult } from '../DBService.js';

const DB_INDEXES = [
  {
    index: {
      fields: ['_id', 'id', 'owner']
    },
    name: 'id-owner-index',
    type: 'json'
  },
  {
    index: {
      fields: ['name']
    },
    name: 'name',
    type: 'json'
  },
  {
    index: {
      fields: ['externalId']
    },
    name: 'externalId',
    type: 'json'
  },
  {
    index: {
      fields: ['username']
    },
    name: 'username',
    type: 'json'
  }
];

interface IDBCouchServiceProvider extends IDBServiceProviderConfig {
  couchDbUrl: string;
  username: string;
  password: string;
  reauthAfterMs: number;
}

class DBCouchServiceProvider extends DBServiceProvider {
  db: any;
  nano: any;
  lastAuth: number = 0;

  constructor(service: IService, config: IDBCouchServiceProvider) {
    super(DBServiceProviders.CouchDB, service, config);
  }

  get config(): IDBCouchServiceProvider {
    return this._config as IDBCouchServiceProvider;
  }

  async hasTable(tablename: string): Promise<boolean> {
    throw new Error('Method not implemented.');
  }

  async flushLog(level: string, msg: string, tag?: string): Promise<void> {
    throw new Error('Method not implemented.');
  }

  // CouchDB Authentication Sessions periodically expire, so we need to re-authenticate.
  // We do this by storing the last authentication time and, after a configured time
  // has passed, triggering reauthentication from any database call
  async checkAuth() {
    const config = this.config;
    if (this.lastAuth + (config.reauthAfterMs || 3600000) < Date.now()) {
      this.service.info('(Re)authenticating to CouchDB...');
      this.lastAuth = Date.now(); // doing this before the long runnning function
      const result = await this.nano.auth(config.username, config.password);
      this.service.success('Successfully authorized with CouchDB', result);
      return true;
    }
  }

  async getDocumentsByOwnerIdV2(
    _document_type: OMNITOOL_DOCUMENT_TYPES,
    _ownerIds: string[],
    _page: number,
    _limitPerPage: number
  ): Promise<QueryResult> {
    throw new Error('Method not implemented.');
  }

  async getDocumentsByOwnerId(
    document_type: OMNITOOL_DOCUMENT_TYPES,
    ownerIds: string | string[],
    _allowPublic: boolean = false,
    limit?: number,
    skip?: number,
    bookmark?: string
  ): Promise<QueryResult> {
    if (ownerIds && !Array.isArray(ownerIds)) {
      ownerIds = [ownerIds];
    }

    const query: MangoQuery = {
      selector: {
        $and: [
          {
            _id: {
              $gte: `${document_type}:`,
              $lt: `${document_type}:\u10FFFF`
            }
          }
        ]
      },
      sort: [{ 'meta.name': 'asc' }],
      use_index: 'id-owner-index'
    };

    const ownerCondition = {
      $or: []
    };

    if (ownerIds.length > 0) {
      // @ts-ignore
      ownerCondition.$or.push({
        $or: ownerIds
          // @ts-ignore
          .map((ownerId) => ({ owner: ownerId }))
          // @ts-ignore
          .concat(ownerIds.map((ownerId) => ({ 'meta.owner': ownerId })))
      });
    }

    if (ownerCondition.$or.length > 0) {
      // @ts-ignore
      query.selector.$and.push(ownerCondition);
    }

    if (limit) {
      query.limit = limit;
    }
    if (skip) {
      query.skip = skip;
    }
    if (bookmark) {
      query.bookmark = bookmark;
    }

    try {
      this.service.debug('Querying objects:', JSON.stringify(query, null, 2));
      const result = await this.db.find(query);
      this.service.debug('Query result:', result);
      return result;
    } catch (error) {
      omnilog.error('Error querying objects:', error);
      throw error;
    }
  }

  async putDocumentById(
    document_type: OMNITOOL_DOCUMENT_TYPES,
    document_id: string,
    value: {},
    _rev?: string
  ): Promise<Nano.MaybeDocument> {
    const _id = `${document_type}:${document_id}`;
    this.service.verbose('putDocumentById', _id);

    const doc = {
      ...value,
      _id,
      _rev
    };
    return await this.put(doc);
  }

  async deleteDocumentById(document_type: OMNITOOL_DOCUMENT_TYPES, document_id: string, _rev: string) {
    // TODO: Add user permission check, tracking
    const _id = `${document_type}:${document_id}`;
    this.service.verbose('deleteDocumentById', _id, _rev);

    if (typeof _rev !== 'string') {
      throw new Error('Invalid _rev: should be a string, is ', _rev);
    }

    // @ts-ignore
    return await this.delete({ _id, _rev });
  }

  async getDocumentById(
    document_type: OMNITOOL_DOCUMENT_TYPES,
    document_id: string,
    ownerIds: string | string[] = [],
    _allowPublic: boolean
  ): Promise<any> {
    if (ownerIds && !Array.isArray(ownerIds)) {
      ownerIds = [ownerIds];
    }

    const query: MangoQuery = {
      selector: {
        _id: {
          $eq: `${document_type}:${document_id}`
        }
      }
    };

    try {
      // this.service.verbose('Querying objects:', JSON.stringify(query, null, 2), allowPublic)
      const result = await this.db.find(query);

      if (result.docs && result.docs.length > 0) {
        if (result.docs.length === 1) {
          this.service.verbose('Query result:', result);
          const doc = result.docs[0];

          if (document_type === OMNITOOL_DOCUMENT_TYPES.WORKFLOW) {
            if (!doc.owner) {
              if (doc.meta.owner) {
                this.service.info('Updating old workflow document to new format...');
                doc.owner = doc.meta.owner;
                doc.org = doc.meta.organisation;
                delete doc.meta.owner;
              }
            }
          }

          if (ownerIds.length > 0) {
            // owner enforcement
            for (const owner of ownerIds) {
              if (doc.owner === owner) {
                return doc;
              }
            }
          } // no owner enforcement
          else {
            return doc;
          }

          throw new Error(
            `Access violation: Found document for ${document_type}:${document_id} but not for owner ${ownerIds}: ${doc.owner}`
          );
        } else {
          throw new Error(
            `Found ${result.docs.length} documents for ${document_type}:${document_id}. Only one expected.`
          );
        }
      } else {
        throw new Error(`Found no documents for ${document_type}:${document_id}.`);
      }
    } catch (error) {
      this.service.error('Error querying objects:', error);
      throw error;
    }
  }

  async createIndex(indexDefinition: any): Promise<boolean> {
    try {
      const response = await this.db.createIndex(indexDefinition);
      if (response.result !== 'exists') {
        this.service.success('Index created:', response);
      }
      return true;
    } catch (ex) {
      this.service.error('Exception during index creation:', ex);
    }
    return false;
  }

  async connect(): Promise<boolean> {
    try {
      const config = this.config;
      this.service.info('Connecting to CouchDB', config);
      this.nano = Nano(config.couchDbUrl || 'http://localhost:5984');
      this.db = this.nano.db.use('omnitool');
      await this.checkAuth();

      const info = await this.db.info();
      this.service.verbose('CouchDB connected %o', info);
      Object.defineProperty(this.service.app, 'db', { value: this });

      this.service.info(`Creating ${DB_INDEXES.length} indexes if necessary...`);
      await Promise.all(
        DB_INDEXES.map(async (index) => {
          return await this.createIndex(index);
        })
      );
      return true;
    } catch (ex) {
      this.service.error('CouchDB connection failed', ex);
      throw new Error('CouchDB connection failed: Check tailnet connection and config');
    }
  }

  async put(doc: Nano.MaybeDocument): Promise<Nano.MaybeDocument> {
    await this.checkAuth();
    const response: Nano.DocumentInsertResponse = await this.db.insert(doc);
    if (response.ok) {
      doc._id = response.id;
      doc._rev = response.rev;
    }
    return doc;
  }

  async get(id: string): Promise<Nano.MaybeDocument | null> {
    await this.checkAuth();
    try {
      const doc: Nano.MaybeDocument = await this.db.get(id);
      return doc;
    } catch (err) {
      return null;
    }
  }

  async delete(doc: Nano.MaybeDocument) {
    if (doc == null || doc._id == null || doc._rev == null) {
      this.service.warn('delete called with invalid document (missing _rev or _id?)', doc);
      return;
    }
    await this.checkAuth();
    return this.db.destroy(doc._id, doc._rev);
  }

  async deleteMany(docs: Nano.MaybeDocument[]) {
    if (docs == null || docs.length === 0) {
      return;
    }
    await this.checkAuth();
    docs = docs.map((d) => ({ _id: d._id, _rev: d._rev, _deleted: true }));
    return this.db.bulk({ docs });
  }

  async list(startkey?: string, endkey?: string, include_docs: boolean = false, limit?: number): Promise<any> {
    await this.checkAuth();
    if (startkey && startkey?.length > 0) {
      endkey ??= startkey + '\ufff0'; // last possible key
    }
    this.service.info('list', { startkey, endkey, include_docs });
    return this.db.list({ startkey, endkey, include_docs, limit });
  }

  async find(
    selector: any,
    fields?: Array<string>,
    limit?: number,
    skip?: number,
    bookmark?: string,
    use_index?: string
  ): Promise<any> {
    await this.checkAuth();
    const query = { selector, fields, limit, skip, bookmark, use_index };
    this.service.info('find', { selector, fields, limit, skip, bookmark, use_index });
    const result = await this.db.find(query);
    return result.docs;
  }

  async authWithPassword(_username: string, _password: string): Promise<any> {
    throw new Error('Method not implemented.');
  }

  async authAsAdmin(): Promise<User | undefined> {
    throw new Error('Method not implemented.');
  }
}

export { DBCouchServiceProvider };
