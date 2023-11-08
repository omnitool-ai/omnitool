/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import BetterSqlite3 from 'better-sqlite3';
import EventEmitter from 'emittery';
import { ensureDir } from 'fs-extra';
import { omnilog, type IApp, type IManaged } from 'omni-shared';
import path from 'path';

interface IKVStorage {
  db: BetterSqlite3.Database;
  getAny: (
    partialKey: string,
    partialKeyMatchPattern: string,
    opts?: { limit?: number; cursor?: number; tags?: string; sort?: 'key' | 'seq'; contentMatch?: string }
  ) => Array<{ key: string; value: any }>;
  set: (key: string, value: any, expiry?: number, tags?: string[]) => void;
  get: (key: string, raw?: boolean) => any;
  del: (key: string) => void;
  inc: (key: string, increment: number) => void;
  vacuum: (purgedKeys?: string[]) => Promise<void>;
  init: () => Promise<boolean>;
  stop: () => Promise<void>;
  registerView: (name: string, sql: string) => void;
}

interface IKVStorageConfig {
  dbPath: string;
  dbName?: string;
}

interface IKVMigration {
  version: number;
  queries: string[];
}

const KVSTORE_VERSION = 3;

const migrations: IKVMigration[] = [
  // example migrations
  {
    version: 1,
    queries: ['ALTER TABLE kvstore ADD COLUMN  owner TEXT;', 'CREATE INDEX IF NOT EXISTS idx_owner ON kvstore(owner);']
  },
  {
    version: 2,
    queries: [
      `UPDATE kvstore
    SET owner = SUBSTR(tags, INSTR(tags, '#user.') + 6, 16) -- assuming the alphanumeric user ID has a fixed length of 16
    WHERE tags LIKE '%#user.%';`,
      `UPDATE kvstore
        SET tags = REPLACE(tags, '#user.' || owner, '')
        WHERE owner IS NOT NULL;
        `,
      `UPDATE kvstore
        SET tags = TRIM(TRIM(tags, ','), ',')
        WHERE owner IS NOT NULL;`
    ]
  },
  {
    version: KVSTORE_VERSION,
    queries: [
      'ALTER TABLE kvstore ADD COLUMN  deleted BOOLEAN DEFAULT 0;',
      "UPDATE kvstore SET deleted = 1 WHERE tags LIKE '%#deleted%';"
    ]
  }
];

class KVStorage implements IKVStorage {
  private _db?: BetterSqlite3.Database;
  events: EventEmitter;
  parent: IManaged | IApp;
  config: IKVStorageConfig;
  views: Map<string, string>;
  version: number = 0;

  constructor(parent: IManaged | IApp, config: IKVStorageConfig) {
    this.parent = parent;
    this.config = config;
    this.events = new EventEmitter();
    this.views = new Map<string, string>();
  }

  // Check if a table exists
  private tableExists(tableName: string): boolean {
    const row = this._db!.prepare(
      `
      SELECT name
      FROM sqlite_master
      WHERE type='table' AND name=?;
    `
    ).get(tableName);

    return Boolean(row);
  }

  // Simple Migration Functionality
  private runMigrations() {
    migrations.sort((a, b) => a.version - b.version);
    const filtered = migrations.filter((migration: IKVMigration) => migration.version > this.version);

    const transaction = this.db.transaction(() => {
      filtered.forEach((migration: IKVMigration) => {
        omnilog.info('Migrating KVstorage from version ' + this.version + ' to ' + migration.version + '...');
        migration.queries.forEach((query) => {
          this.db.exec(query);
        });

        // Update the user_version after each migration
        this.db.exec(`PRAGMA user_version = ${migration.version};`);
        this.version = migration.version;
        omnilog.info('KVstorage migrated to version ' + this.version);
      });
    });

    transaction();
  }

  async init(): Promise<boolean> {
    if (this.config.dbPath !== null) {
      const dbPath = path.join(process.cwd(), this.config.dbPath);
      const dbFile = path.join(dbPath, this.config.dbName ?? `${this.parent.id}.db`);
      await ensureDir(dbPath);
      this._db = new BetterSqlite3(dbFile);

      if (!this.tableExists('kvstore')) {
        omnilog.info("KVStorage table doesn't exist, initializing...");
        this.db.exec(`CREATE TABLE IF NOT EXISTS kvstore (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT UNIQUE NOT NULL,
          value TEXT,
          valueType TEXT NOT NULL,
          blob BLOB,
          expiry INTEGER,
          tags TEXT,
          owner TEXT,
          deleted BOOLEAN DEFAULT 0
        );`);
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_kvstore_key ON kvstore(key);');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_owner ON kvstore(owner);');

        this.db.exec(`PRAGMA user_version = ${KVSTORE_VERSION};`);
        this.version = KVSTORE_VERSION;
      } else {
        this.version = (this._db.prepare('PRAGMA user_version;').get() as { user_version: number }).user_version || 0;
        if (this.version < KVSTORE_VERSION) {
          omnilog.info(
            `KVStorage ${dbFile} exists at version ${this.version}, master is ${KVSTORE_VERSION}, checking for migrations...`
          );
          try {
            this.runMigrations();
            omnilog.info(`KVstorage ${dbFile} is now at version ` + this.version);
          } catch (ex) {
            omnilog.error(`Failed KVStorage ${dbFile} migration`, ex);
            throw new Error('Failed KVStorage migration, aborting.');
          }
        }
      }
      // Create views
      this.views.forEach((sql, name) => {
        omnilog.info(`KVStorage ${this.parent.id} creating view ${name} with SQL: ${sql}`);
        this.db.exec('DROP VIEW IF EXISTS ' + name + ';');
        this.db.exec(sql);
      });

      this.db.pragma('integrity_check');
      this.parent.success(`KVStorage ${this.parent.id}, schema v${this.version} loaded and mapped to ${dbFile}`);

      return true;
    }
    return false;
  }

  async stop(): Promise<void> {
    this.parent.success(`KVStorage ${this.parent.id} stopped`);
    this._db?.close();
    await Promise.resolve();
  }

  get db(): BetterSqlite3.Database {
    if (this._db == null) {
      throw new Error('KVStore accessed before load');
    }
    return this._db;
  }

  getAll() {
    const sql = 'SELECT key, value, expiry, seq FROM kvstore WHERE deleted = 0';
    const statement = this.db.prepare(sql);
    let result = (statement.all() || []) as Array<{ key: string; value: any }>;
    result = result.map((row: any) => ({
      key: row.key as string,
      value: this._getRowValue(row),
      seq: row.seq as number
    }));
    return result;
  }

  getAny(
    partialKey: string,
    partialKeyMatchPattern: string = `${partialKey}%`,
    opts?: {
      limit?: number;
      cursor?: number;
      tags?: string|string[];
      owner?:
        | string
        | {
            user: string;
            includeUnowned: boolean;
          };
      contentMatch?: string;
      expiryType?: 'permanent' | 'temporary';
      sort?: 'seq' | 'key';
      view?: string;
    }
  ): Array<{ key: string; value: any; seq: number }> {
    const start = Date.now();
    let count = 0;
    let result: Array<{ key: string; value: any; seq: number; expiry?: number }> = [];
    try {
      let source = 'kvstore';

      opts ??= {};

      if (opts.view) {
        source = opts.view;
      }
      let sql = 'SELECT key, value, valueType, expiry, seq, tags FROM ' + source + ' WHERE key LIKE ? AND deleted = 0';
      const args: any[] = [partialKeyMatchPattern];

      // --- Expiry handling ---
      if (opts.expiryType && ['permanent', 'temporary'].includes(opts.expiryType)) {
        if (opts.expiryType === 'permanent') {
          sql = sql + ' AND expiry IS NULL ';
        } else if (opts.expiryType === 'temporary') {
          sql = sql + ' AND (expiry IS NOT NULL AND expiry > ?)'; // for temporary files, we also check expiry date
          args.push(Date.now());
        }
      } else {
        sql = sql + ' AND (expiry IS NULL OR expiry > ?)';
        args.push(Date.now());
      }

      if (opts.tags && opts.tags.length) {
        const tags = (typeof(opts.tags) === 'string' ? opts.tags.split(',') : opts.tags).map((tag) => '#' + tag.replace(/[^a-zA-Z0-9-.]/g, '-').toLowerCase().trim());
        tags.forEach((tag, index) => {
          sql += ' AND tags LIKE ?';
          args.push(`%${tag}%`);
        });
      }

      if (opts.owner) {
        if (typeof opts.owner === 'string') {
          sql += ' AND owner = ?';
          args.push(opts.owner.trim());
        } else if (opts.owner.user) {
          if (opts.owner.includeUnowned) {
            sql += ' AND (owner IS NULL OR owner = ?)';
            args.push(opts.owner.user.trim());
          } else {
            sql += ' AND owner = ?';
            args.push(opts.owner.user.trim());
          }
        } else {
          omnilog.warn(`Invalid owner ${opts.owner.user}`);
        }
      }

      if (opts.cursor) {
        sql = sql + ' AND seq < ? ';
        args.push(opts.cursor);
      }

      if (opts.contentMatch) {
        sql =
          sql +
          " AND (json_extract(value, '$.title') LIKE ? OR json_extract(value, '$.description') LIKE ? OR json_extract(value, '$.category') LIKE ? OR key LIKE ?) ";
        args.push(`%${opts.contentMatch}%`);
        args.push(`%${opts.contentMatch}%`);
        args.push(`%${opts.contentMatch}%`);
        args.push(`%${opts.contentMatch}%`);
      }

      let sort = opts?.sort ?? 'seq';
      if (sort !== 'seq' && sort !== 'key') {
        sort = 'seq';
      }

      sql += ` ORDER BY ${sort} DESC`;

      if (opts.limit) {
        sql = sql + ' LIMIT ?';
        args.push(opts.limit);
      }

      sql += ';';
      //console.debug('KV', sql, args);
      const statement = this.db.prepare(sql);

      result = (statement.all(...args) || []) as Array<{
        key: string;
        value: any;
        seq: number;
        expiry?: number;
        valueType: string;
      }>;

      count = result.length;
      /*console.debug(
        result.length + ' results:',
        result.map((r: any) => r.seq + ': ' + r.key)
      );*/

      result = result.map((row: any) => ({
        key: row.key as string,
        value: this._getRowValue(row),
        seq: row.seq as number,
        expiry: row.expiry && row.expiry < 9007199254740991 ? (row.expiry as number) : undefined,
        valueType: row.valueType,
        tags:  row.tags?.split(',').filter((tag: string) => tag.trim()) ?? []
      }));
    } catch (error) {
      this.parent?.error('Error occurred while getting values:', error);
      throw error;
    } finally {
      const end = Date.now();
      this.parent?.debug(`getAny ${partialKey} retrieved ${count} records in ${(end - start).toFixed()} ms`);
    }
    return result;
  }

  addTags(key: string, newTags: string[]): void {
    const tagManipulator = (existingTags: Set<string>, tags: string[]) => {
      tags.forEach((tag) => existingTags.add(tag.trim()));
      return existingTags;
    };

    this.updateTags(key, newTags, tagManipulator);
  }

  setExpiry(key: string, expiry: number | null): void {
    this.db.prepare('UPDATE kvstore SET expiry = ? WHERE key = ?').run(expiry, key);
  }

  removeTags(key: string, tagsToRemove: string[]): void {
    const tagManipulator = (existingTags: Set<string>, tags: string[]) => {
      tags.forEach((tag) => existingTags.delete(tag.trim()));
      return existingTags;
    };

    this.updateTags(key, tagsToRemove, tagManipulator);
  }

  private updateTags(
    key: string,
    tags: string[],
    tagManipulator: (existingTags: Set<string>, tags: string[]) => Set<string>
  ): void {
    const row = this.db.prepare('SELECT * FROM kvstore WHERE key = ?').get(key) as {
      key: string;
      value: any;
      expiry: number;
      tags: string;
    };

    if (!row) {
      omnilog.warn(`updateTags(): No record found for key: ${key}`);
      return;
    }

    // Create a set to avoid duplicate tags
    const existingTags = new Set(row.tags ? row.tags.split(',') : []);

    // Sanitize and process tags
    const processedTags = tags.map((tag) => '#' + tag.replace(/[^a-zA-Z0-9-.]/g, '-').toLowerCase());

    const updatedTags = tagManipulator(existingTags, processedTags);

    this.db.prepare('UPDATE kvstore SET tags = ? WHERE key = ?').run(Array.from(updatedTags).join(','), key);
  }

  set(key: string, value: any, expiry?: number, tags?: string[], owner?: string): void {
    try {
      if (key === null || key === undefined) {
        throw new Error('Key cannot be null or undefined');
      }

      if (tags?.length) {
        // strip out any non-alphanumeric characters
        tags = tags.map(
          (t) =>
            '#' +
            t
              .trim()
              .replace(/[^a-zA-Z0-9-.]/g, '-')
              .toLowerCase()
        );
      }

      if (value === null || value === undefined) {
        throw new Error('Value cannot be null or undefined');
      }

      if (Buffer.isBuffer(value)) {
        this._setBlob(key, value, expiry);
        return;
      }

      const valueType = typeof value; // Store the type of the value
      let writeValue = value;
      if (typeof value !== 'string') {
        writeValue = JSON.stringify(value);
      }

      // In the database operation, add the valueType as a parameter
      const statement = this.db.prepare(
        'INSERT OR REPLACE INTO kvstore (key, value, valueType, expiry, tags, owner) VALUES (?, ?, ?, ?, ?, ?)'
      );
      statement.run(key, writeValue, valueType, expiry ?? null, tags?.join(','), owner?.trim() ?? null);
    } catch (error) {
      this.parent?.error('Error occurred while setting value:', error);
      throw error;
    }
  }

  _setBlob(key: string, value: Buffer, expiry?: number, tags?: string[], owner?: string): void {
    try {
      if (key === null || key === undefined) {
        throw new Error('Key cannot be null or undefined');
      }

      if (value === null || value === undefined) {
        throw new Error('Value cannot be null or undefined');
      }

      const statement = this.db.prepare(
        'INSERT OR REPLACE INTO kvstore (key, value,  valueType, blob, expiry, tags, owner) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      statement.run(key, null, 'Buffer', value, expiry ?? null, tags?.join(','), owner?.trim() ?? null);
    } catch (error) {
      this.parent?.error('Error occurred while setting blob value:', error);
      throw error;
    }
  }

  updateValue(key: string, value: any): void {
    try {
      if (key === null || key === undefined) {
        throw new Error('Key cannot be null or undefined');
      }

      const current = this.get(key, true);
      if (current === null) {
        throw new Error('Key does not exist');
      }

      const expiry = current.expiry ? current.expiry : undefined;
      this.set(
        key,
        value,
        expiry,
        current.tags ? current.tags.split(',').map((t: string) => t.substring(1)) : undefined
      );
    } catch (error) {
      this.parent?.error('Error occurred while updating value:', error);
      throw error;
    }
  }

  public _getRowValue(
    row: { value: string; valueType: string; blob: Buffer; expiry: number; tags: string } | undefined
  ) {
    if (!row) {
      return undefined;
    }

    if (row.valueType === 'number') {
      return Number(row.value);
    } else if (row.valueType === 'string') {
      return row.value;
    } else if (row.valueType === 'object') {
      return row.value != null ? JSON.parse(row.value) : null;
    } else if (row.valueType === 'Buffer') {
      return row.blob;
    } else if (row.valueType === 'boolean') {
      return row.value === 'true' || row.value === '1' || row.value === 'yes' || row.value === 'on';
    }

    omnilog.error('Invalid data type detected:', row);
    throw new Error(`Invalid data type detected - unable to parse value ${row.valueType}`);
  }

  get(key: string, raw: boolean = false): any {
    try {
      if (key === null || key === undefined) {
        throw new Error('Key cannot be null or undefined');
      }

      const statement = this.db.prepare(
        'SELECT value, valueType, blob, expiry, tags FROM kvstore WHERE key = ? AND (expiry IS NULL OR expiry > ?) AND deleted = 0 '
      );
      const result = statement.get(key, Date.now()) as
        | { value: string; valueType: string; blob: Buffer; expiry: number; tags: string }
        | undefined;

      if (result != null) {
        if (result.expiry && Date.now() > result.expiry) {
          // Key has expired, delete it and return null
          this.events.emit('expired', [key]).catch((ex: Error) => {
            this.parent?.warn('Error occurred while emitting expired event:', ex.message);
          });
          this.del(key);
          return null;
        } else {
          if (raw) {
            return result;
          }
          return this._getRowValue(result);
        }
      } else {
        return null;
      }
    } catch (error) {
      this.parent?.error('Error occurred while getting value:', error);
      throw error;
    }
  }

  del(key: string): void {
    try {
      if (key === null || key === undefined) {
        throw new Error('Key cannot be null or undefined');
      }

      const statement = this.db.prepare('DELETE FROM kvstore WHERE key = ?');
      statement.run(key);
    } catch (error) {
      this.parent?.error('Error occurred while deleting value:', error);
      throw error;
    }
  }

  softDelete(key: string, expiry?: number): void {
    try {
      if (key === null || key === undefined) {
        throw new Error('Key cannot be null or undefined');
      }

      const statement = this.db.prepare('UPDATE kvstore SET deleted = 1 WHERE key = ?');
      statement.run(key);
      if (expiry != null) {
        this.setExpiry(key, expiry);
      }
    } catch (error) {
      this.parent?.error('Error occurred while soft deleting value:', error);
      throw error;
    }
  }

  delAny(partialKey: string, partialKeyMatchPattern: string = `${partialKey}%`): void {
    try {
      if (partialKey === null || partialKey === undefined) {
        throw new Error('Key cannot be null or undefined');
      }
      const statement = this.db.prepare('DELETE FROM kvstore WHERE key LIKE ?');
      statement.run(partialKeyMatchPattern);
    } catch (error) {
      this.parent?.error('Error occurred while deleting values:', error);
      throw error;
    }
  }

  clear(): void {
    try {
      const statement = this.db.prepare('DELETE FROM kvstore');
      statement.run();
    } catch (error) {
      this.parent?.error('Error occurred while clearing values:', error);
    }
  }

  inc(key: string, increment: number = 1): void {
    try {
      const existingValue = this.get(key);
      if (existingValue !== null && typeof existingValue === 'number') {
        this.set(key, existingValue + increment);
      } else {
        this.set(key, increment);
      }
    } catch (error) {
      this.parent?.error('Error occurred while incrementing value:', error);
      throw error;
    }
  }

  // Vacuum the database to optimize it

  async vacuum(purgedKeys?: string[]): Promise<void> {
    try {
      const time = Date.now();
      if (purgedKeys !== undefined) {
        const statement = this.db.prepare('SELECT key FROM kvstore WHERE expiry IS NOT NULL AND expiry < ?');
        const result = statement.all(time);
        purgedKeys = result.map((row: any) => row.key as string);

        if (purgedKeys.length > 0) {
          this.parent.info(`KVStorage ${this.parent.id} vacuumed - triggering event`, result);
          try {
            await this.events.emit('expired', purgedKeys);
          } catch (ex) {
            this.parent.warn(`KVStorage ${this.parent.id} vacuumed - error triggering event.`, ex);
          }
        }
      }
      const statement = this.db.prepare('DELETE FROM kvstore WHERE expiry IS NOT NULL AND expiry < ?');
      const result = statement.run(time);
      this.db.pragma('vacuum');
      this.parent?.info(`KVStorage ${this.parent.id} vacuumed - Expired entries removed.`, result);
    } catch (error) {
      this.parent?.error('Error occurred while vacuuming:', error);
      throw error;
    }
  }

  registerView(name: string, sql: string): void {
    this.views.set(name, sql);
  }
}

export { KVStorage, type IKVStorageConfig };
