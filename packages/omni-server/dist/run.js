// src/run.ts
import { OmniLogLevels, registerOmnilogGlobal } from "omni-shared";

// src/core/Server.ts
import {
  App,
  Settings,
  OmniSSEMessages as OmniSSEMessages2
} from "omni-shared";
import { MarkdownEngine } from "omni-sdk";
import { performance as performance3 } from "perf_hooks";

// src/core/KVStorage.ts
import BetterSqlite3 from "better-sqlite3";
import EventEmitter from "emittery";
import { ensureDir } from "fs-extra";
import { omnilog as omnilog2 } from "omni-shared";
import path from "path";
var KVSTORE_VERSION = 3;
var migrations = [
  // example migrations
  {
    version: 1,
    queries: ["ALTER TABLE kvstore ADD COLUMN  owner TEXT;", "CREATE INDEX IF NOT EXISTS idx_owner ON kvstore(owner);"]
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
      "ALTER TABLE kvstore ADD COLUMN  deleted BOOLEAN DEFAULT 0;",
      "UPDATE kvstore SET deleted = 1 WHERE tags LIKE '%#deleted%';"
    ]
  }
];
var KVStorage = class {
  _db;
  events;
  parent;
  config;
  views;
  version = 0;
  constructor(parent, config2) {
    this.parent = parent;
    this.config = config2;
    this.events = new EventEmitter();
    this.views = /* @__PURE__ */ new Map();
  }
  // Check if a table exists
  tableExists(tableName) {
    const row = this._db.prepare(
      `
      SELECT name
      FROM sqlite_master
      WHERE type='table' AND name=?;
    `
    ).get(tableName);
    return Boolean(row);
  }
  // Simple Migration Functionality
  runMigrations() {
    migrations.sort((a, b) => a.version - b.version);
    const filtered = migrations.filter((migration) => migration.version > this.version);
    const transaction = this.db.transaction(() => {
      filtered.forEach((migration) => {
        omnilog2.info("Migrating KVstorage from version " + this.version + " to " + migration.version + "...");
        migration.queries.forEach((query) => {
          this.db.exec(query);
        });
        this.db.exec(`PRAGMA user_version = ${migration.version};`);
        this.version = migration.version;
        omnilog2.info("KVstorage migrated to version " + this.version);
      });
    });
    transaction();
  }
  runSQL(sql, args) {
    const statement = this.db.prepare(sql);
    omnilog2.info(sql, args);
    statement.run(args);
  }
  async init() {
    if (this.config.dbPath !== null) {
      const dbPath = path.join(process.cwd(), this.config.dbPath);
      const dbFile = path.join(dbPath, this.config.dbName ?? `${this.parent.id}.db`);
      await ensureDir(dbPath);
      this._db = new BetterSqlite3(dbFile);
      this._init();
      return true;
    }
    return false;
  }
  async _init() {
    if (!this.tableExists("kvstore")) {
      omnilog2.info("KVStorage table doesn't exist, initializing...");
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
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_kvstore_key ON kvstore(key);");
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_owner ON kvstore(owner);");
      this.db.exec(`PRAGMA user_version = ${KVSTORE_VERSION};`);
      this.version = KVSTORE_VERSION;
    } else {
      this.version = this._db.prepare("PRAGMA user_version;").get().user_version || 0;
      if (this.version < KVSTORE_VERSION) {
        omnilog2.info(
          `KVStorage exists at version ${this.version}, master is ${KVSTORE_VERSION}, checking for migrations...`
        );
        try {
          this.runMigrations();
          omnilog2.info(`KVstorage is now at version ` + this.version);
        } catch (ex) {
          omnilog2.error(`Failed KVStorage migration`, ex);
          throw new Error("Failed KVStorage migration, aborting.");
        }
      }
    }
    this.views.forEach((sql, name) => {
      omnilog2.info(`KVStorage ${this.parent.id} creating view ${name} with SQL: ${sql}`);
      this.db.exec("DROP VIEW IF EXISTS " + name + ";");
      this.db.exec(sql);
    });
    this.db.pragma("integrity_check");
    this.parent.success(`KVStorage ${this.parent.id}, schema v${this.version} loaded`);
  }
  async initFromBuffer(buff) {
    this._db = new BetterSqlite3(buff);
    this._init();
    return true;
  }
  async stop() {
    this.parent.success(`KVStorage ${this.parent.id} stopped`);
    this._db?.close();
    await Promise.resolve();
  }
  get db() {
    if (this._db == null) {
      throw new Error("KVStore accessed before load");
    }
    return this._db;
  }
  getAll() {
    const sql = "SELECT key, value, expiry, seq FROM kvstore WHERE deleted = 0";
    const statement = this.db.prepare(sql);
    let result = statement.all() || [];
    result = result.map((row) => ({
      key: row.key,
      value: this._getRowValue(row),
      seq: row.seq
    }));
    return result;
  }
  getAny(partialKey, partialKeyMatchPattern = `${partialKey}%`, opts) {
    const start = Date.now();
    let count = 0;
    let result = [];
    try {
      let source = "kvstore";
      opts ??= {};
      if (opts.view) {
        source = opts.view;
      }
      let sql = "SELECT key, value, valueType, blob, expiry, seq, tags FROM " + source + " WHERE key LIKE ? AND deleted = 0";
      const args = [partialKeyMatchPattern];
      if (opts.expiryType && ["permanent", "temporary"].includes(opts.expiryType)) {
        if (opts.expiryType === "permanent") {
          sql = sql + " AND expiry IS NULL ";
        } else if (opts.expiryType === "temporary") {
          sql = sql + " AND (expiry IS NOT NULL AND expiry > ?)";
          args.push(Date.now());
        }
      } else {
        sql = sql + " AND (expiry IS NULL OR expiry > ?)";
        args.push(Date.now());
      }
      if (opts.tags && opts.tags.length) {
        const tags = (typeof opts.tags === "string" ? opts.tags.split(",") : opts.tags).map((tag) => "#" + tag.replace(/[^a-zA-Z0-9-.]/g, "-").toLowerCase().trim());
        tags.forEach((tag, index) => {
          sql += " AND tags LIKE ?";
          args.push(`%${tag}%`);
        });
      }
      if (opts.owner) {
        if (typeof opts.owner === "string") {
          sql += " AND owner = ?";
          args.push(opts.owner.trim());
        } else if (opts.owner.user) {
          if (opts.owner.includeUnowned) {
            sql += " AND (owner IS NULL OR owner = ?)";
            args.push(opts.owner.user.trim());
          } else {
            sql += " AND owner = ?";
            args.push(opts.owner.user.trim());
          }
        } else {
          omnilog2.warn(`Invalid owner ${opts.owner.user}`);
        }
      }
      if (opts.cursor) {
        sql = sql + " AND seq < ? ";
        args.push(opts.cursor);
      }
      if (opts.contentMatch) {
        sql = sql + " AND (json_extract(value, '$.title') LIKE ? OR json_extract(value, '$.description') LIKE ? OR json_extract(value, '$.category') LIKE ? OR key LIKE ?) ";
        args.push(`%${opts.contentMatch}%`);
        args.push(`%${opts.contentMatch}%`);
        args.push(`%${opts.contentMatch}%`);
        args.push(`%${opts.contentMatch}%`);
      }
      let sort = opts?.sort ?? "seq";
      if (sort !== "seq" && sort !== "key") {
        sort = "seq";
      }
      sql += ` ORDER BY ${sort} DESC`;
      if (opts.limit) {
        sql = sql + " LIMIT ?";
        args.push(opts.limit);
      }
      sql += ";";
      const statement = this.db.prepare(sql);
      result = statement.all(...args) || [];
      count = result.length;
      result = result.map((row) => ({
        key: row.key,
        value: this._getRowValue(row),
        seq: row.seq,
        expiry: row.expiry && row.expiry < 9007199254740991 ? row.expiry : void 0,
        valueType: row.valueType,
        tags: row.tags?.split(",").filter((tag) => tag.trim()) ?? [],
        blob: row.blob
      }));
    } catch (error) {
      this.parent?.error("Error occurred while getting values:", error);
      throw error;
    } finally {
      const end = Date.now();
      this.parent?.debug(`getAny ${partialKey} retrieved ${count} records in ${(end - start).toFixed()} ms`);
    }
    return result;
  }
  addTags(key, newTags) {
    const tagManipulator = (existingTags, tags) => {
      tags.forEach((tag) => existingTags.add(tag.trim()));
      return existingTags;
    };
    this.updateTags(key, newTags, tagManipulator);
  }
  setExpiry(key, expiry) {
    this.db.prepare("UPDATE kvstore SET expiry = ? WHERE key = ?").run(expiry, key);
  }
  removeTags(key, tagsToRemove) {
    const tagManipulator = (existingTags, tags) => {
      tags.forEach((tag) => existingTags.delete(tag.trim()));
      return existingTags;
    };
    this.updateTags(key, tagsToRemove, tagManipulator);
  }
  updateTags(key, tags, tagManipulator) {
    const row = this.db.prepare("SELECT * FROM kvstore WHERE key = ?").get(key);
    if (!row) {
      omnilog2.warn(`updateTags(): No record found for key: ${key}`);
      return;
    }
    const existingTags = new Set(row.tags ? row.tags.split(",") : []);
    const processedTags = tags.map((tag) => "#" + tag.replace(/[^a-zA-Z0-9-.]/g, "-").toLowerCase());
    const updatedTags = tagManipulator(existingTags, processedTags);
    this.db.prepare("UPDATE kvstore SET tags = ? WHERE key = ?").run(Array.from(updatedTags).join(","), key);
  }
  set(key, value, expiry, tags, owner) {
    try {
      if (key === null || key === void 0) {
        throw new Error("Key cannot be null or undefined");
      }
      if (tags?.length) {
        tags = tags.map(
          (t) => "#" + t.trim().replace(/[^a-zA-Z0-9-.]/g, "-").toLowerCase()
        );
      }
      if (value === null || value === void 0) {
        throw new Error("Value cannot be null or undefined");
      }
      if (Buffer.isBuffer(value)) {
        this._setBlob(key, value, expiry, tags, owner);
        return;
      }
      const valueType = typeof value;
      let writeValue = value;
      if (typeof value !== "string") {
        writeValue = JSON.stringify(value);
      }
      const statement = this.db.prepare(
        "INSERT OR REPLACE INTO kvstore (key, value, valueType, expiry, tags, owner) VALUES (?, ?, ?, ?, ?, ?)"
      );
      statement.run(key, writeValue, valueType, expiry ?? null, tags?.join(","), owner?.trim() ?? null);
    } catch (error) {
      this.parent?.error("Error occurred while setting value:", error);
      throw error;
    }
  }
  _setBlob(key, value, expiry, tags, owner) {
    try {
      if (key === null || key === void 0) {
        throw new Error("Key cannot be null or undefined");
      }
      if (value === null || value === void 0) {
        throw new Error("Value cannot be null or undefined");
      }
      const statement = this.db.prepare(
        "INSERT OR REPLACE INTO kvstore (key, value,  valueType, blob, expiry, tags, owner) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      statement.run(key, null, "Buffer", value, expiry ?? null, tags?.join(","), owner?.trim() ?? null);
    } catch (error) {
      this.parent?.error("Error occurred while setting blob value:", error);
      throw error;
    }
  }
  updateValue(key, value) {
    try {
      if (key === null || key === void 0) {
        throw new Error("Key cannot be null or undefined");
      }
      const current = this.get(key, true);
      if (current === null) {
        throw new Error("Key does not exist");
      }
      const expiry = current.expiry ? current.expiry : void 0;
      this.set(
        key,
        value,
        expiry,
        current.tags ? current.tags.split(",").map((t) => t.substring(1)) : void 0
      );
    } catch (error) {
      this.parent?.error("Error occurred while updating value:", error);
      throw error;
    }
  }
  _getRowValue(row) {
    if (!row) {
      return void 0;
    }
    if (row.valueType === "number") {
      return Number(row.value);
    } else if (row.valueType === "string") {
      return row.value;
    } else if (row.valueType === "object") {
      return row.value != null ? JSON.parse(row.value) : null;
    } else if (row.valueType === "Buffer") {
      return row.blob;
    } else if (row.valueType === "boolean") {
      return row.value === "true" || row.value === "1" || row.value === "yes" || row.value === "on";
    }
    omnilog2.error("Invalid data type detected:", row);
    throw new Error(`Invalid data type detected - unable to parse value ${row.valueType}`);
  }
  get(key, raw = false) {
    try {
      if (key === null || key === void 0) {
        throw new Error("Key cannot be null or undefined");
      }
      const statement = this.db.prepare(
        "SELECT value, valueType, blob, expiry, tags FROM kvstore WHERE key = ? AND (expiry IS NULL OR expiry > ?) AND deleted = 0 "
      );
      const result = statement.get(key, Date.now());
      if (result != null) {
        if (result.expiry && Date.now() > result.expiry) {
          this.events.emit("expired", [key]).catch((ex) => {
            this.parent?.warn("Error occurred while emitting expired event:", ex.message);
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
      this.parent?.error("Error occurred while getting value:", error);
      throw error;
    }
  }
  del(key) {
    try {
      if (key === null || key === void 0) {
        throw new Error("Key cannot be null or undefined");
      }
      const statement = this.db.prepare("DELETE FROM kvstore WHERE key = ?");
      statement.run(key);
    } catch (error) {
      this.parent?.error("Error occurred while deleting value:", error);
      throw error;
    }
  }
  softDelete(key, expiry) {
    try {
      if (key === null || key === void 0) {
        throw new Error("Key cannot be null or undefined");
      }
      const statement = this.db.prepare("UPDATE kvstore SET deleted = 1 WHERE key = ?");
      statement.run(key);
      if (expiry != null) {
        this.setExpiry(key, expiry);
      }
    } catch (error) {
      this.parent?.error("Error occurred while soft deleting value:", error);
      throw error;
    }
  }
  delAny(partialKey, partialKeyMatchPattern = `${partialKey}%`) {
    try {
      if (partialKey === null || partialKey === void 0) {
        throw new Error("Key cannot be null or undefined");
      }
      const statement = this.db.prepare("DELETE FROM kvstore WHERE key LIKE ?");
      statement.run(partialKeyMatchPattern);
    } catch (error) {
      this.parent?.error("Error occurred while deleting values:", error);
      throw error;
    }
  }
  clear() {
    try {
      const statement = this.db.prepare("DELETE FROM kvstore");
      statement.run();
    } catch (error) {
      this.parent?.error("Error occurred while clearing values:", error);
    }
  }
  inc(key, increment = 1) {
    try {
      const existingValue = this.get(key);
      if (existingValue !== null && typeof existingValue === "number") {
        this.set(key, existingValue + increment);
      } else {
        this.set(key, increment);
      }
    } catch (error) {
      this.parent?.error("Error occurred while incrementing value:", error);
      throw error;
    }
  }
  // Vacuum the database to optimize it
  async vacuum(purgedKeys) {
    try {
      const time = Date.now();
      if (purgedKeys !== void 0) {
        const statement2 = this.db.prepare("SELECT key FROM kvstore WHERE expiry IS NOT NULL AND expiry < ?");
        const result2 = statement2.all(time);
        purgedKeys = result2.map((row) => row.key);
        if (purgedKeys.length > 0) {
          this.parent.info(`KVStorage ${this.parent.id} vacuumed - triggering event`, result2);
          try {
            await this.events.emit("expired", purgedKeys);
          } catch (ex) {
            this.parent.warn(`KVStorage ${this.parent.id} vacuumed - error triggering event.`, ex);
          }
        }
      }
      const statement = this.db.prepare("DELETE FROM kvstore WHERE expiry IS NOT NULL AND expiry < ?");
      const result = statement.run(time);
      this.db.pragma("vacuum");
      this.parent?.info(`KVStorage ${this.parent.id} vacuumed - Expired entries removed.`, result);
    } catch (error) {
      this.parent?.error("Error occurred while vacuuming:", error);
      throw error;
    }
  }
  registerView(name, sql) {
    this.views.set(name, sql);
  }
};

// src/core/ServerExtensionsManager.ts
import { execSync } from "child_process";
import { ensureDir as ensureDir2 } from "fs-extra";
import fs2 from "fs/promises";
import yaml2 from "js-yaml";
import fetch2 from "node-fetch";
import { OAIComponent31 } from "omni-sockets";
import { ExtensionManager, omnilog as omnilog3 } from "omni-shared";
import path4 from "path";
import { performance as performance2 } from "perf_hooks";
import serialize from "serialize-javascript";
import { simpleGit as simpleGit2 } from "simple-git";

// src/helper/validation.ts
import { Tier } from "omni-shared";
import { stat as fsStat } from "fs/promises";
var validateName = function(username) {
  omnilog.log("Testing", username);
  return /^[a-z0-9]+$/.test(username);
};
var validateEmail = function(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};
var validateStatus = function(status) {
  return status === "active" || status === "inactive";
};
var validatePassword = function(password) {
  return password.length >= 8;
};
var validateCredit = function(credit) {
  return credit >= 0;
};
var validateTier = async function(db, tierId) {
  const tier = await db.get(`${Tier.name}:${tierId}`);
  return tier;
};
async function validateDirectoryExists(path17) {
  try {
    const stats = await fsStat(path17);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
async function validateFileExists(path17) {
  try {
    const stats = await fsStat(path17);
    return stats.isFile();
  } catch {
    return false;
  }
}

// src/core/ServerExtension.ts
import { existsSync } from "fs";
import { AppExtension } from "omni-shared";
import path2 from "path";
var ServerExtension = class extends AppExtension {
  hooks = {};
  methods = {};
  errors = [];
  disabled = false;
  constructor(id4, manager, config2) {
    id4 = id4.replace(/[^a-zA-Z0-9-_]/g, "_");
    super(id4, manager, config2);
    this.errors = config2.errors || [];
  }
  get extensionConfig() {
    return this.config;
  }
  create() {
    this.debug("create()", this.id);
    if (this.extensionConfig.server?.hooks != null) {
      for (const hook in this.extensionConfig.server.hooks) {
        this.debug("registering hook", hook);
        this.registerEventHook(hook, this.extensionConfig.server.hooks[hook]);
      }
    }
    if (this.extensionConfig.server?.methods && typeof this.extensionConfig.server?.methods === "object") {
      Object.entries(this.extensionConfig.server.methods).filter(([key, value]) => typeof value === "function").forEach(([key, value]) => {
        this.registerMethod(key, value);
      });
    }
  }
  async stop() {
    this.debug("stop()", this.id);
    return true;
  }
  registerEventHook(event, handler) {
    this.info("registerEventHook", event);
    if (!this.disabled) {
      this.hooks[event] = handler.bind(this);
    }
  }
  registerMethod(key, handle) {
    this.info("registerMethod", key, handle != null);
    if (!this.disabled) {
      this.methods[key] = handle.bind(this);
    }
  }
  async invokeKnownMethod(method, ctx, args) {
    if (this.disabled) {
      return;
    }
    if (this.methods[method] === void 0) {
      this.debug("invokeKnownMethod", method, "[ServerExtension] invokeKnownMethod method not found");
      return;
    }
    if (this.methods[method]) {
      this.info("invokeKnownMethods", method, args);
      return await this.methods[method](ctx, args);
    }
    return Promise.resolve();
  }
  async invokeEventHook(ctx, event, args) {
    if (this.disabled) {
      return;
    }
    if (args === null || args === void 0) {
      this.debug(
        "invokeEventHook",
        event,
        "[ServerExtension] invokeEventHook passed args is null or undefined - setting it to empty array"
      );
      args = [];
    }
    this.info("invokeEventHook", event);
    if (this.hooks[event]) {
      if (args && args[Symbol.iterator]) {
        return await this.hooks[event](ctx, ...args);
      } else {
        return await this.hooks[event](ctx, args);
      }
    }
  }
  hasEventHook(event) {
    return this.hooks[event] != null;
  }
  getScriptFile(name) {
    return this.extensionConfig.scripts?.server?.[name];
  }
  getDirectory = () => {
    return path2.join(process.cwd(), "extensions", this.id);
  };
  onRegisterStatic({ fastifyInstance, fastifyStatic: fastifyStatic2 }) {
    if (this.disabled) {
      return;
    }
    const publicPath = path2.join(this.extensionConfig.path, "public");
    if (existsSync(publicPath)) {
      this.manager.verbose("Registering extension static path", this.extensionConfig.id, publicPath);
      fastifyInstance.register(fastifyStatic2, {
        root: publicPath,
        prefix: `/extensions/${this.extensionConfig.id}/`,
        decorateReply: false
      });
    } else {
      this.manager.verbose("No static path for", this.extensionConfig.id, publicPath);
    }
    this.manager.verbose("Registered extension static path", publicPath);
  }
};

// src/core/ServerExtensionUtils.ts
import simpleGit from "simple-git";
import fs from "node:fs";
import yaml from "js-yaml";
import path3 from "node:path";
import { compareVersions } from "compare-versions";
async function revParseShort(localPath, rev) {
  return await simpleGit(localPath).revparse(["--short", rev]);
}
async function resetToLatestCompatibleCommit(extensionId, manifest, localPath, sdkVersion) {
  const commits = (await getRemoteMinSDKVersions(localPath)).reverse();
  const currentHash = await revParseShort(localPath, "HEAD");
  const latestHash = await revParseShort(localPath, "origin/main");
  for (const commit of commits) {
    console.info(`Checking commit ${commit.commit_hash} at old_version ${commit.old_version}`);
    if (commit.old_version === null || compareVersions(sdkVersion, commit.old_version) >= 0) {
      const targetHash = await revParseShort(localPath, `${commit.commit_hash}~1`);
      if (currentHash === targetHash) {
        return { latestHash, currentHash, didUpdate: false };
      }
      omnilog.info(`Found compatible commit ${targetHash} for extension ${manifest.title}`);
      void await simpleGit(localPath).reset(["--hard", `${commit.commit_hash}~1`]);
      const newHash = await revParseShort(localPath, "HEAD");
      omnilog.status_success(`${extensionId} pinned to commit ${newHash}`);
      return { latestHash, currentHash: newHash, didUpdate: true };
    }
  }
  omnilog.warn(`Unable to find a compatible commit for extension ${manifest.title} 
  with minSDKVersion ${manifest.minSDKVersion} and server version ${sdkVersion}. Defaulting to latest commit.`);
  const pullResult = await simpleGit(localPath).pull();
  if (pullResult.summary.changes === 0) {
    return { latestHash, currentHash, didUpdate: false };
  } else {
    const newHash = await revParseShort(localPath, "HEAD");
    return { latestHash, currentHash: newHash, didUpdate: true };
  }
}
async function getRemoteMinSDKVersions(cwd) {
  const git = simpleGit(cwd);
  await git.fetch("origin");
  const logs = await git.log(["origin/main", "--", "extension.yaml"]);
  const commits = logs.all.reverse();
  let lastVersion = null;
  const minSDKVersionChanges = [];
  for (const commit of commits) {
    const content = await git.show([`${commit.hash}:extension.yaml`]);
    const match = content.match(/minSDKVersion:\s*([0-9.]+)/);
    if (match) {
      const currentVersion = match[1];
      if (currentVersion !== lastVersion) {
        minSDKVersionChanges.push({
          commit_hash: commit.hash,
          old_version: lastVersion,
          new_version: currentVersion
        });
        lastVersion = currentVersion;
      }
    }
  }
  omnilog.info(minSDKVersionChanges);
  return minSDKVersionChanges;
}
function serverSatisfyMinSDKRequirements(manifest, sdkVersion) {
  if (!manifest.minSDKVersion) {
    return true;
  }
  omnilog.info(`Checking if server ${sdkVersion} satisfies minSDKVersion ${manifest.minSDKVersion}`);
  return compareVersions(sdkVersion, manifest.minSDKVersion) >= 0;
}
async function installExtension(extensionId, manifest, localPath, sdkVersion) {
  if (!manifest?.origin?.endsWith(".git")) {
    throw new Error("Manifest does not have a valid origin repository.");
  }
  void await simpleGit().clone(manifest.origin, localPath);
  if (!serverSatisfyMinSDKRequirements(manifest, sdkVersion)) {
    omnilog.info(
      `Finding older extensions versions as the required ${manifest.minSDKVersion} is too new for server ${sdkVersion}`
    );
    const changes = await resetToLatestCompatibleCommit(extensionId, manifest, localPath, sdkVersion);
    omnilog.status_success(`${extensionId} pinned to commit ${changes.currentHash}`);
  }
}
async function updateToLatestCompatibleVersion(extensionId, manifest, localPath, sdkVersion) {
  if (!serverSatisfyMinSDKRequirements(manifest, sdkVersion)) {
    omnilog.info(
      `Finding older extensions versions as the required ${manifest.minSDKVersion} is too new for server ${sdkVersion}`
    );
    return await resetToLatestCompatibleCommit(extensionId, manifest, localPath, sdkVersion);
  } else {
    const result = await simpleGit(localPath).pull();
    const newHash = await revParseShort(localPath, "HEAD");
    return { latestHash: newHash, currentHash: newHash, didUpdate: result.summary.changes > 0 };
  }
}
async function validateLocalChanges(extensionBaseDir, extension) {
  const extensionDir = path3.join(extensionBaseDir, extension);
  const manifestFile = path3.join(extensionDir, "extension.yaml");
  if (!fs.existsSync(manifestFile)) {
    omnilog.error(
      `Validation error: Unable to find manifest file for extension ${extension} at ${manifestFile}. Please check your changes.`
    );
    return false;
  }
  const extensionYaml = await yaml.load(fs.readFileSync(manifestFile, "utf-8"));
  if (!extensionYaml?.origin?.endsWith(".git")) {
    omnilog.error(
      `Validation error: Manifest does not have a valid origin repository for extension ${extension}. Please check your changes.`
    );
    return false;
  }
  const remoteManifestFile = await fetch(extensionYaml.origin);
  if (!remoteManifestFile.ok) {
    omnilog.error(
      `Validation error: Checking ${manifestFile}.
Unable to connect to repo for origin ${extensionYaml.origin}.
Please check your changes.`
    );
    return false;
  }
  return true;
}
var remoteYamlCache = null;
async function loadCombinedManifest(knownExtensionsPath) {
  const manifest = await yaml.load(fs.readFileSync(knownExtensionsPath, "utf-8"));
  if (manifest.community_known_extensions_url === void 0) {
    return manifest;
  }
  try {
    if (remoteYamlCache === null) {
      omnilog.info(`Loading remote community extensions manifest from ${manifest.community_known_extensions_url}`);
      remoteYamlCache = await (await fetch(manifest.community_known_extensions_url)).text();
      const remoteYaml2 = await yaml.load(remoteYamlCache);
      remoteYaml2.known_extensions = remoteYaml2.known_extensions ?? [];
      omnilog.status_success(
        `Found ${remoteYaml2.known_extensions.length} community extensions. Merging into manifest.`
      );
    }
    const remoteYaml = await yaml.load(remoteYamlCache);
    manifest.known_extensions = manifest.known_extensions ?? [];
    remoteYaml.known_extensions = remoteYaml.known_extensions ?? [];
    manifest.known_extensions = manifest.known_extensions.concat(remoteYaml.known_extensions);
  } catch (e) {
    omnilog.warn(
      `Unable to load remote community extensions manifest from ${manifest.community_known_extensions_url}. With error ${e}!`
    );
  }
  return manifest;
}
var ExtensionUtils = {
  getRemoteMinSDKVersions,
  validateLocalChanges,
  installExtension,
  updateToLatestCompatibleVersion,
  loadCombinedManifest
};

// src/core/ServerExtensionsManager.ts
var EXTENSION_UPDATE_AFTER_MS = 1e3 * 60 * 60 * 24;
var PERMITTED_EXTENSIONS_EVENTS = /* @__PURE__ */ ((PERMITTED_EXTENSIONS_EVENTS2) => {
  PERMITTED_EXTENSIONS_EVENTS2["pre_request_execute"] = "pre_request_execute";
  PERMITTED_EXTENSIONS_EVENTS2["post_request_execute"] = "post_request_execute";
  PERMITTED_EXTENSIONS_EVENTS2["component:x-input"] = "component:x-input";
  PERMITTED_EXTENSIONS_EVENTS2["jobs.job_started"] = "job_started";
  PERMITTED_EXTENSIONS_EVENTS2["jobs.job_finished"] = "job_finished";
  PERMITTED_EXTENSIONS_EVENTS2["jobs.pre_workflow_start"] = "job_pre_start";
  PERMITTED_EXTENSIONS_EVENTS2["session_created"] = "session_created";
  PERMITTED_EXTENSIONS_EVENTS2["blocks.block_added"] = "block_added";
  return PERMITTED_EXTENSIONS_EVENTS2;
})(PERMITTED_EXTENSIONS_EVENTS || {});
var ServerExtensionManager = class _ServerExtensionManager extends ExtensionManager {
  constructor(app) {
    super(app);
  }
  get extensions() {
    return this.children;
  }
  has(id4) {
    return this.extensions.has(id4);
  }
  get(id4) {
    return this.extensions.get(id4);
  }
  all() {
    return Array.from(this.extensions.values());
  }
  register(Ctor, config2, wrapper) {
    this.debug(`registering ${config2.id} extensions`);
    let extension = new Ctor(config2.id, this, config2);
    if (wrapper && typeof wrapper === "function") {
      extension = wrapper(extension);
    }
    this.children.set(config2.id, extension);
    extension.create?.();
    return extension;
  }
  onRegisterStatics(args) {
    this.extensions.forEach((extension) => {
      extension.onRegisterStatic(args);
    });
  }
  async runExtensionEvent(event, data) {
    this.debug("runExtensionEvent", event);
    for (const extension of this.extensions.values()) {
      if (!extension.disabled && extension.hasEventHook(event)) {
        const ctx = {
          app: this.app,
          extension
        };
        try {
          await extension.invokeEventHook(ctx, event, data);
        } catch (ex) {
          this.error("Error running extension event", extension.id, event, ex);
        }
      }
    }
  }
  installPackage(packageName) {
    const installed = this.app.kvStorage?.get("extensions.installed_deps") || [];
    if (installed.includes(packageName)) {
      this.info("Package already installed:", packageName);
      return;
    }
    packageName = packageName.replace(/[^a-zA-Z0-9-_@]/g, "");
    try {
      omnilog3.log(execSync(`yarn add ${packageName}`).toString());
    } catch (ex) {
      this.error("Error installing package", packageName, ex);
    }
    installed.push(packageName);
    omnilog3.log(this.app);
    this.app.kvStorage.set("extensions.installed_deps", installed);
  }
  async stop() {
    this.debug("Stopping extensions");
    Object.entries(PERMITTED_EXTENSIONS_EVENTS).forEach(([appEvent, extensionEvent]) => {
      this.app.events.off(appEvent, (data) => {
        void this.runExtensionEvent(extensionEvent, data);
      });
    });
    for (const extension of this.extensions.values()) {
      await extension.stop?.();
    }
    return true;
  }
  async init() {
    const loadStart = performance2.now();
    const self = this;
    const mercsServer = this.app;
    const blockManager = mercsServer.blocks;
    if (!await validateDirectoryExists(path4.join(process.cwd(), "extensions"))) {
      await ensureDir2(path4.join(process.cwd(), "extensions"));
    }
    const apisLocalPath = this.app.config.settings.paths?.apisLocalPath || "data.local/apis-local";
    const localDir = path4.join(process.cwd(), apisLocalPath);
    if (!await validateDirectoryExists(localDir)) {
      await ensureDir2(path4.join(process.cwd(), "data.local", "apis-local"));
    }
    mercsServer.subscribeToServiceEvent("httpd", "onRegisterStatics", this.onRegisterStatics.bind(this));
    const extensions = await fs2.readdir(path4.join(process.cwd(), "extensions"));
    for (const extension of extensions) {
      const start = performance2.now();
      const extensionPath = path4.join(process.cwd(), "extensions", extension);
      const extensionConfigPath = path4.join(extensionPath, "extension.yaml");
      const clientScripts = {};
      const serverScripts = {};
      if (await validateFileExists(extensionConfigPath)) {
        if (await validateFileExists(path4.join(extensionPath, ".disabled"))) {
          this.info("Skipping disabled extension", extension);
          continue;
        }
        if (mercsServer.options.noExtensions && !extension.includes("-core-")) {
          this.info(`Skipping non-core extension "${extension}" because --noExtensions was passed`);
          continue;
        }
        this.info(`Loading extension "${extension}"...`);
        const extensionYaml = await yaml2.load(await fs2.readFile(extensionConfigPath, "utf-8"));
        if (await validateDirectoryExists(path4.join(extensionPath, "scripts"))) {
          if (await validateDirectoryExists(path4.join(extensionPath, "scripts", "client"))) {
            this.info("Registering client scripts for", extension);
            const clientScriptSources = await fs2.readdir(path4.join(extensionPath, "scripts", "client"));
            for (const clientScript of clientScriptSources) {
              const clientScriptPath = path4.join(extensionPath, "scripts", "client", clientScript);
              if (await validateFileExists(clientScriptPath)) {
                this.info("Registering client script", clientScriptPath);
                const scriptId = path4.basename(clientScriptPath, path4.extname(clientScriptPath));
                clientScripts[scriptId] = serialize(await fs2.readFile(clientScriptPath, "utf-8"));
              }
            }
          }
        }
        if (await validateDirectoryExists(path4.join(extensionPath, "scripts", "server"))) {
          this.info("Registering server scripts for", extension);
          const serverScriptSources = await fs2.readdir(path4.join(extensionPath, "scripts", "server"));
          for (const serverScript of serverScriptSources) {
            const serverScriptPath = path4.join(extensionPath, "scripts", "server", serverScript);
            if (await validateFileExists(serverScriptPath)) {
              this.info("Registering server script", serverScriptPath);
              const scriptId = path4.basename(serverScriptPath, path4.extname(serverScriptPath));
              serverScripts[scriptId] = serverScriptPath;
            }
          }
        }
        if (extensionYaml.dependencies != null) {
          this.info("Installing dependencies", extensionYaml.dependencies);
          for (const dep of Object.values(extensionYaml.dependencies)) {
            this.info("Installing dependency", dep);
            self.installPackage.bind(self)(dep);
          }
        }
        let hooks = null;
        let methods = null;
        let initExt;
        let createComponents = null;
        const blocks2 = [];
        const patches = [];
        const errors = [];
        if (await validateDirectoryExists(path4.join(extensionPath, "server"))) {
          let extFile = path4.join(extensionPath, "server", "extension.cjs");
          if (!await validateFileExists(extFile)) {
            extFile = path4.join(extensionPath, "server", "extension.js");
          }
          if (await validateFileExists(extFile)) {
            let loadedScript;
            try {
              const { heapUsed, heapTotal } = process.memoryUsage();
              loadedScript = (await import(`file://${extFile}`)).default;
              const { heapUsed: heapUsed2, heapTotal: heapTotal2 } = process.memoryUsage();
              this.info(
                "Loaded extension.js for",
                extension,
                "in",
                (heapUsed2 - heapUsed).toFixed(),
                "bytes",
                (heapTotal2 - heapTotal).toFixed(),
                "bytes total"
              );
            } catch (ex) {
              errors.push(ex.message);
              this.error("Error loading extension.js for", extension, ex);
            }
            if (loadedScript != null) {
              this.debug("Loaded extension.js for", extension);
              initExt = loadedScript.init;
              if (initExt) {
                this.debug("Initializing extension", extension);
                try {
                  await initExt({ app: this.app });
                } catch (ex) {
                  errors.push(ex.message);
                  this.error("Error initializing extension", extension, ex);
                }
              }
              hooks = loadedScript.extensionHooks;
              this.verbose("Loaded event hooks for", extension, Object.keys(loadedScript.extensionHooks || []));
              if (loadedScript.extensionMethods != null && typeof loadedScript.extensionMethods === "object") {
                methods = loadedScript.extensionMethods;
                this.verbose("Loaded methods hooks for", extension, Object.keys(loadedScript.extensionMethods || []));
              }
              if (loadedScript.createComponents != null) {
                if (extensionYaml.supports?.includes?.("blocks:v2")) {
                  createComponents = loadedScript.createComponents;
                  this.verbose("Loaded createComponents function for", extension, createComponents);
                } else {
                  this.warn(
                    "Skipping createComponents for",
                    extension,
                    "because extension.yaml does not indicate supports.[blocks:v2] property",
                    extensionYaml
                  );
                }
              }
              if (createComponents) {
                const DecorateBlocks = (block7) => {
                  block7.origin = "extension:" + extension;
                  block7.apiNamespace = block7.displayNamespace = extension + ":" + block7.displayNamespace;
                  return block7;
                };
                const DecoratePatches = (patch) => {
                  patch.origin = "extension:" + extension;
                  patch.displayNamespace = extension + ":" + patch.displayNamespace;
                  return patch;
                };
                let results;
                try {
                  const potentialPromise = createComponents?.(OAIComponent31);
                  if (potentialPromise instanceof Promise) {
                    omnilog3.log("Found an async component creation. Awaiting it.");
                    results = await potentialPromise;
                  } else {
                    results = potentialPromise;
                  }
                } catch (ex) {
                  errors.push(ex.message);
                  this.error("Failed to create components for extension, skipping", extension, ex);
                }
                if (results) {
                  let { blocks: blocks3, patches: patches2, macros } = results;
                  if (blocks3)
                    blocks3 = blocks3.map(DecorateBlocks);
                  if (patches2)
                    patches2 = patches2.map(DecoratePatches);
                  if (macros)
                    await this.app.emit("register_macros", macros);
                  if (blocks3)
                    await this.app.emit("register_blocks", blocks3);
                  if (patches2)
                    await this.app.emit("register_patches", patches2);
                  this.success(
                    `Registered ${blocks3.length} blocks for`,
                    extension,
                    Object.values(blocks3).map((c) => c.displayOperationId)
                  );
                  this.success(
                    `Registered ${patches2.length} blocks for`,
                    extension,
                    Object.values(patches2).map((c) => c.displayOperationId)
                  );
                }
              }
            }
          }
        }
        const extensionConfig = Object.assign(
          { id: extension },
          extensionYaml,
          { path: extensionPath },
          {
            scripts: { client: clientScripts, server: serverScripts },
            server: { hooks, methods },
            blocks: blocks2.map((b) => blockManager.formatHeader(b)),
            patches: patches.map((p) => blockManager.formatHeader(p)),
            errors
          }
        );
        this.register(ServerExtension, extensionConfig);
      }
      const end = performance2.now();
      await this.getExtensionsList(this.server.options.updateExtensions);
      this.server.kvStorage?.del("extensions.dirty");
      this.success("Loaded extension", extension, "in", (end - start).toFixed(), "ms");
    }
    Object.entries(PERMITTED_EXTENSIONS_EVENTS).forEach(([appEvent, extensionEvent]) => {
      this.app.events.on(appEvent, async (data) => {
        await this.runExtensionEvent(extensionEvent, data || {});
      });
    });
    await this.app.emit("extensions_loaded", this.app);
    const loadEnd = performance2.now();
    this.success("Loaded", this.extensions.size, "extensions in", (loadEnd - loadStart).toFixed(), "ms");
  }
  static async getCoreExtensions() {
    const knownExtensionsPath = path4.join(process.cwd(), "config.default", "extensions", "known_extensions.yaml");
    if (!await validateFileExists(knownExtensionsPath)) {
      throw new Error(`Unable to find known extensions manifest at ${knownExtensionsPath}`);
    }
    const knownExtensions = await yaml2.load(
      await fs2.readFile(knownExtensionsPath, "utf-8")
    );
    return knownExtensions.core_extensions;
  }
  async getExtensionsList(bustCache) {
    const knownExtensionsPath = path4.join(process.cwd(), "config.default", "extensions", "known_extensions.yaml");
    if (!bustCache && !this.server.options.updateExtensions && !this.server.kvStorage?.get("extensions.dirty")) {
      let manifest = [];
      manifest = this.server.kvStorage?.get("extensions.manifest") || [];
      if (manifest?.length > 0) {
        manifest = manifest.map((extension) => {
          return {
            ...extension,
            installed: this.extensions.has(extension.id)
          };
        });
        return manifest;
      }
    }
    if (!await validateFileExists(knownExtensionsPath)) {
      throw new Error(`Unable to find known extensions manifest at ${knownExtensionsPath}`);
    }
    const knownExtensions = await ExtensionUtils.loadCombinedManifest(knownExtensionsPath);
    if (knownExtensions.core_extensions === void 0) {
      throw new Error(`Unable to find core extensions manifest at ${knownExtensionsPath}`);
    }
    let ret = knownExtensions.core_extensions.map((extension) => {
      const extensionId = extension.id.replace(/[^a-zA-Z0-9-_]/g, "_");
      return {
        ...extension,
        id: extensionId,
        isCore: false,
        isLocal: false,
        installed: this.extensions.has(extensionId)
      };
    });
    knownExtensions.known_extensions = knownExtensions.known_extensions ?? [];
    ret = ret.concat(
      knownExtensions.known_extensions.map((extension) => {
        const extensionId = extension.id.replace(/[^a-zA-Z0-9-_]/g, "_");
        return {
          ...extension,
          id: extensionId,
          isCore: true,
          isLocal: false,
          installed: this.extensions.has(extensionId)
        };
      })
    );
    const localExtensions = Array.from(this.extensions.keys()).filter((extensionId) => !ret.find((e) => e.id === extensionId)).map((extensionId) => {
      return {
        id: extensionId,
        isCore: false,
        // local can never be core
        isLocal: true,
        installed: true
      };
    });
    if (localExtensions.length > 0) {
      ret = ret.concat(localExtensions);
    }
    ret = await Promise.all(
      ret.map(async (extension) => {
        if (extension.installed) {
          extension.manifest = this.extensions.get(extension.id).extensionConfig;
        } else if (extension.url) {
          try {
            const result = await fetch2(extension.url);
            if (!result.ok) {
              extension.error = `Unable to fetch manifest for extension from ${extension.url}`;
            } else {
              const manifestText = await result.text();
              const manifest = await yaml2.load(manifestText);
              extension.manifest = manifest;
            }
          } catch (ex) {
            extension.error = ex.message;
          }
        }
        return extension;
      })
    );
    ret = ret.sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
    this.server.kvStorage?.set("extensions.manifest", ret, Date.now() + EXTENSION_UPDATE_AFTER_MS);
    return ret;
  }
  get server() {
    return this.app;
  }
  // Ensure core extensions exist and are on the latest version
  static async ensureCoreExtensions(extensionDir, sdkVersion) {
    try {
      await ensureDir2(extensionDir);
      const coreExtensions = await _ServerExtensionManager.getCoreExtensions();
      if (coreExtensions === void 0) {
        throw new Error(`Unable to load core extension manifest.`);
      }
      await Promise.all(
        coreExtensions.map(async (extension) => {
          if (!extension.url) {
            omnilog3.warn(`\u26A0\uFE0F  Failed to install ${extension.id}:  No repository url available. Skipping.`);
            return;
          }
          const manifestFile = await fetch2(extension.url);
          const manifestText = await manifestFile.text();
          const manifest = await yaml2.load(manifestText);
          const extensionId = extension.id.replace(/[^a-zA-Z0-9-_]/g, "_");
          const extensionPath = path4.join(extensionDir, extensionId);
          if (await validateDirectoryExists(extensionPath)) {
            omnilog3.info("\u2611\uFE0F  Extension", extensionId, "... ok, updating....");
            const git = simpleGit2(extensionPath);
            try {
              const statusResult = await git.status();
              if (!statusResult.isClean()) {
                omnilog3.warn(
                  `Local changes detected in the ${extensionId} repo.
Please reconcile manually or reset by deleting the folder.`
                );
                if (await ExtensionUtils.validateLocalChanges(extensionDir, extensionId)) {
                  omnilog3.status_success(`Local changes validated on ${extensionId}`);
                }
              } else {
                const result = await ExtensionUtils.updateToLatestCompatibleVersion(extensionId, manifest, extensionPath, sdkVersion);
                const statusString = result.didUpdate ? `updated to ${result.currentHash}` : `up-to-date at ${result.currentHash}`;
                omnilog3.status_success(`Extension ${extensionId}...${statusString}`);
              }
            } catch (ex) {
              omnilog3.warn(`Unable to update core extension ${extensionId}: ${ex}. This may cause problems.`);
            }
            return;
          }
          omnilog3.info("Extension", extensionId, "... missing.");
          if (!extension.url) {
            omnilog3.warn(`\u26A0\uFE0F  Failed to install ${extensionId}:  No repository url available. Skipping.`);
            return;
          }
          try {
            if (!manifest?.origin?.endsWith(".git")) {
              throw new Error("Manifest does not have a valid origin repository.");
            }
            omnilog3.log(`\u231B  Cloning extension ${extensionId}...`);
            try {
              await ExtensionUtils.installExtension(extensionId, manifest, extensionPath, sdkVersion);
            } catch (ex) {
              omnilog3.warn(`\u26A0\uFE0F  Unable to clone from ${manifest.origin}: ${ex}.`);
            }
          } catch (ex) {
            omnilog3.warn(`\u26A0\uFE0F  Failed to install ${extensionId}: ${ex.message}.`);
            return;
          }
          omnilog3.status_success(`${extensionId} was successfully installed. `);
        })
      );
    } catch (ex) {
      omnilog3.warn(`\u26A0\uFE0F Unable to validate core extensions: ${ex}.
 The product may be missing core functionality.`);
    }
    omnilog3.status_success("Core extensions validated.");
  }
  static async pruneExtensions(extensionDir) {
    const extensionDirs = await fs2.readdir(extensionDir);
    for (const extension of extensionDirs) {
      const extensionPath = path4.join(extensionDir, extension);
      if (!await validateDirectoryExists(path4.join(extensionPath, ".git"))) {
        continue;
      }
      const manifestFile = path4.join(extensionPath, "extension.yaml");
      if (!await validateFileExists(manifestFile)) {
        continue;
      }
      const extensionYaml = await yaml2.load(await fs2.readFile(manifestFile, "utf-8"));
      if (!extensionYaml.deprecated) {
        continue;
      }
      omnilog3.info(`  ${extension} is deprecated. ${extensionYaml.deprecationReason}.
Pruning...`);
      await fs2.rmdir(extensionPath, { recursive: true });
      omnilog3.info(`\u2611\uFE0F  ${extension} was successfully pruned. `);
    }
  }
  static async updateExtensions(extensionDir, sdkVersion, options) {
    const extensionDirs = await fs2.readdir(extensionDir);
    await Promise.all(
      extensionDirs.map(async (extension) => {
        if (extension.startsWith(".")) {
          return;
        }
        if (!options.updateExtensions || extension.includes("-core-")) {
          return;
        }
        const extensionPath = path4.join(extensionDir, extension);
        if (!await validateDirectoryExists(path4.join(extensionPath, ".git"))) {
          omnilog3.warn(`\u26A0\uFE0F ${extension} not updated: Not a valid git repository`);
          return;
        }
        const manifestFile = path4.join(extensionPath, "extension.yaml");
        if (!await validateFileExists(manifestFile)) {
          omnilog3.warn(
            `\u26A0\uFE0F ${extension} folder does not have a valid manifest file, update cancelled. To fix, delete ${extensionPath} and reinstall the extension.`
          );
          return;
        }
        const extensionYaml = await yaml2.load(await fs2.readFile(manifestFile, "utf-8"));
        if (extensionYaml.deprecated) {
          omnilog3.warn(
            `\u26A0\uFE0F ${extension} is deprecated. ${extensionYaml.deprecationReason}. 
You can use --pruneExtensions to remove it.`
          );
          return;
        }
        omnilog3.log(`Updating extension ${extension}...`);
        const git = simpleGit2(extensionPath);
        try {
          const statusResult = await git.status();
          if (!statusResult.isClean()) {
            omnilog3.warn(
              `Local changes detected in the ${extension} repo.
Please reconcile manually or reset by deleting the folder.`
            );
            if (await ExtensionUtils.validateLocalChanges(extensionDir, extension)) {
              omnilog3.status_success(`Local changes validated on ${extension}`);
            }
          } else {
            const result = await ExtensionUtils.updateToLatestCompatibleVersion(extension, extensionYaml, extensionPath, sdkVersion);
            const statusString = result.didUpdate ? `updated to ${result.currentHash}` : `up-to-date at ${result.currentHash}`;
            omnilog3.status_success(`Extension ${extension}...${statusString}`);
          }
        } catch (ex) {
          omnilog3.warn(`Unable to update extension ${extension}: ${ex}`);
        }
      })
    );
  }
};

// src/core/ServerIntegrationsManager.ts
import { IntegrationsManager } from "omni-shared";
var ServerIntegrationsManager = class extends IntegrationsManager {
  clientExports;
  constructor(server) {
    super(server);
    this.clientExports = /* @__PURE__ */ new Set();
  }
};

// src/core/NSFWCheck.ts
import * as tf from "@tensorflow/tfjs";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import nsfw from "nsfwjs";
import sharp from "sharp";
import path5 from "path";
import sanitize from "sanitize-filename";
import fs3 from "fs/promises";
var model = null;
var initializing = false;
var originalFetch = global.fetch;
function arrayBufferToString(buf) {
  const uintArray = new Uint8Array(buf);
  let result = "";
  for (let i = 0; i < uintArray.length; i++) {
    result += String.fromCharCode(uintArray[i]);
  }
  return result;
}
global.fetch = async (url, options) => {
  if (url && url.startsWith?.("omni://models/")) {
    const modelPath = url.slice("omni://models/".length);
    let dir = path5.dirname(modelPath);
    let file = path5.basename(modelPath);
    dir = dir.split("/").map((d) => sanitize(d)).join(path5.sep);
    file = sanitize(file);
    console.info("[NSFWCheck] Fetching", url, modelPath, dir, file);
    const data = await fs3.readFile(path5.join(process.cwd(), "config.default", "models", dir, file));
    const buffer = data.buffer;
    return {
      ok: true,
      arrayBuffer: async () => buffer,
      json: async () => {
        const text = arrayBufferToString(buffer);
        const ret = JSON.parse(text);
        return ret;
      },
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      text: async () => buffer.toString()
    };
  }
  return originalFetch(url, options);
};
async function initializeModel() {
  if (!model && !initializing) {
    initializing = true;
    try {
      await tf.setBackend("wasm");
      const wasmPath = process.cwd() + "/config.local/wasm/tfjs-backend-wasm.wasm";
      setWasmPaths(wasmPath);
      const modelPath = "omni://models/nsfwjs/mobilenet-v2-quant/model.json";
      model = await nsfw.load(modelPath);
      initializing = false;
    } catch (error) {
      initializing = false;
      throw error;
    }
  }
}
function transformPredictions(predictions) {
  return predictions.reduce((acc, prediction) => {
    acc[prediction.className] = prediction.probability;
    return acc;
  }, {});
}
var nsfwCheck = async (imageBuffer, options = { maxDimension: 512 }) => {
  try {
    let processedBuffer = imageBuffer;
    if (options.maxDimension && options.maxDimension > 0) {
      const metadata = await sharp(imageBuffer).metadata();
      let width;
      let height;
      if (metadata.width && metadata.height) {
        if (metadata.width > metadata.height) {
          height = options.maxDimension;
        } else {
          width = options.maxDimension;
        }
      }
      processedBuffer = (await sharp(imageBuffer).resize(width, height).raw().toBuffer({ resolveWithObject: true })).data;
    }
    const { data, info } = await sharp(processedBuffer).png().raw().toBuffer({ resolveWithObject: true });
    const rawPixelData = new Uint8Array(data.buffer);
    const imageTensor = tf.tensor3d(rawPixelData, [info.height, info.width, info.channels]);
    const imageRGB = imageTensor.slice([0, 0, 0], [-1, -1, 3]);
    const predictions = await model.classify(imageRGB);
    imageRGB.dispose();
    const isNsfw = predictions.some(
      (prediction) => (prediction.className === "Porn" || prediction.className === "Hentai") && prediction.probability > 0.51 || prediction.className === "Sexy" && prediction.probability > 0.95
    );
    return {
      classes: transformPredictions(predictions),
      isNsfw
    };
  } catch (error) {
    console.error("Error processing the image:", error);
    throw error;
  }
};
void initializeModel();

// src/core/Server.ts
import tar from "tar";

// src/helper/utils.ts
import crypto from "crypto";
import { customAlphabet } from "nanoid";
import { promises as fs4 } from "fs";
import path6 from "path";
function convertMapsToObjects(obj) {
  if (obj instanceof Map) {
    obj = Object.fromEntries(obj);
  }
  for (const key of Object.keys(obj)) {
    if (obj[key] instanceof Map) {
      obj[key] = Object.fromEntries(obj[key]);
    } else if (typeof obj[key] === "object" && obj[key] !== null) {
      obj[key] = convertMapsToObjects(obj[key]);
    }
  }
  return obj;
}
function encrypt(text, secretKey, algorithm, signature) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
  let result = `${iv.toString("hex")}:${encrypted.toString("hex")}`;
  if (signature) {
    const hmac = crypto.createHmac("sha256", signature.hmacSecret);
    hmac.update(signature.data);
    const hmacDigest = hmac.digest("hex");
    omnilog.debug(`Encrypt: HMAC: ${hmacDigest}`);
    result += `:${hmacDigest}`;
  }
  return result;
}
function decrypt(encryptedData, secretKey, algorithm, signature) {
  const textParts = encryptedData.split(":");
  if (signature && textParts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  } else if (!signature && textParts.length !== 2) {
    throw new Error("Invalid encrypted data format");
  }
  const iv = Buffer.from(textParts[0], "hex");
  const encryptedText = Buffer.from(textParts[1], "hex");
  if (signature) {
    const hmacDigest = textParts[2];
    const hmac = crypto.createHmac("sha256", signature.hmacSecret);
    hmac.update(signature.data);
    const generatedHmac = hmac.digest("hex");
    omnilog.debug(`Decrypt: HMAC: ${generatedHmac} vs ${hmacDigest}`);
    omnilog.debug("Siganature", signature.data);
    if (hmacDigest.trim().toLowerCase() !== generatedHmac.trim().toLowerCase()) {
      throw new Error("Data signature is invalid");
    }
  }
  const decipher = crypto.createDecipheriv(algorithm, secretKey, iv);
  let decrypted;
  try {
    decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
  } catch (error) {
    throw new Error("Decryption failed");
  }
  return decrypted.toString();
}
function hashPassword(password, saltBuff) {
  return crypto.pbkdf2Sync(password, saltBuff, 21e4, 64, "sha512");
}
function generateId() {
  const characters = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const length = 16;
  const nanoid = customAlphabet(characters, length);
  return nanoid();
}
function randomBytes(length) {
  return crypto.randomBytes(length).toString("hex");
}
async function* getFiles(directory) {
  const entries = await fs4.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path6.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* getFiles(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}
async function scanDirectory(directoryPath) {
  const files = [];
  for await (const file of getFiles(directoryPath)) {
    files.push(file);
  }
  return files;
}

// src/core/BlockManager.ts
import MurmurHash3 from "imurmurhash";
import path9 from "path";
import { existsSync as existsSync2 } from "fs";
import { access, readFile, readdir, stat } from "fs/promises";
import yaml3 from "js-yaml";
import {
  OAIBaseComponent as OAIBaseComponent47,
  OAIComponent31 as OAIComponent312,
  WorkerContext as WorkerContext3
} from "omni-sockets";
import { Manager, omnilog as omnilog5 } from "omni-shared";
import SwaggerClient from "swagger-client";

// src/services/ComponentService/OpenAPIReteAdapter.ts
var OpenAPIReteAdapter = class {
  openApiDocument;
  namespace;
  credentials;
  //private ajv: Ajv;
  patch;
  // Some OpenAPI spec doesn't have the authentication mech defined in the spec. So we need to patch the APIs
  securitySpecs;
  constructor(namespace, openApiDocument, securitySpecs, credentials, patch = {}) {
    this.namespace = namespace;
    this.openApiDocument = openApiDocument;
    this.credentials = credentials;
    this.patch = patch;
    this.securitySpecs = securitySpecs;
  }
  /* private getValidator(schema: OpenAPIV3.SchemaObject): ValidateFunction | undefined {
     this.ajv ??= new Ajv({ strict: false });
     try {
       return this.ajv.compile(schema);
     } catch (ex) {
       omnilog.log('Exception compiling validator', schema, ex);
     }
     return undefined;
   }*/
  constructInputSchema(operation) {
    const parameterObjects = (operation.parameters ?? []).filter(
      (param) => !("$ref" in param)
    );
    const properties = parameterObjects.reduce((acc, parameter) => {
      acc[parameter.name] = this.resolveSchema(parameter.schema);
      return acc;
    }, {});
    const requestBodySchema = operation.requestBody != null ? operation.requestBody.content["application/json"]?.schema : void 0;
    if (requestBodySchema != null) {
      const resolvedRequestBodySchema = this.resolveSchema(requestBodySchema);
      Object.assign(properties, resolvedRequestBodySchema.properties ?? {});
    }
    return { type: "object", properties };
  }
  constructOutputSchema(operation) {
    const response = operation.responses["200"] || operation.responses["201"] || operation.responses.default;
    const mediaType = response?.content?.["application/json"];
    const schema = mediaType?.schema;
    return this.resolveSchema(schema);
  }
  resolveRef(ref) {
    const pathParts = ref.split("/").slice(1);
    return pathParts.reduce((obj, part) => obj[part], this.openApiDocument);
  }
  resolveSchemaCache = {};
  resolveSchema(schema) {
    if ("$ref" in schema) {
      const ref = schema.$ref;
      if (this.resolveSchemaCache[ref]) {
        return this.resolveSchemaCache[ref];
      }
      const resolvedSchema = this.resolveRef(ref);
      this.resolveSchemaCache[ref] = resolvedSchema;
      const result = this.resolveSchema(resolvedSchema);
      this.resolveSchemaCache[ref] = result;
      return result;
    }
    if (schema.type === "object" && schema.properties) {
      const resolvedProperties = {};
      for (const key in schema.properties) {
        const propertySchema = schema.properties[key];
        resolvedProperties[key] = this.resolveSchema(propertySchema);
      }
      schema = { ...schema, properties: resolvedProperties };
    }
    if (schema.type === "array" && schema.items) {
      const resolvedItems = this.resolveSchema(schema.items);
      schema = { ...schema, items: resolvedItems };
    }
    const keysToResolve = ["allOf", "oneOf", "anyOf"];
    keysToResolve.forEach((key) => {
      const s = schema;
      if (s[key]) {
        s[key] = s[key].map((subSchema) => this.resolveSchema(subSchema));
      }
    });
    if (schema.not) {
      schema.not = this.resolveSchema(schema.not);
    }
    return schema;
  }
  getDataType(schema) {
    if (schema.type) {
      return [schema.type];
    } else if ("$ref" in schema) {
      const resolvedSchema = this.resolveRef(schema.$ref);
      return this.getDataType(resolvedSchema);
    } else if (schema.oneOf != null) {
      return schema.oneOf.flatMap((innerSchema) => this.getDataType(innerSchema));
    } else if (schema.anyOf) {
      return schema.anyOf.flatMap((innerSchema) => this.getDataType(innerSchema));
    } else if (schema.allOf) {
      return schema.allOf.flatMap((innerSchema) => this.getDataType(innerSchema));
    } else {
      return ["object"];
    }
  }
  extractOmniIOsFromParameters(parameters) {
    const parameterObjects = parameters.filter((param) => !("$ref" in param));
    return parameterObjects.reduce((acc, parameter) => {
      const dataTypes = this.getDataType(parameter.schema);
      const customSocket = parameter.schema?.["x-omni-socket"] ?? parameter.schema?.["format"] === "binary" ? "file" : void 0;
      acc[parameter.name] = {
        name: parameter.name,
        type: Array.isArray(dataTypes) ? dataTypes[0] : dataTypes,
        dataTypes: this.getDataType(parameter.schema),
        customSocket,
        required: parameter.required ?? false,
        default: parameter.schema?.default,
        // Add the default value
        title: parameter.schema?.title ?? parameter.name.replace(/_/g, " "),
        // @ts-ignore
        hidden: parameter.schema?.["x-omni-hidden"] === true ? true : void 0,
        // @ts-ignore
        choices: parameter.schema?.["x-omni-choices"] || parameter.schema?.enum || void 0,
        description: parameter.description ?? parameter.schema?.summary ?? parameter.name.replace(/_/g, " "),
        source: { sourceType: "parameter", in: parameter.in },
        minimum: parameter.schema?.minimum,
        // Add minimum
        maximum: parameter.schema?.maximum,
        // Add maximum
        format: parameter.schema?.format,
        // Add format
        step: parameter.schema?.minimum != null && parameter.schema?.maximum != null && parameter.schema?.minimum >= -1 && parameter.schema?.maximum <= 1 ? 0.01 : void 0
      };
      return acc;
    }, {});
  }
  extractOmniIOsFromSchema(schema, socketType, mediaType) {
    if (mediaType.startsWith("audio/") || mediaType === "application/ogg" || mediaType.startsWith("video/") || mediaType.startsWith("image/") || mediaType === "application/octet-stream") {
      let customSocket = "file";
      if (mediaType.startsWith("audio/") || mediaType === "application/ogg")
        customSocket = "audio";
      if (mediaType.startsWith("video/"))
        customSocket = "video";
      if (mediaType.startsWith("image/"))
        customSocket = "image";
      return {
        result: {
          name: "result",
          title: "Result",
          description: "Result",
          dataTypes: ["object"],
          source: socketType === "input" ? { sourceType: "requestBody" } : { sourceType: "responseBody" },
          type: "object",
          customSocket
        }
      };
    }
    if (schema === null) {
      return {};
    }
    const resolved_schema = this.resolveSchema(schema);
    const properties = resolved_schema.properties ?? {};
    if (!resolved_schema.properties && socketType === "output") {
      return {
        _omni_result: {
          type: "object",
          dataTypes: ["object"],
          source: { sourceType: "responseBody" },
          name: "_omni_result",
          title: "_omni_result",
          description: "The underlying API did not have top property, this is a single result object"
        }
      };
    }
    return Object.entries(properties).reduce((acc, [key, propertySchema]) => {
      const resolvedPropertySchema = this.resolveSchema(propertySchema);
      const dataTypes = this.getDataType(resolvedPropertySchema);
      const customSocket = resolvedPropertySchema["x-omni-socket"] ?? resolvedPropertySchema["format"] === "binary" ? "file" : void 0;
      acc[key] = {
        name: key,
        type: Array.isArray(dataTypes) ? dataTypes[0] : dataTypes,
        dataTypes,
        customSocket,
        required: resolved_schema.required?.includes(key) ?? resolvedPropertySchema["x-omni-required"] ?? false,
        default: resolvedPropertySchema.default,
        title: this.getOmniValue(
          resolvedPropertySchema,
          "title",
          resolvedPropertySchema.title ?? key.replace(/_/g, " ")
        ),
        hidden: resolvedPropertySchema["x-omni-hidden"] === true ? true : void 0,
        choices: resolvedPropertySchema["x-omni-choices"] || resolvedPropertySchema.enum || void 0,
        description: resolvedPropertySchema.description ?? key.replace(/_/g, " "),
        source: socketType === "input" ? { sourceType: "requestBody" } : { sourceType: "responseBody" },
        format: resolvedPropertySchema.format,
        minimum: resolvedPropertySchema.minimum,
        maximum: resolvedPropertySchema.maximum,
        step: resolvedPropertySchema.minimum != null && resolvedPropertySchema.maximum != null && resolvedPropertySchema.minimum >= -1 && resolvedPropertySchema.maximum <= 1 ? 0.01 : void 0
      };
      return acc;
    }, {});
  }
  extractOmniIOsFromRequestBody(requestBody) {
    const { content } = requestBody;
    if (!content)
      return {};
    for (const mediaTypeKey of Object.keys(content)) {
      const mediaType = content[mediaTypeKey];
      return this.extractOmniIOsFromSchema(mediaType.schema ?? null, "input", mediaTypeKey);
    }
    return {};
  }
  extractOmniIOsFromResponse(response) {
    const { content } = response;
    if (!content) {
      return {
        _omni_result: {
          type: "object",
          dataTypes: ["object"],
          source: { sourceType: "responseBody" },
          name: "_omni_result",
          title: "_omni_result",
          description: "The underlying API did not describe the return value, this is a single result object"
        }
      };
    }
    for (const mediaTypeKey of Object.keys(content)) {
      const mediaType = content[mediaTypeKey];
      return this.extractOmniIOsFromSchema(mediaType.schema ?? null, "output", mediaTypeKey);
    }
    omnilog.warn("No schema found in response");
    return {};
  }
  resolveReference(ref) {
    const referencePath = ref.$ref.split("/").slice(1);
    let resolvedObject = this.openApiDocument;
    for (const pathPart of referencePath) {
      resolvedObject = resolvedObject[pathPart];
    }
    return resolvedObject;
  }
  mangleTitle(title4) {
    if (title4 == null) {
      return void 0;
    }
    title4 = title4.replace(/_/g, " ");
    title4 = title4.replace(/([a-z])([A-Z])/g, "$1 $2");
    title4 = title4.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
    title4 = title4.replace(/[^a-zA-Z0-9 ]/g, "");
    return title4;
  }
  getReteComponentDef(operationId) {
    let operation;
    let urlPath;
    let operationMethod;
    for (const pathItemKey in this.openApiDocument.paths) {
      const pathItem = this.openApiDocument.paths[pathItemKey];
      const methods = Object.entries(pathItem).filter(
        ([method, _]) => ["get", "put", "post", "delete", "options", "head", "patch", "trace"].includes(method)
      );
      for (const [method, op] of methods) {
        if (op) {
          const pseudoOperationId = `${method}_${pathItemKey.replace(/\//g, "_")}`;
          op.operationId = op.operationId || pseudoOperationId;
          if (op.operationId === operationId) {
            operation = op;
            operationMethod = method;
            urlPath = pathItemKey;
            break;
          }
        }
      }
      if (operation != null) {
        break;
      }
    }
    if (operation == null) {
      throw new Error(`Operation with operationId '${operationId}' not found.`);
    }
    const inputOmniIOsFromParameters = this.extractOmniIOsFromParameters(
      operation.parameters ?? []
    );
    const inputOmniIOsFromRequestBody = operation.requestBody != null ? this.extractOmniIOsFromRequestBody(operation.requestBody) : [];
    const requestBodyObject = operation.requestBody != null ? "content" in operation.requestBody ? operation.requestBody : this.resolveReference(operation.requestBody) : void 0;
    const requestContentType = requestBodyObject?.content != null ? Object.keys(requestBodyObject.content)[0] : void 0;
    const inputOmniIOs = Object.assign({}, inputOmniIOsFromParameters, inputOmniIOsFromRequestBody);
    const response = operation.responses["200"] || operation.responses["201"] || operation.responses.default;
    const responseContentType = response?.content ? Object.keys(response.content)[0] : void 0;
    const outputOmniIOs = response ? this.extractOmniIOsFromResponse(response) : {};
    const tags = operation.tags ?? [];
    tags.push("base-api");
    const ret = {
      type: "OAIComponent31",
      title: this.getOmniValue(operation, "title", this.mangleTitle(operation.operationId) ?? "Unnamed Component"),
      category: this.namespace,
      xOmniEnabled: true,
      showSimplifiedIO: false,
      //ersion: '1.0.0',
      errors: [],
      flags: 0,
      tags,
      origin: "omnitool:OpenAPIReteAdapter",
      method: operationMethod ?? "get",
      // use the determined method or fallback to 'get'
      security: this.getAuthenticationScheme(operation.security ?? []),
      requestContentType,
      validator: void 0,
      // TODO: Consider reenabling when OpenAPI incompatibilities on major APIs are not as painful anymore
      credentials: this.credentials,
      description: this.getOmniValue(
        operation,
        "description",
        operation.description ?? operation.summary ?? "No Description"
      ),
      apiNamespace: this.namespace,
      apiOperationId: operationId,
      displayNamespace: this.namespace,
      displayOperationId: operationId,
      responseContentType: responseContentType ?? "application/json",
      urlPath: urlPath ?? "",
      // Include the urlPath property
      inputs: inputOmniIOs,
      outputs: outputOmniIOs,
      customData: {},
      controls: {}
    };
    return ret;
  }
  getAuthenticationScheme(securityRequirements) {
    const schemes = [];
    if (this.securitySpecs === "disable")
      return [];
    if (this.securitySpecs) {
      schemes.push(this.securitySpecs);
      return schemes;
    }
    if (this.openApiDocument.components?.securitySchemes && this.securitySpecs !== "disable") {
      const isOptional = securityRequirements.reduce((acc, requirement) => {
        Object.keys(requirement).length > 0 ? acc = false : acc = true;
        return acc;
      }, false);
      securityRequirements.forEach((requirement) => {
        Object.keys(requirement).forEach((key) => {
          const scheme = this.openApiDocument.components?.securitySchemes?.[key];
          if (scheme) {
            if ("$ref" in scheme) {
              omnilog.info(`Security scheme ${key} is a reference, skipping...`);
            } else if (scheme.type === "http") {
              if (scheme.scheme === "basic") {
                schemes.push({
                  type: "http_basic",
                  isOptional,
                  requireKeys: [
                    {
                      id: "username",
                      displayName: "User name",
                      type: "string"
                    },
                    {
                      id: "password",
                      displayName: "Password",
                      type: "string"
                    }
                  ]
                });
              } else if (scheme.scheme === "bearer") {
                schemes.push({
                  type: "http_bearer",
                  isOptional,
                  requireKeys: [
                    {
                      id: "Bearer",
                      displayName: "Bearer",
                      type: "string"
                    }
                  ]
                });
              } else {
                omnilog.verbose(`Unsupported http security scheme ${key} with scheme ${scheme.scheme}`);
              }
            } else if (scheme.type === "apiKey") {
              schemes.push({
                type: "apiKey",
                isOptional,
                requireKeys: [
                  {
                    id: scheme.name ?? "api_key",
                    in: scheme.in ?? "header",
                    displayName: scheme.name ?? "api_key",
                    type: "string"
                  }
                ]
              });
            } else if (scheme.type === "oauth2") {
              if (scheme.flows?.authorizationCode) {
                schemes.push({
                  type: "oauth2",
                  isOptional,
                  requireKeys: [
                    {
                      id: "accessToken",
                      displayName: "Access Token",
                      type: "oauth2"
                    }
                  ],
                  oauth: {
                    authorizationCode: {
                      authorizationUrl: scheme.flows.authorizationCode.authorizationUrl ?? "",
                      tokenUrl: scheme.flows.authorizationCode.tokenUrl ?? "",
                      refreshUrl: scheme.flows.authorizationCode.refreshUrl,
                      scopes: Object.keys(scheme.flows.authorizationCode.scopes)
                    }
                  }
                });
              } else {
                omnilog.verbose("Unsupported oauth2 security scheme");
              }
            } else {
              omnilog.verbose(`Unsupported security scheme ${key} with type ${scheme.type}`);
            }
          }
        });
      });
    } else {
      omnilog.verbose("No authentication method defined in the OpenAPI document");
    }
    return schemes;
  }
  // See if a x-omni-<name> property is defined on the operation, otherwise return the default value
  getOmniValue(parent, name, defaultValue) {
    return parent[`x-omni-${name}`] ?? defaultValue;
  }
  getOperationIds(filter) {
    const apiOperationIds = [];
    for (const pathItemKey in this.openApiDocument.paths) {
      const pathItem = this.openApiDocument.paths[pathItemKey];
      const operations = Object.values(pathItem).filter(
        (value) => value !== void 0
      );
      for (const op of operations.filter((op2) => op2)) {
        if (op.operationId) {
          if (filter?.includes(op.operationId)) {
            apiOperationIds.push(op.operationId);
          } else {
            if (filter == null) {
              apiOperationIds.push(op.operationId);
            }
          }
        }
      }
    }
    return apiOperationIds;
  }
  getReteComponentDefs(filter) {
    const apiOperationIds = this.getOperationIds(filter);
    return apiOperationIds.map((apiOperationId) => this.getReteComponentDef(apiOperationId));
  }
};

// src/blocks/DefaultBlocks/boolean_input.ts
import { OAIBaseComponent, OmniComponentMacroTypes, BlockCategory as Category } from "omni-sockets";
var NS_OMNI = "omnitool";
var component = OAIBaseComponent.create(NS_OMNI, "input_boolean").fromScratch().set("description", "Input boolean values.").set("title", "Boolean Input").set("category", Category.INPUT_OUTPUT).setMethod("X-CUSTOM");
component.addInput(
  component.createInput("boolean", "boolean", void 0, { array: false }).set("title", "Yes/No").set("description", "A yes/no value").setRequired(true).toOmniIO()
).addOutput(
  component.createOutput("boolean", "boolean", void 0, { array: false }).set("title", "Yes/No").set("description", "A yes/no value").toOmniIO()
);
component.setMacro(OmniComponentMacroTypes.EXEC, (payload, ctx) => {
  console.log("boolean input", payload.boolean);
  return { boolean: payload.boolean };
});
var BooleanInputComponent = component.toJSON();
var boolean_input_default = BooleanInputComponent;

// src/blocks/DefaultBlocks/color_name.ts
import { OAIBaseComponent as OAIBaseComponent2, OmniComponentMacroTypes as OmniComponentMacroTypes2, BlockCategory as Category2 } from "omni-sockets";
import namer from "color-namer";
var block = OAIBaseComponent2.create("omnitool", "color_name");
block.fromScratch().set("description", "Translate RGB value to color name.").set("title", "Color Namer").set("category", Category2.UTILITIES).setMethod("X-CUSTOM");
block.addInput(
  block.createInput("RGB Color", "string", "text").set(
    "description",
    "Input color value in various formats, e.g., #ff0000, #f00, rgb(255,0,0), rgba(255,0,0,1), hsl(0,100%,50%), hsla(0,100%,50%,1)"
  ).setControl({ controlType: "AlpineLabelComponent" }).toOmniIO()
);
block.addOutput(block.createOutput("Color Name", "string", "text").toOmniIO());
block.setMacro(OmniComponentMacroTypes2.EXEC, async (payload, ctx) => {
  const rgbColor = payload["RGB Color"];
  const colors = namer(rgbColor);
  const colorName = colors.basic[0].name;
  return { "Color Name": colorName };
});
var ColorNameBlock = block.toJSON();
var color_name_default = ColorNameBlock;

// src/blocks/DefaultBlocks/chat_input.ts
import {
  OAIBaseComponent as OAIBaseComponent3,
  OmniComponentFlags,
  OmniComponentMacroTypes as OmniComponentMacroTypes3,
  BlockCategory as Category3
} from "omni-sockets";
var NS_OMNI2 = "omnitool";
var component2 = OAIBaseComponent3.create(NS_OMNI2, "chat_input").fromScratch().set("title", "Chat Input").set("category", Category3.INPUT_OUTPUT).setFlag(OmniComponentFlags.UNIQUE_PER_WORKFLOW, true).set(
  "description",
  `Receive data (text, images, audio, video, and documents) directly from the chat window, transforming the recipe into a simple chatbot.
    Text, images, audio, video and documents are supplied via chat by typing and/or uploading.
    The JSON output is automatically populated if the text is valid JSON.
  `
).setMethod("X-CUSTOM");
component2.addInput(
  component2.createInput("text", "string", "text").set("title", "Text").set("description", "An input string").toOmniIO()
).addInput(
  component2.createInput("images", "array", "image").set("title", "Images").set("description", "One or more images").setControl({
    controlType: "AlpineLabelComponent"
  }).toOmniIO()
).addInput(
  component2.createInput("audio", "array", "audioArray").set("title", "Audio").set("description", "One or more audio files").setControl({
    controlType: "AlpineLabelComponent"
  }).toOmniIO()
).addInput(
  component2.createInput("video", "array", "videoArray").set("title", "Video").set("description", "One or more videos").setControl({
    controlType: "AlpineLabelComponent"
  }).toOmniIO()
).addInput(
  component2.createInput("documents", "array", "documentArray").set("title", "Documents").set("description", "One or more documents").setControl({
    controlType: "AlpineLabelComponent"
  }).toOmniIO()
).addInput(
  component2.createInput("json", "array", "objectArray").set("title", "JSON Object(s)").set("description", "One or more object").toOmniIO()
).addOutput(component2.createOutput("text", "string", "text").set("title", "Text").toOmniIO()).addOutput(component2.createOutput("images", "array", "imageArray").set("title", "Images").toOmniIO()).addOutput(component2.createOutput("audio", "array", "audioArray").set("title", "Audio").toOmniIO()).addOutput(component2.createOutput("video", "array", "videoArray").set("title", "Video").toOmniIO()).addOutput(component2.createOutput("documents", "array", "documentArray").set("title", "Documents").toOmniIO()).addOutput(
  component2.createOutput("json", "array", "object", { array: true }).set("title", "JSON Object(s)").toOmniIO()
).setMacro(OmniComponentMacroTypes3.ON_SAVE, async (node, recipe) => {
  recipe.ui ??= {};
  recipe.ui.chat = {
    enabled: true
  };
  return true;
}).setMacro(OmniComponentMacroTypes3.EXEC, async (payload, ctx) => {
  const input = Object.assign({}, payload || {}, ctx.args);
  const input_json = input.json;
  let json;
  if (input_json) {
    json = input_json;
  } else {
    try {
      json = JSON.parse(input.text);
    } catch (e) {
    }
  }
  if (typeof json === "object" && !Array.isArray(json)) {
    json = [json];
  }
  await ctx.app.emit("component:x-input", input);
  return { ...input, json };
});
var ChatInputComponent = component2.toJSON();
var chat_input_default = ChatInputComponent;

// src/blocks/DefaultBlocks/chat_output.ts
import { OAIBaseComponent as OAIBaseComponent4, OmniComponentMacroTypes as OmniComponentMacroTypes4, BlockCategory as Category4 } from "omni-sockets";
var NS_OMNI3 = "omnitool";
var component3 = OAIBaseComponent4.create(NS_OMNI3, "chat_output").fromScratch().set("title", "Chat Output").set("category", Category4.INPUT_OUTPUT).set(
  "description",
  "Send data from this block's inputs to the chat window. The chat supports text formats like text/plain, text/markdown, and text/markdown-code. Images, Audio, Documents, and Video are automatically embedded as interactive elements. Users can select either permanent or expiring storage modes for files."
).setMethod("X-CUSTOM");
component3.addInput(
  component3.createInput("text", "string", "text", { array: true }).set("title", "Text").set("description", "A simple input string").allowMultiple(true).toOmniIO()
).addControl(
  component3.createControl("textType", "string").set("title", "Message Format").set("description", "The format of chat message").setChoices(["text/plain", "text/markdown", "text/markdown-code"], "text/markdown").toOmniControl()
).addInput(
  component3.createInput("images", "array", "image", { array: true }).set("title", "Images").set("description", "One or more images").allowMultiple(true).toOmniIO()
).addInput(
  component3.createInput("audio", "array", "audio", { array: true }).set("title", "Audio").set("description", "One or more audio files").allowMultiple(true).toOmniIO()
).addInput(
  component3.createInput("documents", "array", "document", { array: true }).set("title", "Documents").set("description", "One or more documents").allowMultiple(true).toOmniIO()
).addInput(
  component3.createInput("videos", "array", "video", { array: true }).set("title", "Videos").set("description", "Video Files (.mp4)").allowMultiple(true).toOmniIO()
).addInput(
  component3.createInput("files", "array", "file", { array: true }).set("title", "Files").set("description", "Any type of file").allowMultiple(true).toOmniIO()
).addInput(
  component3.createInput("object", "array", "objectArray").set("title", "JSON").set("description", "A JSON object").allowMultiple(true).setControl({
    controlType: "AlpineLabelComponent"
  }).toOmniIO()
).addInput(
  component3.createInput("persistData", "string", "text").set("title", "File Storage Mode").set("description", "Whether to save the files permanently or make them expire after a certain amount of time").setChoices(["Permanent", "Expiring"], "Permanent").toOmniIO()
).setMacro(OmniComponentMacroTypes4.EXEC, async (payload, ctx) => {
  const deleteData = (p) => {
    delete p.data;
    return p;
  };
  if (payload.persistData !== "Expiring") {
    if (payload.images && payload.images.length > 0) {
      await Promise.all(payload.images.map(async (image) => {
        delete image.data;
        return ctx.app.cdn.setExpiry(image, ctx.userId, null);
      }));
    }
    if (payload.audio && payload.audio.length > 0) {
      await Promise.all(payload.audio.map(async (audio) => {
        delete audio.data;
        return ctx.app.cdn.setExpiry(audio, ctx.userId, null);
      }));
    }
    if (payload.documents && payload.documents.length > 0) {
      await Promise.all(payload.documents.map(async (doc) => {
        delete doc.data;
        return ctx.app.cdn.setExpiry(doc, ctx.userId, null);
      }));
    }
    if (payload.videos && payload.videos.length > 0) {
      await Promise.all(payload.videos.map(async (vid) => {
        delete vid.data;
        return ctx.app.cdn.setExpiry(vid, ctx.userId, null);
      }));
    }
  }
  const attachments = {
    object: payload.object && !Array.isArray(payload.object) ? [payload.object] : payload.object,
    audio: payload?.audio?.map(deleteData),
    documents: payload?.documents?.map(deleteData),
    files: payload?.files?.map(deleteData),
    images: payload?.images?.map(deleteData),
    videos: payload?.videos?.map(deleteData)
  };
  const flags = ["no-picture"];
  const nickname = ctx.args?.xOmniNickName;
  await ctx.app.sendMessageToSession(
    ctx.sessionId,
    payload.text || " ",
    payload.textType,
    attachments,
    flags,
    nickname,
    ctx.workflowId
  );
  return {};
});
var ChatOutputComponent = component3.toJSON();
var chat_output_default = ChatOutputComponent;

// src/blocks/DefaultBlocks/custom_extension_event.ts
import { OmniSSEMessages } from "omni-shared";
import { OAIBaseComponent as OAIBaseComponent5, OmniComponentMacroTypes as OmniComponentMacroTypes5, BlockCategory as Category5 } from "omni-sockets";
var component4 = OAIBaseComponent5.create("omnitool", "custom_extension_event_client").fromScratch().set(
  "description",
  "Sends a custom extension event to a client extension (which must be open to receive it). This block can be used to let the server trigger events in an extension window on the client"
).set("title", "Custom Extension Event (Client)").set("category", Category5.UTILITIES).setMethod("X-CUSTOM");
component4.addInput(
  component4.createInput("extensionId", "string").set("title", "Extension Id").set("description", "The ID of the extension to notify (e.g. omni-extension-babylonjs)").setRequired(true).toOmniIO()
).addInput(
  component4.createInput("eventId", "string").set("title", "Event Id").set("description", "The custom eventId to send to the extension.").toOmniIO()
).addInput(
  component4.createInput("eventArgs", "object", "json").set("title", "Event Arg").set("description", "Event Argument").toOmniIO()
);
component4.setMacro(OmniComponentMacroTypes5.EXEC, async (payload, ctx) => {
  let { extensionId, eventId, eventArgs } = payload;
  if (!extensionId)
    throw new Error("Extension Id Required");
  if (!eventId)
    throw new Error("EventId required");
  if (eventArgs && typeof eventArgs === "string") {
    eventArgs = JSON.parse(eventArgs);
  }
  const message = {
    type: OmniSSEMessages.CUSTOM_EXTENSION_EVENT,
    body: {
      extensionId,
      eventId,
      eventArgs
    }
  };
  await ctx.app.io.send(ctx.sessionId, message);
  return {};
});
var CustomExtensionEventClientComponent = component4.toJSON();
var custom_extension_event_default = CustomExtensionEventClientComponent;

// src/blocks/DefaultBlocks/error_output.ts
import { OAIBaseComponent as OAIBaseComponent6, BlockCategory as Category6 } from "omni-sockets";
var NS_OMNI4 = "omnitool";
var component5 = OAIBaseComponent6.create(NS_OMNI4, "output_error").fromScratch().set("description", "View errors.").set("title", "Error Viewer").set("category", Category6.UTILITIES).setMethod("X-PASSTHROUGH");
component5.addOutput(component5.createOutput("error", "error").set("description", "An Error").toOmniIO());
component5.setMeta({
  source: {
    summary: "A standard text input component",
    authors: ["Mercenaries.ai Team"],
    links: {
      "Mercenaries.ai": "https://mercenaries.ai"
    }
  }
});
var controlComposer = component5.createControl("errorViewer");
controlComposer.setControlType("AlpineTextComponent");
component5.addControl(controlComposer.toOmniControl());
var ErrorOutputComponent = component5.toJSON();
var error_output_default = ErrorOutputComponent;

// src/blocks/DefaultBlocks/file_array_splitter.ts
import { OAIBaseComponent as OAIBaseComponent7, OmniComponentMacroTypes as OmniComponentMacroTypes7, BlockCategory as Category7 } from "omni-sockets";
import deepmerge from "deepmerge";

// src/blocks/DefaultBlocks/meta.json
var meta_default = {
  source: {
    authors: ["Mercenaries.ai Team"],
    links: {
      "Mercenaries.ai": "https://mercenaries.ai"
    }
  }
};

// src/blocks/DefaultBlocks/file_array_splitter.ts
var NS_OMNI5 = "omnitool";
var component6 = OAIBaseComponent7.create(NS_OMNI5, "fileArrayManipulator").fromScratch().set(
  "description",
  "Perform file array manipulation with operations like splitting based on criteria such as separating the first item, dividing even and odd indexed items, or isolating the last item."
).set("title", "File Array Manipulator").set("category", Category7.DATA_TRANSFORMATION).setMethod("X-CUSTOM");
component6.addInput(
  component6.createInput("f1", "array", "cdnObjectArray").set("title", "Files").set("description", "Array of files").setRequired(true).toOmniIO()
).addInput(
  component6.createInput("op", "string", "string").set("title", "Operation").set("description", "Operation to perform").setChoices(["split_first_rest", "split_even_odd", "split_rest_last"], "split_first_rest").toOmniIO()
).addOutput(
  component6.createOutput("f1", "array", "cdnObjectArray").set("title", "Files 1").set("description", "First Output").toOmniIO()
).addOutput(
  component6.createOutput("f2", "array", "cdnObjectArray").set("title", "Files 2").set("description", "Second output").toOmniIO()
).setMacro(OmniComponentMacroTypes7.EXEC, async (payload, ctx) => {
  if (payload.f1.length > 1) {
    if (payload.op === "split_first_rest") {
      const f1 = payload.f1.slice(0, 1);
      const f2 = payload.f1.slice(1);
      return { f1, f2 };
    } else if (payload.op === "split_even_odd") {
      const f1 = payload.f1.filter((_, i) => i % 2 === 0);
      const f2 = payload.f1.filter((_, i) => i % 2 === 1);
      return { f1, f2 };
    } else if (payload.op === "split_rest_last") {
      const f1 = payload.f1.slice(0, payload.f1.length - 2);
      const f2 = payload.f1.slice(payload.f1.length - 1);
      return { f1, f2 };
    }
  } else if (payload.f1.length == 1) {
    return { f1: payload.f1[0] };
  } else {
    return {};
  }
}).setMeta(deepmerge({ source: { summary: component6.data.description } }, meta_default));
var FileArraySplitterComponent = component6.toJSON();
var file_array_splitter_default = FileArraySplitterComponent;

// src/blocks/DefaultBlocks/file_output.ts
import { EOmniFileTypes } from "omni-sdk";
import { OAIBaseComponent as OAIBaseComponent8, OmniComponentMacroTypes as OmniComponentMacroTypes8, BlockCategory as Category8 } from "omni-sockets";
var NS_OMNI6 = "omnitool";
var component7 = OAIBaseComponent8.create(NS_OMNI6, "file_output").fromScratch().set("title", "File Output").set("category", Category8.FILE_OPERATIONS).set(
  "description",
  "Saves recipe results to the File Manager Storage (CTRL+SHIFT+F) for future retrieval. Supports saving text, images, audio, documents, and JSON objects. Choose storage duration and specify file name."
).setMethod("X-CUSTOM");
component7.addInput(
  component7.createInput("text", "string", "text").set("title", "Text").set("description", "A simple input string").toOmniIO()
);
component7.addInput(
  component7.createInput("fileName", "string", "text").set("title", "FileName").setDefault("file").set(
    "description",
    "The filename (without extension) to use when saving. If not provided, a default will be used"
  ).toOmniIO()
).addControl(
  component7.createControl("textType", "string").set("title", "Format").set("description", "The format of chat message").setChoices(["text/plain", "text/markdown", "text/html", "application/json"], "text/markdown").toOmniControl()
).addControl(
  component7.createControl("storageType", "string").set("title", "Storage Duration").set("description", "The duration of storage").setChoices(["Temporary", "Permanent"], "Permanent").toOmniControl()
).addInput(
  component7.createInput("images", "array", "imageArray", { array: true }).set("title", "Images").set("description", "One or more images").allowMultiple(true).toOmniIO()
).addInput(
  component7.createInput("audio", "array", "audioArray", { array: true }).set("title", "Audio").set("description", "One or more audio files").toOmniIO()
).addInput(
  component7.createInput("videos", "array", "video", { array: true }).set("title", "Video").set("description", "One or more video files").toOmniIO()
).addInput(
  component7.createInput("documents", "array", "documentArray", { array: true }).set("title", "Documents").set("description", "One or more documents").toOmniIO()
).addInput(
  component7.createInput("objects", "array", "objectArray", { array: true }).set("title", "JSON").set("description", "A JSON object").toOmniIO()
).addInput(
  component7.createInput("unique", "boolean", "boolean").set("title", "Unique Names").set("description", "If true, will avoid creating files with the same name by adding _2, _3 etc. to the end of the file names").toOmniIO()
).addOutput(
  component7.createOutput("files", "array", "fileArray").set("title", "Files").set("description", "The file(s)").toOmniIO()
).addOutput(
  component7.createOutput("urls", "string", "text").set("title", "URLs").set("description", "The URLs to download the created file(s)").toOmniIO()
).setMacro(OmniComponentMacroTypes8.EXEC, async (payload, ctx) => {
  const permanence = payload.storageType === "Permanent" ? "put" : "putTemp";
  const unique = payload.unique || false;
  const fileName = payload.fileName?.trim?.() || void 0;
  const files = [];
  if (payload.text?.trim().length > 0) {
    let ext = ".md";
    if (payload.textType === "text/plain") {
      ext = ".txt";
    }
    if (payload.textType === "text/html") {
      ext = ".html";
    }
    if (payload.textType === "application/json") {
      ext = ".json";
    }
    const file = await ctx.app.cdn[permanence](payload.text, {
      mimeType: payload.textType,
      fileName: fileName + ext,
      fileType: EOmniFileTypes.document,
      userId: ctx.userId
    });
    files.push(file);
  }
  if (payload.objects) {
    let json_string = "";
    if (payload.objects.length === 1)
      json_string = JSON.stringify(payload.objects[0]);
    else
      json_string = JSON.stringify({ "json": payload.objects });
    const file = await ctx.app.cdn[permanence](json_string, {
      mimeType: "application/json",
      fileName: fileName + ".json",
      fileType: EOmniFileTypes.document,
      userId: ctx.userId
    });
    files.push(file);
  }
  if (payload.documents)
    await uploadAndAddFiles(payload.documents, permanence, fileName, ctx, files, unique);
  if (payload.images)
    await uploadAndAddFiles(payload.images, permanence, fileName, ctx, files, unique);
  if (payload.audio)
    await uploadAndAddFiles(payload.audio, permanence, fileName, ctx, files, unique);
  if (payload.videos)
    await uploadAndAddFiles(payload.videos, permanence, fileName, ctx, files, unique);
  const urls = [];
  if (!files || files.length === 0)
    return { "ok": false };
  for (const file of files) {
    const name = file.fileName;
    const fid = file.fid;
    const raw_url = "http://" + file.ticket.publicUrl + file.url + "?download=true";
    const url = `<a href="${raw_url}" target="_blank">${name} --> ${fid}</a>
  `;
    urls.push(url);
  }
  const result = { "ok": true, files, urls };
  return result;
});
var FileOutputComponent = component7.toJSON();
var file_output_default = FileOutputComponent;
async function uploadAndAddFiles(items, type2, fileName, ctx, files, unique) {
  let index = 0;
  for (const cdnRecord of items) {
    const buffer = cdnRecord.data;
    const data = Buffer.from(buffer);
    const ext = cdnRecord.fileName.split(".").pop();
    let new_filename = fileName || cdnRecord.fileName;
    if (unique && files.length > 0)
      new_filename = new_filename + "_" + (index + 1);
    if (ext)
      new_filename = new_filename + "." + ext;
    const file = await ctx.app.cdn[type2](
      data,
      { mimeType: cdnRecord.mimeType, fileName: new_filename, userId: ctx.userId, jobId: ctx.jobId },
      cdnRecord.meta
    );
    files.push(file);
    index++;
  }
}

// src/blocks/DefaultBlocks/file_metadata_writer.ts
import { OAIBaseComponent as OAIBaseComponent9, OmniComponentMacroTypes as OmniComponentMacroTypes9, BlockCategory as Category9 } from "omni-sockets";
var NS_OMNI7 = "omnitool";
var component8 = OAIBaseComponent9.create(NS_OMNI7, "file_metadata_writer").fromScratch().set("title", "Set File Metadata").set("category", Category9.FILE_OPERATIONS).set(
  "description",
  "Assign metadata to a specific file. It enables you to set the file name and other metadata for image, audio, or document files"
).setMethod("X-CUSTOM");
component8.addInput(
  component8.createInput("file", "object", "file", { customSettings: { do_no_return_data: true } }).set("title", "File").set("description", "A single image, audio or document file").toOmniIO()
);
component8.addInput(
  component8.createInput("fileName", "string", "text").set("title", "File Name").set(
    "description",
    "The filename (without extension) to use when saving. If not provided, a default will be used"
  ).toOmniIO()
).addOutput(
  component8.createOutput("file", "object", "file").set("title", "File").set("description", "The file").toOmniIO()
).setMacro(OmniComponentMacroTypes9.EXEC, async (payload, ctx) => {
  const fileName = payload.fileName?.trim?.() || void 0;
  const file = payload.file;
  if (payload.fileName && file.fid) {
    file.fileName = fileName;
    await ctx.app.cdn.updateFileEntry(file);
  }
  return { file };
});
var FileMetaDataWriterComponent = component8.toJSON();
var file_metadata_writer_default = FileMetaDataWriterComponent;

// src/blocks/DefaultBlocks/file_switch.ts
import { OAIBaseComponent as OAIBaseComponent10, OmniComponentMacroTypes as OmniComponentMacroTypes10, BlockCategory as Category10 } from "omni-sockets";
var NS_OMNI8 = "omnitool";
var component9 = OAIBaseComponent10.create(NS_OMNI8, "file_switch").fromScratch().set(
  "description",
  "Toggle the flow of files based on a switch. Enable or disable features by controlling the output of files when the switch is on or off."
).set("title", "File Switch Box").set("category", Category10.UTILITIES).setMethod("X-CUSTOM");
component9.addInput(
  // We are not manipulating any data in this block, so we set the customSettings.do_no_return_data to true
  component9.createInput("files", "array", "file", { array: true, customSettings: { do_no_return_data: true } }).set("title", "Files").set("description", "A file array").allowMultiple(true).toOmniIO()
);
component9.addInput(
  component9.createInput("switch", "boolean", "boolean").set("description", "Switch (on/off)").toOmniIO()
).addOutput(
  component9.createOutput("on", "array", "file", { array: true }).set("description", "Files will leave through this output when the switch is on").toOmniIO()
).addOutput(
  component9.createOutput("off", "array", "file", { array: true }).set("description", "Files will leave through this output when the switch is on").toOmniIO()
).addOutput(
  component9.createOutput("switch", "boolean").set("description", "Passthrough of the switch signal").toOmniIO()
).setMeta({
  source: {
    summary: "A standard text input component with built-in URL fetching, enabling it to be connected to File (Image/Audio/Document) sockets",
    authors: ["Mercenaries.ai Team"],
    links: {
      "Mercenaries.ai": "https://mercenaries.ai"
    }
  }
});
component9.setMacro(OmniComponentMacroTypes10.EXEC, (payload, ctx) => {
  const files = payload.files;
  const on = payload.switch;
  if (!files) {
    return {};
  }
  console.log("File Switch: ", on, files);
  if (on === true) {
    return { on: files, switch: on };
  } else {
    return { off: files, switch: on };
  }
});
var FileSwitchComponent = component9.toJSON();
var file_switch_default = FileSwitchComponent;

// src/blocks/DefaultBlocks/image_info.ts
import { OAIBaseComponent as OAIBaseComponent11, OmniComponentMacroTypes as OmniComponentMacroTypes11, BlockCategory as Category11 } from "omni-sockets";
var NS_OMNI9 = "omnitool";
var component10 = OAIBaseComponent11.create(NS_OMNI9, "image_info").fromScratch().set(
  "description",
  "Retrieve details (width, height, size, mimetype, extension, file identifier, and URL) from a given image."
).set("title", "Image Info").set("category", Category11.IMAGE_OPERATIONS).setMethod("X-CUSTOM");
component10.addInput(
  component10.createInput("image", "object", "image").set("description", "An image object").setRequired(true).toOmniIO()
).addOutput(component10.createOutput("image", "object", "image").set("description", "An image object").toOmniIO()).addOutput(component10.createOutput("width", "number").set("description", "The width of the image").toOmniIO()).addOutput(component10.createOutput("height", "number").set("description", "The height of the image").toOmniIO()).addOutput(component10.createOutput("size", "number").set("description", "The size of the image").toOmniIO()).addOutput(component10.createOutput("mimeType", "string").set("description", "The mimetype").toOmniIO()).addOutput(component10.createOutput("ext", "string").set("description", "The extension").toOmniIO()).addOutput(component10.createOutput("fid", "string").set("description", "The unique file identifier").toOmniIO()).addOutput(component10.createOutput("url", "string").set("description", "The url of the image").toOmniIO()).setMacro(OmniComponentMacroTypes11.EXEC, async (payload, ctx) => {
  try {
    const imageInput = payload.image;
    if (imageInput) {
      return {
        image: imageInput,
        width: imageInput.meta?.width,
        height: imageInput.meta?.height,
        size: imageInput.size,
        mimeType: imageInput.mimeType,
        ext: imageInput.meta?.type,
        fid: imageInput.fid,
        url: imageInput.url
      };
    } else {
      throw new Error("Image payload is not available");
    }
  } catch (error) {
    console.error(error);
    throw error;
  }
});
var ImageInfoComponent = component10.toJSON();
var image_info_default = ImageInfoComponent;

// src/blocks/DefaultBlocks/json_input.ts
import { OAIBaseComponent as OAIBaseComponent12, OmniComponentMacroTypes as OmniComponentMacroTypes12, BlockCategory as Category12 } from "omni-sockets";
var NS_OMNI10 = "omnitool";
var component11 = OAIBaseComponent12.create(NS_OMNI10, "json_input").fromScratch().set("description", "Input standard JSON data.").set("title", "JSON Input").set("category", Category12.INPUT_OUTPUT).setMethod("X-PASSTHROUGH");
component11.addInput(
  component11.createInput("json", "object").set("title", "JSON").set("description", "An input JSON object").setRequired(true).toOmniIO()
).addOutput(
  component11.createOutput("json", "object").set("title", "JSON").set("description", "The input JSON object").toOmniIO()
).setMacro(OmniComponentMacroTypes12.EXEC, (payload, ctx) => {
  const { json } = payload;
  return { json };
});
var JsonInputComponent = component11.toJSON();
var json_input_default = JsonInputComponent;

// src/blocks/DefaultBlocks/jsonata.ts
import Exp from "jsonata";
import { OAIBaseComponent as OAIBaseComponent13, OmniComponentMacroTypes as OmniComponentMacroTypes13, BlockCategory as Category13 } from "omni-sockets";
var NS_OMNI11 = "omnitool";
var component12 = OAIBaseComponent13.create(NS_OMNI11, "jsonata").fromScratch().set(
  "description",
  "Manipulate and transform JSON objects by applying a **JSONata expression** to the input data. See [JSONata Exerciser](https://try.jsonata.org) for details."
).set("title", "JSONata Transformation").set("category", Category13.DATA_TRANSFORMATION).setMethod("X-CUSTOM");
component12.addInput(component12.createInput("transform", "string").set("title", "Transform").setRequired(true).toOmniIO()).addInput(component12.createInput("object", "array", "objectArray").set("title", "JSON Object").toOmniIO()).addOutput(component12.createOutput("object", "array", "objectArray").set("title", "JSON Object").toOmniIO()).addOutput(component12.createOutput("text", "string").set("title", "Text").toOmniIO()).setMacro(OmniComponentMacroTypes13.EXEC, async (payload, ctx) => {
  const expression = Exp(payload.transform);
  const result = await expression.evaluate(payload.object);
  if (typeof result === "undefined") {
    throw new Error(`undefined jsonata result. Input object: ${JSON.stringify(payload.object, null, 2)}
        Possible reasons:
        1. The JSONata expression is incorrect or malformed.
        2. The JSONata expression is correct but does not match any property in the input object. Please find the input object in the log and check its structure.
        3. The input object is null or undefined.
        4. There is a logical error in the JSONata expression that prevents it from returning a value.`);
  }
  if (typeof result === "string") {
    let p;
    try {
      p = JSON.parse(result);
    } catch (e) {
    }
    return { object: p, text: result };
  }
  return { object: result, text: JSON.stringify(result) };
});
var JSONataComponent = component12.toJSON();
var jsonata_default = JSONataComponent;

// src/blocks/DefaultBlocks/large_language_model.ts
import { OAIBaseComponent as OAIBaseComponent14, OmniComponentMacroTypes as OmniComponentMacroTypes14, BlockCategory as Category14 } from "omni-sockets";
var block2 = OAIBaseComponent14.create("omnitool", "large_language_model");
block2.fromScratch().set(
  "description",
  "Provides an interface for text generation by leveraging multiple LLM providers like OpenAI, Replicate.com, and TextSynth. It allows users to specify a criteria such as speed or accuracy to tailor the AI's behavior. The block ensures compatibility with each AI model's limitations and offers fallback options."
).set("title", "Large Language Model").set("category", Category14.TEXT_GENERATION).setMethod("X-CUSTOM").addInput(
  block2.createInput("Instruction", "string", "text").set("description", "A string").setRequired(true).toOmniIO()
).addInput(block2.createInput("Prompt", "string", "text").set("description", "A string").setRequired(true).toOmniIO()).addOutput(block2.createOutput("Reply", "string", "text").set("description", "A string").toOmniIO());
var controlComposer2 = block2.createControl("Criteria");
controlComposer2.setRequired(true).setControlType("AlpineSelectComponent");
controlComposer2.setChoices([
  { title: "Fast", value: "fast" },
  { title: "Accurate", value: "accurate" },
  { title: "Free", value: "free" },
  { title: "Cheap", value: "cheap" },
  { title: "Creative", value: "creative" }
]);
block2.addControl(controlComposer2.toOmniControl());
var count_tokens = async (text, ctx) => {
  const token_count_result = await ctx.app.blocks.runBlock(ctx, "omnitool.token_count", { Text: text });
  return token_count_result.Count;
};
var can_run_block = async (ctx, blockName) => {
  const block7 = await ctx.app.blocks.getInstance(blockName, ctx.userId);
  const result = block7 && await ctx.app.blocks.canRunBlock(block7, ctx.userId);
  return result;
};
var run_text_synth = async (prompt, instruction, criteria, ctx) => {
  if (!await can_run_block(ctx, "textsynth.generateCompletion")) {
    return null;
  }
  let ts_prompt = `INSTRUCTION: You are helpful math assistant. Answer correctly and be concise
PROMPT: What is 5 + 3?
RESPONSE: 8

INSTRUCTION: You are a knowledgeable geography assistant.
PROMPT: What is the capital of France?
RESPONSE: Paris

INSTRUCTION: You are an assistant knowledgeable about animals.
PROMPT: What is the largest species of shark?
RESPONSE: The whale shark

INSTRUCTION: You are linguist assistant.
PROMPT: Give me a name that rhymes with Mark.
RESPONSE: Clark

INSTRUCTION: ${instruction}`;
  if (criteria === "accurate") {
    ts_prompt += " Be as accurate as possible.\n";
  } else if (criteria === "creative") {
    ts_prompt += " Use extreme creativity.\n";
  } else {
    ts_prompt += " Be concise.\n";
  }
  ts_prompt += `PROMPT: ${prompt}
RESPONSE: `;
  const args = {
    prompt: ts_prompt
  };
  const response = await ctx.app.blocks.runBlock(ctx, "textsynth.generateCompletion", args);
  let text = response.text || "TextSynth was unable to generate a reply. Check your TextSynth credentials at textsynth.com";
  const instruction_index = text.indexOf("INSTRUCTION");
  if (instruction_index > 3) {
    text = text.substring(0, instruction_index);
  }
  return text.trim();
};
var run_replicate_llm = async (prompt, instruction, criteria, ctx) => {
  let blockName = "omni-core-replicate:run.meta/llama-2-70b-chat";
  if (criteria === "fast" || criteria === "cheap") {
    blockName = "omni-core-replicate:run.meta/llama-2-13b-chat";
  }
  if (!await can_run_block(ctx, blockName)) {
    return null;
  }
  const temperature = criteria === "creative" ? 0.75 : 0.5;
  const args = {
    prompt,
    system_prompt: instruction,
    temperature
  };
  const response = await ctx.app.blocks.runBlock(ctx, blockName, args, void 0, { cache: "user" });
  let text = response.output;
  if (typeof text === "string") {
    text = text.replace(/\n\n|\n/g, (match) => match === "\n\n" ? "\n" : "");
  }
  return text || "Replicate.com problem";
};
var context_size_for_model = (model2) => {
  if (model2.includes("-16k")) {
    return 16384;
  }
  if (model2.includes("-32k")) {
    return 32768;
  }
  if (model2 === "gpt-4-1106-preview") {
    return 128e3;
  }
  if (model2 === "gpt-4-vision-preview") {
    return 128e3;
  }
  if (model2.includes("gpt-4")) {
    return 8192;
  }
  if (model2 === "gpt-3.5-turbo-1106") {
    return 16384;
  }
  if (model2 === "gpt-3.5-turbo") {
    if (Date.now() > 16707648e5) {
      return 16384;
    }
  }
  return 4096;
};
var price_for_model = (model2) => {
  if (model2.includes("gpt-4-1106")) {
    return 0.02;
  }
  if (model2.includes("gpt-4-32k")) {
    return 0.09;
  }
  if (model2.includes("gpt-4")) {
    return 0.045;
  }
  if (model2.includes("instruct")) {
    return 18e-4;
  }
  if (model2.startsWith("gpt-3.5-turbo")) {
    return 15e-4;
  }
  console.log("OpenAILLM: Unknown model", model2);
  return 0.1;
};
var run_open_ai = async (prompt, instruction, criteria, ctx) => {
  if (!await can_run_block(ctx, "openai.simpleChatGPT")) {
    return null;
  }
  const prompt_token_count = await count_tokens(instruction + "/" + prompt, ctx);
  const models = await ctx.app.blocks.runBlock(ctx, "openai.getGPTModels", {}, void 0, { cache: "user" });
  if (!models.models) {
    omnilog.error("No models available");
    return models;
  }
  const response_token_count = 1024;
  const token_count = prompt_token_count + response_token_count;
  const possibleModels = models.models.filter((m) => token_count <= context_size_for_model(m)).filter((m) => !m.includes("vision")).sort((a, b) => price_for_model(a) - price_for_model(b));
  if (possibleModels.length === 0) {
    console.log(`LLM: No models available for ${token_count} tokens`);
    return "No models available for input size";
  }
  let model2 = possibleModels[0];
  if (criteria === "accurate") {
    const gpt4Models = possibleModels.filter((m) => m.includes("gpt-4"));
    if (gpt4Models.length > 0) {
      model2 = gpt4Models[0];
    }
  }
  const args = {
    prompt,
    model: model2,
    instruction
  };
  if (criteria === "creative") {
    args.temperature = 0.9;
  }
  const response = await ctx.app.blocks.runBlock(ctx, "openai.simpleChatGPT", args);
  return response.text || "OpenAI problem";
};
block2.setMacro(OmniComponentMacroTypes14.EXEC, async (payload, ctx) => {
  const instruction = payload.Instruction;
  const prompt = payload.Prompt;
  const criteria = payload.Criteria;
  let Reply = null;
  if (!Reply && criteria !== "free") {
    Reply = await run_open_ai(prompt, instruction, criteria, ctx);
  }
  if (!Reply && criteria !== "free") {
    Reply = await run_replicate_llm(prompt, instruction, criteria, ctx);
  }
  if (!Reply) {
    Reply = await run_text_synth(prompt, instruction, criteria, ctx);
  }
  if (!Reply) {
    Reply = "Unable to run a large language model. Check your credentials.";
  }
  return { Reply };
});
var LargeLanguageModelBlock = block2.toJSON();
var large_language_model_default = LargeLanguageModelBlock;

// src/blocks/DefaultBlocks/_block_missing.ts
import { OAIBaseComponent as OAIBaseComponent15, BlockCategory as Category15 } from "omni-sockets";
var NS_OMNI12 = "omnitool";
var component13 = OAIBaseComponent15.create(NS_OMNI12, "_block_missing").fromScratch().set("title", "Warning: Missing Block").set("category", Category15.SYSTEM).set("description", "\u26A0\uFE0F Missing Block \u26A0\uFE0F ").set("renderTemplate", "error").setMethod("X-INPUT");
var Component = component13.toJSON();
var block_missing_default = Component;

// src/blocks/DefaultBlocks/multi_text_replace.ts
import { OAIBaseComponent as OAIBaseComponent16, OmniComponentMacroTypes as OmniComponentMacroTypes15, BlockCategory as Category16 } from "omni-sockets";
var component14 = OAIBaseComponent16.create("omnitool", "multi_text_replace").fromScratch().set(
  "description",
  "Perform dynamic text formatting using templates with variable placeholders, like **{INPUT:Variable Name}** or **{IMAGE:Source Image}**, for inserting text and images. After saving, this block automatically generates input sockets. You can retrieve images using **{IMAGE:filename}**, with filenames set by the **Set File Metadata** block."
).set("title", "Text Template").set("category", Category16.TEXT_MANIPULATION).setMethod("X-CUSTOM");
component14.addInput(
  component14.createInput("source", "string").set("title", "Template").set(
    "description",
    "The string to perform replacements on, containing template variables in the form of {VARIABLE_NAME}"
  ).setRequired(true).toOmniIO()
).addInput(
  component14.createInput("replace", "object").set("title", "JSON Object").set("description", "A JSON object containing key-value pairs to replace in the source string").toOmniIO()
).addInput(
  component14.createInput("images", "object", "image", { array: true }).set("title", "Images").set(
    "description",
    "any images you want to replace, inserted into the text in the form of {IMAGE:filename} (use the Set File Metadata block to set) or using their index {{IMAGE:0}} in the passed array. Note that indices are often unstable."
  ).allowMultiple(true).toOmniIO()
).addControl(
  component14.createControl("button").set("title", "Save").setControlType("AlpineButtonComponent").setCustom("buttonAction", "script").setCustom("buttonValue", "save").set("description", "Save").toOmniControl()
).addOutput(
  component14.createOutput("text", "string").set("description", "The source string with replacements made").toOmniIO()
).setMacro(OmniComponentMacroTypes15.ON_SAVE, async (node) => {
  const source = node.data.source;
  const customInputs = JSON.stringify(node.data["x-omni-dynamicInputs"]);
  const regex = /{input:([^}]+)}/gi;
  const matches = source.matchAll(regex);
  const inputs5 = [...matches].map((match) => {
    return {
      title: match[1],
      name: match[1].toLowerCase().replace(/[^a-z0-9]/g, "_"),
      type: "string",
      customSocket: "text"
    };
  });
  const inputsObject = {};
  inputs5.forEach((input) => {
    inputsObject[input.name] = input;
  });
  node.data["x-omni-dynamicInputs"] = inputsObject;
  return true;
}).setMacro(OmniComponentMacroTypes15.EXEC, (payload, ctx) => {
  const { source, replace } = payload;
  let text = source;
  if (replace) {
    for (const [key, value] of Object.entries(replace)) {
      const search = key;
      const regex = new RegExp("{" + search.toUpperCase() + "}", "g");
      text = text.replace(regex, value);
    }
  }
  if (Object.keys(ctx.node.data["x-omni-dynamicInputs"] || {}).length) {
    for (const key in ctx.node.data["x-omni-dynamicInputs"] || {}) {
      const term = ctx.node.data["x-omni-dynamicInputs"][key].title;
      const search = "{input:" + term + "}";
      const regex = new RegExp(search, "gi");
      text = text.replace(regex, payload[key]);
    }
  }
  if (payload.images?.length) {
    for (let i = 0; i < payload.images.length; i++) {
      const fileName = payload.images[i].fileName.toLowerCase().trim();
      const search2 = "{IMAGE:" + fileName + "}";
      const regex2 = new RegExp(search2, "g");
      text = text.replace(regex2, "/fid/" + payload.images[i].fid);
      const search22 = "{IMAGE:" + i.toString().toLocaleLowerCase().trim() + "}";
      const regex22 = new RegExp(search22, "g");
      text = text.replace(regex22, "/fid/" + payload.images[i].fid);
    }
    const search = "{IMAGES_MARKDOWN}";
    const regex = new RegExp(search, "g");
    text = text.replace(
      regex,
      payload.images.map((image) => {
        return `![/fid/${image.fileName}](/fid/${image.fid})`;
      })
    );
  }
  return { text };
});
var MultiTextReplacerComponent = component14.toJSON();
var multi_text_replace_default = MultiTextReplacerComponent;

// src/blocks/DefaultBlocks/name_to_rgb.ts
import { OAIBaseComponent as OAIBaseComponent17, OmniComponentMacroTypes as OmniComponentMacroTypes16, BlockCategory as Category17 } from "omni-sockets";
import convert from "color-convert";
var block3 = OAIBaseComponent17.create("omnitool", "name_to_rgb");
block3.fromScratch().set("description", "Translate color name to RGB value.").set("title", "Name to RGB").set("category", Category17.UTILITIES).setMethod("X-CUSTOM");
block3.addInput(
  block3.createInput("Color Name", "string", "text").set("description", 'Input color name, e.g., "red"').setControl({ controlType: "AlpineLabelComponent" }).toOmniIO()
);
block3.addOutput(block3.createOutput("Hex String", "string", "text").toOmniIO());
block3.addOutput(block3.createOutput("RGB String", "string", "text").toOmniIO());
block3.addOutput(block3.createOutput("Red", "number").toOmniIO());
block3.addOutput(block3.createOutput("Green", "number").toOmniIO());
block3.addOutput(block3.createOutput("Blue", "number").toOmniIO());
block3.setMacro(OmniComponentMacroTypes16.EXEC, async (payload, ctx) => {
  try {
    const colorName = payload["Color Name"];
    const [red, green, blue] = convert.keyword.rgb(colorName);
    const hexString = convert.rgb.hex(red, green, blue);
    const rgbString = `rgb(${red},${green},${blue})`;
    return {
      "Hex String": `#${hexString}`,
      "RGB String": rgbString,
      Red: red,
      Green: green,
      Blue: blue
    };
  } catch (e) {
    return {};
  }
});
var NameToRgbBlock = block3.toJSON();
var name_to_rgb_default = NameToRgbBlock;

// src/blocks/DefaultBlocks/number_input.ts
import { OAIBaseComponent as OAIBaseComponent18, OmniComponentMacroTypes as OmniComponentMacroTypes17, BlockCategory as Category18 } from "omni-sockets";
import deepmerge2 from "deepmerge";
var NS_OMNI13 = "omnitool";
var block4 = OAIBaseComponent18.create(NS_OMNI13, "number_input").fromScratch().set(
  "description",
  "Allows input of numerical value, formatting of numbers and access to utility functions such as random values and timestamp"
).set("title", "Number Input").set("category", Category18.INPUT_OUTPUT).setMethod("X-CUSTOM");
block4.addInput(
  block4.createInput("number", "Number").set("description", "Input number").setRequired(true).setDefault(1).toOmniIO()
).addOutput(block4.createOutput("number", "number", "number").set("description", "Output number").toOmniIO()).addControl(
  block4.createControl("number_format").set("title", "Format").set("description", "Optionally choose a specific number format for the input.").setChoices(
    [
      { title: "Unchanged", value: "any", description: "Do not perform any modification" },
      { title: "Integer", value: "integer", description: "Convert to an integer" },
      { title: "Floating Point", value: "float", description: "Convert to floating point" },
      { title: "Round", value: "round", description: "Round to the nearest integer" },
      { title: "Ceiling", value: "ceil", description: "Round up to the nearest integer" },
      { title: "Floor", value: "floor", description: "Round down to the nearest integer" },
      { title: "Timestamp", value: "timestamp", description: "Current unix timestamp plus number" },
      { title: "Random", value: "random", description: "Multiply input with a random number" }
    ],
    "any"
  ).toOmniControl()
).setMacro(OmniComponentMacroTypes17.EXEC, (payload, ctx) => {
  const { number_format, number } = payload;
  if (number_format === "integer") {
    return { number: parseInt(number) };
  } else if (number_format === "round") {
    return { number: Math.round(number) };
  } else if (number_format === "ceil") {
    return { number: Math.ceil(number) };
  } else if (number_format === "floor") {
    return { number: Math.floor(number) };
  } else if (number_format === "random") {
    return { number: parseFloat(number) * Math.random() };
  } else if (number_format === "timestamp") {
    return { number: Date.now() + parseFloat(number) };
  } else {
    return { number: parseFloat(number) };
  }
}).setMeta(deepmerge2({ source: { summary: block4.data.description } }, meta_default));
var NumberInputBlock = block4.toJSON();
var number_input_default = NumberInputBlock;

// src/blocks/DefaultBlocks/NsfwDetector.ts
import { OAIBaseComponent as OAIBaseComponent19, OmniComponentMacroTypes as OmniComponentMacroTypes18, BlockCategory as Category19 } from "omni-sockets";
import { EOmniFileTypes as EOmniFileTypes2 } from "omni-sdk";
var NS_OMNI14 = "omnitool";
var component15 = OAIBaseComponent19.create(NS_OMNI14, "nsfw_checker").fromScratch().set("title", "NSFW.js Image Classification").set("category", Category19.CONTENT_MODERATION).set(
  "description",
  `This block uses nsfw.js to perform nsfw classification.
    NSFW.js returns probabilities for an image to fit weighted in probabilities:    
    Hentai \u2014 Pornographic art, unsuitable for most work environments  
    Porn \u2014 Indecent content and actions, often involving genitalia  
    Sexy \u2014 Unseemly provocative content, can include nipples


  `
).setMethod("X-CUSTOM");
component15.addInput(
  component15.createInput("images", "array", "image").set("title", "Images").set("description", "One or more images").setControl({
    controlType: "AlpineLabelComponent"
  }).toOmniIO()
).addInput(
  component15.createInput("pornThreshold", "float").set("title", "Porn Threshold").setConstraints(0, 1, 0.01).setDefault(0.6).setRequired(true).set(
    "description",
    "The probability threshold for the Porn category for an image to be classified NSFW. Set to 1 to disable."
  ).toOmniIO()
).addInput(
  component15.createInput("hentaiThreshold", "float").set("title", "Hentai Threshold").setConstraints(0, 1, 0.01).setDefault(0.6).set(
    "description",
    "The probability threshold for the Hentai category for an image to be classified NSFW. Set to 1 to disable."
  ).toOmniIO()
).addInput(
  component15.createInput("sexyThreshold", "float").set("title", "Sexy Threshold").setConstraints(0, 1, 0.01).setDefault(0.6).set(
    "description",
    "The probability threshold for the Sexy category for an image to be classified NSFW. Set to 1 to disable."
  ).toOmniIO()
);
component15.addOutput(
  component15.createOutput("sfw", "array", "image").set("title", "SFW Images").set("description", "Images evaluated safe").toOmniIO()
).addOutput(
  component15.createOutput("nsfw", "array", "image").set("title", "NSFW Images").set("description", "Images evaluated not safe.").toOmniIO()
).addOutput(
  component15.createOutput("unclassified", "array", "image").set("title", "Unclassified Images").set("description", "Images unable to evaluate.").setControl({
    controlType: "AlpineLabelComponent"
  }).toOmniIO()
).setMacro(OmniComponentMacroTypes18.EXEC, async (payload, ctx) => {
  const sfw = [];
  const nsfw2 = [];
  const unclassified = [];
  if (payload.images && payload.images.length > 0) {
    await Promise.all(
      payload.images?.map(async (element) => {
        let meta = element.meta.nsfw;
        if (meta == null || meta.status !== "success") {
          if (element.fileType === EOmniFileTypes2.image) {
            try {
              const result = await nsfwCheck(Buffer.from(element.data), { maxDimension: 0 });
              if (result) {
                meta = { ...result.classes, status: "success", isNsfw: result.isNsfw };
              }
            } catch (ex) {
              meta = { reason: ex.message, status: "error" };
            }
          } else {
            meta = {
              status: "unknown",
              reason: "not a supported image file"
            };
          }
        }
        let isNsfw;
        if (meta.status === "success") {
          isNsfw = false;
        }
        if (payload.pornThreshold < 1 && meta.Porn != null && meta.Porn > payload.pornThreshold) {
          isNsfw = true;
        }
        if (payload.hentaiThreshold < 1 && meta.Hentai != null && meta.Hentai > payload.hentaiThreshold) {
          isNsfw = true;
        }
        if (payload.sexyThreshold < 1 && meta.Sexy != null && meta.Sexy > payload.sexyThreshold) {
          isNsfw = true;
        }
        if (isNsfw === true) {
          nsfw2.push(element);
        } else if (isNsfw === false) {
          sfw.push(element);
        } else {
          unclassified.push(element);
        }
      })
    );
  }
  return { sfw, nsfw: nsfw2, unclassified };
});
var NSFWCheckerBlock = component15.toJSON();
var NsfwDetector_default = NSFWCheckerBlock;

// src/blocks/DefaultBlocks/prepare_image.ts
import { OAIBaseComponent as OAIBaseComponent20, OmniComponentMacroTypes as OmniComponentMacroTypes19, BlockCategory as Category20 } from "omni-sockets";
import sharp2 from "sharp";
var block5 = OAIBaseComponent20.create("omnitool", "prepare_image");
block5.fromScratch().set(
  "description",
  "Prepare images for further processing. Retrieve the source image(s) and apply various transformations such as resizing, cropping, extending with a blurred background, and creating a mask."
).set("title", "Prepare Image").set("category", Category20.IMAGE_MANIPULATION).setMethod("X-CUSTOM");
block5.addInput(
  block5.createInput("Source", "array", "imageArray").set("description", "Source image(s)").setControl({ controlType: "AlpineLabelComponent" }).toOmniIO()
);
block5.addOutput(block5.createOutput("Result", "array", "imageArray").toOmniIO());
block5.addOutput(block5.createOutput("Mask", "array", "imageArray").toOmniIO());
block5.addOutput(block5.createOutput("Width", "number").toOmniIO());
block5.addOutput(block5.createOutput("Height", "number").toOmniIO());
var controlComposer3 = block5.createControl("Target");
controlComposer3.setRequired(true).setControlType("AlpineSelectComponent");
controlComposer3.setChoices([
  { title: "Stable Diffusion XL", value: "sdxl" },
  { title: "Stable Diffusion 2.1", value: "sd2.1" },
  { title: "Stable Diffusion 1.5", value: "sd1.5" },
  { title: "720p", value: "720p" },
  { title: "1080p", value: "1080p" },
  { title: "4k Wallpaper", value: "4k" },
  { title: "8k", value: "8k" },
  { title: "Facebook Banner", value: "facebook" },
  { title: "Facebook Profile", value: "fbprofile" },
  { title: "Google Meet Background", value: "gmbackground" },
  { title: "Instagram", value: "instagram" },
  { title: "Phone Wallpaper", value: "phone" },
  { title: "Snapchat", value: "snapchat" },
  { title: "Thumbnail", value: "thumbnail" },
  { title: "WeChat", value: "wechat" },
  { title: "YouTube Cover", value: "youtube" },
  { title: "A4", value: "a4" },
  { title: "US Letter", value: "us_letter" },
  { title: "Photo Portrait", value: "12x18" },
  { title: "Photo Landscape", value: "18x12" }
]);
block5.addControl(controlComposer3.toOmniControl());
function getSize(value) {
  const sizeMap = {
    sdxl: [1024, 1024, void 0, "png"],
    "sd1.5": [512, 512, void 0, "png"],
    "sd2.1": [768, 768, void 0, "png"],
    phone: [1080, 1920, void 0, "jpg"],
    "4k": [3840, 2160, void 0, "jpg"],
    "1080p": [1920, 1080, void 0, "jpg"],
    "720p": [1280, 720, void 0, "jpg"],
    "8k": [7680, 4320, void 0, "jpg"],
    youtube: [1280, 720, void 0, "jpg"],
    facebook: [820, 312, void 0, "jpg"],
    fbprofile: [180, 180, void 0, "jpg"],
    gmbackground: [1920, 1090, void 0, "jpg"],
    instagram: [1080, 1080, void 0, "jpg"],
    snapchat: [1080, 1920, void 0, "jpg"],
    thumbnail: [150, 150, void 0, "jpg"],
    wechat: [900, 500, void 0, "jpg"],
    a4: [Math.round(8.27 * 300), Math.round(11.69 * 300), 300, "jpg"],
    // 2480 x 3508
    us_letter: [Math.round(8.5 * 300), Math.round(11 * 300), 300, "jpg"],
    // 2550 x 3300
    "12x18": [3600, 5400, 300, "jpg"],
    "18x12": [5400, 3600, 300, "jpg"]
  };
  return sizeMap[value] || [1024, 1024, void 0, "jpg"];
}
async function fetchImage(cdnRecord, ctx) {
  const entry = await ctx.app.cdn.get(cdnRecord.ticket);
  const buffer = entry.data;
  const image = sharp2(buffer).rotate();
  const metadata = await image.metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  return {
    buffer,
    width,
    height,
    targetWidth: width,
    targetHeight: height
  };
}
async function createMask(imageInfo, feather) {
  const { targetWidth, targetHeight } = imageInfo;
  let { roi } = imageInfo;
  roi ??= {
    x0: 0,
    y0: 0,
    x1: targetWidth,
    y1: targetHeight
  };
  const insetROI = {
    x0: roi.x0 + (roi.x0 > 0 ? feather : 0),
    y0: roi.y0 + (roi.y0 > 0 ? feather : 0),
    x1: roi.x1 - (roi.x1 < targetWidth ? feather : 0),
    y1: roi.y1 - (roi.y1 < targetHeight ? feather : 0)
  };
  const interior = await sharp2({
    create: {
      width: insetROI.x1 - insetROI.x0,
      height: insetROI.y1 - insetROI.y0,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 }
      // Black
    }
  }).png().toBuffer();
  let intermediateBuffer = await sharp2({
    create: {
      width: targetWidth,
      height: targetHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
      // White
    }
  }).composite([
    {
      input: interior,
      top: insetROI.y0,
      left: insetROI.x0
    }
  ]).png().toBuffer();
  if (feather > 0) {
    const sigma = 1 + feather / 2;
    intermediateBuffer = await sharp2(intermediateBuffer).blur(sigma).png().toBuffer();
  }
  const maskImageData = await sharp2(intermediateBuffer).png().toBuffer();
  return maskImageData;
}
async function SoftScale(imageInfo, target) {
  const { width: originalWidth, height: originalHeight, targetWidth, targetHeight } = imageInfo;
  const scaleFactorX = targetWidth / originalWidth;
  const scaleFactorY = targetHeight / originalHeight;
  const maxScaleFactor = Math.max(scaleFactorX, scaleFactorY);
  let scaleFudge = 1.03;
  if (target === "thumbnail") {
    scaleFudge = 1.15;
  }
  const scaleFactorA = Math.min(scaleFactorX * scaleFudge, scaleFactorY * scaleFudge, maxScaleFactor);
  const scaleFactorB = Math.min(
    scaleFactorX * scaleFudge * scaleFudge,
    scaleFactorY * scaleFudge * scaleFudge,
    maxScaleFactor
  );
  let scaledWidth = Math.round(originalWidth * scaleFactorA);
  let scaledHeight = Math.round(originalHeight * scaleFactorA);
  if (scaleFactorX < scaleFactorY) {
    scaledHeight = Math.round(originalHeight * scaleFactorB);
  } else {
    scaledWidth = Math.round(originalWidth * scaleFactorB);
  }
  const newBuffer = await sharp2(imageInfo.buffer).resize(scaledWidth, scaledHeight, { fit: "fill" }).toBuffer();
  return {
    ...imageInfo,
    buffer: newBuffer,
    width: scaledWidth,
    height: scaledHeight
  };
}
async function SoftCrop(imageInfo) {
  const { width, height, targetWidth, targetHeight } = imageInfo;
  const cropX = Math.max(0, Math.round((width - targetWidth) / 2));
  const cropY = Math.max(0, Math.round((height - targetHeight) / 2));
  const newBuffer = await sharp2(imageInfo.buffer).extract({
    left: cropX,
    top: cropY,
    width: Math.min(width, targetWidth),
    height: Math.min(height, targetHeight)
  }).toBuffer();
  return {
    ...imageInfo,
    buffer: newBuffer,
    width: Math.min(width, targetWidth),
    height: Math.min(height, targetHeight)
  };
}
async function ExtendWithBlackBars(imageInfo) {
  const { width, height, targetWidth, targetHeight, roi } = imageInfo;
  let extendX = Math.round((targetWidth - width) / 2);
  let extendY = Math.round((targetHeight - height) / 2);
  if (roi) {
    const targetCenterX = targetWidth / 2;
    const targetCenterY = targetHeight / 2;
    const roiCenterX = (roi.x0 + roi.x1) / 2;
    const roiCenterY = (roi.y0 + roi.y1) / 2;
    extendX = Math.round(targetCenterX - roiCenterX);
    extendY = Math.round(targetCenterY - roiCenterY);
    extendX = Math.max(0, Math.min(extendX, targetWidth - width));
    extendY = Math.max(0, Math.min(extendY, targetHeight - height));
  }
  const newBuffer = await sharp2(imageInfo.buffer).extend({
    top: extendY,
    bottom: targetHeight - height - extendY,
    left: extendX,
    right: targetWidth - width - extendX,
    background: { r: 0, g: 0, b: 0, alpha: 1 }
    // Black
  }).toBuffer();
  return {
    ...imageInfo,
    buffer: newBuffer,
    width: targetWidth,
    height: targetHeight,
    roi: { x0: extendX, y0: extendY, x1: targetWidth - extendX, y1: targetHeight - extendY }
  };
}
async function ExtendWithBlurredBackground(imageInfo) {
  const { width, height, targetWidth, targetHeight, roi } = imageInfo;
  let extendX = Math.round((targetWidth - width) / 2);
  let extendY = Math.round((targetHeight - height) / 2);
  if (roi) {
    const targetCenterX = targetWidth / 2;
    const targetCenterY = targetHeight / 2;
    const roiCenterX = (roi.x0 + roi.x1) / 2;
    const roiCenterY = (roi.y0 + roi.y1) / 2;
    extendX = Math.round(targetCenterX - roiCenterX);
    extendY = Math.round(targetCenterY - roiCenterY);
    extendX = Math.max(0, Math.min(extendX, targetWidth - width));
    extendY = Math.max(0, Math.min(extendY, targetHeight - height));
  }
  const blurRadius = Math.max(targetWidth, targetHeight) / 32;
  const blurredBuffer = await sharp2(imageInfo.buffer).resize(targetWidth, targetHeight, { fit: "fill" }).blur(blurRadius).toBuffer();
  const newBuffer = await sharp2(blurredBuffer).composite([
    {
      input: imageInfo.buffer,
      blend: "over",
      left: extendX,
      top: extendY
    }
  ]).toBuffer();
  return {
    ...imageInfo,
    buffer: newBuffer,
    width: targetWidth,
    height: targetHeight,
    roi: { x0: extendX, y0: extendY, x1: targetWidth - extendX, y1: targetHeight - extendY }
  };
}
async function fetchAndProcessImage(source, target, ctx) {
  const [targetWidth, targetHeight, dpi, fileFormat] = getSize(target);
  let imageInfo = await fetchImage(source, ctx);
  imageInfo.targetWidth = targetWidth;
  imageInfo.targetHeight = targetHeight;
  imageInfo = await SoftScale(imageInfo, target);
  imageInfo = await SoftCrop(imageInfo);
  const useBlackBars = false;
  if (useBlackBars) {
    imageInfo = await ExtendWithBlackBars(imageInfo);
  } else {
    imageInfo = await ExtendWithBlurredBackground(imageInfo);
  }
  const feather = 8;
  const maskImageData = await createMask(imageInfo, feather);
  let transform = sharp2(imageInfo.buffer);
  if (dpi) {
    transform = transform.withMetadata({ density: dpi });
  }
  if (fileFormat) {
    transform = transform.toFormat(fileFormat);
  }
  const imageData = await transform.toBuffer();
  const image = await ctx.app.cdn.putTemp(imageData, { userId: ctx.userId, jobId: ctx.jobId });
  const mask = await ctx.app.cdn.putTemp(maskImageData, { userId: ctx.userId, jobId: ctx.jobId });
  return { image, mask };
}
block5.setMacro(OmniComponentMacroTypes19.EXEC, async (payload, ctx) => {
  const sources = payload.Source;
  const target = payload.Target;
  const processingPromises = sources.map(async (source) => await fetchAndProcessImage(source, target, ctx));
  const processedImages = await Promise.all(processingPromises);
  const Result = processedImages.map((pi) => pi.image);
  const Mask = processedImages.map((pi) => pi.mask);
  const [Width, Height] = getSize(target);
  return { Result, Mask, Width, Height };
});
var PrepareImageBlock = block5.toJSON();
var prepare_image_default = PrepareImageBlock;

// src/blocks/DefaultBlocks/run_script.ts
import { OAIBaseComponent as OAIBaseComponent21, OmniComponentMacroTypes as OmniComponentMacroTypes20, BlockCategory as Category21 } from "omni-sockets";
var component16 = OAIBaseComponent21.create("omnitool", "run_script").fromScratch().set("description", "Executes an omnitool server script with the specified arguments.").set("title", "Run Script").set("category", Category21.UTILITIES).setMethod("X-CUSTOM");
component16.addInput(
  component16.createInput("script", "string").set("title", "Script").set("description", "A string").setRequired(true).toOmniIO()
).addInput(component16.createInput("args", "object").set("title", "Args").set("description", "Args").toOmniIO()).addInput(
  component16.createInput("files", "cdnObjectArray").set("title", "Files").set("description", "Optional Files Objects").toOmniIO()
).addOutput(component16.createOutput("result", "object").set("title", "Result").set("description", "Object").toOmniIO()).addOutput(
  component16.createOutput("files", "cdnObjectArray").set("title", "Files").set("description", "Optional Files Objects").toOmniIO()
);
component16.setMacro(OmniComponentMacroTypes20.EXEC, async (payload, ctx) => {
  const integration = ctx.app.integrations.get("mercenaries");
  return await integration.runScriptFromWorkflow(ctx, payload.script, payload.args, { files: payload.files });
});
var RunScriptComponent = component16.toJSON();
var run_script_default = RunScriptComponent;

// src/blocks/DefaultBlocks/socket_test.ts
import {
  OAIBaseComponent as OAIBaseComponent22,
  OmniComponentMacroTypes as OmniComponentMacroTypes21,
  BlockCategory as Category22
} from "omni-sockets";
var NS_OMNI15 = "omnitool";
var component17 = OAIBaseComponent22.create(NS_OMNI15, "socket_test").fromScratch().set("description", "Verifies all combinations of socket types for testing purposes.").set("title", "Socket Test Block").set("category", Category22.TESTING).setMethod("X-CUSTOM");
var inputTypePairs = [
  ["text", "string", "text", null],
  ["string", "string", "string", null],
  ["number", "number", "number", null],
  ["integer", "number", "integer", null],
  ["float", "number", "float", null],
  ["boolean", "boolean", "boolean", null],
  ["object", "object", "object", null],
  ["cdnObject", "object", "cdnObject", null],
  // type = 'file'
  ["image", "object", "image", null],
  ["audio", "object", "audio", null],
  ["document", "object", "document", null],
  ["imageB64", "string", "image", { format: "base64" }],
  ["textArray", "array", "text", { array: true }],
  ["objectArray", "array", "object", { array: true }],
  ["cdnObjectArray", "array", "cdnObject", { array: true }],
  // type = 'file'
  ["imageArray", "array", "image", { array: true }],
  ["audioArray", "array", "audio", { array: true }],
  ["documentArray", "array", "document", { array: true }],
  ["imageB64Array", "array", "image", { array: true, format: "base64" }]
];
var outputTypePairs = [
  ["text", "string", "text", null],
  ["string", "string", "string", null],
  ["number", "number", "number", null],
  ["integer", "number", "integer", null],
  ["float", "number", "float", null],
  ["boolean", "boolean", "boolean", null],
  ["object", "object", "object", null],
  ["cdnObject", "object", "cdnObject", null],
  // type = 'file'
  ["image", "object", "image", null],
  ["audio", "object", "audio", null],
  ["document", "object", "document", null],
  ["image(B64 test)", "object", "image", null],
  ["textArray", "array", "text", { array: true }],
  ["objectArray", "array", "object", { array: true }],
  ["cdnObjectArray", "array", "cdnObject", { array: true }],
  // type = 'file'
  ["imageArray", "array", "image", { array: true }],
  ["audioArray", "array", "audio", { array: true }],
  ["documentArray", "array", "document", { array: true }],
  ["imageArray(B64 test)", "array", "image", { array: true }]
];
inputTypePairs.forEach(([socketName, inputType, customSocket, socketOpts]) => {
  const inputSocket = component17.createInput(socketName, inputType, customSocket, socketOpts && typeof socketOpts === "object" ? socketOpts : {}).toOmniIO();
  component17.addInput(inputSocket);
});
outputTypePairs.forEach(([socketName, inputType, customSocket, socketOpts]) => {
  const outputSocket = component17.createOutput(socketName, inputType, customSocket, socketOpts && typeof socketOpts === "object" ? socketOpts : {}).set("description", `An output of type ${inputType}`).toOmniIO();
  component17.addOutput(outputSocket);
});
component17.addInput(
  component17.createInput("integerSelector", "integer").setChoices(
    [
      { title: "Option 1001", value: 1001 },
      { title: "Option 1002", value: 1002 },
      { title: "Option 1003", value: 1003 }
    ],
    1001
  ).toOmniIO()
);
component17.addInput(
  component17.createInput("stringSelector", "string").setChoices(
    [
      { title: "Option string1", value: "this is selector string1" },
      { title: "Option string2", value: "this is selector string2" },
      { title: "Option string3", value: " this is selector string3" }
    ],
    "string2"
  ).toOmniIO()
);
component17.addInput(
  component17.createInput("Assert", "object").set("title", "Test Assert").set("description", "An object containing expected values for each output type to assert the output values against").toOmniIO()
);
component17.addOutput(
  component17.createOutput("testReport", "object").set("title", "Test Report").set("description", "A JSON containing the test report").toOmniIO()
);
component17.setMacro(OmniComponentMacroTypes21.EXEC, (payload, ctx) => {
  const output = {};
  const testReport = {};
  inputTypePairs.forEach(([socketName, inputType]) => {
    let correspondingOutput = socketName;
    if (inputType === "imageB64") {
      correspondingOutput = "image(B64 test)";
    } else if (inputType === "imageB64Array") {
      correspondingOutput = "imageArray(B64 test)";
    }
    output[correspondingOutput] = payload[socketName];
    if (payload.Assert) {
      if (payload.assert.hasOwnProperty(correspondingOutput)) {
        testReport[correspondingOutput] = {
          expected: payload.assert[correspondingOutput],
          actual: output[correspondingOutput],
          status: payload.assert[correspondingOutput] === output[correspondingOutput] ? "pass" : "fail"
        };
      }
    }
  });
  output.text += "\n\n integerSelector: " + payload.integerSelector;
  output.text += "\n\n stringSelector: " + payload.stringSelector;
  if (payload.assert) {
    output.testReport = testReport;
  }
  return output;
});
var SocketTestBlock = component17.toJSON();
var socket_test_default = SocketTestBlock;

// src/blocks/DefaultBlocks/static_document.ts
import { OAIBaseComponent as OAIBaseComponent23, BlockCategory as Category23 } from "omni-sockets";
var NS_OMNI16 = "omnitool";
var component18 = OAIBaseComponent23.create(NS_OMNI16, "input_static_document");
component18.fromScratch().set("description", "Retrieve a document from the file manager.").set("title", "Document Input").set("category", Category23.INPUT_OUTPUT).setMethod("X-PASSTHROUGH");
component18.addInput(
  component18.createInput("doc", "string", "document", { customSettings: { do_no_return_data: true } }).set("title", "Document").set("description", "the document fid").setRequired(true).toOmniIO()
).addOutput(
  component18.createOutput("doc", "object", "document").set("title", "Document").set("description", "The Document").toOmniIO()
);
var StaticDocumentComponent = component18.toJSON();
var static_document_default = StaticDocumentComponent;

// src/blocks/DefaultBlocks/static_image.ts
import { OAIBaseComponent as OAIBaseComponent24, OmniComponentMacroTypes as OmniComponentMacroTypes23, BlockCategory as Category24 } from "omni-sockets";
var NS_OMNI17 = "omnitool";
var component19 = OAIBaseComponent24.create(NS_OMNI17, "input_static_image");
component19.fromScratch().set(
  "description",
  "Retrieve an image from the file manager or a URL. This is commonly used when you need to provide images stored in the file manager or via a URL as input in a recipe."
).set("title", "Image Input").set("category", Category24.INPUT_OUTPUT).setMethod("X-CUSTOM");
component19.addInput(
  component19.createInput("img", "string", "image", { customSettings: { do_no_return_data: true } }).set("title", "Image").set("description", "The image").toOmniIO()
).addInput(
  component19.createInput("imgUrl", "string").set("title", "Url").set("description", "The image url").toOmniIO()
).addOutput(
  component19.createOutput("img", "object", "image").set("title", "Image").set("description", "The image").toOmniIO()
).addControl(
  component19.createControl("preview").setControlType("AlpineImageGalleryComponent").toOmniControl()
).addOutput(component19.createOutput("width", "number").set("description", "The width of the image").toOmniIO()).addOutput(component19.createOutput("height", "number").set("description", "The height of the image").toOmniIO()).addOutput(
  component19.createOutput("size", "number").set("description", "The size of the image").setHidden(true).toOmniIO()
).addOutput(component19.createOutput("mimeType", "string").set("description", "The mimetype").setHidden(true).toOmniIO()).addOutput(component19.createOutput("ext", "string").set("description", "The extension").setHidden(true).toOmniIO()).addOutput(
  component19.createOutput("fid", "string").set("description", "The unique file identifier").setHidden(true).toOmniIO()
).addOutput(
  component19.createOutput("url", "string").set("description", "The url of the image").setHidden(true).toOmniIO()
).setMacro(OmniComponentMacroTypes23.EXEC, async (payload, ctx, component39) => {
  try {
    if (!payload.img && !payload.imgUrl) {
      await component39.setControlValue("preview", null, ctx);
      return null;
    }
    if (payload.imgUrl?.trim?.()?.length > 0) {
      const savedImage = await ctx.app.cdn.putTemp(payload.imgUrl, { userId: ctx.userId, jobId: ctx.jobId });
      if (!savedImage) {
        throw new Error("Failed to save the image from the url to the CDN");
      }
      payload.img = savedImage;
    }
    if (payload.img == null) {
      return null;
    }
    ctx.node.data.preview = {
      fid: payload.img.fid,
      url: payload.img.url
    };
    await component39.setControlValue("preview", [ctx.node.data.preview], ctx);
    return {
      img: payload.img,
      width: payload.img.meta.width,
      height: payload.img.meta.height,
      size: payload.size,
      mimeType: payload.mimeType,
      ext: payload.img.meta.type,
      fid: payload.img.fid,
      url: payload.url
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
});
var StaticFileComponent = component19.toJSON();
var static_image_default = StaticFileComponent;

// src/blocks/DefaultBlocks/text_comparison.ts
import { OAIBaseComponent as OAIBaseComponent25, OmniComponentMacroTypes as OmniComponentMacroTypes24, BlockCategory as Category25 } from "omni-sockets";
import levenshtein from "js-levenshtein";
var NS_OMNI18 = "omnitool";
var component20 = OAIBaseComponent25.create(NS_OMNI18, "comparison").fromScratch().set("description", "Compare two texts for various types of equality, including optional Levenshtein Distance.").set("title", "Text Comparison").set("category", Category25.TEXT_MANIPULATION).setMethod("X-CUSTOM");
component20.addInput(
  component20.createInput("textA", "string", "text").set("title", "Text A").set("description", "A JSON string").setRequired(true).toOmniIO()
).addInput(
  component20.createInput("textB", "string", "text").set("title", "Text B").set("description", "A JSON string").setRequired(true).toOmniIO()
).addInput(
  component20.createInput("caseSensitive", "boolean").set("title", "Case Sensitive").set("description", "Should the comparison be case sensitive?").setDefault(false).toOmniIO()
).addOutput(component20.createOutput("equal", "boolean").set("description", "Are the two texts equal?").toOmniIO()).addOutput(
  component20.createOutput("notEqual", "boolean").set("description", "Are the two texts not equal?").toOmniIO()
);
component20.setMeta({
  source: {
    summary: "Compare two texts for equality, including optional Levenshtein Distance.",
    links: {
      "Levenshtein Module": "https://github.com/gustf/js-levenshtein"
    }
  }
});
component20.setMacro(OmniComponentMacroTypes24.EXEC, (payload, ctx) => {
  const { textA, textB } = payload;
  let equal = false;
  if (payload.caseSensitive) {
    equal = textA === textB;
  } else {
    equal = textA.toLowerCase() === textB.toLowerCase();
  }
  const contains = textA.includes(textB);
  const startsWith = textA.startsWith(textB);
  const notEqual = !equal;
  let lvd = 0;
  if (notEqual) {
    lvd = levenshtein(textA, textB);
  }
  const lengthDifference = textA.length - textB.length;
  return {
    equal,
    notEqual,
    levenshtein: lvd,
    contains,
    startsWith,
    lengthDifference
  };
});
var TextComparisonComponent = component20.toJSON();
var text_comparison_default = TextComparisonComponent;

// src/blocks/DefaultBlocks/write_text_document.ts
import { OAIBaseComponent as OAIBaseComponent26, OmniComponentMacroTypes as OmniComponentMacroTypes25, BlockCategory as Category26 } from "omni-sockets";
var NS_OMNI19 = "omnitool";
var component21 = OAIBaseComponent26.create(NS_OMNI19, "write_document").fromScratch().set("title", "Text Document Writer").set("category", Category26.FILE_OPERATIONS).set(
  "description",
  "Create and save a text document to the file manager. With the flexibility to specify the file name, format, and storage duration, it streamlines the process of managing text documents within your recipe. The format of the text can be chosen between plain text and markdown. Additionally, you can decide whether to store the document temporarily or permanently."
).setMethod("X-CUSTOM");
component21.addInput(
  component21.createInput("text", "string", "text", { array: true }).set("title", "Text").set("description", "A simple input string").allowMultiple(true).toOmniIO()
);
component21.addInput(
  component21.createInput("fileName", "string", "text").set("title", "File Name").set(
    "description",
    "The filename (without extension) to use when saving. If not provided, a default will be used"
  ).toOmniIO()
).addControl(
  component21.createControl("textType", "string").set("title", "Format").set("description", "The format of chat message").setChoices(["text/plain", "text/markdown"], "text/markdown").toOmniControl()
).addControl(
  component21.createControl("storageType", "string").set("title", "Storage Duration").set("description", "The duration of storage").setChoices(["Temporary", "Permanent"], "Permanent").toOmniControl()
).addOutput(
  component21.createOutput("document", "object", "document").set("title", "Document").set("description", "The final document").toOmniIO()
).setMacro(OmniComponentMacroTypes25.EXEC, async (payload, ctx) => {
  const type2 = payload.storageType === "Permanent" ? "put" : "putTemp";
  if (Array.isArray(payload.text)) {
    payload.text = payload.text.join("\n");
  }
  let fileName = payload.fileName?.trim?.() || void 0;
  let document;
  if (payload.text?.trim().length > 0) {
    fileName = (fileName || payload.text || "file").trim().substr(0, 20).replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_");
    let ext = ".md";
    if (payload.textType === "text/plain") {
      ext = ".txt";
    }
    document = await ctx.app.cdn[type2](payload.text, {
      mimeType: payload.textType,
      fileName: fileName + ext,
      userId: ctx.userId,
      jobId: ctx.jobId,
      fileType: "document"
    });
  }
  return { document };
});
var TextDocumentWriterComponent = component21.toJSON();
var write_text_document_default = TextDocumentWriterComponent;

// src/blocks/DefaultBlocks/text_input.ts
import { OAIBaseComponent as OAIBaseComponent27, BlockCategory as Category27 } from "omni-sockets";
var NS_OMNI20 = "omnitool";
var component22 = OAIBaseComponent27.create(NS_OMNI20, "input_text").fromScratch().set(
  "description",
  "Accept text values as input. It also comes with built-in URL fetching capabilities, enabling convenient connections of your file to the Image/Audio/Document sockets."
).set("title", "Text Input").set("category", Category27.INPUT_OUTPUT).setMethod("X-PASSTHROUGH");
component22.addInput(
  component22.createInput("text", "string", "text", { array: true }).set("description", "A string").allowMultiple(true).toOmniIO()
).addOutput(component22.createOutput("text", "string", "text").set("description", "A string").toOmniIO()).setMeta({
  source: {
    summary: "A standard text input component with built-in URL fetching, enabling it to be connected to File (Image/Audio/Document) sockets",
    authors: ["Mercenaries.ai Team"],
    links: {
      "Mercenaries.ai": "https://mercenaries.ai"
    }
  }
});
var TextInputComponent = component22.toJSON();
var text_input_default = TextInputComponent;

// src/blocks/DefaultBlocks/text_replace.ts
import { OAIBaseComponent as OAIBaseComponent28, OmniComponentMacroTypes as OmniComponentMacroTypes26, BlockCategory as Category28 } from "omni-sockets";
var NS_OMNI21 = "omnitool";
var component23 = OAIBaseComponent28.create(NS_OMNI21, "text_replace").fromScratch().set(
  "description",
  `Replace specified text within the input text. Provide the input text, the text to be matched, and the text to replace the matched term(s) with. For example:

    **Input**: PRODUCT is awesome
    **Match**: PRODUCT
    **Replace**: Omnitool
  `
).set("title", "Text Replacer").set("category", Category28.TEXT_MANIPULATION).setMethod("X-CUSTOM");
component23.addInput(
  component23.createInput(
    "text",
    "string",
    "text"
    /*socket type*/
  ).set("description", "The input text").setRequired(true).toOmniIO()
).addInput(
  component23.createInput("match", "string", "text").set("description", "The text to be matched, or a regular expression in the form /regex/flags (e.g. /foo/g) ").setRequired(true).toOmniIO()
).addInput(
  component23.createInput("replace", "string", "text").set("description", "Text to replace the matched term(s) with").setRequired(true).toOmniIO()
).addOutput(component23.createOutput("text", "string", "text").set("description", "A string").toOmniIO()).setMacro(OmniComponentMacroTypes26.EXEC, (payload, ctx) => {
  let { match, replace } = payload;
  if (!match || replace === null) {
    return { text: payload.text };
  }
  replace = replace.trim();
  let text = payload.text;
  const useRegex = match.indexOf("/") === 0;
  if (useRegex) {
    const matchParts = match.split("/");
    const regex = new RegExp(matchParts[1], matchParts[2] || "g");
    text = text.replace(regex, replace);
  } else {
    text = text.replace(match, replace);
  }
  return { text };
});
var TextReplacerComponent = component23.toJSON();
var text_replace_default = TextReplacerComponent;

// src/blocks/DefaultBlocks/text_splitter.ts
import { OAIBaseComponent as OAIBaseComponent29, OmniComponentMacroTypes as OmniComponentMacroTypes27, BlockCategory as Category29 } from "omni-sockets";
var NS_OMNI22 = "omnitool";
var component24 = OAIBaseComponent29.create(NS_OMNI22, "text_splitter").fromScratch().set("description", "Split text into chunks based on the specified chunk size or delimiter").set("title", "Text Splitter").set("category", Category29.TEXT_MANIPULATION).setMethod("X-CUSTOM");
component24.addInput(
  component24.createInput("text", "string").set("title", "Text").set("description", "A string").setRequired(true).toOmniIO()
).addInput(
  component24.createInput("chunkSize", "integer").set("title", "Chunk size").set("description", "Length of each chunk").toOmniIO()
).addInput(
  component24.createInput("delimiter", "string").set("title", "Delimiter").set("description", "Delimiter to split the text").toOmniIO()
).addInput(
  component24.createInput("chunkPrefix", "string").set("title", "Chunk prefix").set("description", "A string to prepend to each chunk").toOmniIO()
).addInput(
  component24.createInput("chunkPostfix", "string").set("title", "Chunk postfix").set("description", "A string to append to each chunk").toOmniIO()
).addOutput(
  component24.createOutput("chunks", "array", "objectArray").set("title", "Chunks").set("description", "An array of text chunks").toOmniIO()
).setMacro(OmniComponentMacroTypes27.EXEC, (payload, ctx) => {
  const text = payload.text;
  const chunkSize = payload.chunkSize;
  const delimiter = payload.delimiter;
  const chunkPrefix = payload.chunkPrefix ?? "";
  const chunkPostfix = payload.chunkPostfix ?? "";
  if (!chunkSize && !delimiter) {
    throw new Error("Either chunkSize or delimiter must be provided.");
  }
  let chunks;
  if (delimiter) {
    chunks = text.split(delimiter).map((chunk) => {
      return { text: chunkPrefix + chunk.trim() + chunkPostfix };
    });
  } else {
    chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push({ text: chunkPrefix + text.slice(i, i + chunkSize).trim() + chunkPostfix });
    }
  }
  return { chunks };
});
var TextSplitterComponent = component24.toJSON();
var text_splitter_default = TextSplitterComponent;

// src/blocks/DefaultBlocks/text_to_json.ts
import { OAIBaseComponent as OAIBaseComponent30, OmniComponentMacroTypes as OmniComponentMacroTypes28, BlockCategory as Category30 } from "omni-sockets";
var NS_OMNI23 = "omnitool";
var component25 = OAIBaseComponent30.create(NS_OMNI23, "text_to_json").fromScratch().set("description", "Convert text into a JSON object or array, allowing for additional manipulation.").set("title", "Text to JSON Converter").set("category", Category30.DATA_TRANSFORMATION).setMethod("X-CUSTOM");
component25.addInput(component25.createInput("text", "string", "text").set("description", "A JSON string").toOmniIO()).addOutput(
  component25.createOutput("json", "object").set("description", "the resulting JSON").set("title", "JSON").toOmniIO()
).setMacro(OmniComponentMacroTypes28.EXEC, (payload, ctx) => {
  const text = payload.text;
  let json;
  if (text != null) {
    try {
      json = JSON.parse(text);
    } catch {
      let sanitizedText = text.trim().replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
      sanitizedText = sanitizedText.replace(/\n/g, "");
      sanitizedText = sanitizedText.replace(/\\n/g, " ");
      sanitizedText = sanitizedText.replace(/\\t/g, " ");
      sanitizedText = sanitizedText.replace(/\\r/g, " ");
      try {
        json = JSON.parse(sanitizedText);
      } catch (error) {
        const errorText = `Invalid JSON string: ${sanitizedText}. Error: ${error.message}`;
        throw new Error(errorText);
      }
    }
  } else {
    throw new Error("Payload text is null or undefined.");
  }
  return { json };
});
var TextToJSONComponent = component25.toJSON();
var text_to_json_default = TextToJSONComponent;

// src/blocks/DefaultBlocks/token_count.ts
import { OAIBaseComponent as OAIBaseComponent31, OmniComponentMacroTypes as OmniComponentMacroTypes29, BlockCategory as Category31 } from "omni-sockets";
var block6 = OAIBaseComponent31.create("omnitool", "token_count");
block6.fromScratch().set("description", "Estimates the number of tokens in a string").set("title", "Token Count").set("category", Category31.TEXT_ANALYSIS).setMethod("X-CUSTOM").addInput(block6.createInput("Text", "string", "text").set("description", "A string").setRequired(true).toOmniIO()).addOutput(block6.createOutput("Count", "number").set("description", "Output number").toOmniIO()).setMacro(OmniComponentMacroTypes29.EXEC, (payload, ctx) => {
  const text = payload.Text;
  console.log("text", text);
  let tokenCount = 0;
  const words = text.split(/\s+|[.,!?;]\s*/);
  for (const word of words) {
    if (word.length === 0)
      continue;
    if (word.length > 15) {
      tokenCount += word.length;
    } else if (/^[A-Za-z]+$/.test(word)) {
      tokenCount += 1.3;
    } else {
      tokenCount += 3;
    }
  }
  return { Count: Math.ceil(tokenCount) };
});
var TokenCountBlock = block6.toJSON();
var token_count_default = TokenCountBlock;

// src/blocks/DefaultBlocks/recipe_metadata.ts
import { OAIBaseComponent as OAIBaseComponent32, OmniComponentMacroTypes as OmniComponentMacroTypes30, OmniComponentFlags as OmniComponentFlags2, BlockCategory as Category32 } from "omni-sockets";
var NS_OMNI24 = "omnitool";
var component26 = OAIBaseComponent32.create(NS_OMNI24, "recipe_metadata").fromScratch().set(
  "description",
  "Set essential information for your recipe, including the title, introduction, help section, author, and credits for your recipe. Make the most of this block to enhance the presentation and user-friendliness of your recipes."
).set("title", "Recipe Metadata").set("category", Category32.RECIPE_OPERATIONS).setMethod("X-NOOP").setFlag(OmniComponentFlags2.NO_EXECUTE, true).setFlag(OmniComponentFlags2.UNIQUE_PER_WORKFLOW, true).setRenderTemplate("simple");
component26.addInput(
  component26.createInput("usage", "object").set("title", "Usage Information").setHidden(true).toOmniIO()
);
component26.addOutput(component26.createOutput("text", "string").setHidden(true).toOmniIO());
var titleControl = component26.createControl("title");
titleControl.setRequired(true).setControlType("AlpineTextComponent").set("description", "The title for this recipe").set("placeholder", "My Awesome Recipe");
component26.addControl(titleControl.toOmniControl());
var introductionControl = component26.createControl("description");
introductionControl.setControlType("AlpineTextComponent").set("description", "A description of this recipe").set("placeholder", "Enter a short description of this recipe here.");
component26.addControl(introductionControl.toOmniControl());
var helpControl = component26.createControl("help");
helpControl.setControlType("AlpineTextComponent").set(
  "description",
  "Text with instructions and information about this recipe that is shown to the user when they open it."
).set("placeholder", "Enter text or markdown to be shown when the user opens this recipe.");
component26.addControl(helpControl.toOmniControl());
var authorControl = component26.createControl("author");
authorControl.setControlType("AlpineTextComponent").set("description", "Author information such as name, email, website, etc.").set("placeholder", "Enter author information here.");
component26.addControl(authorControl.toOmniControl());
var tagsControl = component26.createControl("tags");
tagsControl.setControlType("AlpineSelect2TagComponent").set("title", "Tags").set("placeholder", "Enter tags here.");
component26.addControl(tagsControl.toOmniControl());
var licenseControl = component26.createControl("license");
licenseControl.setControlType("AlpineSelectComponent").set("title", "License").set("description", "Licensing information for the recipe, such as MIT, GPL, CC0 etc.").setChoices(
  [
    {
      title: "MIT License",
      value: "MIT",
      description: "A permissive license that allows for re-use with few restrictions."
    },
    {
      title: "GNU General Public License (GPL)",
      value: "GPL",
      description: "A copyleft license that requires any modifications to be open-sourced."
    },
    {
      title: "Creative Commons Zero (CC0)",
      value: "CC0",
      description: "A public domain dedication tool, meaning no rights reserved."
    },
    {
      title: "Creative Commons Attribution (CC-BY)",
      value: "CC-BY",
      description: "Allows others to distribute and build upon the work, even commercially, as long as credit is provided."
    },
    {
      title: "Creative Commons Attribution-ShareAlike (CC-BY-SA)",
      value: "CC-BY-SA",
      description: "Similar to CC-BY but derivatives must license their new creations under identical terms."
    },
    {
      title: "Creative Commons Attribution-NoDerivs (CC-BY-ND)",
      value: "CC-BY-ND",
      description: "Allows for redistribution, commercial or non-commercial, but doesn't allow derivative works."
    },
    {
      title: "Creative Commons Attribution-NonCommercial (CC-BY-NC)",
      value: "CC-BY-NC",
      description: "Allows for derivatives but not for commercial use."
    },
    {
      title: "Creative Commons Attribution-NonCommercial-ShareAlike (CC-BY-NC-SA)",
      value: "CC-BY-NC-SA",
      description: "Allows derivatives but they must not be used commercially and should be licensed under the same terms."
    },
    {
      title: "Creative Commons Attribution-NonCommercial-NoDerivs (CC-BY-NC-ND)",
      value: "CC-BY-NC-ND",
      description: "Only allows for non-commercial redistribution and no derivatives are allowed."
    },
    {
      title: "Proprietary License",
      value: "Proprietary",
      description: "A license retaining all rights and usually not allowing distribution or modifications."
    },
    {
      title: "Other (See Credits)",
      value: "Other (See Credits)",
      description: "A custom license or one not listed here. See the associated credits or documentation for details."
    }
  ],
  "CC0"
).set("placeholder", "Enter licensing information here.");
component26.addControl(licenseControl.toOmniControl());
var creditsControl = component26.createControl("credits");
creditsControl.setControlType("AlpineTextComponent").set("description", "Further information that is shown to the users when they inspect the recipe.").set(
  "placeholder",
  "Enter credits, acknowledgements, 3rd party licenses, legal notices, data sources or other metadata here."
);
component26.addControl(creditsControl.toOmniControl());
component26.createControl("ui_template").setControlType("AlpineTextComponent").set("description", "Further information that is shown to the users when they inspect the recipe.").set("placeholder", "Custom UI Template");
component26.addControl(creditsControl.toOmniControl());
component26.addControl(
  component26.createControl("button").set("title", "Save").setControlType("AlpineButtonComponent").setCustom("buttonAction", "script").setCustom("buttonValue", "save").set("description", "Save").toOmniControl()
);
component26.setMeta({
  source: {
    summary: "A component that allows you to provide instructions and help to users about how to use your recipe",
    authors: ["Mercenaries.ai Team"],
    links: {
      "Mercenaries.ai": "https://mercenaries.ai"
    }
  }
});
component26.setMacro(OmniComponentMacroTypes30.ON_SAVE, async (node, recipe) => {
  node.data.title = (node.data.title || recipe.meta.name || "(Unnamed Recipe)").substr(0, 50).trim();
  node.data.description = (node.data.description || recipe.meta.description || "").substr(0, 2048).trim();
  node.data.author = (node.data.author || recipe.meta.author || "Anonymous").trim();
  node.data.help = (node.data.help || recipe.meta.help || "").substr(0, 2048).trim();
  delete node.data.introduction;
  recipe.setMeta({
    name: node.data.title || recipe.meta.name,
    description: node.data.description || recipe.meta.description,
    author: node.data.author || recipe.meta.author,
    help: node.data.help || recipe.meta.help,
    // Ensures other properties are preserved
    pictureUrl: recipe.meta.pictureUrl,
    created: recipe.meta.created,
    updated: Date.now(),
    tags: node.data.tags || recipe.meta.tags,
    category: (
      /*node.data.category || */
      recipe.meta.category
    )
  });
  recipe.setUI({
    template: node.data.ui_template
  });
  return true;
});
var RecipeMetadataBlock = component26.toJSON();
var recipe_metadata_default = RecipeMetadataBlock;

// src/blocks/DefaultBlocks/output_validator.ts
import { OAIBaseComponent as OAIBaseComponent33, OmniComponentMacroTypes as OmniComponentMacroTypes31, BlockCategory as Category33 } from "omni-sockets";
var NS_OMNI25 = "omnitool";
var component27 = OAIBaseComponent33.create(NS_OMNI25, "validator").fromScratch().set("title", "Output Validator").set("category", Category33.TESTING).set(
  "description",
  "Validate the output from sockets against a set of JSON assertions. An error will be thrown in case of any assertion failure."
).setMethod("X-CUSTOM");
var inputTypes = ["string", "boolean", "number", "array", "object", "assert"];
for (const inputType of inputTypes) {
  component27.addInput(
    component27.createInput(inputType, inputType === "assert" ? "object" : inputType).set("title", inputType.charAt(0).toUpperCase() + inputType.slice(1)).set("description", `Input of type ${inputType}`).toOmniIO()
  );
}
component27.addOutput(
  component27.createOutput("validationReport", "object").set("title", "Validation Report").set("description", "A JSON formatted string containing the validation report").toOmniIO()
);
component27.setMacro(OmniComponentMacroTypes31.EXEC, async (payload, ctx) => {
  try {
    const validationReport = {};
    let validationFailed = false;
    const failedInputs = [];
    inputTypes.forEach((inputType) => {
      if (inputType !== "assert" && payload.assert && payload.assert.hasOwnProperty(inputType)) {
        const status = payload.assert[inputType] === payload[inputType] ? "\u2705 pass" : "\u274Cfail";
        validationReport[inputType] = {
          expected: payload.assert[inputType],
          actual: payload[inputType],
          status
        };
        if (status === "\u274Cfail") {
          validationFailed = true;
          failedInputs.push(`${inputType}: expected ${payload.assert[inputType]}, received ${payload[inputType]}`);
        }
      }
    });
    if (validationFailed) {
      throw new Error(`Validation failed for inputs: ${failedInputs.join(", ")}`);
    }
    return { validationReport };
  } catch (error) {
    console.error(error);
    throw error;
  }
});
var ValidatorComponent = component27.toJSON();
var output_validator_default = ValidatorComponent;

// src/blocks/DefaultBlocks/file_to_directory.ts
import extra from "fs-extra";
import path7 from "path";
import {
  OAIBaseComponent as OAIBaseComponent34,
  OmniComponentMacroTypes as OmniComponentMacroTypes32,
  BlockCategory as Category34
} from "omni-sockets";
var NS_OMNI26 = "omnitool";
var component28 = OAIBaseComponent34.create(NS_OMNI26, "files_to_local_directory").fromScratch().set("title", "Write Files To Directory").set("category", Category34.INPUT_OUTPUT).set(
  "description",
  `Writes files to the server's data.local/file-export/<userID>/<jobId> directory.  
       **Overwrite**: Overwrite existing files.  
       Returns the target directory as well as the list of files written.
       `
).setMethod("X-CUSTOM");
component28.addControl(component28.createControl("overwrite", "boolean").set("title", "Overwrite").toOmniControl()).addInput(
  component28.createInput("files", "object", "file", { array: true }).set("title", "Files").set("description", "The files to write in the Directory.").allowMultiple(true).toOmniIO()
).addInput(
  component28.createInput("output_dir", "string", "text").set("title", "Optional Directory").set("description", "If provided, save the files in this Directory.").toOmniIO()
).addOutput(component28.createOutput("directory", "string", "text").set("title", "Directory").toOmniIO()).addOutput(component28.createOutput("files", "string", "text", { array: true }).set("title", "Files").toOmniIO()).setMacro(OmniComponentMacroTypes32.EXEC, async (payload, ctx) => {
  const fileExportPath = ctx.app.config.settings.paths?.fileExportPath || "data.local/file-export";
  let output_dir = payload.output_dir;
  if (output_dir) {
    output_dir = path7.join(process.cwd(), fileExportPath, ctx.userId, output_dir);
  }
  const dir = output_dir || path7.join(process.cwd(), fileExportPath, ctx.userId, ctx.jobId);
  await extra.ensureDir(dir);
  const files = [];
  for (const f of payload.files) {
    let file_name = f.fileName;
    if (payload.overwrite === false) {
      let counter = 1;
      while (await extra.pathExists(path7.join(dir, file_name))) {
        const ext = path7.extname(file_name);
        const base = path7.basename(file_name, ext);
        file_name = `${base}(${counter})${ext}`;
        counter++;
      }
    }
    await ctx.app.cdn.exportFile(f.fid, dir, file_name, { overwrite: payload.overwrite });
    files.push(file_name);
  }
  return {
    directory: dir,
    files
  };
});
var WriteFilesToDirectoryComponent = component28.toJSON();
var file_to_directory_default = WriteFilesToDirectoryComponent;

// src/blocks/DefaultBlocks/static_file.ts
import { OAIBaseComponent as OAIBaseComponent35, OmniComponentMacroTypes as OmniComponentMacroTypes33, BlockCategory as Category35 } from "omni-sockets";
var NS_OMNI27 = "omnitool";
var component29 = OAIBaseComponent35.create(NS_OMNI27, "input_static_file");
component29.fromScratch().set("description", "Link a static asset from the file manager").set("title", "Static File Asset").set("category", Category35.INPUT_OUTPUT).setMethod("X-CUSTOM");
component29.addInput(
  component29.createInput("fid", "string").set("title", "File").set("description", "The File Asset").setRequired(true).setControl({
    controlType: "AlpineLabelComponent"
  }).toOmniIO()
).addControl(
  component29.createControl("preview").setControlType("AlpineLabelComponent").set("displays", "input:fid").toOmniControl()
).addOutput(
  component29.createOutput("file", "object", "file").set("title", "File").set("description", "The File Object").toOmniIO()
).addOutput(
  component29.createOutput("url", "string").set("description", "The url of the file file").toOmniIO()
).setMacro(OmniComponentMacroTypes33.EXEC, async (payload, ctx) => {
  try {
    if (!payload.fid) {
      return {};
    }
    const file = await ctx.app.cdn.find(payload.fid, ctx.userId);
    if (!file) {
      throw new Error("File with id " + payload.fid + " could not be found.");
    }
    return { file, url: file.url };
  } catch (error) {
    console.error(error);
    throw error;
  }
});
var StaticFileComponent2 = component29.toJSON();
var static_file_default = StaticFileComponent2;

// src/blocks/DefaultBlocks/files_from_directory.ts
import fs5 from "fs/promises";
import extra2 from "fs-extra";
import path8 from "path";
import {
  OAIBaseComponent as OAIBaseComponent36,
  OmniComponentMacroTypes as OmniComponentMacroTypes34,
  BlockCategory as Category36
} from "omni-sockets";

// src/integrations/APIIntegration.ts
import {
  Integration,
  NodeProcessEnv
} from "omni-shared";
var APIIntegration = class extends Integration {
  handlers;
  clientExports;
  serverHandlers;
  routes;
  schemas;
  constructor(id4, manager, config2) {
    super(id4, manager, config2 || {});
    this.routes = /* @__PURE__ */ new Set();
    this.handlers = /* @__PURE__ */ new Map();
    this.clientExports = /* @__PURE__ */ new Map();
    this.serverHandlers = /* @__PURE__ */ new Map();
    this.schemas = /* @__PURE__ */ new Map();
  }
  declareClientExport(clientExport) {
    const manager = this.manager;
    if (!manager.clientExports.has(clientExport)) {
      manager.clientExports.add(clientExport);
    }
  }
  getEndpoint(route) {
    let ret = this.config.endpoints[0];
    if (route) {
      ret += route;
    }
    return ret;
  }
  addRoute(route) {
    this.routes.add(route);
  }
  replaceTokens(string, field) {
    const ret = string.replace(/\$\{([^}]+)\}/g, (match, p1) => {
      if (!Object.keys(this.config).includes(p1)) {
        if (this[p1] != null && typeof this[p1] === "function") {
          return this[p1]();
        } else {
          this.warn("replaceTokens: Unable to resolve variable", p1, "in field ", field);
          return void 0;
        }
      } else {
        return this.config[p1];
      }
    });
    this.verbose("replaceTokens", field, ret);
    return ret;
  }
  async load() {
    const config2 = JSON.parse(JSON.stringify(this.config));
    if (!this.app.services.has("httpd")) {
      this.warn("API service not found, cannot register routes");
      return false;
    }
    this.debug(`${this.id} integration loading...`);
    for (const path17 in config2.routes || []) {
      const def = config2.routes[path17];
      if (def == null) {
        this.warn("Empty route definition: null", path17);
        continue;
      }
      let method = "GET";
      let endpoint = path17;
      if (path17.includes(" ")) {
        [method, endpoint] = path17.split(" ");
      }
      const route = JSON.parse(JSON.stringify(def));
      route.method = method;
      if (this.handlers.has(route.handler)) {
        const apiDef = this.handlers.get(route.handler);
        const { handler, schema } = apiDef(this, def.opts);
        route.handler = handler;
        route.schema = schema;
        if (this.clientExports.has(route.clientExport)) {
          const clientExport = this.clientExports.get(route.clientExport)();
          clientExport.namespace = this.id;
          clientExport.name = route.clientExport;
          clientExport.method = route.method;
          clientExport.endpoint = endpoint;
          this.declareClientExport(clientExport);
        }
      } else {
        this.error(
          endpoint,
          "route handler function not found, have you added it to the integrations handler Map?",
          route.handler
        );
        continue;
      }
      this.debug(`${this.id}: addRoute`, route.method, endpoint, "handler installed");
      if (route.insecure && process.env.NODE_ENV === NodeProcessEnv.production) {
        this.warn(`${this.id}: route`, route.method, endpoint, "is not secured by token.");
      }
      this.addRoute({ url: endpoint, ...route });
    }
    const api = this.app.services.get("httpd");
    this.routes.forEach((route) => {
      api.registerAPI(route);
    });
    this.success(`${this.id} integration loaded.`);
    return true;
  }
};

// src/integrations/CdnIntegrations/handlers/fid.ts
var fidClientExport = function() {
  return {
    description: "Retrieve a workflow artifact",
    params: [{ name: "fid", required: true, type: "string" }]
  };
};
var uploadClientExport = function() {
  return {
    method: "POST",
    description: "Retrieve a workflow artifact",
    params: [{ name: "fid", required: true, type: "string" }]
  };
};
var createUploadHandler = function(integration, config2) {
  return {
    schema: {
      headers: {
        type: "object",
        properties: {
          "Content-Type": {
            type: "string",
            pattern: ".*multipart/form-data.*"
            // Ensures the request has this content-type. Right now this suffice, might need a custom validation function instead for more complex validation
          }
        },
        required: ["content-type"]
      }
    },
    handler: async function(request, reply) {
      if (!request.user) {
        throw new Error("User not logged in");
      }
      const parts = request.parts();
      integration.info("upload", parts);
      const files = [];
      let storageType = "temporary";
      for await (const part of parts) {
        if (!part.file) {
          const value = await part.value;
          if (part.fieldname === "storageType" && ["permanent", "temporary"].includes(value)) {
            storageType = value;
          }
        } else {
          const buffer = await part.toBuffer();
          const fileName = part.filename;
          let res;
          if (storageType === "permanent") {
            res = await integration.put(buffer, { fileName, userId: request.user.id, tags: ["upload"] });
          } else {
            res = await integration.putTemp(buffer, { fileName, userId: request.user.id, tags: ["upload"] });
          }
          files.push(res);
        }
      }
      return await reply.send(files);
    }
  };
};
var createFidHandler = function(integration, config2) {
  return {
    schema: {
      params: {
        type: "object",
        properties: {
          fid: { type: "string" }
        },
        required: ["fid"]
      },
      querystring: {
        type: "object",
        properties: {
          obj: { type: "boolean" },
          test: { type: "boolean" }
        }
      }
      // TODO: Validate response
    },
    handler: async function(request, reply) {
      const fid = request.params.fid;
      if (fid == null) {
        return await reply.status(422).send({ error: "Missing fid" });
      }
      const cdn = integration.app.cdn;
      if (request.query.obj) {
        const fo = await cdn.find(fid);
        if (fo == null) {
          return await reply.status(404).header("Cache-Control", "no-cache, no-store, must-revalidate").send({ error: "File not found" });
        } else {
          return await reply.status(200).send(fo);
        }
      }
      if (request.query.test === "true") {
        if (await cdn.checkFileExists(fid)) {
          return await reply.status(200).send({ exists: true });
        } else {
          return await reply.status(410).header("Cache-Control", "no-cache, no-store, must-revalidate").send({ exists: false });
        }
      }
      const defaults = { download: false };
      const opts = Object.assign({}, defaults, { ...request.query });
      omnilog.log(opts);
      try {
        const servedFile = await cdn.serveFile(fid, opts, reply);
        return servedFile;
      } catch (ex) {
        integration.error(ex);
        const status = ex.response?.status ?? 500;
        const replied = reply.status(status).send({ error: `${status} : An error occurred` });
        return await replied;
      }
    }
  };
};

// src/integrations/CdnIntegrations/CdnIntegration.ts
import imageSize from "image-size";
import axios from "axios";
import { join as joinPath } from "path";
import { EOmniFileTypes as EOmniFileTypes3, OmniBaseResource } from "omni-sdk";
var CdnResource = class extends OmniBaseResource {
  constructor(resource) {
    super(resource);
  }
  static getImageMeta(cdnResource) {
    if (cdnResource == null) {
      return;
    }
    try {
      const buffer = cdnResource instanceof Buffer ? cdnResource : cdnResource.data instanceof Buffer ? cdnResource.data : void 0;
      if (buffer != null) {
        return imageSize(buffer);
      }
    } catch (ex) {
      omnilog.error(ex);
      return {};
    }
  }
  asBase64(addHeader) {
    if (this.data instanceof Buffer) {
      if (addHeader) {
        return `data:${this.mimeType};base64,${this.data.toString("base64")}`;
      } else {
        return this.data.toString("base64");
      }
    } else if (typeof this.data === "string") {
      if (addHeader) {
        return `data:${this.mimeType};base64,${this.data}`;
      } else {
        return this.data;
      }
    }
  }
  asBuffer() {
    if (this.data instanceof Buffer) {
      return this.data;
    } else {
      omnilog.error("Invalid data type detected:", typeof this.data);
    }
  }
};
var CdnIntegration = class extends APIIntegration {
  _kvStorage;
  async load() {
    this.handlers.set("fid", createFidHandler);
    this.clientExports.set("fid", fidClientExport);
    this.handlers.set("fidupload", createUploadHandler);
    this.clientExports.set("fidupload", uploadClientExport);
    const config2 = this.config.kvStorage;
    if (config2 != null) {
      this._kvStorage = new KVStorage(this, config2);
      if (!await this._kvStorage.init()) {
        throw new Error("KVStorage failed to start");
      }
      this._kvStorage?.events.on("expired", this.onExpired.bind(this));
      await this._kvStorage?.vacuum([]);
      const chown = this.app.options.chown;
      if (chown != null) {
        this.warn("Transferring ownership of all unknown files to " + chown);
        const tag = chown.trim();
        this.success(this._kvStorage?.db.prepare("UPDATE kvstore SET owner = ? WHERE owner IS NULL").run(tag));
      }
    }
    this.info("Looking for samples to import...");
    const directoryPath = joinPath(process.cwd(), "config.default", "samples");
    const files = await scanDirectory(directoryPath);
    this.debug("CdnIntegration:load:files");
    const cdnFiles = await Promise.all(
      files.map(async (file) => {
        return this.importSampleFile(file, ["sample"]);
      })
    );
    this.success("Imported sample files");
    return await super.load();
  }
  async onExpired(purgedKeys) {
  }
  async stop() {
    this._kvStorage?.events.off("vacuum", this.onExpired.bind(this));
    await this._kvStorage?.stop();
    return true;
  }
  get kvStorage() {
    if (this._kvStorage == null) {
      throw new Error("KV Storage accessed before loaded");
    }
    return this._kvStorage;
  }
  // Parse Seaweed style ttl string to ms
  parseTTL(ttl) {
    if (!ttl || ttl.length === 0)
      return 0;
    const ttlNumber = parseInt(ttl.slice(0, -1), 10);
    const ttlUnit = ttl.slice(-1);
    switch (ttlUnit) {
      case "s":
        return ttlNumber * 1e3;
      case "m":
        return ttlNumber * 1e3 * 60;
      case "h":
        return ttlNumber * 1e3 * 60 * 60;
      case "d":
        return ttlNumber * 1e3 * 60 * 60 * 24;
      default:
        throw new Error(`Unrecognized TTL unit: ${ttlUnit}`);
    }
  }
  createResource(resource) {
    return new CdnResource(resource);
  }
  //TODO: This needs work
  static async fetch(url, opts, integration) {
    if (url.indexOf("/fid/") === 0 && integration != null) {
      return this.getByFid(url.replace("/fid/", ""), integration);
    }
    console.info("Fetching from external URL", url);
    const result = await axios.get(url, {
      // @ts-ignore
      responseType: "arraybuffer",
      ...opts
    });
    return {
      data: Buffer.from(result.data, "binary"),
      mimeType: result.headers["content-type"],
      size: parseInt(result.headers["content-length"], 10)
    };
  }
  getCdnUrl(ticket) {
    return "/fid/" + ticket.fid;
  }
};

// src/blocks/DefaultBlocks/files_from_directory.ts
var NS_OMNI28 = "omnitool";
var component30 = OAIBaseComponent36.create(NS_OMNI28, "files_from_local_directory").fromScratch().set("title", "Read Files from Directory").set("category", Category36.INPUT_OUTPUT).set(
  "description",
  `Feeds files from the server's data.local/file-import/<user_id> directory to the recipe  
       **Filter**: A regular expression to filter file-names.
       **Recursive**: Include files from all subdirectries recursively.
      `
).setMethod("X-CUSTOM");
component30.addControl(component30.createControl("filter", "string").set("title", "Filter").toOmniControl()).addControl(component30.createControl("recursive", "boolean").set("title", "Recursive").toOmniControl()).addOutput(component30.createOutput("images", "object", "images", { array: true }).set("title", "Images").toOmniIO()).addOutput(component30.createOutput("videos", "object", "video", { array: true }).set("title", "Videos").toOmniIO()).addOutput(component30.createOutput("audios", "object", "audio", { array: true }).set("title", "Audios").toOmniIO()).addOutput(component30.createOutput("documents", "object", "document", { array: true }).set("title", "Documents").toOmniIO()).addOutput(component30.createOutput("jsons", "object", "json", { array: true }).set("title", "Objects").toOmniIO()).addOutput(component30.createOutput("files", "object", "file", { array: true }).set("title", "Files").toOmniIO()).setMacro(OmniComponentMacroTypes34.EXEC, async (payload, ctx) => {
  const fileImportPath = ctx.app.config.settings.paths?.fileImportPath || "data.local/file-import";
  const dir = path8.join(process.cwd(), fileImportPath, ctx.userId);
  await extra2.ensureDir(dir);
  let files = await fs5.readdir(dir, { recursive: !!payload.recursive, withFileTypes: true });
  files = files.filter((f) => f.isFile());
  if (payload.filter) {
    files = files.filter((f) => {
      const fname = path8.join(f.path.split("file-import")[1], f.name);
      return fname.match(payload.filter);
    });
  }
  const outFiles = await Promise.all(files.map((f) => ctx.app.cdn.importLocalFile(path8.join(f.path, f.name), ["local-import"], ctx.userId)));
  const images = outFiles.filter((f) => f.fileType === EOmniFileTypes3.image);
  const documents = outFiles.filter((f) => f.fileType === EOmniFileTypes3.document).filter((f) => f.mimeType !== "application/json");
  const videos = outFiles.filter((f) => f.fileType === EOmniFileTypes3.video);
  const audios = outFiles.filter((f) => f.fileType === EOmniFileTypes3.audio);
  let jsons = outFiles.filter((f) => f.mimeType === "application/json");
  jsons = await Promise.all(jsons.map(async (f) => ctx.app.cdn.get({ fid: f.fid, userId: ctx.userId }, {}, "object")));
  return { files: outFiles, images, videos, audios, documents, jsons };
});
var GetFilesFromDirectoryComponent = component30.toJSON();
var files_from_directory_default = GetFilesFromDirectoryComponent;

// src/blocks/DefaultBlocks/recipe_output.ts
import { OAIBaseComponent as OAIBaseComponent37, OmniComponentMacroTypes as OmniComponentMacroTypes35, BlockCategory as Category37 } from "omni-sockets";
var NS_OMNI29 = "omnitool";
var component31 = OAIBaseComponent37.create(NS_OMNI29, "recipe_output").fromScratch().set("title", "Recipe Output").set("category", Category37.INPUT_OUTPUT).set(
  "description",
  `Sets the API output for this recipe, used with the Run Recipe Block or when invoked via the REST API.  
    - To retrieve the output of the recipe, use the \`/api/v1/workflow/results?jobId=<jobId>\` endpoint.  
    - To retrieve file contents, use their file id (fid) with the \`/fid/<fid>\` endpoint on the server endpoint.  
    `
).setMethod("X-CUSTOM");
component31.addInput(
  component31.createInput("text", "string", "text", { array: true }).set("title", "Text").set("description", "A simple input string").allowMultiple(true).toOmniIO()
).addInput(
  component31.createInput("images", "array", "image", { array: true }).set("title", "Images").set("description", "One or more images").allowMultiple(true).toOmniIO()
).addInput(
  component31.createInput("audio", "array", "audio", { array: true }).set("title", "Audio").set("description", "One or more audio files").allowMultiple(true).toOmniIO()
).addInput(
  component31.createInput("documents", "array", "document", { array: true }).set("title", "Documents").set("description", "One or more documents").allowMultiple(true).toOmniIO()
).addInput(
  component31.createInput("videos", "array", "video", { array: true }).set("title", "Videos").set("description", "Video Files (.mp4)").allowMultiple(true).toOmniIO()
).addInput(
  component31.createInput("files", "array", "file", { array: true }).set("title", "Files").set("description", "Any type of file").allowMultiple(true).toOmniIO()
).addInput(
  component31.createInput("objects", "array", "objectArray").set("title", "JSON").set("description", "A JSON object").allowMultiple(true).setControl({
    controlType: "AlpineLabelComponent"
  }).toOmniIO()
).addInput(
  component31.createInput("persistData", "string", "text").set("title", "File Storage Mode").set("description", "Whether to save the files permanently or make them expire after a certain amount of time").setChoices(["Permanent", "Expiring"], "Permanent").toOmniIO()
).setMacro(OmniComponentMacroTypes35.EXEC, async (payload, ctx) => {
  const deleteData = (p) => {
    delete p.data;
    return p;
  };
  if (payload.persistData !== "Expiring") {
    if (payload.images && payload.images.length > 0) {
      await Promise.all(payload.images.map(async (image) => {
        delete image.data;
        return ctx.app.cdn.setExpiry(image, ctx.userId, null);
      }));
    }
    if (payload.audio && payload.audio.length > 0) {
      await Promise.all(payload.audio.map(async (audio) => {
        delete audio.data;
        return ctx.app.cdn.setExpiry(audio, ctx.userId, null);
      }));
    }
    if (payload.documents && payload.documents.length > 0) {
      await Promise.all(payload.documents.map(async (doc) => {
        delete doc.data;
        return ctx.app.cdn.setExpiry(doc, ctx.userId, null);
      }));
    }
    if (payload.videos && payload.videos.length > 0) {
      await Promise.all(payload.videos.map(async (vid) => {
        delete vid.data;
        return ctx.app.cdn.setExpiry(vid, ctx.userId, null);
      }));
    }
  }
  const result = {
    text: payload.text && !Array.isArray(payload.text) ? [payload.text] : payload.text,
    objects: payload.objects && !Array.isArray(payload.objects) ? [payload.objects] : payload.objects,
    artifacts: {
      audio: payload?.audio?.map(deleteData),
      documents: payload?.documents?.map(deleteData),
      files: payload?.files?.map(deleteData),
      images: payload?.images?.map(deleteData),
      videos: payload?.videos?.map(deleteData)
    },
    job: {
      userId: ctx.userId,
      jobId: ctx.jobId,
      recipeId: ctx.workflowId,
      errors: ctx.engine.errors && ctx.engine.errors.length > 0 ? ctx.engine.errors : null,
      success: !ctx.engine.errors || ctx.engine.errors.length === 0
    },
    created: Date.now()
  };
  const jobService = ctx.app.services.get("jobs");
  const storage = jobService.kvStorage;
  if (storage) {
    const tags = [];
    tags.push("job." + ctx.jobId);
    storage.set("result." + ctx.jobId, result, payload.persistData !== "Expiring" ? null : Date.now() + 1e3 * 60 * 60 * 24 * 30, tags, ctx.userId);
  }
  return {};
});
var RecipeOutputComponent = component31.toJSON();
var recipe_output_default = RecipeOutputComponent;

// src/utils/blocks.js
async function runBlock(ctx, block_name, args, outputs5 = {}) {
  try {
    const app = ctx.app;
    if (!app) {
      throw new Error("[runBlock] app not found in ctx");
    }
    const blocks2 = app.blocks;
    if (!blocks2) {
      throw new Error("[runBlock] blocks not found in app");
    }
    const result = await blocks2.runBlock(ctx, block_name, args, outputs5);
    return result;
  } catch (err) {
    throw new Error(`Error running block ${block_name}: ${err}`);
  }
}

// src/utils/utils.js
import { omnilog as omnilog4 } from "omni-shared";
var VERBOSE = true;
async function makeToast(ctx, message) {
  const app = ctx.app;
  const user = ctx.userId;
  const description_json = { type: "info", description: `Chunking document progress` };
  const toast = { user, message, description_json };
  await app.sendToastToUser(user, toast);
}
function is_valid(value) {
  if (value === null || value === void 0) {
    return false;
  }
  if (Array.isArray(value) && value.length === 0) {
    return false;
  }
  if (typeof value === "object" && Object.keys(value).length === 0) {
    return false;
  }
  if (typeof value === "string" && value.trim() === "") {
    return false;
  }
  return true;
}
function clean_string(original) {
  if (!is_valid(original)) {
    return "";
  }
  let text = sanitizeString(original);
  text = text.replace(/\n+/g, " ");
  text = text.replace(/ +/g, " ");
  return text;
}
function sanitizeString(original, use_escape_character = false) {
  return use_escape_character ? original.replace(/'/g, "\\'").replace(/"/g, '\\"') : original.replace(/'/g, "\u2018").replace(/"/g, "\u201C");
}
async function delay(ms) {
  return await new Promise((resolve) => setTimeout(resolve, ms));
}
async function pauseForSeconds(seconds) {
  console_log("Before pause");
  await delay(seconds * 1e3);
  console_log("After pause");
}
function console_log(...args) {
  if (VERBOSE) {
    omnilog4.log(...args);
  }
}
function console_warn(...args) {
  if (VERBOSE) {
    omnilog4.warn(...args);
  }
}
function sanitizeName(name) {
  if (!is_valid(name))
    return null;
  const sanetized_name = name.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
  return sanetized_name;
}
function combineValues(existing_value, new_value) {
  if (!existing_value)
    return new_value;
  if (!new_value)
    return existing_value;
  let result = null;
  if (Array.isArray(existing_value) && Array.isArray(new_value)) {
    result = existing_value.concat(new_value);
  } else if (Array.isArray(existing_value) && !Array.isArray(new_value)) {
    existing_value.push(new_value);
    result = existing_value;
  } else if (!Array.isArray(existing_value) && Array.isArray(new_value)) {
    result = [existing_value].concat(new_value);
  } else if (!Array.isArray(existing_value) && !Array.isArray(new_value)) {
    result = [existing_value, new_value];
  }
  return result;
}
async function runRecipe(ctx, recipe_id, args) {
  if (!recipe_id)
    throw new Error(`No recipe id specified`);
  const integration = ctx.app.integrations.get("workflow");
  const recipe_json = await integration.getRecipe(recipe_id, ctx.userId, true);
  if (!recipe_json)
    throw new Error(`Recipe ${recipe_id} not found`);
  const jobService = ctx.app.services.get("jobs");
  const job = await jobService.startRecipe(recipe_json, ctx.sessionId, ctx.userId, args, 0, "system");
  let value = null;
  await new Promise((resolve, reject) => {
    console.log("waiting for job", job.jobId);
    ctx.app.events.once("jobs.job_finished_" + job.jobId).then((job2) => {
      let workflow_job = job2;
      if (Array.isArray(workflow_job))
        workflow_job = workflow_job[0];
      value = workflow_job.artifactsValue;
      resolve(job2);
    });
  });
  return value;
}
function blockOutput(args) {
  const json = { ...args };
  json.result = { ok: true };
  return json;
}

// src/utils/database.js
var OMNITOOL_DOCUMENT_TYPES_USERDOC = "udoc";
function get_effective_key(ctx, key) {
  return `${ctx.userId}:${key}`;
}
function get_db(ctx) {
  const db = ctx.app.services.get("db");
  return db;
}
async function user_db_put(ctx, value, key, rev = void 0) {
  const db = get_db(ctx);
  const effectiveKey = get_effective_key(ctx, key);
  console_log(`put: ${key} = ${effectiveKey} with rev ${rev}`);
  let effective_rev = rev;
  if (effective_rev === void 0) {
    try {
      const get_result = await db.getDocumentById(OMNITOOL_DOCUMENT_TYPES_USERDOC, effectiveKey);
      effective_rev = get_result._rev;
      console_log(`fixing rev SUCCEEDED - deleteted rev ${effective_rev}`);
    } catch (e) {
      console_log("fixing rev failed");
    }
  }
  try {
    const json = await db.putDocumentById(OMNITOOL_DOCUMENT_TYPES_USERDOC, effectiveKey, { value }, effective_rev);
    if (json == null) {
      console_log(`put: ${key} = ${effectiveKey} failed`);
      return false;
    } else {
      console_log(`put: ${key} = ${effectiveKey} succeeded`);
    }
  } catch (e) {
    throw new Error(`put: ${key} = ${effectiveKey} failed with error: ${e}`);
  }
  return true;
}
async function user_db_get(ctx, key) {
  const effectiveKey = get_effective_key(ctx, key);
  const db = get_db(ctx);
  let json = null;
  try {
    json = await db.getDocumentById(OMNITOOL_DOCUMENT_TYPES_USERDOC, effectiveKey);
  } catch (e) {
    console_log(`usr_db_get: ${key} = ${effectiveKey} failed with error: ${e}`);
  }
  if (json == null)
    return null;
  const json_value = json.value;
  if (json_value == null) {
    console_log(`usr_db_get NULL VALUE. DELETING IT: ${key} = ${effectiveKey} json = ${JSON.stringify(json)}`);
    await db.deleteDocumentById(OMNITOOL_DOCUMENT_TYPES_USERDOC, effectiveKey, json._rev);
    return null;
  }
  return json_value;
}

// src/utils/component.js
import { OAIBaseComponent as OAIBaseComponent38, OmniComponentMacroTypes as OmniComponentMacroTypes36 } from "omni-sockets";
function generateTitle(value) {
  const title4 = value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
  return title4;
}
function setComponentInputs(component39, inputs5) {
  inputs5.forEach(function(input) {
    const name = input.name;
    const type2 = input.type;
    const customSocket = input.customSocket;
    const description4 = input.description;
    const default_value = input.defaultValue;
    let title4 = input.title;
    const choices = input.choices;
    const minimum = input.minimum;
    const maximum = input.maximum;
    const step = input.step;
    const allow_multiple = input.allowMultiple;
    if (!title4 || title4 === "")
      title4 = generateTitle(name);
    component39.addInput(
      component39.createInput(name, type2, customSocket).set("title", title4 || "").set("description", description4 || "").set("choices", choices || null).set("minimum", minimum || null).set("maximum", maximum || null).set("step", step || null).set("allowMultiple", allow_multiple || null).setDefault(default_value).toOmniIO()
    );
  });
  return component39;
}
function setComponentOutputs(component39, outputs5) {
  outputs5.forEach(function(output) {
    const name = output.name;
    const type2 = output.type;
    const customSocket = output.customSocket;
    const description4 = output.description;
    let title4 = output.title;
    if (!title4 || title4 === "")
      title4 = generateTitle(name);
    component39.addOutput(
      component39.createOutput(name, type2, customSocket).set("title", title4 || "").set("description", description4 || "").toOmniIO()
    );
  });
  return component39;
}
function setComponentControls(component39, controls4) {
  controls4.forEach(function(control) {
    const name = control.name;
    let title4 = control.title;
    const placeholder = control.placeholder;
    const description4 = control.description;
    if (!title4 || title4 === "")
      title4 = generateTitle(name);
    component39.addControl(
      component39.createControl(name).set("title", title4 || "").set("placeholder", placeholder || "").set("description", description4 || "").toOmniControl()
    );
  });
  return component39;
}
function createComponent(group_id4, id4, title4, category4, description4, summary4, links4, inputs5, outputs5, controls4, payloadParser) {
  if (!links4)
    links4 = {};
  let baseComponent2 = OAIBaseComponent38.create(group_id4, id4).fromScratch().set("title", title4).set("category", category4).set("description", description4).setMethod("X-CUSTOM").setMeta({
    source: {
      summary: summary4,
      links: links4
    }
  });
  baseComponent2 = setComponentInputs(baseComponent2, inputs5);
  baseComponent2 = setComponentOutputs(baseComponent2, outputs5);
  if (controls4)
    baseComponent2 = setComponentControls(baseComponent2, controls4);
  baseComponent2.setMacro(OmniComponentMacroTypes36.EXEC, payloadParser);
  const component39 = baseComponent2.toJSON();
  return component39;
}

// src/utils/files.js
import { Utils } from "omni-shared";

// src/utils/llm.js
function generateModelId(model_name, model_provider) {
  return `${model_name}|${model_provider}`;
}
function deduceLlmTitle(model_name, model_provider, provider_icon = "?") {
  const title4 = provider_icon + // @ts-ignore
  model_name.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) + " (" + model_provider + ")";
  return title4;
}
function deduceLlmDescription(model_name, context_size = 0) {
  let description4 = model_name.substring(0, model_name.length - 4);
  if (context_size > 0)
    description4 += ` (${Math.floor(context_size / 1024)}k)`;
  return description4;
}
async function fixJsonWithLlm(llm, json_string_to_fix) {
  const ctx = llm.ctx;
  let response = null;
  const args = {};
  args.user = ctx.userId;
  args.prompt = json_string_to_fix;
  args.instruction = "Fix the JSON string below. Do not output anything else but the carefully fixed JSON string.";
  args.temperature = 0;
  try {
    response = await llm.runLlmBlock(ctx, args);
  } catch (err) {
    console.error(`[FIXING] fixJsonWithLlm: Error fixing json: ${err}`);
    return null;
  }
  const text = response?.answer_text || "";
  console_log(`[FIXING] fixJsonWithLlm: text: ${text}`);
  if (!is_valid(text))
    return null;
  return text;
}
async function fixJsonString(llm, passed_string) {
  if (!is_valid(passed_string)) {
    throw new Error(`[FIXING] fixJsonString: passed string is not valid: ${passed_string}`);
  }
  if (typeof passed_string !== "string") {
    throw new Error(
      `[FIXING] fixJsonString: passed string is not a string: ${passed_string}, type = ${typeof passed_string}`
    );
  }
  const cleanedString = passed_string.replace(/\\n/g, "\n");
  let jsonObject = null;
  let fixed = false;
  let attempt_count = 0;
  let attempt_at_cleaned_string = cleanedString;
  while (!fixed && attempt_count < 10) {
    attempt_count++;
    console_log(`[FIXING] Attempting to fix JSON string after ${attempt_count} attempts.
`);
    try {
      jsonObject = JSON.parse(attempt_at_cleaned_string);
    } catch (err) {
      console.error(
        `[FIXING] [${attempt_count}] Error fixing JSON string: ${err}, attempt_at_cleaned_string: ${attempt_at_cleaned_string}`
      );
    }
    if (jsonObject !== null && jsonObject !== void 0) {
      fixed = true;
      console_log(`[FIXING] Successfully fixed JSON string after ${attempt_count} attempts.
`);
      return jsonObject;
    }
    const response = await fixJsonWithLlm(llm, passed_string);
    if (response !== null && response !== void 0) {
      attempt_at_cleaned_string = response;
    }
    await pauseForSeconds(0.5);
  }
  if (!fixed) {
    throw new Error(`Error fixing JSON string after ${attempt_count} attempts.
cleanedString: ${cleanedString})`);
  }
  return "{}";
}
var Llm = class {
  // @ts-ignore
  constructor(tokenizer, params = null) {
    this.tokenizer = tokenizer;
    this.context_sizes = {};
  }
  // @ts-ignore
  countTextTokens(text) {
    return this.tokenizer.countTextTokens(text);
  }
  // @ts-ignore
  getModelContextSizeFromModelInfo(model_name) {
    return this.context_sizes[model_name];
  }
  // -----------------------------------------------------------------------
  /**
   * @param {any} ctx
   * @param {string} prompt
   * @param {string} instruction
   * @param {string} model_name
   * @param {number} [temperature=0]
   * @param {any} args
   * @returns {Promise<{ answer_text: string; answer_json: any; }>}
   */
  // @ts-ignore
  async query(ctx, prompt, instruction, model_name, temperature = 0, args = null) {
    throw new Error("You have to implement this method");
  }
  /**
   * @param {any} ctx
   * @param {any} args
   * @returns {Promise<{ answer_text: string; answer_json: any; }>}
   */
  // @ts-ignore
  async runLlmBlock(ctx, args) {
    throw new Error("You have to implement this method");
  }
  getProvider() {
    throw new Error("You have to implement this method");
  }
  getModelType() {
    throw new Error("You have to implement this method");
  }
  // @ts-ignore
  async getModelChoices(choices, llm_model_types, llm_context_sizes) {
    throw new Error("You have to implement this method");
  }
};

// src/utils/tokenizer_Openai.js
import { encode, isWithinTokenLimit } from "gpt-tokenizer";

// src/utils/tokenizer.js
var Tokenizer = class {
  // @ts-ignore
  constructor(params = null) {
  }
  // @ts-ignore
  encodeText(text) {
    throw new Error("You have to implement the method: encode");
  }
  // @ts-ignore
  textIsWithinTokenLimit(text, token_limit) {
    throw new Error("You have to implement the method: isWithinTokenLimit");
  }
  // @ts-ignore
  countTextTokens(text) {
    throw new Error("You have to implement the method: countTextTokens");
  }
};

// src/utils/tokenizer_Openai.js
var Tokenizer_Openai = class extends Tokenizer {
  constructor() {
    super();
  }
  // @ts-ignore
  encodeText(text) {
    return encode(text);
  }
  // @ts-ignore
  countTextTokens(text) {
    const tokens = encode(text);
    if (tokens !== null && tokens !== void 0 && tokens.length > 0) {
      const num_tokens = tokens.length;
      return num_tokens;
    } else {
      return 0;
    }
  }
  // @ts-ignore
  textIsWithinTokenLimit(text, token_limit) {
    return isWithinTokenLimit(text, token_limit);
  }
};

// src/utils/llm_Openai.js
var LLM_PROVIDER_OPENAI_SERVER = "openai";
var LLM_MODEL_TYPE_OPENAI = "openai";
var BLOCK_OPENAI_ADVANCED_CHATGPT = "openai.advancedChatGPT";
var LLM_CONTEXT_SIZE_MARGIN = 500;
var GPT3_MODEL_SMALL = "gpt-3.5-turbo";
var GPT3_MODEL_LARGE = "gpt-3.5-turbo-16k";
var GPT4_MODEL_SMALL = "gpt-4";
var GPT4_MODEL_LARGE = "gpt-4-32k";
var GPT3_MODEL_PREVIEW = "gpt-3.5-turbo-1106";
var GPT4_MODEL_PREVIEW = "gpt-4-1106-preview";
var GPT4_SIZE_CUTOFF = 8192 - LLM_CONTEXT_SIZE_MARGIN;
var ICON_OPENAI = "\u{1F4B0}";
var llm_openai_models = [
  {
    model_name: GPT3_MODEL_SMALL,
    model_type: LLM_MODEL_TYPE_OPENAI,
    context_size: 4096,
    provider: LLM_PROVIDER_OPENAI_SERVER
  },
  {
    model_name: GPT3_MODEL_LARGE,
    model_type: LLM_MODEL_TYPE_OPENAI,
    context_size: 16385,
    provider: LLM_PROVIDER_OPENAI_SERVER
  },
  {
    model_name: GPT4_MODEL_SMALL,
    model_type: LLM_MODEL_TYPE_OPENAI,
    context_size: 8192,
    provider: LLM_PROVIDER_OPENAI_SERVER
  },
  {
    model_name: GPT4_MODEL_LARGE,
    model_type: LLM_MODEL_TYPE_OPENAI,
    context_size: 32768,
    provider: LLM_PROVIDER_OPENAI_SERVER
  },
  {
    model_name: GPT3_MODEL_PREVIEW,
    model_type: LLM_MODEL_TYPE_OPENAI,
    context_size: 16385,
    provider: LLM_PROVIDER_OPENAI_SERVER
  },
  {
    model_name: GPT4_MODEL_PREVIEW,
    model_type: LLM_MODEL_TYPE_OPENAI,
    context_size: 128e3,
    provider: LLM_PROVIDER_OPENAI_SERVER
  }
];
var Llm_Openai = class extends Llm {
  constructor() {
    const tokenizer_Openai = new Tokenizer_Openai();
    super(tokenizer_Openai);
    this.context_sizes[GPT3_MODEL_SMALL] = 4096;
    this.context_sizes[GPT3_MODEL_LARGE] = 16385;
    this.context_sizes[GPT4_MODEL_SMALL] = 8192;
    this.context_sizes[GPT4_MODEL_LARGE] = 32768;
    this.context_sizes[GPT3_MODEL_PREVIEW] = 16385;
    this.context_sizes[GPT4_MODEL_PREVIEW] = 128e3;
  }
  // -----------------------------------------------------------------------
  /**
   * @param {any} ctx
   * @param {string} prompt
   * @param {string} instruction
   * @param {string} model_name
   * @param {number} [temperature=0]
   * @param {any} [args=null]
   * @returns {Promise<{ answer_text: string; answer_json: any; }>}
   */
  async query(ctx, prompt, instruction, model_name, temperature = 0, args = null) {
    const block_args = { ...args };
    block_args.user = ctx.userId;
    if (prompt !== "")
      block_args.prompt = prompt;
    if (instruction !== "")
      block_args.instruction = instruction;
    block_args.temperature = temperature;
    block_args.model = model_name;
    const response = await this.runLlmBlock(ctx, block_args);
    if (response.error)
      throw new Error(response.error);
    const total_tokens = response?.usage?.total_tokens || 0;
    let answer_text = response?.answer_text || "";
    const function_arguments_string = response?.function_arguments_string || "";
    let function_arguments = null;
    if (is_valid(function_arguments_string))
      function_arguments = await fixJsonString(ctx, function_arguments_string);
    if (is_valid(answer_text))
      answer_text = clean_string(answer_text);
    const answer_json = {};
    answer_json.function_arguments_string = function_arguments_string;
    answer_json.function_arguments = function_arguments;
    answer_json.total_tokens = total_tokens;
    answer_json.answer_text = answer_text;
    const return_value = {
      answer_text,
      answer_json
    };
    return return_value;
  }
  getProvider() {
    return LLM_PROVIDER_OPENAI_SERVER;
  }
  getModelType() {
    return LLM_MODEL_TYPE_OPENAI;
  }
  // @ts-ignore
  async getModelChoices(choices, llm_model_types, llm_context_sizes) {
    const models = Object.values(llm_openai_models);
    for (const model2 of models) {
      const model_name = model2.model_name;
      const provider = model2.provider;
      const model_id = generateModelId(model_name, provider);
      const title4 = model2.title || deduceLlmTitle(model_name, provider, ICON_OPENAI);
      const description4 = model2.description || deduceLlmDescription(model_name, model2.context_size);
      llm_model_types[model_name] = model2.type;
      llm_context_sizes[model_name] = model2.context_size;
      const choice = { value: model_id, title: title4, description: description4 };
      choices.push(choice);
    }
  }
  // @ts-ignore
  async runLlmBlock(ctx, args) {
    const prompt = args.prompt;
    const instruction = args.instruction;
    const model2 = args.model;
    const prompt_cost = this.tokenizer.countTextTokens(prompt);
    const instruction_cost = this.tokenizer.countTextTokens(instruction);
    const cost = prompt_cost + instruction_cost;
    let response = null;
    try {
      response = await runBlock(ctx, BLOCK_OPENAI_ADVANCED_CHATGPT, args);
    } catch (err) {
      const error_message = `Error running openai.advancedChatGPT: ${err.message}`;
      console.error(error_message);
      throw err;
    }
    return response;
  }
};

// src/utils/llms.js
var default_providers = [];
var llm_Openai = new Llm_Openai();
default_providers.push(llm_Openai);

// src/utils/tiktoken.js
import { encode as encode2 } from "gpt-tokenizer";

// src/blocks/DefaultBlocks/loop_recipe.ts
import { BlockCategory as Category38 } from "omni-sockets";
var group_id = "omnitool";
var id = "loop_recipe";
var title = `Loop Recipe`;
var category = Category38.RECIPE_OPERATIONS;
var description = `Run a recipe, possibly multiple time based on an array of values`;
var summary = description;
var inputs = [
  { name: "recipe_id", type: "string", customSocket: "text", description: "The UUID of the recipe to loop" },
  {
    name: "driving_input",
    type: "object",
    customSocket: "object",
    description: 'A json containing the name of the input variable to loop the recipe over its array of values. If using Chat Input in the recipe, the name should be "text", "images", "audio", or "documents". So, for example, we could have {"text":["hello","world"]} to loop the recipe over the values "hello" and "world".'
  },
  {
    name: "other_inputs",
    type: "object",
    customSocket: "object",
    description: "All the other inputs to pass to the recipe, in the format {input_name1:value1, input_name2:value2, etc. }"
  }
];
var outputs = [
  {
    name: "text",
    type: "string",
    customSocket: "text",
    description: "Texts returned by recipes, each separated with |"
  },
  { name: "images", type: "array", customSocket: "imageArray", description: "Images returned by recipes" },
  { name: "audio", type: "array", customSocket: "audioArray", description: "Audio returned by recipes" },
  { name: "documents", type: "array", customSocket: "documentArray", description: "Documents returned by recipes" },
  { name: "videos", type: "array", customSocket: "fileArray", description: "Videos returned by recipes" },
  { name: "files", type: "array", customSocket: "fileArray", description: "Files returned by recipes" },
  { name: "objects", type: "array", customSocket: "objectArray", description: "Objects returned by recipes" },
  {
    name: "result_array",
    type: "array",
    customSocket: "objectArray",
    description: "An array of all the recipes results"
  },
  { name: "info", type: "string", customSocket: "text", description: "Information about the block execution" }
];
var controls = null;
var links = {};
var LoopRecipeComponent = createComponent(
  group_id,
  id,
  title,
  category,
  description,
  summary,
  links,
  inputs,
  outputs,
  controls,
  parsePayload
);
async function parsePayload(payload, ctx) {
  let info = "*** LoopRecipeComponent ***  |";
  console.warn("LoopRecipeComponent", JSON.stringify(payload));
  const driving_input = payload.driving_input;
  const other_args = payload.other_inputs || {};
  const recipe_id = payload.recipe_id;
  if (!recipe_id)
    throw new Error(`No recipe id specified`);
  if (!driving_input)
    throw new Error(`No loop input json specified`);
  const input_keys = Object.keys(driving_input);
  const input_name = input_keys[0].toLowerCase();
  if (!input_name || input_name === "")
    throw new Error(`No input name specified`);
  const loop_input_value = driving_input[input_name];
  const args = { ...other_args };
  if ("botIdentity" in args)
    delete args.botIdentity;
  let input_array = [];
  if (input_name && Array.isArray(loop_input_value)) {
    input_array = loop_input_value;
  } else {
    input_array = [loop_input_value];
  }
  let texts = [];
  let images = [];
  let audio = [];
  let videos = [];
  let files = [];
  let objects = [];
  let documents = [];
  const initial_toast = `Looping Recipe ${recipe_id} #${input_array.length} times, using INPUT: ${input_name}.`;
  await ctx.app.sendToastToUser(ctx.userId, { message: initial_toast });
  const result_array = [];
  let input_index = 0;
  for (const input of input_array) {
    if (!input)
      continue;
    args[input_name] = input;
    let toast_info = `Recipe ${recipe_id} finished executing loop ${input_index + 1} of ${input_array.length} `;
    try {
      const result = await runRecipe(ctx, recipe_id, args);
      if (result) {
        result_array.push(result);
        if ("text" in result && result.text && result.text !== "") {
          texts = combineValues(texts, result.text);
          toast_info += `, with RESULT of type: text`;
        }
        if ("images" in result && result.images && result.images.length > 0) {
          images = combineValues(images, result.images);
          toast_info += `, with RESULT of type: images`;
        }
        if ("audio" in result && result.audio && result.audio.length > 0) {
          audio = combineValues(audio, result.audio);
          toast_info += `, with RESULT of type: audio`;
        }
        if ("documents" in result && result.documents && result.documents.length > 0) {
          documents = combineValues(documents, result.documents);
          toast_info += `, with RESULT of type: documents`;
        }
        if ("videos" in result && result.videos && result.videos.length > 0) {
          videos = combineValues(videos, result.videos);
          toast_info += `, with RESULT of type: videos`;
        }
        if ("files" in result && result.files && result.files.length > 0) {
          files = combineValues(files, result.files);
          toast_info += `, with RESULT of type: files`;
        }
        if ("objects" in result && result.objects && result.objects.length > 0) {
          objects = combineValues(objects, result.objects);
          toast_info += `, with RESULT of type: objects`;
        }
      } else {
        info += `WARNING: could not read any value from recipe_id ${recipe_id}  |  `;
        toast_info += `WARNING: could not read any value from recipe_id ${recipe_id}  |  `;
      }
    } catch {
      info += `Error running recipe ${recipe_id} with input ${input} |  `;
      toast_info += `Error running recipe ${recipe_id} with input ${input} |  `;
      continue;
    }
    await ctx.app.sendToastToUser(ctx.userId, { message: toast_info });
    input_index++;
  }
  let text = "";
  if (texts) {
    for (const text_value of texts) {
      if (text === "")
        text = text_value;
      else
        text = `${text} | ${text_value}`;
    }
  }
  const results = {};
  if (text && text !== "")
    results.text = text;
  if (images && images.length > 0)
    results.images = images;
  if (audio && audio.length > 0)
    results.audio = audio;
  if (videos && videos.length > 0)
    results.videos = videos;
  if (files && files.length > 0)
    results.files = files;
  if (objects && objects.length > 0)
    results.objects = objects;
  if (documents && documents.length > 0)
    results.documents = documents;
  results.result_array = result_array;
  results.info = info;
  results.ok = true;
  const return_value = blockOutput(results);
  return return_value;
}

// src/blocks/DefaultBlocks/stringarray_to_json.ts
import { BlockCategory as Category39 } from "omni-sockets";
var NS_OMNI30 = "omnitool";
var group_id2 = NS_OMNI30;
var id2 = "stringarray_to_json";
var title2 = "String to JSON";
var category2 = Category39.DATA_TRANSFORMATION;
var description2 = "Transforms a string containing multiple values separated by a specified delimiter into a structured JSON format, with each value assigned the chosen data type (e.g., string, number, boolean, or object).";
var summary2 = description2;
var inputs2 = [
  {
    name: "string",
    type: "string",
    customSocket: "text",
    description: "The string to be parsed and turned into an array of values."
  },
  {
    name: "type",
    type: "string",
    customSocket: "text",
    choices: ["string", "number", "boolean", "object"],
    defaultValue: "string",
    description: "The type of the values in the array."
  },
  {
    name: "separator",
    type: "string",
    customSocket: "text",
    description: "The separator to use to split the values of the input variable to loop. If not specified, line-break will be used."
  },
  {
    name: "name",
    type: "string",
    customSocket: "text",
    description: "If specified, the json will have this structure: { <name> : [array_value1, array_value2...] }, if not it will use [array_value1, array_value2...]"
  }
];
var outputs2 = [
  { name: "json", type: "object", customSocket: "object", description: "The json created from the inputs." },
  { name: "info", type: "string", customSocket: "text", description: "Information about the block execution" }
];
var controls2 = null;
var links2 = {};
var StringarrayToJsonComponent = createComponent(
  group_id2,
  id2,
  title2,
  category2,
  description2,
  summary2,
  links2,
  inputs2,
  outputs2,
  controls2,
  parsePayload2
);
async function parsePayload2(payload, ctx) {
  const input_name = payload.name;
  const input_string = payload.string;
  const input_type = payload.type;
  const separator = payload.separator || "\n";
  if (!input_string) {
    throw new Error(`No string specified`);
  }
  let info = "";
  let values = [];
  if (separator == "\n")
    values = input_string.split(/\r?\n/);
  else
    values = input_string.split(separator);
  if (!values || values.length == 0)
    throw new Error(`No values found in the string ${input_string} using the separator ${separator}`);
  const value_array = [];
  for (let value of values) {
    try {
      if (input_type == "number")
        value = Number(value);
      else if (input_type == "boolean") {
        value = value.toLowerCase() === "true";
        if (!value)
          value = value.toLowerCase() === "1";
        if (!value)
          value = value.toLowerCase() === "yes";
        if (!value)
          value = value.toLowerCase() === "y";
        if (!value)
          value = value.toLowerCase() === "ok";
        if (!value)
          value = value.toLowerCase() === "on";
      } else if (input_type == "object")
        value = JSON.parse(value);
      if (value) {
        value_array.push(value);
      } else {
        info += `Value ${value} is not a valid ${input_type}; 
`;
      }
    } catch (e) {
      info += `Error parsing value ${value} to type ${input_type}: ${e}; 
`;
      continue;
    }
  }
  if (value_array.length == 0)
    throw new Error(`No values found in the string ${input_string} using the separator ${separator}`);
  let json = null;
  if (input_name && input_name.length > 0) {
    json = {};
    json[input_name] = value_array;
  } else {
    json = value_array;
  }
  return { result: { ok: true }, json, info };
}

// src/blocks/DefaultBlocks/images_to_markdown.ts
import { BlockCategory as Category40 } from "omni-sockets";
var NS_OMNI31 = "omnitool";
var group_id3 = NS_OMNI31;
var id3 = "images_to_markdown";
var title3 = "Images to Markdown";
var category3 = Category40.DATA_TRANSFORMATION;
var description3 = "Transform an array of images and their corresponding captions into a markdown document.";
var summary3 = description3;
var inputs3 = [
  { name: "title", type: "string", customSocket: "text", description: "The title of the markdown." },
  { name: "images", type: "array", customSocket: "imageArray", description: "Images to be included in the markdown." },
  {
    name: "captions",
    type: "object",
    customSocket: "object",
    description: 'Captions to be included in the markdown in the format { "captions": ["caption1", "caption2", ...] }.'
  },
  {
    name: "entry_name",
    type: "string",
    customSocket: "text",
    defaultValue: "Panel",
    description: "The name to be used for each picture, e.g. panel, page or illustration"
  },
  {
    name: "append_to",
    type: "string",
    customSocket: "text",
    description: "Optional. The name of the markdown to append the new markdown to."
  }
];
var outputs3 = [
  { name: "markdown", type: "string", customSocket: "text", description: "The markdown created from the inputs." },
  { name: "info", type: "string", customSocket: "text", description: "Information about the block execution" }
];
var controls3 = null;
var links3 = {};
var ImagesToMarkdownComponent = createComponent(
  group_id3,
  id3,
  title3,
  category3,
  description3,
  summary3,
  links3,
  inputs3,
  outputs3,
  controls3,
  parsePayload3
);
async function parsePayload3(payload, ctx) {
  const title4 = payload.title;
  const images_cdns = payload.images;
  const captions_object = payload.captions;
  const entry_name = payload.entry_name;
  const captions = captions_object?.captions;
  const append_to = payload.append_to;
  if ((!images_cdns || images_cdns.length == 0) && (!captions_object || captions.length == 0)) {
    throw new Error(`No images or captions specified`);
  }
  let info = "";
  const image_urls = [];
  for (const image_cdn of images_cdns) {
    image_urls.push(image_cdn.url);
  }
  let markdown = "";
  if (title4) {
    markdown += `# ${title4}

`;
  } else {
    info += `No title specified
`;
  }
  if (!entry_name || entry_name == "") {
    info += `No Entry Name specified
`;
  }
  const minLen = Math.min(image_urls.length, captions.length);
  for (let i = 0; i < minLen; i++) {
    markdown += `## ${entry_name} ${i + 1}

`;
    markdown += `![${captions[i]}](${image_urls[i]})`;
    markdown += `${captions[i]}

`;
    markdown += `---

`;
  }
  for (let i = minLen; i < image_urls.length; i++) {
    markdown += `## ${entry_name} ${i + 1}

`;
    markdown += `![](${image_urls[i]})

`;
    markdown += `---

`;
    info += `No caption for image ${i + 1}
`;
  }
  for (let i = minLen; i < captions.length; i++) {
    markdown += `## ${entry_name} ${i + 1}

`;
    markdown += `${captions[i]}

`;
    markdown += `---

`;
    info += `No image for caption ${i + 1}
`;
  }
  if (!markdown || markdown == "")
    throw new Error(`No markdown created`);
  if (info.length > 0)
    console_warn(info);
  else
    info = "ok";
  if (append_to && append_to != "")
    markdown = append_to + "\n\n" + markdown;
  return { result: { ok: true }, markdown, info };
}

// src/blocks/DefaultBlocks/recipe_picker.ts
import { OAIBaseComponent as OAIBaseComponent39, OmniComponentMacroTypes as OmniComponentMacroTypes37, BlockCategory as Category41 } from "omni-sockets";
var component32 = OAIBaseComponent39.create("omnitool", "recipe_picker").fromScratch().set(
  "description",
  'Run a Recipe based on the passed "choice", as defined in the choices string (e.g. "color: red, green, blue"). The ID of the recipes are entered in the fields dynamically created from the comma-separated list of choice names. The Outputs of this block matches the outputs of the Recipe_Output block used in the recipes.'
).set("title", "Recipe Picker").set("category", Category41.RECIPE_OPERATIONS).setMethod("X-CUSTOM");
component32.addInput(
  component32.createInput("json", "object", "object").set("title", "Json").set(
    "description",
    "A JSON object containing all the recipes input fields, including the one named in the Choices string (and its value)."
  ).setRequired(true).toOmniIO()
).addInput(
  component32.createInput("choices", "string", "text").set("title", "Choices").set(
    "description",
    'A string in the format <choice_name>: <choice_value1>, <choice_value2>, etc. E.g. "color:red, green, blue" .'
  ).setRequired(true).toOmniIO()
).addControl(
  component32.createControl("button").set("title", "Update").setControlType("AlpineButtonComponent").setCustom("buttonAction", "script").setCustom("buttonValue", "save").set("description", "Update").toOmniControl()
).addOutput(component32.createOutput("text", "string", "text").set("title", "Text").toOmniIO()).addOutput(component32.createOutput("images", "array", "imageArray").set("title", "Images").toOmniIO()).addOutput(component32.createOutput("audio", "array", "audioArray").set("title", "Audio").toOmniIO()).addOutput(component32.createOutput("video", "array", "videoArray").set("title", "Video").toOmniIO()).addOutput(component32.createOutput("documents", "array", "documentArray").set("title", "Documents").toOmniIO()).addOutput(component32.createOutput("json", "array", "object", { array: true }).set("title", "JSON Object(s)").toOmniIO()).setMacro(OmniComponentMacroTypes37.ON_SAVE, onSave).setMacro(OmniComponentMacroTypes37.EXEC, processPayload);
var RecipePickerComponent = component32.toJSON();
async function onSave(node, recipe, ctx) {
  const choices = node.data.choices;
  if (!choices)
    return true;
  const choices_processed = parseChoiceString(choices);
  const choice_field = choices_processed.choice;
  const choices_names = choices_processed.values;
  if (!choice_field)
    return true;
  if (!choices_names)
    return true;
  const inputsObject = {};
  if (choices_names && choices_names.length > 0) {
    for (const choice_name of choices_names) {
      const work_name = sanitizeName(choice_name);
      const input = {
        title: `* ${choice_name} Recipe ID`,
        name: work_name,
        type: "string",
        customSocket: "text"
      };
      inputsObject[input.name] = input;
    }
  }
  node.data["x-omni-dynamicInputs"] = inputsObject;
  return true;
}
function parseChoiceString(input) {
  const [choice, valuesString] = input.split(":");
  const values = valuesString.split(",").map((value) => sanitizeName(value));
  return {
    choice: choice.trim(),
    values
  };
}
async function processPayload(payload, ctx) {
  const json = payload.json;
  const choices = payload.choices;
  if (!choices)
    throw new Error(`No choices provided.`);
  if (!json)
    throw new Error(`No json provided.`);
  const choices_processed = parseChoiceString(choices);
  const choice_field = choices_processed.choice;
  const choices_names = choices_processed.values;
  if (!choice_field)
    throw new Error(`No choice provided.`);
  if (!choices_names)
    throw new Error(`No values provided.`);
  if (!(choice_field in json))
    throw new Error(`Choice ${choice_field} not found in the json: ${JSON.stringify(json)}`);
  const choice = sanitizeName(json[choice_field]);
  if (!choice || choice.length == 0)
    throw new Error(`Choice ${choice_field} is empty in the json: ${JSON.stringify(json)}`);
  if (!choices_names.includes(choice))
    throw new Error(`Choice ${choice} is not in the list of available choices: ${choices_names.join(", ")}`);
  const recipes = {};
  for (const choice_name of choices_names) {
    if (choice_name in payload) {
      const recipe_id = payload[choice_name];
      if (recipe_id && recipe_id.length > 0)
        recipes[choice_name] = recipe_id;
    }
  }
  const picked_recipe_id = recipes[choice];
  if (!picked_recipe_id) {
    throw new Error(`Recipe Id for choice "${choice}" is not provided.`);
  }
  await makeToast(ctx, `Running recipe ${picked_recipe_id} for choice ${choice}.`);
  const recipe_result = await runRecipe(ctx, picked_recipe_id, json);
  if (!recipe_result) {
    await makeToast(ctx, `Recipe ${picked_recipe_id} for choice ${choice} returned no result.`);
    return { ok: true };
  }
  const result = {};
  result.result = { ok: true };
  for (const key in recipe_result) {
    if (recipe_result[key] && recipe_result[key].length == 0) {
      delete recipe_result[key];
    } else {
      result[key] = recipe_result[key];
    }
  }
  return result;
}

// src/blocks/DefaultBlocks/number_input_slider.ts
import { OAIBaseComponent as OAIBaseComponent40, OmniComponentMacroTypes as OmniComponentMacroTypes38, BlockCategory as Category42 } from "omni-sockets";
import deepmerge3 from "deepmerge";
var NS_OMNI32 = "omnitool";
var component33 = OAIBaseComponent40.create(NS_OMNI32, "number_input_slider").fromScratch().set(
  "description",
  "Allows input of numerical value through a slider, with a min, max, default and step value"
).set("title", "Number Input with Slider").set("category", Category42.INPUT_OUTPUT).setMethod("X-CUSTOM");
component33.addInput(
  component33.createInput("expand", "boolean").set("description", "Expand to show the slider options").toOmniIO()
).addControl(
  component33.createControl("button").set("title", "Update").setControlType("AlpineButtonComponent").setCustom("buttonAction", "script").setCustom("buttonValue", "save").set("description", "Update").toOmniControl()
).addOutput(component33.createOutput("number", "number", "number").set("description", "Output number").toOmniIO()).setMacro(OmniComponentMacroTypes38.ON_SAVE, onSave2).setMacro(OmniComponentMacroTypes38.EXEC, processPayload2).setMeta(deepmerge3({ source: { summary: component33.data.description } }, meta_default));
var NumberInputSliderBlock = component33.toJSON();
async function onSave2(node, recipe, ctx) {
  const expand = node.data.expand;
  const min = node.data.min;
  const max = node.data.max;
  const def = node.data.default;
  const step = node.data.step;
  const inputsObject = {};
  if (expand == true) {
    const min_socket = {};
    min_socket.title = `* min`;
    min_socket.name = "min";
    min_socket.type = "number";
    min_socket.customSocket = "number";
    inputsObject[min_socket.name] = min_socket;
    const max_socket = {};
    max_socket.title = `* max`;
    max_socket.name = "max";
    max_socket.type = "number";
    max_socket.customSocket = "number";
    inputsObject[max_socket.name] = max_socket;
    const def_socket = {};
    def_socket.title = `* default`;
    def_socket.name = "default";
    def_socket.type = "number";
    def_socket.customSocket = "number";
    inputsObject[def_socket.name] = def_socket;
    const step_socket = {};
    step_socket.title = `* step`;
    step_socket.name = "step";
    step_socket.type = "number";
    step_socket.customSocket = "number";
    inputsObject[step_socket.name] = step_socket;
  }
  const number_socket = {};
  number_socket.title = `number`;
  number_socket.name = "number";
  number_socket.type = "number";
  number_socket.customSocket = "number";
  if (def != void 0) {
    number_socket.default = def;
  }
  if (min != void 0 && max != void 0) {
    number_socket.minimum = min;
    number_socket.maximum = max;
  }
  if (step != void 0) {
    number_socket.step = step;
  }
  inputsObject[number_socket.name] = number_socket;
  node.data["x-omni-dynamicInputs"] = inputsObject;
  return true;
}
async function processPayload2(payload, ctx) {
  const raw_number = payload.number;
  const number = parseFloat(raw_number);
  const result = {};
  result.result = { ok: true };
  result.number = number;
  return result;
}

// src/blocks/DefaultBlocks/json_packer.ts
import { OAIBaseComponent as OAIBaseComponent41, OmniComponentMacroTypes as OmniComponentMacroTypes39, BlockCategory as Category43 } from "omni-sockets";
var component34 = OAIBaseComponent41.create("omnipath", "json_packer").fromScratch().set(
  "description",
  "Combine its dynamic inputs into a single json."
).set("title", "Json Packer").set("category", Category43.RECIPE_OPERATIONS).setMethod("X-CUSTOM");
component34.addInput(
  component34.createInput("fields_list", "string").set("title", "List").set("description", "The comma separated list of inputs, in the format input_name:input_type, e.g. my_picture:image. Valid types are text, object, objectarray, array, image, audio, document, video, file. ").toOmniIO()
).addControl(
  component34.createControl("button").set("title", "Save").setControlType("AlpineButtonComponent").setCustom("buttonAction", "script").setCustom("buttonValue", "save").set("description", "Save").toOmniControl()
).addOutput(
  component34.createOutput("json", "object", "object").set("title", "Json").toOmniIO()
).setMacro(OmniComponentMacroTypes39.ON_SAVE, onSave3).setMacro(OmniComponentMacroTypes39.EXEC, processPayload3);
var JsonPackerComponent = component34.toJSON();
async function onSave3(node, recipe, ctx) {
  const inputsObject = {};
  const fields_list = node.data.fields_list;
  const pairs = fields_list.split(",");
  for (const pair of pairs) {
    let [socket_name, socket_type] = pair.split(":");
    socket_type = socket_type.toLowerCase().trim();
    socket_name = socket_name.trim();
    const clean_name = sanitizeName(socket_name);
    let type2 = "";
    switch (socket_type) {
      case "text":
        type2 = "string";
        break;
      case "object":
        type2 = "object";
        break;
      case "objectarray":
        type2 = "array";
        break;
      case "array":
        type2 = "array";
        break;
      case "image":
        type2 = "array";
        break;
      case "audio":
        type2 = "array";
        break;
      case "document":
        type2 = "array";
        break;
      case "video":
        type2 = "array";
        break;
      case "file":
        type2 = "array";
        break;
      default:
        type2 = "string";
        break;
    }
    const input = {
      title: `* ${socket_name}`,
      name: clean_name,
      type: type2,
      customSocket: socket_type
    };
    inputsObject[input.name] = input;
  }
  node.data["x-omni-dynamicInputs"] = inputsObject;
  return true;
}
async function processPayload3(payload, ctx) {
  const fields_list = payload.fields_list;
  const pairs = fields_list.split(",");
  const json = {};
  for (const pair of pairs) {
    const [field_name, field_type] = pair.split(":");
    const sanetized_field_name = sanitizeName(field_name);
    json[sanetized_field_name] = payload[sanetized_field_name];
  }
  const result = {};
  result.result = { ok: true };
  result.json = json;
  return result;
}

// src/blocks/DefaultBlocks/json_unpacker.ts
import { OAIBaseComponent as OAIBaseComponent42, OmniComponentMacroTypes as OmniComponentMacroTypes40, BlockCategory as Category44 } from "omni-sockets";
var component35 = OAIBaseComponent42.create("omnipath", "json_unpacker").fromScratch().set(
  "description",
  "Dynamically unpack a json into separate outputs."
).set("title", "Json Unpacker").set("category", Category44.RECIPE_OPERATIONS).setMethod("X-CUSTOM");
component35.addInput(
  component35.createInput("json", "object").set("title", "Json").set("description", "The json to unpack.").toOmniIO()
).addInput(
  component35.createInput("fields_list", "string").set("title", "List").set("description", "The comma separated list of outputs, in the format output_name:output_type, e.g. my_picture:image. Valid types are text, object, objectarray, array, image, audio, document, video, file. ").toOmniIO()
).addControl(
  component35.createControl("button").set("title", "Save").setControlType("AlpineButtonComponent").setCustom("buttonAction", "script").setCustom("buttonValue", "save").set("description", "Save").toOmniControl()
).setMacro(OmniComponentMacroTypes40.ON_SAVE, onSave4).setMacro(OmniComponentMacroTypes40.EXEC, processPayload4);
var JsonUnpackerComponent = component35.toJSON();
async function onSave4(node, recipe, ctx) {
  const outputsObject = {};
  const fields_list = node.data.fields_list;
  if (!fields_list)
    return true;
  const pairs = fields_list.split(",");
  for (const pair of pairs) {
    let [socket_name, socket_type] = pair.split(":");
    socket_type = socket_type.toLowerCase().trim();
    socket_name = socket_name.trim();
    const clean_name = sanitizeName(socket_name);
    let type2 = "";
    switch (socket_type) {
      case "text":
        type2 = "string";
        break;
      case "object":
        type2 = "object";
        break;
      case "objectarray":
        type2 = "array";
        break;
      case "array":
        type2 = "array";
        break;
      case "image":
        type2 = "array";
        break;
      case "audio":
        type2 = "array";
        break;
      case "document":
        type2 = "array";
        break;
      case "video":
        type2 = "array";
        break;
      case "file":
        type2 = "array";
        break;
      default:
        type2 = "string";
        break;
    }
    const output = {
      title: `${socket_name} *`,
      name: clean_name,
      type: type2,
      customSocket: socket_type
    };
    outputsObject[output.name] = output;
  }
  node.data["x-omni-dynamicOutputs"] = outputsObject;
  return true;
}
async function processPayload4(payload, ctx) {
  const fields_list = payload.fields_list;
  let raw_json = payload.json;
  if (!raw_json)
    return { result: { ok: false, message: "No json provided" } };
  if (Array.isArray(raw_json))
    raw_json = raw_json[0];
  const json = {};
  for (const key in raw_json) {
    if (key && key.length > 0) {
      const sanetized_key = sanitizeName(key);
      json[sanetized_key] = raw_json[key];
    }
  }
  if (!fields_list)
    return { result: { ok: false, message: "No outputs_list provided" } };
  json["result"] = { ok: true };
  return json;
}

// src/blocks/DefaultBlocks/run_recipe.ts
import { OAIBaseComponent as OAIBaseComponent43, OmniComponentMacroTypes as OmniComponentMacroTypes41, BlockCategory as Category45 } from "omni-sockets";
var component36 = OAIBaseComponent43.create("omnitool", "run_recipe").fromScratch().set(
  "description",
  "Run a recipe."
).set("title", "Run Recipe").set("category", Category45.RECIPE_OPERATIONS).setMethod("X-CUSTOM");
component36.addInput(
  component36.createInput("recipes_list", "string", "text").set("title", "Recipes List").set("description", "The Id of the recipe to run").setChoices({ block: "omnitool.get_recipes", map: { root: "models", title: "title", value: "value", cache: "none" } }).setDefault("invalid").toOmniIO()
).addInput(
  component36.createInput("recipe_id", "string", "text").set("title", "Recipe Id Override").set("description", "The Id of the recipe to run - override the recipes_list input").toOmniIO()
).addInput(
  component36.createInput("text", "string", "text").set("title", "Text").set("description", "An input string").toOmniIO()
).addInput(
  component36.createInput("images", "array", "image").set("title", "Images").set("description", "One or more images").setControl({
    controlType: "AlpineLabelComponent"
  }).toOmniIO()
).addInput(
  component36.createInput("audio", "array", "audioArray").set("title", "Audio").set("description", "One or more audio files").setControl({
    controlType: "AlpineLabelComponent"
  }).toOmniIO()
).addInput(
  component36.createInput("video", "array", "videoArray").set("title", "Video").set("description", "One or more videos").setControl({
    controlType: "AlpineLabelComponent"
  }).toOmniIO()
).addInput(
  component36.createInput("documents", "array", "documentArray").set("title", "Documents").set("description", "One or more documents").setControl({
    controlType: "AlpineLabelComponent"
  }).toOmniIO()
).addInput(
  component36.createInput("json", "array", "objectArray").set("title", "JSON Object(s)").set("description", "One or more object").toOmniIO()
).addInput(
  component36.createInput("args", "object", "object").set("title", "Additional arguments").set("description", "Additional arguments to be passed as inputs - useful when the recipe uses a formio input block.").toOmniIO()
).addOutput(component36.createOutput("text", "string", "text").set("title", "Text").toOmniIO()).addOutput(component36.createOutput("images", "array", "imageArray").set("title", "Images").toOmniIO()).addOutput(component36.createOutput("audio", "array", "audioArray").set("title", "Audio").toOmniIO()).addOutput(component36.createOutput("video", "array", "videoArray").set("title", "Video").toOmniIO()).addOutput(component36.createOutput("documents", "array", "documentArray").set("title", "Documents").toOmniIO()).addOutput(component36.createOutput("json", "array", "object", { array: true }).set("title", "JSON Object(s)").toOmniIO()).setMacro(OmniComponentMacroTypes41.EXEC, processPayload5);
var RunRecipeComponent = component36.toJSON();
async function processPayload5(payload, ctx) {
  let recipe_id = payload.recipe_id;
  if (!recipe_id) {
    recipe_id = payload.recipes_list;
    if (recipe_id === "invalid")
      recipe_id = void 0;
  }
  if (!recipe_id) {
    throw new Error(`Recipe Id is not provided.`);
  }
  const args = payload.args;
  const json = { ...args };
  for (const key in payload) {
    if (key === "args")
      continue;
    json[key] = payload[key];
  }
  await ctx.app.sendToastToUser(ctx.userId, { message: `Running recipe ${recipe_id}.` });
  const recipe_result = await runRecipe(ctx, recipe_id, json);
  if (!recipe_result) {
    await ctx.app.sendToastToUser(ctx.userId, { message: `Recipe ${recipe_id} returned no result.` });
    return { ok: true };
  }
  const result = {};
  result.result = { ok: true };
  for (const key in recipe_result) {
    if (recipe_result[key] && recipe_result[key].length === 0) {
      delete recipe_result[key];
    } else {
      result[key] = recipe_result[key];
    }
  }
  return result;
}

// src/blocks/DefaultBlocks/masked_input.ts
import { OAIBaseComponent as OAIBaseComponent44, BlockCategory as Category46 } from "omni-sockets";
var NS_OMNI33 = "omnitool";
var component37 = OAIBaseComponent44.create(NS_OMNI33, "input_credential").fromScratch().set(
  "description",
  `A text input component that masks its content by default.  

\u26A0\uFE0F WARNING: This node performs visual masking only`
).set("title", "Masked Input").set("category", Category46.INPUT_OUTPUT).setMethod("X-PASSTHROUGH");
component37.addInput(
  component37.createInput("text", "string").set("description", "Sensitive text you would like to mask").setFormat("password").allowMultiple(true).toOmniIO()
).addOutput(component37.createOutput("text", "string", "text").set("description", "Sensitive text").toOmniIO()).setMeta({
  source: {
    authors: ["Mercenaries.ai Team"],
    links: {
      "Mercenaries.ai": "https://mercenaries.ai"
    }
  }
});
var PasswordInputComponent = component37.toJSON();
var masked_input_default = PasswordInputComponent;

// src/blocks/DefaultBlocks/hf_get_models.ts
import axios2 from "axios";
import { OAIBaseComponent as OAIBaseComponent45, OmniComponentMacroTypes as OmniComponentMacroTypes42 } from "omni-sockets";
var NAMESPACE = "huggingface_utils";
var OPERATION_ID = "getModels";
var TITLE = "Get Huggingface Models";
var DESCRIPTION = "Get top Huggingface models for a given tag, sorted in a number of ways.";
var CATEGORY = "hugginface";
var HUGGINGFACE_BASE_KEY = "RESERVED_huggingface_models";
var HUGGINGFACE_TAGS = [
  "audio-classification",
  "audio-to-audio",
  "automatic-speech-recognition",
  "conversational",
  "document-question-answering",
  "feature-extraction",
  "fill-mask",
  "image-classification",
  "image-segmentation",
  "image-to-image",
  "image-to-text",
  "object-detection",
  "question-answering",
  "reinforcement-learning",
  "question-answering",
  "sentence-similarity",
  "summarization",
  "table-question-answering",
  "tabular-classification",
  "tabular-regression",
  "text-classification",
  "text-generation",
  "text-to-image",
  "text-to-speech",
  "token-classification",
  "translation",
  "visual-question-answering",
  "zero-shot-classification",
  "zero-shot-image-classification"
];
var huggingface_sorts = ["trending", "likes", "downloads", "date"];
var inputs4 = [
  { name: "tag", type: "string", title: "Tag", customSocket: "text", defaultValue: "text-to-image", description: "Tag to filter the models by.", choices: HUGGINGFACE_TAGS },
  { name: "criteria", type: "string", defaultValue: "trending", title: "Criteria", description: "The criteria to sort the models ", choices: huggingface_sorts },
  { name: "max_entries", type: "number", defaultValue: 25, minimum: 1, maximum: 100, step: 1, description: "The number of models to return." }
];
var outputs4 = [
  { name: "model", type: "string", customSocket: "text", description: "The selected model" },
  { name: "tag", type: "string", customSocket: "text", description: "The selected tag" }
];
var baseComponent = OAIBaseComponent45.create(NAMESPACE, OPERATION_ID).fromScratch().set("title", TITLE).set("category", CATEGORY).set("description", DESCRIPTION).setMethod("X-CUSTOM");
baseComponent = setComponentInputs(baseComponent, inputs4);
baseComponent = setComponentOutputs(baseComponent, outputs4);
baseComponent.addControl(
  baseComponent.createControl("button").set("title", "Update").setControlType("AlpineButtonComponent").setCustom("buttonAction", "script").setCustom("buttonValue", "save").set("description", "Update").toOmniControl()
);
baseComponent.setMacro(OmniComponentMacroTypes42.ON_SAVE, onSave5);
baseComponent.setMacro(OmniComponentMacroTypes42.EXEC, processPayload6);
var HuggingfaceListModelsComponent = baseComponent.toJSON();
async function onSave5(node, recipe, ctx) {
  const tag = node.data.tag;
  const criteria = node.data.criteria;
  const max_entries = node.data.max_entries;
  const key = `${HUGGINGFACE_BASE_KEY}_${tag}_${criteria}_${max_entries}`;
  let cached_models = await user_db_get(ctx, key);
  debugger;
  if (!cached_models) {
    cached_models = await getModels(tag, max_entries, criteria);
    if (cached_models && cached_models.length > 0 && !("error" in cached_models))
      await user_db_put(ctx, cached_models, key);
  }
  if (cached_models && cached_models.length > 0) {
    const inputsObject = {};
    const model_socket = {};
    model_socket.title = `${tag} Models`;
    model_socket.name = "model";
    model_socket.type = "string";
    model_socket.customSocket = "text";
    model_socket.choices = cached_models;
    inputsObject[model_socket.name] = model_socket;
    node.data["x-omni-dynamicInputs"] = inputsObject;
  }
  return true;
}
async function processPayload6(payload, ctx) {
  debugger;
  const model2 = payload.model;
  const tag = payload.tag;
  return { result: { "ok": true }, model: model2, tag };
}
async function fetchData(tag) {
  try {
    console.log(`Fetching data for tag ${tag}`);
    const response = await axios2.get(`https://huggingface.co/api/models?filter=${tag}`);
    return response.data;
  } catch (error) {
    console.error("Error fetching data:", error);
    throw error;
  }
}
function sortAndFormatData(data, max_entries, tag, criteria) {
  let sortFunction;
  switch (criteria) {
    case "trending":
      sortFunction = (a, b) => b.downloads * b.likes - a.downloads * a.likes;
      break;
    case "likes":
      sortFunction = (a, b) => b.likes - a.likes;
      break;
    case "downloads":
      sortFunction = (a, b) => b.downloads - a.downloads;
      break;
    case "date":
      sortFunction = (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      break;
    default:
      throw new Error(`Unknown sorting criteria: ${criteria}`);
  }
  return data.sort(sortFunction).slice(0, max_entries).map((model2) => ({
    model_id: model2.modelId,
    title: `${model2.modelId} [${model2.likes}] @ ${model2.modelId.split("/")[0]}`,
    likes: model2.likes,
    downloads: model2.downloads,
    date: model2.createdAt,
    author: model2.modelId.split("/")[0],
    tag
  }));
}
async function getModels(tag, max_entries = 20, criteria = "trending") {
  try {
    const models = await fetchData(tag);
    const formattedData = sortAndFormatData(models, max_entries, tag, criteria);
    const output = [];
    for (const model2 of formattedData) {
      output.push(model2.model_id);
    }
    console.log(JSON.stringify(output, null, 2));
    return output;
  } catch (err) {
    console.error("Error processing data:", err.message);
  }
}

// src/blocks/DefaultBlocks/get_recipes.ts
import {
  OAIBaseComponent as OAIBaseComponent46,
  OmniComponentMacroTypes as OmniComponentMacroTypes43,
  BlockCategory as Category48
} from "omni-sockets";
var NS_OMNI34 = "omnitool";
var component38 = OAIBaseComponent46.create(NS_OMNI34, "get_recipes").fromScratch().set("title", "Get Recipes").set("category", Category48.INPUT_OUTPUT).set(
  "description",
  `Receive data (text, images, audio, video, and documents) directly from the chat window, transforming the recipe into a simple chatbot.
    Text, images, audio, video and documents are supplied via chat by typing and/or uploading.
    The JSON output is automatically populated if the text is valid JSON.
  `
).setMethod("X-CUSTOM");
component38.addOutput(component38.createOutput("models", "object", void 0, { array: true }).set("title", "Models").toOmniIO()).setMacro(OmniComponentMacroTypes43.EXEC, processPayload7);
async function processPayload7(payload, ctx) {
  const user_id = ctx.userId;
  const user_ids = [user_id];
  const integration = ctx.app.integrations.get("workflow");
  const collection = await integration.db.getDocumentsByOwnerIdV2("wf" /* WORKFLOW */, user_ids, 0, 100);
  const items = collection.docs;
  const models = [];
  models.push({ title: "Select a recipe", value: "invalid" });
  for (const workflow of items) {
    const id4 = workflow.id;
    const name = workflow.meta?.name;
    models.push({ title: name, value: id4 });
  }
  const results = { models, "ok": true };
  return results;
}
var GetRecipesComponent = component38.toJSON();

// src/blocks/DefaultBlocks.ts
var blocks = [];
blocks.push(boolean_input_default);
blocks.push(chat_input_default);
blocks.push(chat_output_default);
blocks.push(color_name_default);
blocks.push(custom_extension_event_default);
blocks.push(error_output_default);
blocks.push(file_array_splitter_default);
blocks.push(file_metadata_writer_default);
blocks.push(file_output_default);
blocks.push(file_switch_default);
blocks.push(files_from_directory_default);
blocks.push(image_info_default);
blocks.push(ImagesToMarkdownComponent);
blocks.push(jsonata_default);
blocks.push(json_input_default);
blocks.push(large_language_model_default);
blocks.push(LoopRecipeComponent);
blocks.push(multi_text_replace_default);
blocks.push(block_missing_default);
blocks.push(name_to_rgb_default);
blocks.push(number_input_default);
blocks.push(NsfwDetector_default);
blocks.push(prepare_image_default);
blocks.push(masked_input_default);
blocks.push(recipe_output_default);
blocks.push(run_script_default);
blocks.push(socket_test_default);
blocks.push(static_document_default);
blocks.push(static_file_default);
blocks.push(static_image_default);
blocks.push(StringarrayToJsonComponent);
blocks.push(text_comparison_default);
blocks.push(write_text_document_default);
blocks.push(text_input_default);
blocks.push(text_replace_default);
blocks.push(text_splitter_default);
blocks.push(text_to_json_default);
blocks.push(token_count_default);
blocks.push(recipe_metadata_default);
blocks.push(output_validator_default);
blocks.push(RecipePickerComponent);
blocks.push(NumberInputSliderBlock);
blocks.push(JsonPackerComponent);
blocks.push(JsonUnpackerComponent);
blocks.push(RunRecipeComponent);
blocks.push(HuggingfaceListModelsComponent);
blocks.push(GetRecipesComponent);
blocks.push(file_to_directory_default);
var OmniDefaultBlocks = blocks;

// src/core/StorageAdapter.ts
var StorageAdapter = class {
  backingStorage;
  keyPrefix;
  expiry;
  constructor(keyPrefix, backingStorage, expiry) {
    this.backingStorage = backingStorage ?? /* @__PURE__ */ new Map();
    this.expiry = expiry;
    this.keyPrefix = keyPrefix ?? "";
  }
  bindStorage(backingStorage) {
    this.backingStorage = backingStorage;
  }
  delete(key) {
    if (this.has(key)) {
      if (this.backingStorage instanceof Map) {
        this.backingStorage.delete(this.keyPrefix + key);
      } else {
        this.backingStorage.del(this.keyPrefix + key);
      }
    }
  }
  get(key) {
    return this.backingStorage.get(this.keyPrefix + key);
  }
  set(key, value, expiry) {
    if (this.backingStorage instanceof Map) {
      this.backingStorage.set(
        this.keyPrefix + key,
        value
      );
    } else {
      this.backingStorage.set(this.keyPrefix + key, value, expiry || this.expiry);
    }
  }
  // Wipe the storage
  clear(doubleConfirm) {
    if (this.backingStorage instanceof Map) {
      this.backingStorage.clear();
    } else {
      if (this.keyPrefix.length > 0) {
        this.backingStorage.delAny(this.keyPrefix);
      } else if (doubleConfirm === "Yes I want to wipe the storage even though I have not set a key prefix and it will wipe any other storage on the same KVStorage") {
        this.backingStorage.clear();
      }
    }
  }
  clearWithPrefix() {
    if (!this.keyPrefix) {
      throw new Error("No key prefix set. Use clear() method if you intend to wipe the entire storage.");
    }
    if (this.backingStorage instanceof Map) {
      for (const key of this.backingStorage.keys()) {
        if (key.startsWith(this.keyPrefix)) {
          this.backingStorage.delete(key);
        }
      }
    } else {
      this.backingStorage.delAny(this.keyPrefix);
    }
  }
  values() {
    if (this.backingStorage instanceof Map) {
      return this.backingStorage.values();
    }
    if (this.keyPrefix) {
      return this.backingStorage.getAny(this.keyPrefix).map((r) => r?.value)[Symbol.iterator]();
    }
    return this.backingStorage.getAll().map((r) => r?.value)[Symbol.iterator]();
  }
  keys() {
    if (this.backingStorage instanceof Map) {
      return this.backingStorage.keys();
    }
    if (this.keyPrefix) {
      return this.backingStorage.getAny(this.keyPrefix).map((r) => r?.key.substring(0, this.keyPrefix.length))[Symbol.iterator]();
    }
    return this.backingStorage.getAll().map((r) => r?.key)[Symbol.iterator]();
  }
  entries() {
    if (this.backingStorage instanceof Map) {
      return this.backingStorage.entries();
    }
    if (this.keyPrefix) {
      return this.backingStorage.getAny(this.keyPrefix).map((r) => [r?.key.substring(0, this.keyPrefix.length), r?.value])[Symbol.iterator]();
    }
    return this.backingStorage.getAll().map((r) => [r?.key, r?.value])[Symbol.iterator]();
  }
  has(key) {
    if (this.backingStorage instanceof Map) {
      return this.backingStorage.has(this.keyPrefix + key);
    }
    return this.get(key) != null;
  }
  search(limit, cursor, keySearch, contentSearch, tags, view) {
    if (this.backingStorage instanceof Map) {
      function* convertToIterator(map) {
        for (const [key, value] of map.entries()) {
          yield [key, value, -1];
        }
      }
      return convertToIterator(this.backingStorage);
    }
    if (this.keyPrefix || view) {
      function* convertToIterator(data) {
        for (const item of data) {
          yield [item.key, item.value, item.seq];
        }
      }
      const result = this.backingStorage.getAny(this.keyPrefix, void 0, {
        contentMatch: contentSearch,
        sort: "seq",
        tags,
        limit,
        cursor,
        view
      });
      return convertToIterator(result);
    }
  }
};

// src/core/BlockManager.ts
var PRELOAD_REGISTRY_IN_PARALLEL = false;
function removeUndefinedValues(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return obj;
  }
  const result = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (value !== void 0) {
        result[key] = removeUndefinedValues(value);
      }
    }
  }
  return result;
}
var BlockManager = class _BlockManager extends Manager {
  ReteAdapter = OpenAPIReteAdapter;
  BaseComponent = OAIBaseComponent47;
  factories;
  // This holds component factories
  namespaces;
  // This holds namespaces
  patches;
  // This holds patches
  blocks;
  // This holds blocks
  blocksAndPatches;
  // This holds blocks and patches
  macros;
  // This holds functions attached to blocks
  cache;
  // This holds cached entries
  config;
  _kvStorage;
  constructor(app, config2) {
    super(app);
    this.config = config2;
    this.blocks = new StorageAdapter("block:");
    this.patches = new StorageAdapter("patch:");
    this.blocksAndPatches = new StorageAdapter();
    this.namespaces = new StorageAdapter("ns:");
    this.cache = new StorageAdapter("cache:", void 0, 60 * 60 * 24);
    this.factories = /* @__PURE__ */ new Map();
    this.macros = /* @__PURE__ */ new Map();
    this.registerType("OAIComponent31", OAIComponent312.fromJSON);
    app.events.on("credential_change", (e) => {
      this.cache.clearWithPrefix();
    });
  }
  get kvStorage() {
    if (this._kvStorage == null) {
      throw new Error("BlockManager kvStorage accessed before load");
    }
    return this._kvStorage;
  }
  async init() {
    const kvConfig = this.config.kvStorage;
    if (kvConfig) {
      this._kvStorage = new KVStorage(this.app, kvConfig);
      this._kvStorage.registerView(
        "BlocksAndPatches",
        `CREATE VIEW IF NOT EXISTS BlocksAndPatches (key,
        value,
        valueType,
        blob,
        expiry,
        tags,
        deleted,
        seq) AS
      SELECT
            key,
            value,
            valueType,
            blob,
            expiry,
            tags,
            deleted,
            ROW_NUMBER() OVER (ORDER BY seq DESC) AS new_seq
        FROM
            kvstore
        WHERE
            (key LIKE 'block:%' OR key LIKE 'patch:%')
            AND deleted = 0;`
      );
      if (!await this.kvStorage.init()) {
        throw new Error("KVStorage failed to start");
      }
      const resetDB = this.app.options.resetDB;
      if (resetDB?.split(",").includes("blocks")) {
        this.info("Resetting blocks storage");
        this.kvStorage.clear();
      }
      await this.kvStorage.vacuum();
      this.app.events.on("register_blocks", (blocks2) => {
        blocks2.forEach((block7) => {
          this.addBlock(block7);
        });
      });
      this.app.events.on("register_patches", (patches) => {
        patches.forEach((patch) => {
          this.addPatch(patch);
        });
      });
      this.app.events.on("register_macros", (macros) => {
        Object.entries(macros || {}).forEach(([key, value]) => {
          this.registerMacro(key, value);
        });
      });
      this.blocks.bindStorage(this.kvStorage);
      this.namespaces.bindStorage(this.kvStorage);
      this.patches.bindStorage(this.kvStorage);
      this.cache.bindStorage(this.kvStorage);
      this.blocksAndPatches.bindStorage(this.kvStorage);
    }
    OmniDefaultBlocks.forEach((block7) => {
      this.addBlock(block7);
    });
    this.registerExecutors();
    if (this.config.preload) {
      await this.preload();
    }
    this.info("BlockManager initialized");
    return true;
  }
  formatHeader(blockOrPatch) {
    return {
      title: blockOrPatch.title ?? `${blockOrPatch.displayNamespace + "." + blockOrPatch.displayOperationId}`,
      description: blockOrPatch.description ?? "",
      category: blockOrPatch.category,
      name: `${blockOrPatch.displayNamespace + "." + blockOrPatch.displayOperationId}`,
      tags: blockOrPatch.tags ?? []
    };
  }
  async stop() {
    await this.kvStorage.stop();
    await super.stop();
    this.info("BlockManager stopped");
    return true;
  }
  registerExecutors() {
    const amqpService = this.app.services.get("amqp");
    this.app.api2 ??= {};
    this.app.api2.execute = async (api, body, requestConfig, ctx) => {
      if (!ctx.userId || !ctx.sessionId) {
        this.debug("execute() called without ctx.userId or ctx.sessionId");
      }
      const oid = api.split(".");
      const integrationId = oid.shift();
      const opKey = oid.join(".");
      await this.app.events.emit("pre_request_execute", [ctx, api, { body, params: requestConfig?.params ?? {} }]);
      omnilog5.log("Executing", integrationId, opKey, body, requestConfig, ctx);
      let result;
      try {
        result = await amqpService.publishAwaitable(
          "omni_tasks",
          void 0,
          Object.assign({}, { integration: { key: integrationId, operationId: opKey, block: api } }, { body }, requestConfig, {
            job_ctx: ctx
          })
        );
      } catch (e) {
        this.error("Error executing", api, e);
        result = { error: e };
      } finally {
        try {
          await this.app.events.emit("post_request_execute", [
            ctx,
            api,
            { body, params: requestConfig?.params ?? {}, result }
          ]);
        } catch (ex) {
          omnilog5.error(ex);
        }
      }
      if (result.error) {
        throw result.error;
      }
      return result;
    };
  }
  async preloadDir(registryDir, prefix) {
    if (!await this.checkDirectory(registryDir)) {
      return;
    }
    const registryFiles = await readdir(registryDir);
    this.debug(`Scanning registry folder ${registryDir}, containing ${registryFiles.length} files.`);
    if (PRELOAD_REGISTRY_IN_PARALLEL) {
      const tasks = registryFiles.map(async (file) => {
        if (file.startsWith(".")) {
          return null;
        }
        const filePath = path9.join(registryDir, file);
        const s = await stat(filePath);
        if (s.isDirectory()) {
          try {
            await this.registerFromFolder(filePath, prefix, this.app.options.refreshBlocks);
          } catch (error) {
            this.warn(`Failed to register from ${filePath}`, error);
          }
        }
      });
      await Promise.all(tasks);
    } else {
      if (registryFiles.length <= 0) {
        return;
      }
      omnilog5.status_start(`[BlockManager] Loading ${registryFiles.length} registries...`);
      for (const file of registryFiles) {
        if (file.startsWith(".")) {
          continue;
        }
        const filePath = path9.join(registryDir, file);
        const s = await stat(filePath);
        if (s.isDirectory()) {
          try {
            await this.registerFromFolder(filePath, prefix, this.app.options.refreshBlocks);
          } catch (error) {
            this.error(`Failed to preloadDir from ${filePath}. Error = ${error}. Skipping...`);
          }
        }
      }
      omnilog5.status_success("[BlockManager] Completed");
    }
  }
  // Preload APIS
  async preload() {
    const start = performance.now();
    const apisTestingPath = this.app.config.settings.paths?.apisTestingPath || "data.local/apis-testing";
    const testDir = path9.join(process.cwd(), apisTestingPath);
    await this.preloadDir(testDir, "test");
    const apisLocalPath = this.app.config.settings.paths?.apisLocalPath || "data.local/apis-local";
    const localDir = path9.join(process.cwd(), apisLocalPath);
    await this.preloadDir(localDir, "local");
    const registryDir = process.cwd() + "/extensions/omni-core-blocks/server/apis/";
    await this.preloadDir(registryDir);
    const end = performance.now();
    this.info(`BlockManager preload completed in ${(end - start).toFixed()}ms`);
  }
  async uninstallNamespace(ns, prefix = "local") {
    ns = ns.replace(/[^a-zA-Z0-9-_]/g, "");
    if (ns.length < 3) {
      throw new Error("Namespace too short");
    }
    const name = `${prefix}-${ns}`;
    if (!this.namespaces.get(name)) {
      throw new Error("Namespace " + name + "not found");
    }
    this.info(`Uninstalling namespace ${name}`);
    this._kvStorage?.runSQL(`DELETE FROM kvstore WHERE key LIKE ?`, `%:${name}%`);
  }
  async registerFromFolder(dirPath, prefix, forceRefresh = false) {
    const start = performance.now();
    const files = await readdir(dirPath);
    await Promise.all(
      files.map(async (file) => {
        if (file.endsWith(".yaml")) {
          try {
            const nsData = yaml3.load(await readFile(path9.join(dirPath, file), "utf8"));
            if (!nsData.title) {
              nsData.title = nsData.namespace;
            }
            if (prefix) {
              nsData.namespace = `${prefix}-${nsData.namespace}`;
              nsData.title = `$${nsData.title} (${prefix})`;
              nsData.prefix = prefix;
            }
            const ns = nsData.namespace;
            const url = nsData.api?.url ?? nsData.api?.spec ?? nsData.api?.json;
            if (!ns || !url) {
              this.error(`Skipping ${dirPath}\\${file} as it does not have a valid namespace or api field`);
              return;
            }
            if (this.namespaces.has(ns) && !forceRefresh) {
              this.debug("Skipping namespace " + ns + " as it's already registered");
              await Promise.resolve();
              return;
            }
            await this.addNamespace(ns, nsData, true);
            const opIds = [];
            const patches = [];
            const cDir = path9.join(dirPath, "blocks");
            if (await this.checkDirectory(cDir)) {
              const components = await readdir(cDir);
              await Promise.all(
                components.map(async (component39) => {
                  if (component39.endsWith(".yaml")) {
                    const patch = yaml3.load(await readFile(cDir + "/" + component39, "utf8"));
                    if (nsData.prefix) {
                      patch.title = `${patch.title} (${nsData.prefix})`;
                      patch.apiNamespace = `${nsData.prefix}-${patch.apiNamespace}`;
                      patch.displayNamespace = `${nsData.prefix}-${patch.displayNamespace}`;
                      patch.tags = patch.tags ?? [];
                      patch.tags.push(nsData.prefix);
                    }
                    opIds.push(patch.apiOperationId);
                    patches.push(patch);
                  }
                })
              );
            }
            this.info(`Loading ${url} as ${ns}`);
            try {
              await this.blocksFromNamespace(nsData, dirPath, opIds, patches);
              await this.processPatches(patches);
            } catch (e) {
              this.error(`Failed to process ${ns} ${url}`, e);
              throw e;
            }
          } catch (error) {
            this.warn(`Failed to register from ${path9.join(dirPath, file)}`, error);
            throw error;
          }
        }
      })
    );
    const end = performance.now();
    this.info(`BlockManager registerFromFolder from ${dirPath} in ${(end - start).toFixed()}ms`);
  }
  async loadAPISpec(currDir, api) {
    const start = performance.now();
    let parsedSchema = null;
    if (api.url != null) {
      this.info("Loading API from URL", api.url);
      let response;
      try {
        response = await fetch(api.url);
      } catch (error) {
        this.error(error);
        throw new Error(`Failed to fetch spec from ${api.url}`);
      }
      const spec = await response.text();
      try {
        if (api.url.endsWith(".yaml") || api.url.endsWith(".yml")) {
          parsedSchema = await SwaggerClient.resolve({ spec: yaml3.load(spec) });
        } else {
          parsedSchema = await SwaggerClient.resolve({ spec: JSON.parse(spec) });
        }
      } catch (error) {
        this.error(error);
        throw new Error(`Failed to resolve spec from ${api.url}`);
      }
    } else if (api.json) {
      this.info("Loading API from JSON", api.json);
      parsedSchema = await SwaggerClient.resolve({ spec: api.json });
    } else if (api.spec != null) {
      this.info("Loading API from SPEC", api.spec);
      const specPath = path9.join(currDir, api.spec);
      if (existsSync2(specPath)) {
        const spec = yaml3.load(await readFile(specPath, "utf8"));
        parsedSchema = await SwaggerClient.resolve({ spec });
      } else {
        this.error(`Spec file ${specPath} not found`);
        throw new Error(`Spec file ${specPath} not found`);
      }
    } else {
      throw new Error("No url or spec provided");
    }
    const end = performance.now();
    this.info(`loadAPISpec ${currDir} completed in ${(end - start).toFixed(1)} milliseconds`);
    return parsedSchema?.spec ?? parsedSchema;
  }
  async checkDirectory(path17) {
    try {
      await access(path17);
      return true;
    } catch {
      return false;
    }
  }
  async blocksFromNamespace(nsData, dir, filterOpIds, patches) {
    const ns = nsData.namespace;
    this.info(`Processing API ${ns}`, filterOpIds, patches?.length ?? 0);
    const specDoc = await this.loadAPISpec(dir, nsData.api ?? {});
    if (!specDoc) {
      this.error(`Error: Could not fetch OpenAPI spec for ${ns}`);
      return;
    }
    const adapter = new OpenAPIReteAdapter(ns, specDoc, nsData.api?.auth);
    const blocks2 = adapter.getReteComponentDefs(
      /* filterOpIds */
    );
    this.info("------ Adding Blocks ------");
    for (const c of blocks2) {
      const key = `${c.displayNamespace}.${c.displayOperationId}`;
      if (!this.hasBlock(key)) {
        try {
          this.addBlock(c);
          await this.app.events.emit("block_added", [{ block: c }]);
          this.verbose(`Added Block "${key}"`);
        } catch (e) {
          this.error(`Failed to add block "${key}"`, e);
          await this.app.events.emit("block_added", [{ error: e }]);
          return;
        }
      }
    }
  }
  async processPatches(patches) {
    this.info("------ Adding Patches ------");
    for (const p of patches) {
      const key = `${p.displayNamespace}.${p.displayOperationId}`;
      try {
        if (!this.blocks.has(`${p.apiNamespace}.${p.apiOperationId}`)) {
          this.warn(
            `Patch ${p.displayNamespace}.${p.displayOperationId} skipped as base block ${p.apiNamespace}.${p.apiOperationId} was not found`
          );
        } else {
          if (this.patches.has(key)) {
            this.verbose(`Patch ${key} already registered, overwriting`);
          }
          const allowOverwrite = true;
          this.addPatch(p, allowOverwrite);
        }
      } catch (e) {
        this.error(`Failed to add patch ${key}`, e);
      }
      this.info(`Adding patch ${key}`);
    }
  }
  getBlock(key) {
    return this.blocks.get(key);
  }
  async addNamespace(key, namespace, allowOverwrite) {
    if (!key)
      throw new Error("addNamespace(): key cannot be undefined");
    if (!namespace) {
      throw new Error("addNamespace(): namespace cannot be undefined");
    }
    if (this.namespaces.has(key) && !allowOverwrite) {
      throw new Error(`addNamespace(): namespace ${key} already registered`);
    }
    this.namespaces.set(key, namespace);
    await this.app.events.emit("register_namespace", namespace);
    return this;
  }
  addPatch(patch, allowOverwrite) {
    const key = `${patch.displayNamespace}.${patch.displayOperationId}`;
    if (!key)
      throw new Error("addPatch(): key cannot be undefined");
    if (!patch)
      throw new Error("addPatch(): patch cannot be undefined");
    if (this.patches.has(key) && !allowOverwrite) {
      throw new Error(`addPatch(): patch ${key} already registered`);
    }
    if (!patch.apiNamespace) {
      throw new Error(`addPatch(): patch ${key} is missing apiNamespace`);
    }
    if (!patch.apiOperationId) {
      throw new Error(`addPatch(): patch ${key} is missing apiOperationId`);
    }
    this.info("Registering patch", key);
    patch = removeUndefinedValues(patch);
    patch.hash = _BlockManager.hashObject(patch);
    this.patches.set(key, patch);
  }
  getMacro(component39, macroType) {
    let macro = component39?.macros?.[macroType];
    if (typeof macro === "string") {
      macro = this.macros.get(macro);
    }
    if (typeof macro === "function") {
      return macro.bind(component39);
    }
    return void 0;
  }
  hashObject(obj) {
    return _BlockManager.hashObject(obj);
  }
  static hashObject(obj) {
    if (obj.patch)
      delete obj.patch;
    const hashState = new MurmurHash3();
    const hash = hashState.hash(JSON.stringify(obj)).result().toString(16);
    return hash;
  }
  registerMacro(key, macro) {
    this.macros.set(key, macro);
  }
  addBlock(block7) {
    const key = `${block7.apiNamespace}.${block7.apiOperationId}`;
    if (!block7)
      throw new Error(`Block ${key} is undefined`);
    if (!block7.type)
      throw new Error(`Block ${key} is missing type`);
    if (!this.factories.has(block7.type)) {
      throw new Error(`Block ${key} has unknown type ${block7.type}` + Array.from(this.factories.keys()).toString());
    }
    if (block7.displayNamespace !== block7.apiNamespace || block7.displayOperationId !== block7.apiOperationId) {
      throw new Error(
        `addBlock(): Block ${key} has mismatched display and api namespaces, indicating it is a patch. Use addPatch() instead`
      );
    }
    this.debug("Registering block", key);
    const macros = block7.macros;
    if (macros && Object.keys(macros).length > 0) {
      for (const m in macros) {
        const macro = macros[m];
        this.verbose("Registering macro", m);
        if (typeof macro === "function") {
          const macroKey = "macro://" + m + ":" + block7.displayNamespace + "." + block7.displayOperationId;
          this.registerMacro(macroKey, macro);
          macros[m] = macroKey;
        } else if (typeof macro === "string") {
          if (!this.macros.has(macro)) {
            throw new Error(`Block ${key} has unknown macro ${m}. The Macro has to be registered before the block`);
          }
        }
      }
    }
    block7 = removeUndefinedValues(block7);
    block7.hash = _BlockManager.hashObject(block7);
    this.blocks.set(key, block7);
  }
  hasBlock(key) {
    if (!key)
      throw new Error("hasBlock(): key cannot be undefined");
    return this.blocks.has(key);
  }
  async canRunBlock(block7, userId) {
    if (!block7)
      throw new Error("canRunBlock(): block cannot be undefined");
    const credentialsService = this.app.services.get("credentials");
    if (!credentialsService) {
      throw new Error("Credentials service unavailable");
    }
    return await credentialsService.hasSecret(userId, block7.apiNamespace);
  }
  registerType(key, Factory) {
    if (!key)
      throw new Error("registerType(): key cannot be undefined");
    if (!Factory || typeof Factory !== "function") {
      throw new Error(`Factory ${key} must be a function`);
    }
    if (this.factories.has(key)) {
      throw new Error(`Block type ${key} already registered`);
    }
    this.factories.set(key, Factory);
  }
  // return a composed block. If the key responds to a patch, the patch is applied to the underlying block
  async getInstance(key, userId) {
    const patch = this.patches.get(key);
    const baseKey = patch ? `${patch.apiNamespace}.${patch.apiOperationId}` : key;
    const block7 = this.blocks.get(baseKey);
    if (!block7) {
      return void 0;
    }
    const Factory = this.factories.get(block7.type);
    const ret = Factory(block7, patch);
    if (block7.dependsOn) {
      const check = block7.dependsOn.filter((d) => !this.hasBlock(d) && !this.patches.has(d));
      if (check.length > 0) {
        ret.data.errors.push(`Missing dependencies: ${check.join(",")}`);
      }
    }
    ret.data.tags.push(patch ? "patch" : "base-api");
    const hideInputs = ret.scripts?.["hideExcept:inputs"];
    if (hideInputs?.length) {
      for (const k in ret.inputs) {
        ret.inputs[k].hidden = ret.inputs[k].hidden ?? !hideInputs.includes(k);
      }
    }
    const hideOutputs = ret.scripts?.["hideExcept:outputs"];
    if (hideOutputs?.length) {
      for (const k in ret.outputs) {
        ret.outputs[k].hidden = ret.outputs[k].hidden ?? !hideOutputs.includes(k);
      }
    }
    if (userId && !await this.canRunBlock(ret, userId)) {
      ret.data.errors.push("Block cannot run");
    }
    return ret;
  }
  async tryResolveExtensionBlock(ctx, key) {
    if (key.indexOf(":") > 0) {
      const server = this.app;
      const [extensionId, blockKey] = key.split(":");
      if (server.extensions.has(extensionId)) {
        const extension = server.extensions.get(extensionId);
        if (extension) {
          const block7 = await extension.invokeKnownMethod("resolveMissingBlock" /* resolveMissingBlock */, ctx, blockKey);
          if (block7) {
            return block7;
          } else {
            return void 0;
          }
        }
      }
    }
  }
  async getInstances(keys, userId, failBehavior = "throw") {
    if (!keys || !Array.isArray(keys)) {
      throw new Error("getInstances(keys): keys must be string[]");
    }
    const missing = [];
    const promises = keys.map(async (key) => {
      const block7 = await this.getInstance(key, userId);
      if (block7) {
        return block7;
      }
      missing.push(key);
      if (failBehavior === "throw") {
        const patch = this.patches.get(key);
        if (patch) {
          throw new Error(`Unable to compose patched block "${key}" / "${patch.apiNamespace}.${patch.apiOperationId}"`);
        }
        throw new Error(`Unable to find block "${key}"`);
      }
      if (failBehavior === "missing_block") {
        omnilog5.warn(`[getInstances] Unable to compose block "${key}"`);
        const result2 = await this.getInstance("omnitool._block_missing", userId);
        if (result2) {
          result2.data.errors.push(`Unable to compose block "${key}"`);
          result2.data._missingKey = key;
        }
        return result2;
      }
      return void 0;
    });
    let result = await Promise.all(promises);
    if (failBehavior === "filter") {
      result = result.filter((r) => r);
    }
    return { blocks: result ?? [], missing };
  }
  getAllNamespaces(opts) {
    let all = Array.from(this.namespaces.values());
    if (opts?.filter) {
      all = all.filter((n) => n.namespace === opts.filter);
    }
    return all;
  }
  orderByTitle(a, b) {
    const aKey = a?.title ?? a?.name ?? "";
    const bKey = b?.title ?? b?.name ?? "";
    const locale = "en-US-POSIX";
    return aKey.toLowerCase().localeCompare(bKey.toLowerCase(), locale);
  }
  getFilteredBlocksAndPatches(limit, cursor, keyword, opts) {
    const maxLimit = 9999;
    const filter = keyword.replace(/ /g, "").toLowerCase() ?? "";
    const blockAndPatches = this.blocksAndPatches.search(
      maxLimit,
      0,
      filter,
      opts?.contentMatch,
      opts?.tags,
      "BlocksAndPatches"
    );
    const all = [];
    if (blockAndPatches) {
      for (const item of blockAndPatches) {
        const itemFormatHeader = this.formatHeader(item[1]);
        if (itemFormatHeader.tags?.includes("base-api"))
          continue;
        all.push([item[2], itemFormatHeader]);
      }
    }
    all.sort((a, b) => this.orderByTitle(a[1], b[1]));
    return all.slice(cursor, cursor + limit);
  }
  getNamespace(key) {
    return this.namespaces.get(key);
  }
  getBlocksForNamespace(ns) {
    return Array.from(this.blocks.values()).filter((block7) => block7.apiNamespace === ns);
  }
  async getAllBlocks(includeDefinitions = true, filter) {
    const patches = Array.from(this.patches.keys());
    if (includeDefinitions) {
      let blocks3 = Array.from(this.blocks.keys());
      const patchSet = new Set(patches);
      blocks3 = blocks3.filter((key) => !patchSet.has(key));
      return [...blocks3, ...patches];
    }
    const patchInstances = (await Promise.all(patches.map(async (key) => await this.getInstance(key)))).filter(
      Boolean
    );
    const blocks2 = Array.from(this.blocks.keys()).filter(
      (key) => !patchInstances.find((p) => p.name === key)
    );
    const blockInstances = (await Promise.all(blocks2.map(async (key) => await this.getInstance(key)))).filter(
      Boolean
    );
    return [...blockInstances, ...patchInstances];
  }
  getRequiredCredentialsForBlock(key) {
    const block7 = this.blocks.get(key);
    if (!block7)
      throw new Error(`Block ${key} not found`);
    const securitySchemes = block7.security;
    if (!securitySchemes || securitySchemes.length <= 0) {
      return [];
    }
    const requiredCredentials = [];
    for (const scheme of securitySchemes) {
      scheme.requireKeys?.forEach((key2) => {
        const existing = requiredCredentials.find((k) => k.id === key2.id);
        if (!existing) {
          requiredCredentials.push(key2);
        }
      });
    }
    return Array.from(requiredCredentials);
  }
  getRequiredCredentials(namespace, includeOptional = true) {
    const securitySchemes = [];
    const components = this.getBlocksForNamespace(namespace);
    if (components != null) {
      components.forEach((component39) => {
        if (component39.security != null) {
          securitySchemes.push(...component39.security);
        }
      });
    }
    if (securitySchemes.length <= 0) {
      return [];
    }
    const requiredCredentials = [];
    for (const scheme of securitySchemes) {
      if (!includeOptional && scheme.isOptional) {
        continue;
      }
      scheme.requireKeys?.forEach((key) => {
        const existing = requiredCredentials.find((k) => k.id === key.id);
        if (!existing) {
          requiredCredentials.push(key);
        }
      });
    }
    return Array.from(requiredCredentials);
  }
  async getSecurityScheme(apiNamespace, version) {
    const securitySchemes = [];
    const components = this.getBlocksForNamespace(apiNamespace);
    if (components != null) {
      components.forEach((component39) => {
        if (component39.security != null) {
          securitySchemes.push(...component39.security);
        }
      });
    }
    return securitySchemes;
  }
  async searchSecurityScheme(apiNamespace, version, schemeType, oauthFlowType) {
    const securitySchemes = await this.getSecurityScheme(apiNamespace, version);
    const filteredSecuritySchemes = securitySchemes.filter((securityScheme) => {
      if (schemeType != null) {
        if (securityScheme.type !== schemeType) {
          return false;
        }
        if (schemeType === "oauth2" && oauthFlowType != null) {
          if (Object.hasOwnProperty.call(securityScheme.oauth, oauthFlowType)) {
            return true;
          } else {
            return false;
          }
        }
      }
      return true;
    });
    return filteredSecuritySchemes;
  }
  getAPISignature(namespace, operationId) {
    const ns = this.getNamespace(namespace);
    if (!ns) {
      throw new Error(`Namespace ${namespace} not found`);
    }
    const component39 = this.getBlock(`${namespace}.${operationId}`);
    if (!component39) {
      throw new Error(`BlockManager: Component ${operationId} not found`);
    }
    const signature = {
      method: component39.method,
      url: ns.api?.basePath + component39.urlPath,
      contentType: component39.responseContentType,
      requestContentType: component39.requestContentType,
      security: component39.security
    };
    this.debug(`getAPISignature ${namespace} ${operationId} ${JSON.stringify(signature, null, 2)}`);
    return signature;
  }
  async runBlock(ctx, blockName, args, outputs5, opts) {
    opts ??= {};
    this.info("runblock", blockName, args, outputs5, opts);
    if (!ctx.sessionId) {
      this.error("Invalid session");
      return { error: "Invalid session" };
    }
    const block7 = await this.getInstance(blockName);
    this.info(`Running block ${blockName}`);
    if (!block7) {
      this.error("Invalid block", blockName);
      return { error: "Invalid block" };
    }
    const inputs5 = {};
    for (const key in args) {
      if (args[key] !== null && args[key] !== void 0) {
        inputs5[key] = Array.isArray(args[key]) ? args[key] : [args[key]];
      }
    }
    outputs5 ??= { text: "" };
    const node = {
      id: 1,
      name: blockName,
      type: "component",
      component: blockName,
      inputs: inputs5,
      outputs: outputs5,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      data: {},
      position: [0, 0]
    };
    const workerContext = WorkerContext3.create(ctx.app, null, node, {
      ...ctx.getData()
    });
    let cKey = "";
    const ttl = (opts.cacheTTLInSeconds ? opts.cacheTTLInSeconds * 1e3 : 60 * 60 * 24 * 1e3) + Date.now();
    if (opts?.cacheType) {
      const hashState = new MurmurHash3();
      if (opts.cacheType === "session") {
        cKey = ctx.sessionId;
      } else if (opts.cacheType === "global") {
        cKey = "global";
      } else if (opts.cacheType === "user") {
        cKey = ctx.userId;
      }
      const hash = hashState.hash(JSON.stringify(inputs5)).result().toString(16);
      cKey = cKey + ":" + blockName + ":" + block7.hash + hash;
    }
    if (opts?.bustCache) {
      this.info("Busting cache for " + cKey);
      this.cache.delete(cKey);
    } else if (cKey.length && this.cache.get(cKey)) {
      this.info("Cache hit for " + cKey);
      return this.cache.get(cKey);
    }
    let result = await block7.workerStart(inputs5, workerContext);
    if (!result || result.error) {
      if (!result) {
        result = { error: "Unknown error" };
      }
      this.error("Error running block", result.error);
      return result;
    }
    if (cKey.length) {
      this.info("Cache miss for " + cKey);
      this.cache.set(cKey, result, ttl);
    }
    return result;
  }
};

// src/core/URLValidator.ts
var URLValidator = class {
  mode;
  list;
  contentType;
  app;
  constructor(server) {
    this.app = server;
    this.mode = this.app.settings.get("omni:api.fetch.policy.url.type")?.value ?? "deny_all_except";
    this.list = this.app.settings.get("omni:api.fetch.policy.url.list")?.value ?? [];
    this.contentType = this.app.settings.get("omni:api.fetch.policy.content-type")?.value ?? [];
  }
  async init() {
    this.app.events.on("blocks_reset", () => {
      this.app.settings.reset("omni:api.fetch.policy.url.type");
      this.app.settings.reset("omni:api.fetch.policy.url.list");
      this.app.settings.reset("omni:api.fetch.policy.content-type");
      this.load();
    });
    this.app.events.on("register_namespace", (namespace) => {
      if (this.mode === "deny_all_except" && namespace.api) {
        if (namespace.api.basePath) {
          const urlObj = new URL(namespace.api.basePath);
          const domain = urlObj.host;
          const urlList = this.app.settings.get("omni:api.fetch.policy.url.list")?.value;
          omnilog.debug(`\u{1F527} HttpClientService: Adding ${domain} to the list of allowed URLs`);
          if (urlList && !urlList.includes(domain)) {
            urlList.push(domain);
            this.app.settings.update("omni:api.fetch.policy.url.list", urlList);
          }
        }
      }
    });
    this.app.events.on("register_blocks", (blocks2) => {
      blocks2.forEach((block7) => {
        const contentTypeList = this.app.settings.get("omni:api.fetch.policy.content-type")?.value;
        omnilog.debug(`\u{1F527} HttpClientService: Adding ${block7.responseContentType} to the list of allowed content types`);
        if (contentTypeList && !contentTypeList.includes(block7.responseContentType)) {
          contentTypeList.push(block7.responseContentType);
          this.app.settings.update("omni:api.fetch.policy.content-type", contentTypeList);
        }
      });
    });
  }
  /**
   * Validates a URL against a list of allowed/forbidden domains
   * @param url The URL to validate
   * @returns true if the URL is allowed, false otherwise
   */
  validate(url) {
    const getDomain = (url2) => {
      const urlObj = new URL(url2);
      return urlObj.host;
    };
    omnilog.debug(`\u{1F527} URLValidator: Validating ${getDomain(url)}, ${this.mode}, ${this.isInList(getDomain(url))}`);
    if (this.mode === "deny_all_except") {
      if (this.list.length > 0) {
        if (!this.isInList(getDomain(url))) {
          omnilog.info(`\u{1F6AB} URLValidator: ${getDomain(url)} is not allowed`);
          return false;
        }
      }
    } else if (this.mode === "allow_all_except") {
      if (this.list.length > 0) {
        if (this.isInList(getDomain(url))) {
          omnilog.info(`\u{1F6AB} URLValidator: ${getDomain(url)} is not allowed`);
          return false;
        }
      }
    }
    omnilog.info(`\u{1F44D} URLValidator: ${getDomain(url)} is allowed`);
    return true;
  }
  // Check if the URL is in the list
  isInList(url) {
    if (this.list.length > 0) {
      if (this.list.includes(url)) {
        return true;
      }
    } else {
      this.load();
    }
    return this.list.includes(url);
  }
  /**
   * Validates a URL against a list of allowed/forbidden content types
   * @param contentType The content type to validate
   * @returns true if the content type is allowed, false otherwise
   */
  validateContentType(contentType) {
    if (this.contentType.length > 0) {
      if (!this.contentType.includes(contentType)) {
        omnilog.debug(`\u{1F6AB} URLValidator: ${contentType} is not allowed`);
      }
    }
    return true;
  }
  /**
   * We cache the URLs in memory to optimise API calls
   * This method reloads the URLs from the server settings.
   * Right now we load the URLs if we doesn't get a hit on the memory cache.
   *
   * TODO: Consider reloading the URLs from the server settings periodically/on every settings update
   */
  load() {
    this.mode = this.app.settings.get("omni:api.fetch.policy.url.type")?.value ?? "allow_all_except";
    this.list = this.app.settings.get("omni:api.fetch.policy.url.list")?.value ?? [];
    this.contentType = this.app.settings.get("omni:api.fetch.policy.content-type")?.value ?? [];
  }
};

// src/core/Server.ts
var MercsServer = class extends App {
  kvStorage;
  api2;
  extensions;
  _startTime = 0;
  shutdown = false;
  options;
  blocks;
  nsfwCheck = nsfwCheck;
  urlValidator;
  sdkHost;
  settings;
  constructor(id4, config2, options) {
    config2 = config2 || {};
    config2.logger ??= { level: 4 };
    super(id4, config2, { integrationsManagerType: ServerIntegrationsManager });
    this.options = options || {};
    this.api2 = {};
    this.extensions = new ServerExtensionManager(this);
    this._startTime = performance3.now();
    this.blocks = new BlockManager(this, config2.blockmanager);
    this.settings = new Settings();
    this.urlValidator = new URLValidator(this);
    this.sdkHost = {
      MarkdownEngine
    };
  }
  async stop() {
    this.kvStorage?.inc("m.server.stop.count");
    await this.extensions.stop();
    await this.blocks.stop();
    await super.stop();
    await this.kvStorage?.stop();
    return true;
  }
  get utils() {
    return { tar };
  }
  async init() {
    const self = this;
    process.on("SIGINT", async function() {
      if (self.shutdown) {
        omnilog.log("Already shutting down, patience");
        return;
      }
      self.shutdown = true;
      omnilog.log("\nSIGINT received, terminating (Ctrl+C)");
      const killProc = setTimeout(async function() {
        await self.kvStorage?.stop();
        omnilog.log("Not shut down after 5 seconds, terminating with extreme prejudice");
        process.exit();
      }, 5e3);
      await self.stop();
      clearTimeout(killProc);
      process.exit();
    });
    const config2 = this.config.kvStorage;
    if (config2) {
      this.kvStorage = new KVStorage(this, config2);
      if (!await this.kvStorage.init()) {
        throw new Error("KVStorage failed to start");
      }
      await this.kvStorage.vacuum();
    } else {
      this.warn("No KVStorage config found, server will run without persistent storage");
    }
    this.kvStorage?.inc("m.server.init.count");
    await this.urlValidator.init();
    await this.blocks.init();
    await this.extensions.init();
    this.info("Initializing NSFW.js detection model");
    await initializeModel();
    this.success("---------------------------- INIT COMPLETE ---------------------------------");
  }
  async initGlobalSettings() {
    let settingsStore = null;
    const settingStoreConfig = this.config.settings?.kvStorage;
    if (settingStoreConfig) {
      settingsStore = new KVStorage(this, settingStoreConfig);
      if (!await settingsStore.init()) {
        throw new Error("Settings KVStorage failed to start");
      }
      await settingsStore.vacuum();
    } else {
      this.warn("No settings store configured, using in-memory store");
    }
    this.settings.bindStorage(
      new StorageAdapter("settings:", settingsStore ?? /* @__PURE__ */ new Map())
    );
    const resetDB = this.options.resetDB;
    let resetSetting = false;
    if (resetDB?.split(",").includes("settings")) {
      this.info("Re-configuring server settings");
      resetSetting = true;
    }
    if (resetSetting) {
      this.settings.delete("omni:api.fetch.policy.url.type");
      this.settings.delete("omni:api.fetch.policy.url.list");
      this.settings.delete("omni:api.fetch.policy.content-type");
    }
    this.settings.add({
      key: "omni:feature.permission",
      defaultValue: true,
      value: true
    });
    const sessionSecret = randomBytes(32);
    this.settings.add({
      key: "omni:network.session.secret",
      defaultValue: sessionSecret,
      value: sessionSecret
    });
    const jwtSecret = randomBytes(32);
    this.settings.add({
      key: "omni:auth.jwt.secret",
      defaultValue: jwtSecret,
      value: jwtSecret
    });
    this.settings.add({
      key: "omni:api.oauth.google-tts.client.id",
      defaultValue: "",
      value: ""
    });
    this.settings.add({
      key: "omni:api.oauth.google-tts.client.secret",
      defaultValue: "",
      value: ""
    });
    this.settings.add({
      key: "omni:api.oauth.google-translate.client.id",
      defaultValue: "",
      value: ""
    });
    this.settings.add({
      key: "omni:api.oauth.google-translate.client.secret",
      defaultValue: "",
      value: ""
    });
    this.settings.add({
      key: "omni:api.oauth.google-play.client.id",
      defaultValue: "",
      value: ""
    });
    this.settings.add({
      key: "omni:api.oauth.google-play.client.secret",
      defaultValue: "",
      value: ""
    });
    this.settings.add({
      key: "omni:api.oauth.google-llm.client.id",
      defaultValue: "",
      value: ""
    });
    this.settings.add({
      key: "omni:api.oauth.google-llm.client.secret",
      defaultValue: "",
      value: ""
    });
    this.settings.add({
      key: "omni:api.oauth.google-vision.client.id",
      defaultValue: "",
      value: ""
    });
    this.settings.add({
      key: "omni:api.oauth.google-vision.client.secret",
      defaultValue: "",
      value: ""
    });
    this.settings.add({
      key: "omni:api.oauth.google-gmail.client.id",
      defaultValue: "",
      value: ""
    });
    this.settings.add({
      key: "omni:api.oauth.google-gmail.client.secret",
      defaultValue: "",
      value: ""
    });
    this.settings.add({
      key: "omni:api.fetch.policy.url.type",
      defaultValue: "deny_all_except",
      value: "deny_all_except"
    });
    const listenOn = new URL("http://0.0.0.0:1688");
    listenOn.hostname = this.options.listen;
    listenOn.protocol = this.options.secure ? "https" : "http";
    listenOn.port = this.options.port;
    this.settings.add({
      key: "omni:api.fetch.policy.url.list",
      defaultValue: [listenOn.host],
      value: [listenOn.host]
    });
    this.settings.add({
      key: "omni:api.fetch.policy.content-type",
      defaultValue: [],
      value: []
    });
  }
  async onLoad() {
    this.kvStorage?.inc("m.server.load.count");
    this.info("Server load completed in " + (performance3.now() - this._startTime).toFixed() + "ms");
    this.success("---------------------------- LOAD COMPLETE ---------------------------------");
    await this.emit("server_loaded", this);
    return true;
  }
  async onStart() {
    this.kvStorage?.inc("m.server.start.count");
    this.info("Server start completed in " + (performance3.now() - this._startTime).toFixed() + "ms");
    this.success("---------------------------- START COMPLETE ---------------------------------");
    return true;
  }
  async onStop() {
    this.info("Server shut down after " + ((performance3.now() - this._startTime) / (1e3 * 60)).toFixed(2) + "minutes");
    this.success("---------------------------- STOP COMPLETE ---------------------------------");
    return true;
  }
  get io() {
    return this.services.get("messaging");
  }
  get cdn() {
    return this.integrations.get("cdn");
  }
  get jobs() {
    return this.services.get("jobs");
  }
  async sendErrorToSession(session, message, type2 = "text/markdown", attachments = {}, flags) {
    flags ??= [];
    if (!flags.includes("error")) {
      flags.push("error");
    }
    await this.sendMessagesToSession(session, [{ message, type: type2 }], attachments, flags);
  }
  async sendMessageToSession(session, message, type2 = "text/markdown", attachments = {}, flags, nickname) {
    await this.sendMessagesToSession(session, [{ message, type: type2 }], attachments, flags, nickname);
  }
  async sendToastToUser(user, toast) {
    const packet = {
      type: OmniSSEMessages2.CLIENT_TOAST,
      body: { ...toast }
    };
    return this.io.sendUser(user, packet);
  }
  async sendMessagesToSession(session, messages, attachments = {}, flags = ["no-picture"], nickname = "omni", sender = "") {
    const header = { type: "chat:system", from: nickname, flags, sender };
    const body = {
      content: messages.map((m) => ({ value: m.message, type: m.type ?? "text/markdown" })),
      attachments
    };
    const packet = { ...header, body };
    await this.io.send(session, packet);
  }
};
var Server_default = MercsServer;

// src/loadConfig.ts
import { existsSync as existsSync3, readFileSync } from "fs";
import yaml4 from "js-yaml";
var loadServerConfig = (defaultFile) => {
  let defaultConfig = {};
  if (existsSync3(defaultFile)) {
    defaultConfig = yaml4.load(readFileSync(defaultFile, "utf8"));
    omnilog.info("Importing ", defaultFile, " configuration");
    return defaultConfig;
  } else {
    throw new Error("No " + defaultFile + " found at repository root");
  }
};

// src/run.ts
import { exec } from "child_process";
import os3 from "os";
import fs8 from "node:fs";
import assert3 from "node:assert";

// src/services/APIService.ts
import { APIService } from "omni-shared";
var ServerAPIHandler = class {
  _apiDefinition;
  constructor(apiDefinition) {
    this._apiDefinition = apiDefinition;
  }
  get key() {
    return this._apiDefinition.key;
  }
  get handler() {
    return this._apiDefinition.handler;
  }
  get params() {
    return this._apiDefinition.params;
  }
  get description() {
    return this._apiDefinition.description ?? "";
  }
};
var APIServerService = class extends APIService {
  _apiHandlers = /* @__PURE__ */ new Map();
  constructor(id4, manager, config2) {
    super(id4, manager, config2 || { id: id4 });
  }
  get handlers() {
    return this._apiHandlers;
  }
  register(apiDefinition) {
    this._apiHandlers.set(apiDefinition.key, new ServerAPIHandler(apiDefinition));
  }
  hasHandler(key) {
    return this._apiHandlers.has(key);
  }
};

// src/services/AmqpService.ts
import { Service } from "omni-shared";
import os from "os";
import { v4 as uuidv4 } from "uuid";

// src/services/RestConsumerService/MockMQ.ts
import Table from "cli-table3";
import Database from "better-sqlite3";
import { EventEmitter as EventEmitter2 } from "events";
import path10 from "path";
var EXCHANGE_VERSION = 1;
var migrations2 = [
  // example migrations
  {
    version: EXCHANGE_VERSION,
    queries: [
      "ALTER TABLE queue ADD COLUMN dead_letter_exchange TEXT;",
      "ALTER TABLE queue ADD COLUMN dead_letter_routing_key TEXT;",
      "ALTER TABLE queue ADD COLUMN message_ttl TEXT;",
      "ALTER TABLE messages ADD COLUMN retry_count TEXT;",
      "ALTER TABLE messages ADD COLUMN created_at TEXT;"
    ]
  }
];
var SQLite3MessageQueue = class _SQLite3MessageQueue {
  static instance;
  db;
  concurrency;
  emitter;
  interval;
  constructor(concurrency = 1, interval = 1e3 * 10, config2 = {}) {
    const dbQueuePath = config2.settings.paths?.dbQueuePath ?? "data.local/db/queue.db";
    this.db = new Database(path10.join(process.cwd(), dbQueuePath));
    this.concurrency = concurrency;
    this.emitter = new EventEmitter2();
    this.interval = interval;
    const version = this.db.prepare("PRAGMA user_version;").get().user_version || 0;
    omnilog.debug("Exchange version: " + version);
    if (version === 0) {
      this.db.exec("CREATE TABLE IF NOT EXISTS exchange (name TEXT PRIMARY KEY, type TEXT, options TEXT);");
      this.db.exec("CREATE TABLE IF NOT EXISTS queue (name TEXT PRIMARY KEY, dead_letter_exchange TEXT, dead_letter_routing_key TEXT, message_ttl INTEGER);");
      this.db.exec(`CREATE TABLE IF NOT EXISTS binding (
                      exchange TEXT,
                      queue TEXT,
                      routingKey TEXT,
                      FOREIGN KEY(exchange) REFERENCES exchange(name),
                      FOREIGN KEY(queue) REFERENCES queue(name),
                      UNIQUE(exchange, queue, routingKey) ON CONFLICT IGNORE
                    );`);
      this.db.exec(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, exchange TEXT, routingKey TEXT,
                    status TEXT DEFAULT 'sent', payload TEXT, retry_count INTEGER, created_at TIMESTAMP,
                    FOREIGN KEY(exchange) REFERENCES exchange(name));`);
      this.db.exec(`PRAGMA user_version = ${EXCHANGE_VERSION};`);
    } else {
      if (version < EXCHANGE_VERSION) {
        this.runMigrations(version);
      }
    }
    this.db.pragma("integrity_check");
    this.db.pragma("vacuum");
  }
  runMigrations(version) {
    migrations2.sort((a, b) => a.version - b.version);
    const filtered = migrations2.filter((migration) => migration.version > version);
    const transaction = this.db.transaction(() => {
      filtered.forEach((migration) => {
        omnilog.info("Migrating MQ exchange from version " + version + " to " + migration.version + "...");
        migration.queries.forEach((query) => {
          omnilog.debug("Executing queries: " + query);
          this.db.exec(query);
        });
        this.db.exec(`PRAGMA user_version = ${migration.version};`);
        omnilog.info("KVstorage migrated to version " + version);
      });
    });
    transaction();
  }
  static getInstance(config2) {
    if (!_SQLite3MessageQueue.instance) {
      _SQLite3MessageQueue.instance = new _SQLite3MessageQueue(void 0, void 0, config2);
    }
    return _SQLite3MessageQueue.instance;
  }
  async purgeQueue(queue) {
    try {
      const stmt = this.db.prepare("DELETE FROM messages;");
      stmt.run();
    } catch (error) {
      omnilog.error(error);
    }
  }
  async connect() {
    return await Promise.resolve(this);
  }
  async createChannel() {
    return await Promise.resolve(this);
  }
  async assertExchange(name, type2, options) {
    try {
      const stmt = this.db.prepare("INSERT OR IGNORE INTO exchange (name, type, options) VALUES (?, ?, ?)");
      stmt.run(name, type2, JSON.stringify(options));
    } catch (error) {
      omnilog.error(error);
    }
    await this.debugExchange(name);
    return await Promise.resolve(this);
  }
  async assertQueue(queue, options) {
    try {
      const stmt = this.db.prepare("INSERT OR IGNORE INTO queue (name, dead_letter_exchange, dead_letter_routing_key, message_ttl) VALUES (?, ?, ?, ?)");
      stmt.run(queue, options?.deadLetterExchange, options?.deadLetterRoutingKey, options?.messageTtl);
    } catch (error) {
      omnilog.error(error);
    }
    return await Promise.resolve(this);
  }
  async bindQueue(queue, exchange, routingKey) {
    try {
      const stmt = this.db.prepare("INSERT INTO binding (exchange, queue, routingKey) VALUES (?, ?, ?)");
      stmt.run(exchange, queue, routingKey);
    } catch (error) {
      omnilog.error(error);
    }
    return await Promise.resolve(this);
  }
  async publish(exchange, routingKey, content, options) {
    try {
      const createdAt = (/* @__PURE__ */ new Date()).toISOString();
      const retryCount = options?.headers?.retry_count ?? 0;
      const stmt = this.db.prepare("INSERT INTO messages (exchange, routingKey, payload, retry_count, created_at) VALUES (?, ?, ?, ?, ?)");
      const result = stmt.run(exchange, routingKey, content.toString(), retryCount, createdAt);
      const rowId = result.lastInsertRowid;
      this.emitter.emit("message");
      omnilog.info(`Published message to ${exchange} with routing key ${routingKey}`);
      const queueStmt = this.db.prepare("SELECT queue FROM binding WHERE exchange = ? AND routingKey = ?");
      const queue = queueStmt.get(exchange, routingKey);
      if (queue) {
        const queueDetailsStmt = this.db.prepare("SELECT message_ttl, dead_letter_exchange, dead_letter_routing_key FROM queue WHERE name = ?");
        const { message_ttl, dead_letter_exchange, dead_letter_routing_key } = queueDetailsStmt.get(queue.queue);
        if (message_ttl) {
          setTimeout(() => {
            if (dead_letter_exchange && dead_letter_routing_key) {
              const createdAt2 = (/* @__PURE__ */ new Date()).toISOString();
              const moveStmt = this.db.prepare("INSERT INTO messages (exchange, routingKey, payload, status, retry_count, created_at) VALUES (?, ?, ?, ?, ?, ?)");
              moveStmt.run(dead_letter_exchange, dead_letter_routing_key, content.toString(), "sent", retryCount, createdAt2);
              omnilog.info(`Message expired, moving to ${dead_letter_exchange} with routing key ${dead_letter_routing_key}`);
              const deleteStmt = this.db.prepare("DELETE FROM messages WHERE id = ?");
              deleteStmt.run(rowId);
            }
          }, message_ttl);
        }
      }
    } catch (error) {
      omnilog.error(error);
    }
  }
  async consume(queue, callback) {
    let active = 0;
    const processMessage = () => {
      if (active >= this.concurrency)
        return;
      this.db.transaction(() => {
        try {
          const getBindingStmt = this.db.prepare("SELECT * FROM binding WHERE queue = ?");
          const bindings = getBindingStmt.all(queue);
          for (const binding of bindings) {
            const stmt = this.db.prepare(`SELECT id, * FROM messages WHERE exchange = ? AND routingKey = ?
                                          AND status = 'sent' ORDER BY id LIMIT 1`);
            const row = stmt.get(binding.exchange, binding.routingKey);
            this.debugQueue(binding.routingKey);
            if (row) {
              active++;
              const msg = {
                content: Buffer.from(row.payload),
                headers: {
                  retry_count: row.retry_count
                },
                ack: () => {
                  const deleteStmt = this.db.prepare("DELETE FROM messages WHERE id = ?");
                  deleteStmt.run(row.id);
                  active--;
                  if (active < this.concurrency) {
                    processMessage();
                  }
                },
                nack: () => {
                  const deleteStmt = this.db.prepare("DELETE FROM messages WHERE id = ?");
                  deleteStmt.run(row.id);
                  active--;
                  if (active < this.concurrency) {
                    processMessage();
                  }
                }
              };
              callback(msg);
              const updateStmt = this.db.prepare("UPDATE messages SET status = 'delivered' WHERE id = ?");
              updateStmt.run(row.id);
            }
          }
        } catch (error) {
          omnilog.error(error);
        }
      })();
    };
    this.emitter.on("message", processMessage);
    let intervalId = 0;
    if (this.interval > 0) {
      intervalId = setInterval(processMessage, this.interval);
    }
    return await Promise.resolve({ consumerTag: intervalId });
  }
  async cancel(consumerTag) {
    if (consumerTag) {
      clearInterval(consumerTag);
    }
    omnilog.info("Cancelled consumer");
    return await Promise.resolve(true);
  }
  ack(message) {
    message.ack();
  }
  nack(message) {
    message.nack();
  }
  async debugExchange(exchange) {
    const exchangeStmt = this.db.prepare("SELECT * FROM exchange WHERE name = ?");
    const exchangeData = exchangeStmt.get(exchange);
    if (!exchangeData) {
      omnilog.warn(`Exchange "${exchange}" not found.`);
      return;
    }
    const bindingsStmt = this.db.prepare("SELECT queue, routingKey FROM binding WHERE exchange = ?");
    const bindings = bindingsStmt.all(exchange);
    const table = new Table({
      head: ["Exchange", "Type", "Queue", "Routing Key"]
    });
    for (const binding of bindings) {
      table.push([exchangeData.name, exchangeData.type, binding.queue, binding.routingKey]);
    }
    omnilog.debug(table.toString());
  }
  async debugQueue(queue) {
    const queueStmt = this.db.prepare(
      "SELECT COUNT(*) as count, status, created_at FROM messages WHERE routingKey = ? GROUP BY status"
    );
    const messages = queueStmt.all(queue);
    if (messages.length === 0) {
      return;
    }
    const table = new Table({
      head: ["Queue", "Status", "Count", "Created At"]
    });
    for (const message of messages) {
      table.push([queue, message.status, message.count, message.created_at]);
    }
    omnilog.debug(table.toString());
  }
};
var Connection = class extends SQLite3MessageQueue {
};
var connect = (dummy, config2) => Connection.getInstance(config2);

// src/services/AmqpService.ts
var TASK_PROTOCOL_VERSION = "aardvark";
var AmqpService = class extends Service {
  taskQueueConnection;
  taskQueueChannel;
  consumerTag;
  shardId;
  constructor(id4, manager, config2) {
    config2.endpoint = config2.endpoint?.replace("{{username}}", config2.username);
    config2.endpoint = config2.endpoint?.replace("{{password}}", config2.password);
    super(id4, manager, config2 || {});
    this.shardId = os.type + os.hostname();
  }
  // Never use this from the consumer side
  publish(exchange, routingKey, message) {
    routingKey = routingKey ?? `REST-${TASK_PROTOCOL_VERSION}.requests`;
    this.taskQueueChannel?.publish(exchange, routingKey, Buffer.from(JSON.stringify(message)));
  }
  // Never use this from the consumer side
  async publishAwaitable(exchange, routingKey, message) {
    return await new Promise((resolve, reject) => {
      const config2 = this.config;
      const taskId = uuidv4().replace(/-/g, "");
      message.taskId = taskId;
      message.shardId = this.shardId;
      routingKey = routingKey || `REST-${TASK_PROTOCOL_VERSION}.requests`;
      let fixedQueue = config2.fixedQueue;
      const integration = `${message.integration.key}.${message.integration.operationId}`;
      if (config2.pinned_consumers?.[integration]) {
        fixedQueue = config2.pinned_consumers[integration];
        this.debug("Fixed queue overriden from pinned consumers: " + fixedQueue + " for routing key: " + integration);
      }
      if (fixedQueue) {
        this.debug("Fixing queue to " + fixedQueue);
        routingKey = routingKey + (fixedQueue || "");
      }
      function stringifyWithLimit(obj, limit = 100) {
        const jsonString = JSON.stringify(obj);
        if (jsonString.length < limit) {
          return jsonString;
        }
        return jsonString.substring(0, limit) + `... Plus ${jsonString.length - limit} more bytes`;
      }
      this.info(
        "publishing message to exchange: " + exchange + " with routing key: " + routingKey + " message: " + stringifyWithLimit(message)
      );
      this.info(`subscribing to event: ${this.id}:result.${taskId} for task: ` + taskId);
      this.app.events.once(`amqp:result.${taskId}`).then((payload) => {
        this.verbose("got result for task: " + taskId);
        if (payload.result) {
          resolve(payload.result);
        } else if (payload.error) {
          this.warn("got error from the rest consumer for task" + taskId + " error: " + payload.error);
          reject(payload.error);
        } else if (!payload.result) {
          this.warn("no result, no error:", payload);
          resolve({});
        }
      });
      this.taskQueueChannel?.publish(exchange, routingKey, Buffer.from(JSON.stringify(message)));
    });
  }
  async load() {
    const config2 = this.config;
    this.taskQueueConnection = await connect(config2.endpoint, this.app.config);
    this.success("Connection to AMQP Task server established");
    this.taskQueueChannel = await this.taskQueueConnection.createChannel();
    for (const exchange of config2.exchanges || []) {
      this.verbose("asserting exchange: " + exchange.name);
      await this.taskQueueChannel.assertExchange(exchange.name, exchange.type, exchange.options);
    }
    const queueName = this.id + "-" + TASK_PROTOCOL_VERSION + "-" + this.shardId + "-queue";
    const routingKey = `RESULTS-${TASK_PROTOCOL_VERSION}.${this.shardId}`;
    await this.taskQueueChannel.assertQueue(queueName);
    await this.taskQueueChannel.bindQueue(queueName, "omni_tasks", routingKey);
    this.success("Results Queue created and bound to tasks exchange, waiting to consume messages");
    return true;
  }
  // Consume incoming messages on the results queue
  async resultsHandler(message) {
    const channel = this.taskQueueChannel;
    const self = this;
    try {
      if (!message?.content?.toString()) {
        throw new Error("Invalid message received");
      }
      const payload = JSON.parse(message.content.toString());
      if (!payload?.taskId) {
        self.error("No message payload or task id missing, discarding", payload);
        throw new Error("Invalid message payload");
      }
      self.verbose(`Received message for task ${payload.taskId}`);
      if (payload.error) {
        self.error("Task failed Failed to process message with error:", payload.error);
        await self.app.emit("amqp:result." + payload.taskId, payload);
        channel.ack(message);
      } else {
        try {
          await self.app.emit("amqp:result." + payload.taskId, payload);
          self.verbose(`Task ${payload.taskId} completed successfully`);
        } catch (error) {
          self.error(error);
        } finally {
          channel.ack(message);
        }
      }
    } catch (error) {
      self.error(`Failed to process message with error: ${error}`);
      if (message) {
        channel.ack(message);
      }
    }
    return true;
  }
  async start() {
    if (!this.taskQueueChannel) {
      throw new Error("unable to find the exchange");
    }
    await this.taskQueueChannel.purgeQueue(this.id + "-" + TASK_PROTOCOL_VERSION + "-" + this.shardId + "-queue");
    const queueName = this.id + "-" + TASK_PROTOCOL_VERSION + "-" + this.shardId + "-queue";
    this.info("Starting Queue Consumer", queueName);
    this.consumerTag = (await this.taskQueueChannel.consume(queueName, this.resultsHandler.bind(this))).consumerTag;
    return true;
  }
  async stop() {
    if (this.consumerTag) {
      this.taskQueueChannel?.cancel(this.consumerTag);
      this.consumerTag = void 0;
    }
    return true;
  }
};

// src/services/ChatService.ts
import { Service as Service3 } from "omni-shared";

// src/services/DBService.ts
import { Service as Service2 } from "omni-shared";

// src/services/DBService/DBServiceProvider.ts
var DBServiceProvider = class {
  id;
  service;
  _config;
  constructor(id4, service, config2) {
    this.id = id4;
    this.service = service;
    this._config = config2;
  }
};

// src/services/DBService/DBCouchToSQLiteQuerifier.ts
var DBCouchToSQLiteQuerifier = class _DBCouchToSQLiteQuerifier {
  static operatorMap = {
    $eq: "=",
    $ne: "!=",
    $gt: ">",
    $gte: ">=",
    $lt: "<",
    $lte: "<=",
    $in: "IN",
    $nin: "NOT IN",
    $exists: "IS NOT NULL",
    $elemMatch: "LIKE"
    // Using LIKE for $elemMatch
  };
  static translateQuery(mangoQuery) {
    let translatedQuery = "SELECT * FROM kvstore WHERE ";
    for (let field in mangoQuery.selector) {
      let operand = mangoQuery.selector[field];
      translatedQuery += _DBCouchToSQLiteQuerifier.translateCondition(field, operand);
    }
    return translatedQuery.slice(0, -5);
  }
  static translateCondition(field, operand, parentField) {
    let translatedCondition = "";
    if (Array.isArray(operand) && (field === "$or" || field === "$and")) {
      let operator = _DBCouchToSQLiteQuerifier.operatorMap[field];
      let translatedConditions = operand.map((condition) => {
        let subQuery = _DBCouchToSQLiteQuerifier.translateQuery({ selector: condition });
        return `(${subQuery.substring("SELECT * FROM kvstore WHERE ".length)})`;
      });
      translatedCondition += `(${translatedConditions.join(` ${operator} `)}) AND `;
    } else if (typeof operand === "object" && operand !== null) {
      const isOperatorObject = Object.keys(operand).some(
        (key) => _DBCouchToSQLiteQuerifier.operatorMap.hasOwnProperty(key)
      );
      if (isOperatorObject) {
        for (let operator in operand) {
          if (operator === "$exists") {
            let existsCheck = operand[operator] ? "IS NOT NULL" : "IS NULL";
            let jsonFieldPath = parentField ? `'$.${parentField}.${field}'` : `'$.${field}'`;
            translatedCondition += `json_extract(value, ${jsonFieldPath}) ${existsCheck} AND `;
          } else if (operator === "$elemMatch") {
            let translatedOperator = _DBCouchToSQLiteQuerifier.translateOperator(operator);
            let subField = Object.keys(operand[operator])[0];
            let subValue = operand[operator][subField];
            let jsonFieldPath = parentField ? `'$.${parentField}.${field}'` : `'$.${field}'`;
            translatedCondition += `json_extract(value, ${jsonFieldPath}) ${translatedOperator} '%${subValue}%' AND `;
          } else {
            let translatedOperator = _DBCouchToSQLiteQuerifier.translateOperator(operator);
            let value = typeof operand[operator] === "boolean" ? operand[operator] : `'${operand[operator]}'`;
            let jsonFieldPath = parentField ? `'$.${parentField}.${field}'` : `'$.${field}'`;
            translatedCondition += `json_extract(value, ${jsonFieldPath}) ${translatedOperator} ${value} AND `;
          }
        }
      } else {
        for (let subField in operand) {
          let fullFieldPath = parentField ? `${parentField}.${field}` : field;
          translatedCondition += _DBCouchToSQLiteQuerifier.translateCondition(
            subField,
            operand[subField],
            fullFieldPath
          );
        }
      }
    } else {
      let translatedOperator = _DBCouchToSQLiteQuerifier.translateOperator("$eq");
      let jsonFieldPath = parentField ? `'$.${parentField}.${field}'` : `'$.${field}'`;
      let value = typeof operand === "boolean" ? operand : `'${operand}'`;
      translatedCondition += `json_extract(value, ${jsonFieldPath}) ${translatedOperator} ${value} AND `;
    }
    return translatedCondition;
  }
  static translateOperator(mangoOperator) {
    let translatedOperator = _DBCouchToSQLiteQuerifier.operatorMap[mangoOperator];
    if (!translatedOperator) {
      throw new Error(`Unrecognized or unsupported operator: ${mangoOperator}`);
    }
    return translatedOperator;
  }
};

// src/services/DBService/DBSQLiteServiceProvider.ts
import { User } from "omni-shared";
var OMNI_ID = (document_type, docId) => `${document_type}:${docId}`;
var DB_MONO_DBNAME = "legacy_monolith.db";
var DBSQLiteServiceProvider = class extends DBServiceProvider {
  db;
  constructor(service, config2) {
    super(2 /* SQLite */, service, config2);
    this.db = new KVStorage(this.service.app, {
      dbPath: config2.kvStorage.dbPath,
      dbName: DB_MONO_DBNAME
    });
  }
  async getDocumentsByOwnerId(document_type, ownerIds, allowPublic, limit, skip, bookmark) {
    throw new Error("Method deprecated. Use getDocumentsByOwnerIdV2() instead.");
  }
  async getDocumentsByOwnerIdV2(document_type, ownerIds, page, limitPerPage, customFilters) {
    let baseQuery = `FROM kvstore WHERE key LIKE '${document_type}:%' AND (${ownerIds.map((id4) => `json_extract(value, '$.owner') = '${id4}'`).join(" OR ")}) `;
    if (customFilters && customFilters.size > 0) {
      baseQuery += "AND (";
      customFilters.forEach((value, key) => {
        baseQuery += `json_extract(value, '$.${key}') LIKE '%${value}%' OR `;
      });
      baseQuery = baseQuery.slice(0, -3);
      baseQuery += ") ";
    }
    let query = `SELECT * ${baseQuery}`;
    const offset = (page - 1) * limitPerPage;
    query += `LIMIT ${limitPerPage} OFFSET ${offset}`;
    const countQuery = `SELECT COUNT(*) AS total ${baseQuery}`;
    let docs = this.db.db.prepare(query).all();
    docs = docs.map((doc) => {
      return this.db._getRowValue(doc);
    });
    const totalDocsResult = this.db.db.prepare(countQuery).get();
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
  async putDocumentById(document_type, document_id, value, _rev) {
    this.db.set(OMNI_ID(document_type, document_id), value);
    return value;
  }
  async deleteDocumentById(document_type, document_id, _rev) {
    this.db.del(OMNI_ID(document_type, document_id));
  }
  async getDocumentById(document_type, document_id, ownerIds, allowPublic) {
    return this.db.get(OMNI_ID(document_type, document_id));
  }
  async createIndex(indexDefinition) {
    throw new Error("Method not implemented.");
  }
  async connect() {
    return await this.db.init();
  }
  async put(doc) {
    if (!doc.hasOwnProperty("_id")) {
      throw new Error("Legacy document must have an _id property");
    }
    const omni_id = doc["_id"];
    this.db.set(omni_id, doc);
    return doc;
  }
  async get(id4) {
    return this.db.get(id4);
  }
  async delete(doc) {
    if (!doc.hasOwnProperty("_id")) {
      throw new Error("Legacy document must have an _id property");
    }
    const omni_id = doc["_id"];
    this.db.del(omni_id);
    return true;
  }
  async deleteMany(docs) {
    throw new Error("Method not implemented.");
  }
  async list(startkey, endkey, include_docs, limit) {
    throw new Error("Method not implemented.");
  }
  async find(selector, fields, limit, skip, bookmark, use_index) {
    const query = { selector, fields, limit, skip, bookmark, use_index };
    const sql = DBCouchToSQLiteQuerifier.translateQuery(query);
    let result = this.db.db.prepare(sql).all();
    result = result.map((doc) => {
      return this.db._getRowValue(doc);
    });
    return result;
  }
  async authWithPassword(username, password) {
    throw new Error("Method not implemented.");
  }
  async authAsAdmin() {
    const query = {
      authType: "pocketbase"
    };
    const result = await this.find(query, void 0, void 0, void 0, void 0, "externalId");
    if (result && Array.isArray(result) && result.length > 0) {
      const user = User.fromJSON(result[0]);
      return user;
    }
    return void 0;
  }
  async hasTable(tablename) {
    throw new Error("Method not implemented.");
  }
  async flushLog(level, msg, tag) {
  }
};

// src/services/DBService.ts
var DBService = class extends Service2 {
  db;
  nano;
  lastAuth = 0;
  provider;
  constructor(id4, manager, config2) {
    super(id4, manager, config2 || { id: id4 });
    this.provider = new DBSQLiteServiceProvider(this, config2);
  }
  async getDocumentsByOwnerId(document_type, ownerIds, allowPublic = false, limit, skip, bookmark) {
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
  async getDocumentsByOwnerIdV2(document_type, ownerIds, page, limitPerPage, customFilters) {
    const result = await this.provider.getDocumentsByOwnerIdV2(
      document_type,
      ownerIds,
      page,
      limitPerPage,
      customFilters
    );
    return result;
  }
  async putDocumentById(document_type, document_id, value, _rev) {
    const result = await this.provider.putDocumentById(document_type, document_id, value, _rev);
    return result;
  }
  async deleteDocumentById(document_type, document_id, _rev) {
    await this.provider.deleteDocumentById(document_type, document_id, _rev);
  }
  async getDocumentById(document_type, document_id, ownerIds = [], allowPublic) {
    const result = await this.provider.getDocumentById(document_type, document_id, ownerIds, allowPublic);
    return result;
  }
  async createIndex(indexDefinition) {
    const result = await this.provider.createIndex(indexDefinition);
    return result;
  }
  async start() {
    return true;
  }
  async load() {
    const result = await this.provider.connect();
    return result;
  }
  async put(doc) {
    const result = await this.provider.put(doc);
    return result;
  }
  async get(id4) {
    const result = await this.provider.get(id4);
    return result;
  }
  async delete(doc) {
    const result = await this.provider.delete(doc);
    return result;
  }
  async deleteMany(docs) {
    const result = await this.provider.deleteMany(docs);
    return result;
  }
  async list(startkey, endkey, include_docs = false, limit) {
    const result = await this.provider.list(startkey, endkey, include_docs, limit);
    return result;
  }
  async find(selector, fields, limit, skip, bookmark, use_index) {
    const result = await this.provider.find(selector, fields, limit, skip, bookmark, use_index);
    return result;
  }
  async hasTable(tablename) {
    return await this.provider.hasTable(tablename);
  }
  async flushLog(level, msg, tag) {
    await this.provider.flushLog(level, msg, tag);
  }
};

// src/services/ChatService.ts
var ChatContext = class _ChatContext {
  _id;
  _rev;
  static MAX_LENGTH = 50;
  id;
  thread;
  constructor(contextId) {
    this.id = contextId;
    this.thread = new Array();
  }
  partialGet(length, up_to_ts) {
    const resultObj = {
      result: [],
      up_to_ts: -1
    };
    resultObj.up_to_ts = up_to_ts;
    let searchIndex = -1;
    for (let i = this.thread.length - 1; i >= 0; --i) {
      const entry = this.thread[i];
      if (entry.ts <= up_to_ts) {
        searchIndex = i;
        break;
      }
    }
    const startIndex = Math.max(0, searchIndex - length + 1);
    resultObj.result = this.thread.slice(startIndex, searchIndex + 1).map((e) => e.payload);
    return resultObj;
  }
  append(clientPayload, ts) {
    let insertAfterIndex = this.thread.length;
    for (let i = this.thread.length - 1; i >= 0; --i) {
      const entry = this.thread[i];
      if (ts > entry.ts) {
        break;
      }
      insertAfterIndex = i;
    }
    this.thread.splice(insertAfterIndex, 0, new ChatEntry(ts, clientPayload));
  }
  prune() {
    while (this.thread.length > _ChatContext.MAX_LENGTH) {
      this.thread.shift();
    }
  }
  static async fromDB(key, storage) {
    try {
      const dbDoc = await storage.get(`${"chat" /* CHAT */}:${key}`);
      if (dbDoc !== null) {
        return Object.assign(new _ChatContext(""), dbDoc);
      }
      return null;
    } catch (e) {
      omnilog.warn("Failed to load chat thread from DB ", e);
      return null;
    }
  }
  async saveToDB(key, storage) {
    return await storage.putDocumentById("chat" /* CHAT */, key, this, this._rev);
  }
  clear() {
    this.thread.length = 0;
  }
};
var ChatEntry = class {
  ts;
  payload;
  constructor(ts, payload) {
    this.ts = ts;
    this.payload = payload;
  }
};
var ChatService = class _ChatService extends Service3 {
  chatSessions;
  constructor(id4, manager, config2) {
    super(id4, manager, config2);
    this.chatSessions = /* @__PURE__ */ new Map();
  }
  static GetDBKey(userId, contextId) {
    return `${userId}:${contextId}`;
  }
  getApp() {
    return this.app;
  }
  getDB() {
    return this.app.services.get("db");
  }
  async randomSleep() {
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 100) + 100));
  }
  async writeAppend(userId, contextId, msgobj, ts) {
    let retry = 3;
    while (retry > 0) {
      try {
        const context = await this.getChatContext(userId, contextId);
        context.append(msgobj, ts);
        context.prune();
        await context.saveToDB(_ChatService.GetDBKey(userId, contextId), this.getDB());
        return;
      } catch (e) {
        if (e.statusCode === 409) {
          retry--;
          await this.randomSleep();
        } else {
          throw e;
        }
      }
    }
  }
  async clearChatHistory(userId, contextId) {
    let retry = 3;
    while (retry > 0) {
      try {
        const context = await this.getChatContext(userId, contextId);
        context.clear();
        await context.saveToDB(_ChatService.GetDBKey(userId, contextId), this.getDB());
        return true;
      } catch (e) {
        if (e.statusCode === 409) {
          retry--;
          await this.randomSleep();
        } else {
          throw e;
        }
      }
    }
    return true;
  }
  async getChatContext(userId, contextId) {
    const value = await ChatContext.fromDB(_ChatService.GetDBKey(userId, contextId), this.getDB());
    return value ?? new ChatContext(contextId);
  }
  async load() {
    return true;
  }
};

// src/services/CredentialsService/CredentialService.ts
import crypto2 from "crypto";
import { existsSync as existsSync5, readFileSync as readFileSync3, unlinkSync, writeFileSync as writeFileSync2 } from "fs";
import { ensureDirSync as ensureDirSync2 } from "fs-extra";
import yaml6 from "js-yaml";
import {
  APIKey,
  Organisation,
  Service as Service4,
  User as User2
} from "omni-shared";
import path12 from "path";
import { AuthorizationCode } from "simple-oauth2";

// src/services/CredentialsService/Store/BaseCredentialStore.ts
import { existsSync as existsSync4, writeFileSync, readFileSync as readFileSync2 } from "fs";
import { ensureDirSync } from "fs-extra";
import yaml5 from "js-yaml";
import path11 from "path";
var BaseCredentialStore = class {
};
var LocalFileCredentialStore = class extends BaseCredentialStore {
  _config;
  _vault;
  constructor(config2) {
    super();
    this._config = config2;
    this._vault = /* @__PURE__ */ new Map();
  }
  async init() {
    const keystorePath = this._config.keystore ?? this._config.settings.paths?.keystorePath ?? "./data.local/keystore";
    this.loadCredentials(path11.join(keystorePath, "vault.yaml"));
  }
  loadCredentials(file) {
    if (existsSync4(file)) {
      const credentials = yaml5.load(readFileSync2(file, "utf8"));
      omnilog.info(`Importing keystore from ${file}`);
      if (credentials) {
        for (const key in credentials) {
          if (Object.prototype.hasOwnProperty.call(credentials, key)) {
            if (!credentials[key].includes("xxxxxxxxxxxxx")) {
              this._vault.set(key, credentials[key]);
            } else {
              throw new Error(`Invalid credentials for key '${key}'`);
            }
          }
        }
      } else {
        omnilog.warn("No credentials found");
      }
    } else {
      omnilog.warn(`No ${file} file found at repository root`);
    }
  }
  getSecret(vaultKey) {
    return this._vault.get(vaultKey);
  }
  async setSecret(secret, vaultKey) {
    if (vaultKey) {
      this._vault.set(vaultKey, secret);
      this.flushToFile();
      return true;
    }
    throw new Error("Vault key is required");
  }
  deleteSecret(vaultKey) {
    this._vault.delete(vaultKey);
    try {
      this.flushToFile();
      return true;
    } catch (error) {
      omnilog.error("Error deleting ciphers:", error);
      return false;
    }
  }
  flushToFile() {
    try {
      ensureDirSync(this._config.keystore);
      debugger;
      const keystorePath = this._config.keystore ?? this._config.settings.paths?.keystorePath ?? "./data.local/keystore";
      writeFileSync(path11.join(keystorePath, `vault.yaml`), yaml5.dump(convertMapsToObjects(this._vault)));
    } catch (err) {
      omnilog.error(err);
      throw new Error("Failed to write keystore to file");
    }
  }
};

// src/services/CredentialsService/Store/KVCredentialStore.ts
var KVCredentialStore = class extends BaseCredentialStore {
  _vault;
  constructor(parent, config2) {
    super();
    this._vault = new KVStorage(parent, config2);
  }
  async init() {
    if (!await this._vault.init()) {
      throw new Error("KVStorage failed to start");
    }
    await this._vault.vacuum();
  }
  getSecret(vaultKey) {
    const json = this._vault.get(`cred.${vaultKey}`);
    if (json) {
      return json.secret;
    }
  }
  async setSecret(secret, vaultKey) {
    if (vaultKey) {
      this._vault.set(`cred.${vaultKey}`, { secret });
      return true;
    }
    throw new Error("Vault key is required");
  }
  deleteSecret(vaultKey) {
    this._vault.del(`cred.${vaultKey}`);
    return true;
  }
};

// src/services/CredentialsService/CredentialService.ts
import querystring from "querystring";
var CredentialService = class extends Service4 {
  _store;
  _encKey;
  _hmacSecret;
  // private readonly _pbLogger: PocketBaseLogger
  constructor(id4, manager, config2) {
    config2.opts ??= {};
    super(id4, manager, config2 || {});
    if (this.serviceConfig.encryption) {
      this.initKey(this.serviceConfig.encryption.keyPath);
    }
    if (this.serviceConfig.encryption?.signature) {
      this.initHmacSecret(this.serviceConfig.encryption.signature.keyPath);
    }
    this._store = config2.store ?? new KVCredentialStore(this, config2.storeConfig);
  }
  get serviceConfig() {
    return this.config;
  }
  get server() {
    return this.manager.app;
  }
  async hasSecret(userId, apiNamespace) {
    const db = this.app.services.get("db");
    if (!db) {
      throw new Error("hasSecret() failed: DB service not initialized");
    }
    const user = await db.get(`user:${userId}`);
    if (user == null) {
      this.info(`User ${userId} not found`);
      return false;
    }
    const blockManager = this.server.blocks;
    const requiredCredentials = blockManager.getRequiredCredentials(apiNamespace, false);
    const hasAllRequiredKey = requiredCredentials.reduce(async (previousPromise, tokenType) => {
      const hasAllRequiredKeySoFar = await previousPromise;
      if (!hasAllRequiredKeySoFar)
        return false;
      let apiKey = await this.getCredentialMetadata(user.id, User2.modelName, apiNamespace, tokenType.id);
      if (!apiKey) {
        this.info(`No credential found for user ${user.id} namespace ${apiNamespace} type ${tokenType.id}`);
        const orgId = user.organisation?.id;
        if (orgId) {
          apiKey = await this.getCredentialMetadata(orgId, Organisation.modelName, apiNamespace, tokenType.id);
        }
      }
      if (!apiKey) {
        this.info(
          `No credential found for org ${user.organisation?.id} namespace ${apiNamespace} type ${tokenType.id}`
        );
        apiKey = await this.getCredentialMetadata("omni", "omni", apiNamespace, tokenType.id);
      }
      return !!apiKey;
    }, Promise.resolve(true));
    return await hasAllRequiredKey;
  }
  async get(userId, apiNamespace, baseUrl, tokenType) {
    const db = this.app.services.get("db");
    if (!db) {
      throw new Error("Get credential failed: DB service not initialized");
    }
    omnilog.info(`Getting credential for user ${userId} namespace ${apiNamespace} type ${tokenType} base url host ${baseUrl}`);
    const user = await db.get(`user:${userId}`);
    if (user == null) {
      throw new Error(`User ${userId} not found`);
    }
    let apiKey = await this.getCredentialMetadata(user.id, User2.modelName, apiNamespace, tokenType);
    if (!apiKey) {
      this.info(`No credential found for user ${user.id} namespace ${apiNamespace} type ${tokenType}`);
      const orgId = user.organisation?.id;
      if (orgId) {
        apiKey = await this.getCredentialMetadata(orgId, Organisation.modelName, apiNamespace, tokenType);
      }
    }
    if (!apiKey) {
      this.info(`No credential found for org ${user.organisation?.id} namespace ${apiNamespace} type ${tokenType}`);
      apiKey = await this.getCredentialMetadata("omni", "omni", apiNamespace, tokenType);
    }
    if (apiKey) {
      const secret = await this._store.getSecret(apiKey.key);
      if (secret) {
        if (this.serviceConfig.encryption) {
          if (this._encKey) {
            const url = new URL(baseUrl);
            omnilog.debug(`Decrypting secret for ${url.host} ${this._hmacSecret ? "with signature" : ""}`);
            const decipher = decrypt(secret, this._encKey, this.serviceConfig.encryption.algorithm, this._hmacSecret ? { hmacSecret: this._hmacSecret, data: url.host } : void 0);
            if (decipher) {
              return decipher;
            }
          }
          throw new Error("Failed to decrypt secret");
        } else {
          return secret;
        }
      }
    }
    throw new Error(`No credential found for namespace ${apiNamespace} type ${tokenType}`);
  }
  async storeSecret(secret, ownerId, ownerType, apiNamespace, tokenType, secretName) {
    let cipher = secret;
    if (this.serviceConfig.encryption) {
      if (this._encKey) {
        const blockManager = this.server.blocks;
        const baseUrl = blockManager.getNamespace(apiNamespace)?.api?.basePath ?? "";
        cipher = encrypt(secret, this._encKey, this.serviceConfig.encryption.algorithm, this._hmacSecret ? { hmacSecret: this._hmacSecret, data: new URL(baseUrl).host } : void 0);
        if (!cipher) {
          throw new Error("Failed to encrypt secret");
        }
      } else {
        throw new Error("Failed to encrypt secret");
      }
    }
    const vaultKey = this.generateVaultKey(ownerId, ownerType, apiNamespace, tokenType);
    const result = await this._store.setSecret(cipher, vaultKey);
    await this.createCredentialDetails(ownerId, ownerType, apiNamespace, tokenType, vaultKey);
    await this.server.emit("credential_change", {});
    return result;
  }
  generateVaultKey(ownerId, ownerType, apiNamespace, tokenType, secretName) {
    return `${ownerType}:${ownerId}:${apiNamespace}:${tokenType}`.concat(secretName ? `:${secretName}` : "");
  }
  async setUserCredential(user, apiNamespace, tokenType, secret) {
    if (!user || !apiNamespace || !tokenType || !secret) {
      return false;
    }
    const apiKey = await this.getCredentialMetadata(user.id, User2.modelName, apiNamespace, tokenType);
    if (apiKey) {
      await this.revokeUserCredentials(user, apiNamespace, tokenType);
    }
    return await this.storeSecret(secret, user.id, User2.modelName, apiNamespace, tokenType);
  }
  async setOrgCredential(org, apiNamespace, tokenType, secret) {
    const apiKey = await this.getCredentialMetadata(org.id, Organisation.modelName, apiNamespace, tokenType);
    if (apiKey) {
      await this.revokeOrgCredentials(org, apiNamespace, tokenType);
    }
    await this.storeSecret(secret, org.id, Organisation.modelName, apiNamespace, tokenType);
  }
  async revokeOrgCredentials(org, apiNamespace, tokenType) {
    const apiKey = await this.getCredentialMetadata(org.id, Organisation.modelName, apiNamespace, tokenType);
    if (apiKey) {
      if (await this._store.deleteSecret(apiKey.key)) {
        await this.revokeCredentials(apiKey);
      }
    }
  }
  async revokeUserCredentials(user, apiNamespace, tokenType) {
    const apiKey = await this.getCredentialMetadata(user.id, User2.modelName, apiNamespace, tokenType);
    if (apiKey) {
      if (await this._store.deleteSecret(apiKey.key)) {
        await this.revokeCredentials(apiKey);
        return true;
      }
    }
    return false;
  }
  async getCredentialMetadata(ownerId, ownerType, apiNamespace, tokenType) {
    const vaultType = this.config.type;
    const query = {
      $or: [
        {
          owner: `${ownerType}:${ownerId}`,
          meta: {
            revoked: false
          },
          apiNamespace,
          variableName: tokenType,
          vaultType
        }
      ]
    };
    const dbService = this.app.services.get("db");
    const result = await dbService.find(query);
    if (result && result.length > 0) {
      return result[0];
    }
  }
  async createCredentialDetails(ownerId, ownerType, apiNamespace, variableName = "token", credentialKey) {
    const apiKey = new APIKey(generateId());
    apiKey.meta.name = apiNamespace;
    apiKey.meta.description = `User API Key for ${apiNamespace}`;
    apiKey.owner = `${ownerType}:${ownerId}`;
    apiKey.key = credentialKey;
    apiKey.vaultType = this.config.type;
    apiKey.apiNamespace = apiNamespace;
    apiKey.variableName = variableName;
    this.debug("Saving API key metadata:", JSON.stringify(apiKey, null, 2));
    const db = this.app.services.get("db");
    if (db) {
      try {
        await db.put(apiKey);
      } catch (err) {
        this.error("Error saving API key metadata:", err);
        throw new Error("Error saving API key");
      }
    }
  }
  async revokeCredentials(apiKeyDetails) {
    const dbService = this.app.services.get("db");
    if (apiKeyDetails._id) {
      const apiKeyToBeRevoked = await dbService.get(apiKeyDetails._id);
      if (apiKeyToBeRevoked) {
        apiKeyToBeRevoked.meta.revoked = true;
        await dbService.put(apiKeyToBeRevoked);
        await this.server.emit("credential_change", {});
      }
    }
  }
  async listKeyMetadata(ownerId, ownerType) {
    const db = this.app.services.get("db");
    const query = {
      $or: [
        {
          owner: `${ownerType}:${ownerId}`,
          meta: {
            revoked: false
          }
        }
      ]
    };
    const result = await db.find(query);
    return result.map((key) => {
      return {
        meta: key.meta,
        tokenType: key.variableName,
        owner: key.owner,
        apiNamespace: key.apiNamespace
      };
    });
  }
  async generateAuthUrl(user, apiNamespace) {
    const clientId = this.app.settings.get(`omni:api.oauth.${apiNamespace}.client.id`)?.value;
    const clientSecret = this.app.settings.get(`omni:api.oauth.${apiNamespace}.client.secret`)?.value;
    if (!clientId || !clientSecret) {
      throw new Error("No client credentials found");
    }
    const blockManager = this.server.blocks;
    const oauthSecuritySchemes = await blockManager.searchSecurityScheme(
      apiNamespace,
      void 0,
      "oauth2",
      "authorizationCode"
    );
    if (!oauthSecuritySchemes || oauthSecuritySchemes.length <= 0) {
      throw new Error("OAuth 2.0 security scheme not found");
    }
    const oauth2Scheme = oauthSecuritySchemes[0];
    if (!oauth2Scheme?.oauth?.authorizationCode) {
      throw new Error("No oauth2 scheme authorization code found");
    }
    const authCodeScheme = oauth2Scheme.oauth?.authorizationCode;
    if (authCodeScheme.tokenUrl == null) {
      throw new Error("No oauth2 token url found");
    }
    const scopes = /* @__PURE__ */ new Set();
    for (const securityScheme of oauthSecuritySchemes) {
      const authCodeScheme2 = securityScheme.oauth?.authorizationCode;
      if (authCodeScheme2?.scopes != null) {
        for (const scope of authCodeScheme2.scopes) {
          scopes.add(scope);
        }
      }
    }
    const opts = this.serviceConfig.oauth[apiNamespace].opts;
    const oauth2client = new AuthorizationCode({
      client: {
        id: clientId,
        secret: clientSecret
      },
      auth: {
        tokenHost: new URL(authCodeScheme.tokenUrl).origin,
        tokenPath: new URL(authCodeScheme.tokenUrl).pathname,
        refreshPath: authCodeScheme.refreshUrl ? new URL(authCodeScheme.refreshUrl).pathname : void 0,
        authorizeHost: authCodeScheme.authorizationUrl ? new URL(authCodeScheme.authorizationUrl).origin : void 0,
        authorizePath: authCodeScheme.authorizationUrl ? new URL(authCodeScheme.authorizationUrl).pathname : void 0
      }
    });
    return oauth2client.authorizeURL({
      // @ts-ignore
      redirect_uri: `${this.app.config.network.public_url}/api/v1/auth/oauth2/${apiNamespace}/callback`,
      scope: Array.from(scopes)
    }).concat(`${opts ? "&" + querystring.stringify(opts) : ""}`);
  }
  async generateAccessToken(user, apiNamespace, code, scopes) {
    const clientId = this.app.settings.get(`omni:api.oauth.${apiNamespace}.client.id`)?.value;
    const clientSecret = this.app.settings.get(`omni:api.oauth.${apiNamespace}.client.secret`)?.value;
    if (!clientId || !clientSecret) {
      throw new Error("No client credentials found");
    }
    const blockManager = this.server.blocks;
    const oauthSecuritySchemes = await blockManager.searchSecurityScheme(
      apiNamespace,
      void 0,
      "oauth2",
      "authorizationCode"
    );
    if (!oauthSecuritySchemes || oauthSecuritySchemes.length <= 0) {
      throw new Error("OAuth 2.0 security scheme not found");
    }
    const oauth2Scheme = oauthSecuritySchemes[0];
    if (!oauth2Scheme?.oauth?.authorizationCode) {
      throw new Error("No oauth2 scheme authorization code found");
    }
    const authCodeScheme = oauth2Scheme.oauth?.authorizationCode;
    if (authCodeScheme.tokenUrl == null) {
      throw new Error("No oauth2 token url found");
    }
    const oauth2client = new AuthorizationCode({
      client: {
        id: clientId,
        secret: clientSecret
      },
      auth: {
        tokenHost: new URL(authCodeScheme.tokenUrl).origin,
        tokenPath: new URL(authCodeScheme.tokenUrl).pathname,
        refreshPath: authCodeScheme.refreshUrl ? new URL(authCodeScheme.refreshUrl).pathname : void 0,
        authorizeHost: authCodeScheme.authorizationUrl ? new URL(authCodeScheme.authorizationUrl).origin : void 0,
        authorizePath: authCodeScheme.authorizationUrl ? new URL(authCodeScheme.authorizationUrl).pathname : void 0
      }
    });
    const tokenParams = {
      code,
      // @ts-ignore
      redirect_uri: `${this.app.config.network.public_url}/api/v1/auth/oauth2/${apiNamespace}/callback`,
      scope: scopes
    };
    try {
      const accessToken = await oauth2client.getToken(tokenParams);
      await this.setUserCredential(user, apiNamespace, "accessToken", JSON.stringify(accessToken));
      return true;
    } catch (err) {
      console.error("Access Token Error", err);
      throw new Error("Access Token Error");
    }
  }
  // This method will try to refresh when token is expired
  async getOAuth2AccessToken(userId, apiNamespace, url) {
    const db = this.app.services.get("db");
    if (!db) {
      throw new Error("Get credential failed: DB service not initialized");
    }
    const user = await db.get(`user:${userId}`);
    if (user == null) {
      throw new Error(`User ${userId} not found`);
    }
    const blockManager = this.server.blocks;
    const oauthSecuritySchemes = await blockManager.searchSecurityScheme(
      apiNamespace,
      void 0,
      "oauth2",
      "authorizationCode"
    );
    if (!oauthSecuritySchemes || oauthSecuritySchemes.length <= 0) {
      throw new Error("OAuth 2.0 security scheme not found");
    }
    const oauth2Scheme = oauthSecuritySchemes[0];
    if (!oauth2Scheme?.oauth?.authorizationCode) {
      throw new Error("No oauth2 scheme authorization code found");
    }
    const authCodeScheme = oauth2Scheme.oauth?.authorizationCode;
    if (authCodeScheme.tokenUrl == null) {
      throw new Error("No oauth2 token url found");
    }
    const scopes = /* @__PURE__ */ new Set();
    for (const securityScheme of oauthSecuritySchemes) {
      const authCodeScheme2 = securityScheme.oauth?.authorizationCode;
      if (authCodeScheme2?.scopes != null) {
        for (const scope of authCodeScheme2.scopes) {
          scopes.add(scope);
        }
      }
    }
    const clientId = this.app.settings.get(`omni:api.oauth.${apiNamespace}.client.id`)?.value;
    const clientSecret = this.app.settings.get(`omni:api.oauth.${apiNamespace}.client.secret`)?.value;
    if (!clientId || !clientSecret) {
      throw new Error("No client credentials found");
    }
    const oauth2client = new AuthorizationCode({
      client: {
        id: clientId,
        secret: clientSecret
      },
      auth: {
        tokenHost: new URL(authCodeScheme.tokenUrl).origin,
        tokenPath: new URL(authCodeScheme.tokenUrl).pathname,
        refreshPath: authCodeScheme.refreshUrl ? new URL(authCodeScheme.refreshUrl).pathname : void 0,
        authorizeHost: authCodeScheme.authorizationUrl ? new URL(authCodeScheme.authorizationUrl).origin : void 0,
        authorizePath: authCodeScheme.authorizationUrl ? new URL(authCodeScheme.authorizationUrl).pathname : void 0
      }
    });
    const accessTokenStr = await this.get(user.id, apiNamespace, url, "accessToken");
    const accessToken = oauth2client.createToken(JSON.parse(accessTokenStr));
    if (accessToken.expired()) {
      try {
        omnilog.debug("Refreshing token", JSON.stringify(accessToken));
        const refreshedToken = await accessToken.refresh({ scope: Array.from(scopes) });
        omnilog.debug("Refreshed token", JSON.stringify(refreshedToken));
        refreshedToken.token = {
          ...refreshedToken.token,
          refresh_token: refreshedToken.token.refresh_token ?? accessToken.token.refresh_token
        };
        await this.setUserCredential(user, apiNamespace, "accessToken", JSON.stringify(refreshedToken));
        return `${refreshedToken.token.token_type} ${refreshedToken.token.access_token}`;
      } catch (err) {
        console.error("Refresh Token Error", err);
        throw new Error("Refresh Token Error");
      }
    }
    return `${accessToken.token.token_type} ${accessToken.token.access_token}`;
  }
  // Service load fires when the service is loaded. Other services may not be available at this point
  async load() {
    this.info("credential service loading...");
    await this._store.init();
    try {
      await this.loadOmniKeystore();
    } catch (err) {
      this.error("Error loading omni keystore", err);
    }
    try {
      await this.migrateCredentials();
    } catch (err) {
      this.error("Error migrating credentials: you may need to revoke and re-add your credentials", err);
    }
    return true;
  }
  async migrateCredentials() {
    if (!this._encKey || !this._hmacSecret) {
      this.info("Encryption key or signature is not enabled, skipping migration");
      return;
    }
    const dbService = this.app.services.get("db");
    const query = {
      _id: {
        $gte: `${APIKey.modelName}:`,
        // i.e. _id.startswith(userId + ':')
        $lt: `${APIKey.modelName}:\u10FFFF`
      },
      meta: {
        revoked: false
      }
    };
    const result = await dbService.find(query);
    if (result && result.length > 0) {
      for (const apiKey of result) {
        const secret = await this._store.getSecret(apiKey.key);
        if (secret) {
          const textParts = secret.split(":");
          if (textParts.length < 3) {
            const decipher = decrypt(secret, this._encKey, this.serviceConfig.encryption.algorithm);
            if (decipher) {
              const blockManager = this.server.blocks;
              const baseUrl = blockManager.getNamespace(apiKey.apiNamespace)?.api?.basePath ?? "";
              const cipher = encrypt(decipher, this._encKey, this.serviceConfig.encryption.algorithm, { hmacSecret: this._hmacSecret, data: new URL(baseUrl).host });
              if (cipher) {
                await this._store.setSecret(cipher, apiKey.key);
              }
            }
          }
        }
      }
    }
  }
  initKey(keyPath) {
    if (!this.serviceConfig.encryption) {
      return;
    }
    if (!existsSync5(keyPath)) {
      ensureDirSync2(path12.dirname(keyPath));
      writeFileSync2(keyPath, crypto2.randomBytes(32));
    }
    this._encKey = readFileSync3(keyPath);
    if (this._encKey?.length < 32) {
      omnilog.error("Encryption key failed to init");
      process.exit(-78);
    }
  }
  initHmacSecret(hmacSecretPath) {
    if (!existsSync5(hmacSecretPath)) {
      ensureDirSync2(path12.dirname(hmacSecretPath));
      writeFileSync2(hmacSecretPath, crypto2.randomBytes(32));
    }
    this._hmacSecret = readFileSync3(hmacSecretPath);
    if (this._hmacSecret?.length < 32) {
      omnilog.error("HMAC secret key failed to init");
      process.exit(-78);
    }
  }
  async loadOmniKeystore() {
    if (existsSync5(this.serviceConfig.omniKeys)) {
      const credentials = yaml6.load(readFileSync3(this.serviceConfig.omniKeys, "utf8"));
      this.info(`Importing keystore from ${this.serviceConfig.omniKeys}`);
      if (credentials) {
        for (const ns in credentials) {
          for (const token in credentials[ns]) {
            if (!JSON.stringify(credentials[ns][token]).includes("xxxxxxxxxxxxx")) {
              const apiKeyDetails = await this.getCredentialMetadata("omni", "omni", ns, token);
              if (apiKeyDetails) {
                if (await this._store.deleteSecret(apiKeyDetails.key)) {
                  await this.revokeCredentials(apiKeyDetails);
                }
              }
              await this.storeSecret(credentials[ns][token], "omni", "omni", ns, token);
            } else {
              this.warn(`Invalid credentials for key '${ns} ${token}'`);
            }
          }
        }
      } else {
        this.info("No credentials found");
      }
      unlinkSync(this.serviceConfig.omniKeys);
    } else {
      omnilog.info(`No ${this.serviceConfig.omniKeys} file found at repository root`);
    }
  }
};

// src/services/CredentialsService/Store/VaultWardenCredentialStore.ts
import axios3 from "axios";
import { randomUUID } from "crypto";
var VaultWardenCredentialStore = class extends BaseCredentialStore {
  _accessToken;
  _config;
  constructor(config2) {
    super();
    this._config = config2;
  }
  async init() {
    await this.getAccessToken();
  }
  async getSecret(vaultKey) {
    const requestConfig = {
      headers: {
        Authorization: `Bearer ${this._accessToken}`
      }
    };
    try {
      const response = await axios3.get(`${this._config.apiUrl}/ciphers/${vaultKey}`, requestConfig);
      if (response.status === 200) {
        return JSON.parse(response.data.Data.Notes);
      } else {
        omnilog.error("Failed getting ciphers:", response.status);
        throw new Error("Failed getting ciphers");
      }
    } catch (error) {
      omnilog.error("Error getting ciphers:", error);
      throw new Error("Error getting ciphers");
    }
  }
  async setSecret(secret) {
    const requestConfig = {
      headers: {
        Authorization: `Bearer ${this._accessToken}`,
        "Content-Type": "application/json"
      }
    };
    const requestData = {
      cipher: {
        organizationId: this._config.vaultOrgId,
        type: 2,
        // 2 for Secure Note type
        name: "secret",
        notes: secret,
        secureNote: {
          type: 0
          // 0 for Generic type
        }
      },
      collectionIds: [this._config.vaultCollectionId]
    };
    try {
      const response = await axios3.post(`${this._config.apiUrl}/ciphers/create`, requestData, requestConfig);
      if (response.status === 200) {
        omnilog.info("Secure note created successfully");
        return response.data.Id;
      } else {
        omnilog.error("Failed to create secure note:", response.status);
        throw new Error("Failed to create secure note");
      }
    } catch (error) {
      omnilog.error("Error creating secure note");
      throw new Error("Error creating secure note");
    }
  }
  async deleteSecret(vaultKey) {
    const requestConfig = {
      headers: {
        Authorization: `Bearer ${this._accessToken}`
      }
    };
    try {
      omnilog.debug("Revoking cipher:", requestConfig);
      const response = await axios3.delete(`${this._config.apiUrl}/ciphers/${vaultKey}`, requestConfig);
      if (response.status === 200) {
        return true;
      } else {
        omnilog.error("Failed revoking cipher:", response.status);
        throw new Error("Failed revoking ciphers");
      }
    } catch (error) {
      omnilog.error("Error revoking ciphers", error);
      throw new Error("Error revoking ciphers");
    }
  }
  async getAccessToken() {
    try {
      omnilog.debug("Getting access token...");
      const response = await axios3.post(
        this._config.tokenUrl,
        {
          grant_type: "client_credentials",
          client_id: this._config.clientId,
          client_secret: this._config.clientSecret,
          scope: "api",
          device_type: 14,
          device_identifier: randomUUID(),
          device_name: "mercs"
        },
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          }
        }
      );
      if (response.status === 200) {
        this._accessToken = response.data.access_token;
        this.scheduleTokenRefresh(response.data.expires_in);
      } else {
        omnilog.error("Failed to get access token:", response.status);
        this._accessToken = null;
      }
    } catch (error) {
      omnilog.error("Error getting access token");
      this._accessToken = null;
    }
  }
  scheduleTokenRefresh(expiresIn) {
    const refreshTime = (expiresIn - 60) * 1e3;
    setTimeout(() => {
      omnilog.log("Refreshing access token...");
      this.getAccessToken();
    }, refreshTime);
  }
};

// src/services/FastifyServerService.ts
import fastifyCookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifySession from "@fastify/session";
import fastifyStatic from "@fastify/static";
import fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { FastifySSEPlugin } from "fastify-sse-v2";
import { Service as Service5 } from "omni-shared";
import path13 from "path";
import proxy from "@fastify/http-proxy";
import multipart from "@fastify/multipart";

// src/services/Authenticator/Authenticator.ts
import crypto3 from "crypto";
import fp from "fastify-plugin";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { EObjectAction, Group, Organisation as Organisation2, User as User3, Workflow, omnilog as omnilog6 } from "omni-shared";
var Authenticator = class {
  _db;
  _kvStorage;
  _config;
  authHandlers = {};
  constructor(db, config2) {
    omnilog6.debug("Creating Authenticator: ", db ? "db not null" : "db is null");
    this._db = db;
    this._config = config2;
  }
  get kvStorage() {
    if (!this._kvStorage) {
      throw new Error("KVStorage is not initialized");
    }
    return this._kvStorage;
  }
  async initialize() {
    const kvConfig = this._config.kvStorage;
    if (kvConfig) {
      this._kvStorage = new KVStorage(this._db.app, kvConfig);
      if (!await this._kvStorage.init()) {
        throw new Error("KVStorage failed to start");
      }
      await this._kvStorage.vacuum();
    }
    this.authHandlers = {
      local: async (request, reply) => {
        const { username, password } = request.body || {};
        try {
          const user = await this.authenticateWithUsernameAndPassword(username.toLowerCase(), password);
          return user;
        } catch (err) {
          return null;
        }
      },
      cloudflare: async (request, reply) => {
        try {
          const token = request.cookies.CF_Authorization;
          if (!token) {
            return null;
          }
          const user = await this.authenticateWithCloudFlareZeroTrustToken(token);
          return user;
        } catch (err) {
          return null;
        }
      },
      pb_admin: async (request, reply) => {
        try {
          const user = await this.authAsPocketbaseAdmin();
          return user;
        } catch (err) {
          return null;
        }
      },
      jwt: async (request, reply) => {
        try {
          const user = await this.authenticateJwt(request);
          return user;
        } catch (err) {
          omnilog6.warn("authenticateJwt failed", err);
        }
      }
    };
    return fp(async (fastify2, _options) => {
      fastify2.decorateRequest("user", null);
    });
  }
  async getUserById(userId) {
    if (userId) {
      const dbresult = await this._db.get(`user:${userId}`);
      if (dbresult) {
        const user = User3.fromJSON(dbresult);
        return user;
      }
    }
    return null;
  }
  authenticate(strategy = [], done) {
    const strategies = Array.isArray(strategy) ? strategy : [strategy];
    return async (request, reply) => {
      const user = await this.getUserById(request.session.userId);
      if (user) {
        request.user = user;
        request.user.settings.bindStorage(
          new StorageAdapter(
            `settings:${request.user.id}`,
            this._kvStorage ?? /* @__PURE__ */ new Map()
          )
        );
        request.session.touch();
        return;
      }
      omnilog6.debug("strategies", strategies.join(","));
      for (const s of strategies) {
        const handler = this.authHandlers[s];
        const user2 = await handler(request, reply);
        if (user2) {
          request.session.userId = user2.id;
          request.user = user2;
          break;
        }
      }
      if (!request.user) {
        return await reply.status(401).send("Authentication failed");
      }
      request.user.settings.bindStorage(
        new StorageAdapter(
          `settings:${request.user.id}`,
          this._kvStorage ?? /* @__PURE__ */ new Map()
        )
      );
      if (done) {
        await done(request.session.sessionId, request.user);
      }
    };
  }
  async authenticateJwt(request) {
    const token = request.headers.authorization?.split(" ")[1];
    if (!token) {
      throw new Error("Unauthorized access");
    }
    try {
      const decoded = jwt.verify(token, this._config.jwt.secret);
      const { scopes, issuerId, tokenId } = decoded;
      omnilog6.debug("scopes", scopes);
      const user = await this.getUserById(issuerId);
      if (!user) {
        throw new Error("Invalid issuer");
      }
      request.session.set("permission", scopes);
      return user;
    } catch (err) {
      omnilog6.error(err);
      throw new Error("Unauthorized access");
    }
  }
  async authAsPocketbaseAdmin() {
    omnilog6.debug("autoLogin enabled? ", this._config.autologin);
    if (!this._config.autologin) {
      omnilog6.warn("Autologin failed: not in single user mode.");
      return null;
    }
    const start = performance.now();
    let user = await this._db.provider.authAsAdmin();
    if (user) {
      const end2 = performance.now();
      omnilog6.info(`authWithAutologin in ${(end2 - start).toFixed(1)}ms`);
      return user;
    }
    user = await this.getUserByUsername(this._config.admin.username);
    if (user) {
      user = await this.authenticateWithUsernameAndPassword(this._config.admin.username, this._config.admin.password);
      if (user) {
        const end2 = performance.now();
        omnilog6.info(`authWithAutologin in ${(end2 - start).toFixed(1)}ms`);
        return user;
      }
    }
    omnilog6.debug("Creating new user");
    const org = await this.createOrg("autologin");
    const group = await this.createAdminGroup("admin", org);
    const newUser = await this.createAndAddUserToOrg(this._config.admin.username, this._config.admin.password, null, null, group, org);
    const end = performance.now();
    omnilog6.info(`authWithAutologin in ${(end - start).toFixed(1)}ms`);
    return newUser;
  }
  async authenticateWithCloudFlareZeroTrustToken(token) {
    const start = performance.now();
    const client = jwksClient({
      jwksUri: this._config.cloudflare.publicKeyUrl
    });
    return await new Promise((resolve, reject) => {
      jwt.verify(
        token,
        function(header, callback) {
          client.getSigningKey(header.kid, function(err, key) {
            if (err) {
              callback(err);
            } else {
              const signingKey = key.getPublicKey();
              callback(null, signingKey);
            }
          });
        },
        {
          audience: this._config.cloudflare.policyAud,
          algorithms: ["RS256"]
        },
        async (err, decoded) => {
          omnilog6.debug("authenticateWithCloudFlareZeroTrustToken", decoded, err);
          if (err != null) {
            omnilog6.error(err);
            const end = performance.now();
            omnilog6.info(`authenticateWithCloudFlareZeroTrustToken error in ${(end - start).toFixed(1)}ms`);
            reject(err);
          } else {
            const cloudflareUserId = decoded.sub;
            if (cloudflareUserId && typeof cloudflareUserId === "string") {
              const user = await this.getUserByExternalIdAndAuthType(cloudflareUserId, "cloudflare");
              if (user != null) {
                const end = performance.now();
                omnilog6.info(`authenticateWithCloudFlareZeroTrustToken  in ${(end - start).toFixed(1)}ms`);
                resolve(user);
              } else {
                const email = decoded.email;
                const username = email.split("@")[0];
                const org = await this.createOrg("cloudflare");
                const group = await this.createAdminGroup("admin", org);
                const newUser = await this.createAndAddUserToOrg(username, null, cloudflareUserId, "cloudflare", group, org);
                omnilog6.debug("Created user: ", newUser);
                resolve(newUser);
              }
            } else {
              resolve(null);
            }
          }
        }
      );
    });
  }
  async authenticateWithUsernameAndPassword(username, password) {
    const start = performance.now();
    const user = await this.getUserByUsername(username);
    if (user == null || !user.password || !user.salt) {
      const end2 = performance.now();
      omnilog6.info(`authenticateWithUsernameAndPassword errors in ${(end2 - start).toFixed(1)}ms`);
      throw new Error("Incorrect username or password.");
    }
    const saltBuff = Buffer.from(user.salt, "hex");
    const hashedPassword = hashPassword(password, saltBuff);
    if (!crypto3.timingSafeEqual(Buffer.from(user.password, "hex"), hashedPassword)) {
      const end2 = performance.now();
      omnilog6.info(`authenticateWithUsernameAndPassword errors in ${(end2 - start).toFixed(1)}ms`);
      throw new Error("Incorrect username or password.");
    }
    const end = performance.now();
    omnilog6.info(`authenticateWithUsernameAndPassword in ${(end - start).toFixed(1)}ms`);
    return user;
  }
  async getUserByExternalIdAndAuthType(externalId, authType) {
    const start = performance.now();
    try {
      const query = {
        externalId,
        authType
      };
      const result = await this._db.find(query, void 0, void 0, void 0, void 0, "externalId");
      if (result && result.length > 0) {
        const user = User3.fromJSON(result[0]);
        const end2 = performance.now();
        omnilog6.info(`getUserByExternalIdAndAuthType in ${(end2 - start).toFixed(1)}ms`);
        return user;
      }
      const end = performance.now();
      omnilog6.info(`getUserByExternalIdAndAuthType empty in ${(end - start).toFixed(1)}ms`);
      return null;
    } catch (err) {
      const end = performance.now();
      omnilog6.info(`getUserByExternalIdAndAuthType error in ${(end - start).toFixed(1)}ms`);
      return null;
    }
  }
  async createOrg(name) {
    const newOrg = new Organisation2(generateId(), name);
    newOrg.createdAt = Math.floor(Date.now() / 1e3);
    newOrg.lastUpdated = Math.floor(Date.now() / 1e3);
    return await this._db.put(newOrg);
  }
  async createAdminGroup(name, org) {
    const newGroup = new Group(generateId(), name);
    newGroup.createdAt = Math.floor(Date.now() / 1e3);
    newGroup.lastUpdated = Math.floor(Date.now() / 1e3);
    newGroup.organisation = { id: org.id, name: org.name };
    newGroup.permission = [
      // Admin rights: r/w users from the same org
      {
        subject: User3.modelName,
        action: [EObjectAction.CREATE, EObjectAction.READ, EObjectAction.UPDATE, EObjectAction.DELETE],
        conditions: [{ organisation: { id: org.id } }]
      },
      // Admin rights: r/w groups from the same org
      {
        subject: Group.modelName,
        action: [EObjectAction.CREATE, EObjectAction.READ, EObjectAction.UPDATE, EObjectAction.DELETE],
        conditions: [{ organisation: { id: org.id } }]
      },
      // Admin rights: r/w/x workflows of the same org
      {
        subject: Workflow.modelName,
        action: [
          EObjectAction.CREATE,
          EObjectAction.READ,
          EObjectAction.UPDATE,
          EObjectAction.DELETE,
          EObjectAction.EXECUTE
        ],
        conditions: [{ org: { id: org.id } }]
      }
    ];
    return await this._db.put(newGroup);
  }
  async createAndAddUserToOrg(username, password, externalId, authType, group, org) {
    const salt = crypto3.randomBytes(16);
    const newUser = new User3(generateId(), username.toLowerCase());
    newUser.organisation = { id: org.id, name: org.name };
    newUser.password = password ? hashPassword(password, salt).toString("hex") : null;
    newUser.salt = salt.toString("hex");
    newUser.createdAt = Math.floor(Date.now() / 1e3);
    newUser.lastUpdated = Math.floor(Date.now() / 1e3);
    newUser.externalId = externalId;
    newUser.authType = authType;
    await this._db.put(newUser);
    if (!Array.isArray(group)) {
      if (group.name.toLowerCase() === "admin") {
        newUser.tags.push("admin");
      }
      group.members.push({ id: newUser.id, name: newUser.username });
      await this._db.put(group);
    } else {
      for (const g of group) {
        if (g.name.toLowerCase() === "admin") {
          newUser.tags.push("admin");
        }
        g.members.push({ id: newUser.id, name: newUser.username });
        await this._db.put(g);
      }
    }
    org.members.push({ id: newUser.id, name: newUser.username });
    await this._db.put(org);
    return newUser;
  }
  async getUserByUsername(username) {
    try {
      const query = {
        username,
        password: { $exists: true }
      };
      const result = await this._db.find(query, void 0, void 0, void 0, void 0, "username");
      if (result && result.length > 0) {
        const user = User3.fromJSON(result[0]);
        return user;
      }
      return null;
    } catch (err) {
      return null;
    }
  }
};

// src/services/Session/CustomMemoryStore.ts
import { MemoryStore } from "@fastify/session";
var CustomMemoryStore = class extends MemoryStore {
  sessions;
  expirationCallbacks;
  onExpiration;
  onDestroy;
  constructor(onExpiration, onDestroy) {
    super();
    this.expirationCallbacks = /* @__PURE__ */ new Map();
    this.onExpiration = onExpiration;
    this.onDestroy = onDestroy;
    if (onDestroy == null)
      this.onDestroy = onExpiration;
    this.sessions = /* @__PURE__ */ new Map();
  }
  async get(sid, callback) {
    const session = this.sessions.get(sid);
    callback(void 0, session);
  }
  set(sid, session, callback) {
    const ttl = this.getTTL(session);
    const expiresAt = Date.now() + ttl;
    const timer = setTimeout(() => {
      if (this.onExpiration != null)
        this.onExpiration(sid, session.get("userId"));
      this.expirationCallbacks.delete(sid);
    }, ttl);
    this.expirationCallbacks.set(sid, timer);
    this.sessions.set(sid, session);
    callback();
  }
  // Override the destroy method to clear the expiration callback
  destroy(sid, callback) {
    const timer = this.expirationCallbacks.get(sid);
    if (timer != null) {
      clearTimeout(timer);
      this.expirationCallbacks.delete(sid);
    }
    const session = this.sessions.get(sid);
    const userId = session?.userId;
    if (this.onDestroy != null)
      this.onDestroy(sid, userId);
    this.sessions.delete(sid);
    callback();
  }
  // Method to calculate the TTL based on session.maxAge or default maxAge
  getTTL(session) {
    if (session && session.cookie && session.cookie.maxAge) {
      return session.cookie.maxAge;
    }
    return 30 * 24 * 60 * 60 * 1e3;
  }
  // Invalidate all sessions
  invalidateAll(callback) {
    for (const timer of this.expirationCallbacks.values()) {
      clearTimeout(timer);
    }
    this.expirationCallbacks.clear();
    for (const sid of this.sessions.keys()) {
      const session = this.sessions.get(sid);
      session.destroy();
    }
    callback();
  }
};

// src/services/Session/KVSessionStore.ts
var KVSessionStore = class {
  _kvStorage;
  expirationCallbacks;
  onExpiration;
  onDestroy;
  constructor(kvStorage, onExpiration, onDestroy) {
    this.expirationCallbacks = /* @__PURE__ */ new Map();
    this.onExpiration = onExpiration;
    this.onDestroy = onDestroy;
    if (onDestroy == null)
      this.onDestroy = onExpiration;
    this._kvStorage = kvStorage;
  }
  async get(sid, callback) {
    const session = this._kvStorage.get(sid);
    callback(void 0, session);
  }
  set(sid, session, callback) {
    const ttl = this.getTTL(session);
    const expiresAt = Date.now() + ttl;
    const timer = setTimeout(() => {
      if (this.onExpiration != null)
        this.onExpiration(sid, session.get("userId"));
      this.expirationCallbacks.delete(sid);
    }, ttl);
    this.expirationCallbacks.set(sid, timer);
    this._kvStorage.set(sid, session);
    callback();
  }
  // Override the destroy method to clear the expiration callback
  destroy(sid, callback) {
    const timer = this.expirationCallbacks.get(sid);
    if (timer != null) {
      clearTimeout(timer);
      this.expirationCallbacks.delete(sid);
    }
    const session = this._kvStorage.get(sid);
    const userId = session?.userId;
    if (this.onDestroy != null)
      this.onDestroy(sid, userId);
    this._kvStorage.del(sid);
    callback();
  }
  // Method to calculate the TTL based on session.maxAge or default maxAge
  getTTL(session) {
    if (session && session.cookie && session.cookie.maxAge) {
      return session.cookie.maxAge;
    }
    return 30 * 24 * 60 * 60 * 1e3;
  }
};

// src/services/FastifyServerService.ts
import fs6 from "node:fs";
var FastifyServerService = class extends Service5 {
  fastifyInstance;
  authenticator;
  _kvStorage;
  constructor(id4, manager, config2) {
    config2.opts ??= {};
    config2.listen ??= { host: "0.0.0.0", port: 3e3 };
    config2.cors ??= { origin: true, credentials: false };
    config2.session ??= {
      secret: "secret that is more than 32 characters",
      cookie: { secure: false, httpOnly: false, maxAge: 1e3 * 60 * 30 }
    };
    super(id4, manager, config2 || {});
  }
  // -----------------------------------------------------------------------------------------------
  // addRoute
  //
  //  Purpose:
  //    Adds an api route to the fastify service with the specificed method and handler function
  //
  //    Optionally supports schema and websocket support.
  //
  //    See https://www.fastify.io/docs/latest/Reference/Routes/
  // -----------------------------------------------------------------------------------------------
  async addRoute({ url, method, handler, insecure, authStrategy, schema, websocket, config: config2 }) {
    method ??= "GET";
    schema ??= null;
    const preValidation = insecure ? void 0 : this.authenticator?.authenticate(authStrategy, async (sessionId, user) => {
      await this.emitGlobalEvent("session_created", [sessionId, user]);
    });
    if (websocket === true) {
      this.warn("addRoute (websocket) is half baked and untested.");
      this.fastifyInstance.get(url, { websocket: true }, handler);
      this.verbose("api route added", method, url, handler, "(websocket enabled)");
    } else {
      this.fastifyInstance.route({ url, method, preValidation, handler, schema, config: config2 });
      this.debug("api route added", method, url, insecure, preValidation, authStrategy, handler);
    }
  }
  get serviceConfig() {
    return this.config;
  }
  async create() {
    this.verbose(`service ${this.id} creating...`);
    this.fastifyInstance = fastify(this.config.opts);
    this.registerCORSHandler();
    this.registerRateLimiter();
    const kvStoreConfig = this.config.session.kvStorage;
    if (kvStoreConfig != null) {
      this._kvStorage = new KVStorage(this, kvStoreConfig);
      if (!await this._kvStorage.init()) {
        throw new Error("KVStorage failed to start");
      }
      await this._kvStorage.vacuum();
    }
    let sessionStore;
    if (this._kvStorage != null) {
      sessionStore = new KVSessionStore(this._kvStorage, async (sid, userId) => {
        await this.emitGlobalEvent("session_expired", [sid, userId]);
      });
    } else {
      sessionStore = new CustomMemoryStore(async (sid, userId) => {
        await this.emitGlobalEvent("session_destroyed", [sid, userId]);
      });
    }
    this.fastifyInstance.addHook("onSend", (request, reply, payload, next) => {
      reply.header("X-Frame-Options", "SAMEORIGIN");
      reply.header("Cross-Origin-Opener-Policy", "same-origin");
      reply.header("Cross-Origin-Embedder-Policy", "credentialless");
      next();
    });
    this.fastifyInstance.register(fastifyCookie);
    this.fastifyInstance.register(fastifySession, {
      store: sessionStore,
      secret: this.app.settings.get("omni:network.session.secret")?.value,
      // secret: this.serviceConfig.session.secret,
      cookieName: "sessionId",
      cookie: {
        secure: this.config.session.cookie.secure,
        httpOnly: this.config.session.cookie.httpOnly,
        maxAge: this.config.session.cookie.maxAge,
        sameSite: this.config.session.cookie.sameSite ?? "Lax"
      }
    });
    const db = this.app.services.get("db");
    this.authenticator = new Authenticator(db, {
      //@ts-ignore
      jwt: {
        secret: this.app.settings.get("omni:auth.jwt.secret")?.value || ""
      },
      //@ts-ignore
      discord: this.app.config.integrations?.auth?.discord,
      //@ts-ignore
      cloudflare: this.app.config.integrations?.auth?.cloudflare,
      autologin: this.serviceConfig.autologin,
      admin: this.serviceConfig.admin,
      //@ts-ignore
      kvStorage: this.app.config.integrations?.auth?.kvStorage
    });
    this.fastifyInstance.register(this.authenticator.initialize());
    this.subscribeToGlobalEvent("registerAPI", this.addRoute.bind(this));
    this.debug(`service ${this.id} created`);
    return true;
  }
  registerRateLimiter() {
    const fastifyConfig = this.config;
    this.fastifyInstance.register(rateLimit, {
      global: fastifyConfig.rateLimit.global,
      max: fastifyConfig.rateLimit.max,
      timeWindow: fastifyConfig.rateLimit.timeWindow,
      onExceeding: (req, key) => {
        this.error(`Rate limit exceeded for ${req.ip} on ${req.url} with key ${key}`);
      }
    });
  }
  registerCORSHandler() {
    const fastifyConfig = this.config;
    switch (fastifyConfig.listen.host) {
      case "127.0.0.1":
        break;
      default:
        if (fastifyConfig.cors.origin === true) {
          this.warn(
            "Fastify configuration: CORS origin is set to true, this is not recommended for production use as it creates security risks."
          );
        }
        this.fastifyInstance.register(cors, {
          origin: fastifyConfig.cors.origin,
          credentials: fastifyConfig.cors.credentials
        });
        break;
    }
  }
  resolveOmniWebPath() {
    const maybeWebExtensionPath = path13.join(process.cwd(), "extensions", "omni-core-web", "public");
    if (fs6.existsSync(maybeWebExtensionPath)) {
      return maybeWebExtensionPath;
    }
    return path13.join(process.cwd(), "public/");
  }
  registerStaticHandler() {
    const config2 = this.config;
    if (config2.proxy.enabled) {
      this.fastifyInstance.register(proxy, {
        upstream: config2.proxy.viteDebugger,
        http: true,
        websocket: true
      });
      this.fastifyInstance.register(proxy, {
        upstream: "http://127.0.0.1:8090/",
        http: true,
        prefix: "/db/",
        websocket: true,
        preValidation: async (request, reply) => {
          const user = request.user;
          const auth = this.app.integrations.get("auth");
          if (!await auth.isAdmin(user)) {
            return reply.code(403).send({ message: "Not admin" });
          }
        }
      });
    } else {
      const omniWebPath = this.resolveOmniWebPath();
      this.info(`${this.id} static path ${omniWebPath}`);
      this.fastifyInstance.register(fastifyStatic, {
        root: omniWebPath,
        prefix: "/"
        // optional: default '/'
      });
    }
    this.fastifyInstance.get("/version", async (request, reply) => {
      reply.send(this.app.version);
    });
  }
  async load() {
    const service = this;
    this.debug(`service ${this.id} loading...`);
    this.fastifyInstance.register(multipart);
    this.registerStaticHandler();
    await this.emit("onRegisterStatics", { fastifyInstance: this.fastifyInstance, fastifyStatic });
    this.fastifyInstance.register(FastifySSEPlugin);
    this.fastifyInstance.setErrorHandler(function(error, _request, reply) {
      omnilog.trace(error);
      service.error(error);
      reply.status(500).send({ ok: false });
    });
    await this.emit("registerMiddleware", [this.fastifyInstance, this]);
    this.success(`service ${this.id} loaded`);
    return true;
  }
  async start() {
    this.debug(`service ${this.id} starting...`);
    await this.fastifyInstance.listen(this.config.listen);
    this.success(`service ${this.id} started`);
    return true;
  }
  async stop() {
    this.debug(`service ${this.id} stopping...`);
    await this.fastifyInstance.close();
    this.success(`service ${this.id} stopped.`);
    return true;
  }
};

// src/services/HttpClientService.ts
import axios4 from "axios";
import { Service as Service6 } from "omni-shared";
var HTTP_CODES = {
  400: {
    message: "[400] The server is having trouble processing your request due to invalid input. Please review your information and submit it again.",
    retryable: false
  },
  401: {
    message: "[401] Authentication failed. Please check your credentials.",
    retryable: false
  },
  403: {
    message: "[403] You are not authorized to perform this action.",
    retryable: false
  },
  404: {
    message: "[404] The requested resource was not found.",
    retryable: false
  },
  408: {
    message: "[408] The server timed out waiting for the request.",
    retryable: true
  },
  409: {
    message: "[409] The server is having trouble processing your request due to a conflict. Please review your information and submit it again.",
    retryable: false
  },
  410: {
    message: "[410] The requested resource is no longer available.",
    retryable: false
  },
  422: {
    message: "[422] The server is having trouble processing your request due to invalid input. Please review your information and submit it again.",
    retryable: false
  },
  429: {
    message: "[429] The server is having trouble processing your request due to too many requests. Please try again later.",
    retryable: true
  },
  500: {
    message: "[500] The server encountered an internal error. Please try again later.",
    retryable: true
  },
  501: {
    message: "[501] The server does not support the requested feature.",
    retryable: false
  },
  502: {
    message: "[502] The server encountered an internal error. Please try again later.",
    retryable: true
  },
  503: {
    message: "[503] The server is currently unavailable. Please try again later.",
    retryable: true
  },
  504: {
    message: "[504] The server timed out waiting for the request.",
    retryable: true
  }
};
var HTTPClientError = class extends Error {
  retryable;
  originalError;
  constructor(message, retryable, originalError) {
    super(message);
    this.retryable = retryable;
    this.originalError = originalError;
  }
};
var HttpClientService = class extends Service6 {
  axios;
  constructor(id4, manager, config2) {
    super(id4, manager, config2 || {});
    this.axios = axios4.create();
  }
  async request(config2, userId) {
    if (this.app.urlValidator) {
      if (!this.app.urlValidator.validate(config2.url)) {
        if (userId) {
          await this.app.sendToastToUser(userId, { message: `URL ${config2.url} is blocked. Please check your server configuration`, options: { type: "error" } });
        }
        throw new Error(`URL ${config2.url} is blocked. Please check your server configuration`);
      }
    }
    try {
      const response = await this.axios.request(config2);
      if (this.app.urlValidator) {
        if (!this.app.urlValidator.validateContentType(response.headers["content-type"])) {
          throw new Error(`Content-Type ${response.headers["content-type"]} is not allowed`);
        }
      }
      return response;
    } catch (err) {
      if (err.code === "ENOTFOUND" && err.syscall === "getaddrinfo") {
        err.message = `Failed to resolve host "${err.hostname}". Please check your network settings.`;
      }
      const errorCode = err.response ? err.response.status : err.code;
      const error = HTTP_CODES[errorCode];
      if (error) {
        err.message = error.message;
        throw new HTTPClientError(error.message, error.retryable, err);
      } else {
        throw new HTTPClientError(err.message, false, err);
      }
    }
  }
  sanitizeHeader(header) {
    const newHeader = JSON.parse(JSON.stringify(header));
    if (newHeader.Authorization) {
      newHeader.Authorization = "<REDACTED>";
    }
    return newHeader;
  }
  async load() {
    return true;
  }
};

// src/services/JobController/JobControllerService.ts
import { Service as Service7 } from "omni-shared";

// src/services/JobController/WorkflowJob.ts
import { v4 as uuidv42 } from "uuid";
import * as Rete from "rete";
var WorkflowJob = class {
  id;
  engine;
  artifacts = {};
  _state = "ready" /* READY */;
  _activeNode = [];
  ctx;
  startNode = 0;
  data = {};
  snapshot = {};
  controller;
  runningNodes = 0;
  errors = [];
  constructor(controller, rete, ctx, startNode = 0) {
    this.id = uuidv42();
    this.controller = controller;
    this.engine = new Rete.Engine("mercs@0.1.0");
    this.data = JSON.parse(JSON.stringify(rete));
    ctx.setJobId(this.id);
    this.startNode = startNode;
    this.ctx = ctx;
    this.snapshot = this.engine.copy(this.data);
    this.ctx.engine = this.engine;
  }
  set artifactsValue(value) {
    this.artifacts = value;
  }
  get artifactsValue() {
    return this.artifacts;
  }
  get context() {
    return this.ctx;
  }
  get workflowId() {
    return this.ctx.workflowId;
  }
  get state() {
    return this._state;
  }
  set state(value) {
    if (value === this._state) {
      return;
    }
    this.controller.debug(`Job ${this.id} state change from '${this._state}' to '${value}'`);
    this._state = value;
    this.updateRemote();
  }
  get rete() {
    return this.data.rete;
  }
  addActiveNode(nodeId) {
    const hackUpdateClient = true;
    if (hackUpdateClient) {
      this._activeNode.unshift(nodeId);
    } else {
      this._activeNode.push(nodeId);
    }
    this.updateRemote();
  }
  removeActiveNode(nodeId) {
    this._activeNode = this._activeNode.filter((n) => n !== nodeId);
    this.updateRemote();
  }
  updateRemote(headerText = "job:update") {
    const header = {
      type: headerText
    };
    const meta = {
      name: this?.data?.meta?.name ?? "Recipe"
    };
    const body = {
      jobId: this.id,
      state: this.state,
      activeNode: this._activeNode,
      activeNodeName: this.data.rete?.nodes[this._activeNode[0]]?.name,
      workflowId: this.ctx?.workflowId,
      meta,
      errors: this.errors
    };
    this.controller.emitGlobalEvent("sse_user_message", [this.ctx?.userId, header, body]);
  }
  nodeNameForId(nodeId) {
    return this.data.rete.nodes[nodeId].name;
  }
  addError(nodeId, message, details) {
    const nodeName = this.nodeNameForId(nodeId);
    this.errors.push({ nodeId, nodeName, message, details });
    this.updateRemote("job:error");
  }
  start() {
    this.state = "running" /* RUNNING */;
  }
  finish() {
    if (this.state === "forceStop" /* FORCESTOP */) {
      this.state = "stopped" /* STOPPED */;
      return;
    }
    if (this.state === "error" /* ERROR */) {
      return;
    }
    this.state = this.errors.length > 0 ? "error" /* ERROR */ : "success" /* SUCCESS */;
  }
  forceStop() {
    if (this.state === "success" /* SUCCESS */ || this.state === "error" /* ERROR */ || this.state === "stopped" /* STOPPED */) {
      return false;
    }
    this.state = "forceStop" /* FORCESTOP */;
    return true;
  }
  toJSON(details) {
    details ??= { rete: false };
    const ret = {
      id: this.id,
      state: this.state,
      user: this.ctx?.userId
    };
    if (details.rete) {
      ret.rete = this.data;
    }
    return ret;
  }
};

// src/services/JobController/JobControllerService.ts
import { WorkerContext as WorkerContext4, JobContext } from "omni-sockets";
function topologicalSort(nodes) {
  const visited = /* @__PURE__ */ new Set();
  const stack = [];
  let computable = true;
  function depthFirstSearch(vertex) {
    if (visited.has(vertex)) {
      return stack.findIndex((x) => x === vertex) >= 0;
    }
    visited.add(vertex);
    const node = nodes[vertex];
    for (const inputKey of Object.keys(node.inputs)) {
      const inputConns = node.inputs[inputKey].connections;
      for (const i in inputConns) {
        const inputNodeProto = inputConns[i];
        if (inputNodeProto) {
          if (!depthFirstSearch(inputNodeProto.node)) {
            computable = false;
            node.runState = "deadLock";
          }
        }
      }
    }
    stack.push(vertex);
    return true;
  }
  for (const key in nodes) {
    depthFirstSearch(nodes[key].id);
  }
  return { searchOrder: stack, computable };
}
var JobControllerService = class extends Service7 {
  jobs = /* @__PURE__ */ new Map();
  kvStorage;
  constructor(id4, manager, config2) {
    super(id4, manager, config2 || { id: id4 });
  }
  getApp() {
    return this.app;
  }
  async load() {
    const config2 = this.config.kvStorage;
    if (config2) {
      this.kvStorage = new KVStorage(this, config2);
      if (!await this.kvStorage.init()) {
        throw new Error("KVStorage failed to start");
      }
      await this.kvStorage.vacuum();
    } else {
      this.warn("No KVStorage config found, server will run without persistent storage");
    }
  }
  async start() {
    return true;
  }
  async stop() {
    this.kvStorage?.stop();
    return true;
  }
  stopJob(jobId) {
    let result = 0;
    this.jobs.forEach((job, id4) => {
      if (jobId && jobId !== id4) {
        return;
      }
      if (job.forceStop()) {
        result++;
      }
    });
    return result;
  }
  async skipNode(node) {
    node.runState = "skipped";
    node.outputDataInstance = {};
  }
  simplifyErrors(nodeError) {
    for (let i = 0; i < 3; i++) {
      nodeError = nodeError?.error || nodeError;
      nodeError = nodeError?.message || nodeError;
      try {
        nodeError = JSON.parse(nodeError);
      } catch {
      }
    }
    if (typeof nodeError !== "string") {
      nodeError = JSON.stringify(nodeError);
    }
    return nodeError;
  }
  async _runBlockInParallel(job, node, component39, inputData, key) {
    await this.emit("job_worker_start", [job, node, component39, inputData, job.context.workflowId]);
    await this.app.emit("sse_message", {
      type: "job_state",
      event: "node_started",
      args: { node_id: node.id, job_id: job.id },
      sessionId: job.context.sessionId,
      userId: job.context.userId,
      workflowId: job.context.workflowId
    });
    const workerContext = WorkerContext4.create(
      this.app,
      job.engine,
      {
        id: node.id,
        data: node.data,
        inputs: inputData,
        outputs: {}
      },
      {
        sessionId: job.context.sessionId,
        userId: job.context.userId,
        jobId: job.id,
        workflowId: job.context.workflowId,
        args: job.context.args,
        flags: job.context.flags
      }
    );
    await component39.workerStart(inputData, workerContext);
    node.outputDataInstance = workerContext.outputs;
    node.runState = "finished";
    await this.emit("job_worker_result", [job, node, component39, node.outputDataInstance]);
    this.info("Worker result", job.id, node.id, component39.name, Object.keys(node.outputDataInstance || {}));
    await this.app.emit("sse_message", {
      type: "job_state",
      event: "node_finished",
      args: { node_id: node.id, job_id: job.id },
      sessionId: job.context.sessionId,
      userId: job.context.userId
    });
    let nodeError = node.outputDataInstance?.error;
    if (nodeError) {
      if (global.DebugOnNodeReturn) {
        debugger;
      }
      nodeError = this.simplifyErrors(nodeError);
      throw new Error(nodeError);
    }
  }
  async runBlockInParallel(job, node, component39, inputData, key) {
    node.runState = "running";
    job.addActiveNode(node.id);
    try {
      await this._runBlockInParallel(job, node, component39, inputData, key);
    } catch (e) {
      node.runState = "error";
      job.engine.trigger("warn", e);
      job.addError(key, `${e.message}`, e);
      job.state = "error" /* ERROR */;
      omnilog.error("Error running node", e);
    }
    job.removeActiveNode(node.id);
  }
  async advanceRecipe(job) {
    if (!job) {
      omnilog.log("Recipe has already completed, stale result");
      return;
    }
    const nodes = job.rete?.nodes ?? [];
    const n = Object.keys(nodes).length;
    const { searchOrder } = topologicalSort(nodes);
    let canFinish = true;
    for (let j = 0; j < n; j++) {
      if (job.state !== "running" /* RUNNING */) {
        this.warn("Job is not running, giving up ... status: ", job.state, job);
        break;
      }
      const key = searchOrder[j];
      const node = nodes[key];
      if (node.runState) {
        continue;
      }
      if (!(node?.data?.xOmniEnabled ?? true)) {
        this.info(`node "${node.name}" is disabled in the editor, skipping node`);
        await this.skipNode(node);
        continue;
      }
      canFinish = false;
      const component39 = job.engine.components.get(node.name);
      let canRun = true;
      if (!component39) {
        this.error(`Component ${node.name} not found`);
        job.addError(key, `Component ${node.name} does not exist`, "error");
        break;
      }
      let executable = true;
      const inputData = {};
      for (const inputKey of Object.keys(node.inputs)) {
        const inputConns = node.inputs[inputKey].connections;
        if (!inputConns.length) {
          continue;
        }
        const inputArray = [];
        const safeInputNodesSet = /* @__PURE__ */ new Set();
        const toxicInputNodesSet = /* @__PURE__ */ new Set();
        for (const i in inputConns) {
          const inputNodeProto = inputConns[i];
          if (inputNodeProto) {
            const inputNode = nodes[inputNodeProto.node];
            if (inputNode.runState === "deadLock") {
              executable = false;
              job.addError(key, "Recipe has deadlocked. Forcing progress.", "error");
              break;
            }
            if (!("outputDataInstance" in inputNode)) {
              canRun = false;
              break;
            }
            const inputSafe = inputNodeProto.output in (inputNode.outputDataInstance ?? {});
            if (inputSafe) {
              safeInputNodesSet.add(inputNode);
            } else {
              toxicInputNodesSet.add(inputNode);
            }
            const output = inputNode.outputDataInstance?.[inputNodeProto.output];
            inputArray.push(output);
          }
        }
        inputData[inputKey] = inputArray;
        if (!(inputData?.xOmniEnabled ?? true)) {
          this.info(`node "${node.name}" was disabled at runtime, skipping node`);
          await this.skipNode(node);
          continue;
        }
      }
      if (!canRun) {
        continue;
      }
      if (!executable) {
        await this.skipNode(node);
        await this.advanceRecipe(job);
        return;
      }
      job.runningNodes++;
      this.runBlockInParallel(job, node, component39, inputData, key).then(
        async () => {
          job.runningNodes--;
          await this.advanceRecipe(job);
        },
        (e) => {
          job.runningNodes--;
          this.error(`Error running node ${node.name}`, e);
        }
      );
    }
    if (job.runningNodes) {
      return;
    }
    if (canFinish) {
      await this.finishJob(job);
      return;
    }
    if (job.errors.length && job.state === "running" /* RUNNING */) {
      await this.finishJob(job);
    }
  }
  async finishJob(job) {
    this.success("Job instance " + job.id + " finished");
    job.finish();
    await this.emit("job_finished", [job.context, job]);
    await this.emit("job_finished_" + job.id, [job]);
    setTimeout(() => {
      this.jobs.delete(job.id);
    }, 20 * 60 * 1e3);
    await this.app.emit("sse_message", {
      type: "job_state",
      event: "job_finished",
      args: { job_id: job.id },
      sessionId: job.context.sessionId,
      userId: job.context.userId
    });
  }
  async startJob(job) {
    omnilog.log(`workflow instance ${job.id} starting`);
    job.start();
    await this.emit("job_started", job);
    await this.emit("job_started_" + job.id, [job]);
  }
  async createJob(recipe, ctx, startNode) {
    const job = new WorkflowJob(this, recipe, ctx, startNode);
    this.jobs.set(job.id, job);
    const actions = {
      cancel: false,
      cancelReason: null
    };
    await this.emit("pre_workflow_start", [recipe, job.context, actions]);
    if (actions.cancel) {
      throw new Error("Workflow cancelled: " + actions.cancelReason || "No reason available");
    }
    return job;
  }
  async registerBlocksWithReteEngine(blockNames, job) {
    const userId = job.context.userId;
    const failBehavior = "missing_block";
    const results = await this.getApp().blocks.getInstances(blockNames, userId, failBehavior);
    const blocks2 = results.blocks;
    blocks2.forEach((c) => {
      job.engine.register(c);
    });
  }
  async startRecipe(recipe, sessionId, userId, args, startNode, sender) {
    this.info("Recipe executing:", args, recipe.rete);
    args.botIdentity = sender;
    const ctx = JobContext.create(this.app, {
      sessionId,
      userId,
      workflowId: recipe.id,
      jobId: "",
      // Will be set in WorkflowJob constructor.
      args
    });
    const job = await this.createJob(recipe, ctx, startNode);
    const blockNames = Array.from(new Set(Object.values(job.rete.nodes).map((n) => n.name)));
    await this.registerBlocksWithReteEngine(blockNames, job);
    await this.startJob(job);
    await this.app.emit("sse_message", {
      type: "job_state",
      event: "job_started",
      args: { job_id: job.id },
      workflowId: job.context.workflowId,
      sessionId: job.context.sessionId,
      userId: job.context.userId
    });
    process.nextTick(async () => {
      await this.advanceRecipe(job);
    });
    return {
      jobId: job.id,
      recipeId: recipe.id,
      workflowId: recipe.id,
      meta: recipe.meta
    };
  }
};

// src/services/MessagingService.ts
import {
  MessagingServiceBase
} from "omni-shared";
import NodeCache from "node-cache";
var MessageComposer = class _MessageComposer {
  message;
  constructor(type2) {
    this.message = {
      type: type2,
      body: {}
    };
  }
  static create(type2) {
    return new _MessageComposer(type2);
  }
  to(to) {
    this.message.to = to;
    return this;
  }
  from(from) {
    this.message.from = from;
    return this;
  }
  setPayload(payload) {
    this.message.body = payload;
    return this;
  }
  setFlags(flags) {
    this.message.flags = flags;
    return this;
  }
  toMessage() {
    return this.message;
  }
};
var MessagingServerService = class _MessagingServerService extends MessagingServiceBase {
  messageCache;
  connections;
  heartbeat;
  constructor(id4, manager, config2) {
    super(id4, manager, config2 || {});
    this.config = config2;
    this.messageCache = new NodeCache();
    this.connections = /* @__PURE__ */ new Map();
    this.heartbeat = null;
  }
  get serviceConfig() {
    return this.config;
  }
  startHeartbeat() {
    if (this.heartbeat == null) {
      const interval = this.serviceConfig.keepaliveInterval;
      if (interval && interval > 0) {
        this.heartbeat = setInterval(this.onTick.bind(this), interval);
        this.info(`SSE keepalive timer active at ${interval} ms`);
      } else {
        this.info("Not using keepalive timer for SSE. (services.messaging.keepaliveInterval = 0) ");
      }
    }
  }
  stopHeartbeat() {
    if (this.heartbeat != null) {
      clearTimeout(this.heartbeat);
      this.heartbeat = null;
      this.debug("SSE keepalive timer cancelled");
    }
  }
  async stop() {
    this.stopHeartbeat();
    const conn = Array.from(this.connections.values());
    for (let i = 0; i < conn.length; i++) {
      conn[i]?.raw?.end();
    }
    this.connections.clear();
  }
  onTick() {
    if (this.connections.size > 0) {
      this.broadcast({ type: "keepalive", body: {} });
    }
  }
  createMessage(header, body) {
    return { ...header, body };
  }
  async load() {
    this.info("MessagingService loading");
    const nodeCacheOptions = this.serviceConfig.nodeCache || { checkperiod: 6e3 };
    this.messageCache = new NodeCache(nodeCacheOptions);
    this.subscribeToGlobalEvent("session_created", this.onSessionCreate.bind(this));
    this.subscribeToGlobalEvent("session_destroyed", this.onSessionDestroy.bind(this));
    this.success("MessagingService loaded");
    this.subscribeToGlobalEvent("sse_user_message", (args) => {
      const [userId, header, body, opts] = args;
      const message = _MessagingServerService.createServerMessage(header, body);
      this.sendUser(userId, message, opts);
    });
    this.subscribeToGlobalEvent("sse_message", (o) => {
      if (o.sessionId) {
        const message = _MessagingServerService.createServerMessage({ type: o.type }, o);
        this.send(o.sessionId, message, { no_cache: false });
      }
    });
  }
  async start() {
    return true;
  }
  static createServerMessage(header, body) {
    return { ...header, body };
  }
  composeMessage(type2) {
    return MessageComposer.create(type2);
  }
  // send event to a specific session
  async send(sessionId, message, deliveryOpts) {
    const connection = this.connections.get(sessionId);
    if (!(connection != null && this.sendSSEMessage(connection, message))) {
      if (!deliveryOpts?.no_cache) {
        const cachedMessages = this.messageCache.get(sessionId) || [];
        const { maxCacheSizePerUser = 1e3 } = this.serviceConfig;
        if (cachedMessages.length >= maxCacheSizePerUser) {
          this.warn(
            "SSE: Message cache full",
            sessionId,
            cachedMessages.length,
            this.serviceConfig.maxCacheSizePerUser
          );
          cachedMessages.shift();
        }
        cachedMessages.push(message);
        this.messageCache.set(sessionId, cachedMessages, deliveryOpts?.expireAt || 0);
      }
    }
  }
  async sendUser(userId, message, deliveryOpts) {
    for (const [sessionId, connection] of this.connections) {
      const user = connection.request.user;
      if (user && user.id === userId) {
        await this.send(sessionId, message, deliveryOpts);
      }
    }
  }
  // send event to all connected sessions
  async broadcast(message, deliveryOpts) {
    for (const [sessionId] of this.connections) {
      await this.send(sessionId, message, deliveryOpts);
    }
  }
  // session is created. SSE connection does not yet exist
  async onSessionCreate([sessionId, user]) {
    if (!this.messageCache.has(sessionId)) {
      this.messageCache.set(sessionId, []);
    }
  }
  async onConnectionCreate(request, reply) {
    const user = request.user;
    const sessionId = request.session.sessionId;
    if (!user || !sessionId) {
      this.error("SSE: User not logged in", sessionId, user);
      return await reply.status(403).send({ error: "User not logged in" });
    }
    const ip = request.ip;
    const userAgent = request.headers["user-agent"];
    const hadConnection = this.connections.has(sessionId);
    if (hadConnection) {
      const existingConnection = this.connections.get(sessionId);
      if (existingConnection != null) {
        this.sendSSEMessage(existingConnection, {
          type: "close",
          body: {
            reason: "new_connection",
            message: `A newer connection was made from ${ip} / ${userAgent}. `
          }
        });
        this.connections.delete(sessionId);
        setTimeout(() => {
          existingConnection.raw.end();
        }, 2);
      }
      this.info(`SSE: Existing connection for session ${sessionId}, user ${user.id}, IP: ${ip} closed.`);
    }
    this.connections.set(sessionId, reply);
    this.info(
      `SSE: New connection created for session ${sessionId}, user ${user.id}, IP: ${ip}, Browser: ${userAgent}. Connection count: ${this.connections.size}.`
    );
    const messages = this.messageCache.get(sessionId);
    if (messages != null) {
      messages.forEach((message) => this.sendSSEMessage(reply, message));
      this.messageCache.del(sessionId);
    }
    if (!hadConnection && !request.query.reconnect) {
      const welcomeMessage = _MessagingServerService.createServerMessage(
        {
          type: "chat",
          to: user.id,
          from: "omni"
        },
        {
          content: [
            {
              value: `Welcome to **omniTool**, *@${user.username}*.
Get started with the /help command.
You can file bugs by messaging **@bugbear** a one liner of your issue. `,
              type: "text/markdown"
            }
          ],
          attachments: {
            commands: [
              {
                title: "/help",
                id: "help",
                args: [],
                classes: ["animate-pulse"]
              }
            ]
          }
        }
      );
      this.sendSSEMessage(reply, welcomeMessage);
    }
    if (this.connections.size > 0) {
      this.startHeartbeat();
    }
    request.socket.on("close", () => {
      this.onSSEDisconnect(sessionId);
    });
    reply.sse("ok");
  }
  sendSSEMessage(connection, message) {
    const data = this.app.stringify(message ?? { empty: true });
    try {
      if (!connection.sent) {
        connection.sse({ id: "sse", data });
        this.verbose("sse -> ", data);
        return true;
      } else {
        this.warn("SSE: Connection already closed");
        return false;
      }
    } catch (error) {
      this.error(`Error sending SSE message: ${error.message}`, error);
      return false;
    }
  }
  onSSEDisconnect(sessionId) {
    if (this.connections.has(sessionId)) {
      this.connections.delete(sessionId);
    }
    this.info(`SSE: Connection closed for session ${sessionId}. Connection count: ${this.connections.size}.`);
    if (this.connections.size == 0) {
      this.stopHeartbeat();
    }
  }
  onSessionDestroy(sessionId) {
    if (this.connections.has(sessionId)) {
      const existingConnection = this.connections.get(sessionId);
      this.sendSSEMessage(existingConnection, {
        type: "close",
        body: {
          reason: "session_expired",
          message: "Your session has been expired."
        }
      });
      this.connections.delete(sessionId);
      setTimeout(() => {
        try {
          existingConnection.raw.end();
        } catch (ex) {
        }
      }, 2);
    }
    this.warn("Session destroyed");
    this.messageCache.del(sessionId);
  }
};

// src/services/RestConsumerService/RESTConsumerService.ts
import { Service as Service8, omnilog as omnilog7 } from "omni-shared";
import os2 from "os";
import FormData from "form-data";
import { v4 as uuidv43 } from "uuid";
import { capitalize } from "lodash-es";
import Replicate from "replicate";

// src/services/RestConsumerService/HuggingFace.ts
import { HfInference } from "@huggingface/inference";
import axios5 from "axios";
var MAX_ENTRIES = 25;
async function audioClassification(inference, block_payload, model2, options, job_ctx, service) {
  const labels = [];
  const scores = [];
  const jsons = [];
  let audio_cdns = block_payload.audio;
  if (!Array.isArray(audio_cdns))
    audio_cdns = [audio_cdns];
  if (!audio_cdns || audio_cdns.length === 0)
    throw new Error("Missing audio");
  for (const audio_cdn of audio_cdns) {
    const raw_audio = await service.app.cdn.get(audio_cdn.ticket);
    const data = raw_audio.data;
    const args = { model: model2, data };
    const inference_results = await inference.audioClassification(args, options);
    if (!inference_results)
      throw new Error("Missing classification_output for audio_classification_task");
    for (const classification_output of inference_results) {
      const label = classification_output.label;
      const score = classification_output.score;
      labels.push(label);
      scores.push(score);
      jsons.push({ label, score });
    }
  }
  return { label: labels, score: scores, json: jsons, _omni_status: 200 };
}
async function audioToAudio(inference, block_payload, model2, options, job_ctx, service) {
  const audios = [];
  const labels = [];
  let audio_cdns = block_payload.audio;
  if (!Array.isArray(audio_cdns))
    audio_cdns = [audio_cdns];
  if (!audio_cdns || audio_cdns.length === 0)
    throw new Error("Missing audio");
  for (const audio_cdn of audio_cdns) {
    const raw_audio = await service.app.cdn.get(audio_cdn.ticket);
    const data = raw_audio.data;
    const args = { model: model2, data };
    const inference_results = await inference.audioToAudio(args, options);
    if (!inference_results)
      throw new Error("Missing result for audio_to_audio_task");
    for (const result of inference_results) {
      const blob = result.blob;
      const label = result.label;
      const audio_cdn2 = await blobToAudioCdn(blob, job_ctx, service);
      audios.push(audio_cdn2);
      labels.push(label);
    }
  }
  return { audios, labels, _omni_status: 200 };
}
async function automaticSpeechRecognition(inference, block_payload, model2, options, job_ctx, service) {
  const texts = [];
  let audio_cdns = block_payload.audio;
  if (!Array.isArray(audio_cdns))
    audio_cdns = [audio_cdns];
  if (!audio_cdns || audio_cdns.length === 0)
    throw new Error("Missing audio");
  for (const audio_cdn of audio_cdns) {
    const raw_audio = await service.app.cdn.get(audio_cdn.ticket);
    const data = raw_audio.data;
    const args = { model: model2, data };
    const inference_results = await inference.automaticSpeechRecognition(args, options);
    if (!inference_results)
      throw new Error("Missing transcription_output for automatic_speech_recognition_task");
    const text = inference_results.text;
    texts.push(text);
  }
  return { text: texts, _omni_status: 200 };
}
async function conversational(inference, block_payload, model2, options, job_ctx, service) {
  let generated_responses = block_payload.generated_responses || [];
  if (!Array.isArray(generated_responses))
    generated_responses = [generated_responses];
  let past_user_inputs = block_payload.past_user_inputs || [];
  if (!Array.isArray(past_user_inputs))
    past_user_inputs = [past_user_inputs];
  const text = block_payload.text || "";
  if (!text || text.length === 0)
    throw new Error("Missing text for conversational_task");
  const inputs5 = { text, generated_responses, past_user_inputs };
  const max_length = block_payload.max_length;
  const max_time = block_payload.max_time;
  const min_length = block_payload.min_length;
  const repetition_penalty = block_payload.repetition_penalty;
  const temperature = block_payload.temperature;
  const top_k = block_payload.top_k;
  const top_p = block_payload.top_p;
  const parameters = { max_length, max_time, min_length, repetition_penalty, temperature, top_k, top_p };
  const args = { model: model2, inputs: inputs5, parameters };
  const inference_results = await inference.conversational(args, options);
  if (!inference_results)
    throw new Error("Missing conversational_output for conversational_task");
  const generated_text = inference_results.generated_text;
  const conversation = inference_results.conversation;
  past_user_inputs = conversation.past_user_inputs;
  generated_responses = conversation.generated_responses;
  const warnings = inference_results.warnings;
  return { generated_text, past_user_inputs, generated_responses, warnings, _omni_status: 200 };
}
async function documentQuestionAnswering(inference, block_payload, model2, options, job_ctx, service) {
  let image_cdns = block_payload.image;
  if (!Array.isArray(image_cdns))
    image_cdns = [image_cdns];
  if (!image_cdns)
    throw new Error("Missing images for documentQuestionAnswering");
  const answers = [];
  const jsons = [];
  for (const image_cdn of image_cdns) {
    const raw_image = await service.app.cdn.get(image_cdn.ticket);
    const image = raw_image.data;
    const question = block_payload.question;
    if (!question)
      throw new Error("Missing question for documentQuestionAnswering");
    const inputs5 = { image, question };
    const args = { model: model2, inputs: inputs5 };
    const inference_results = await inference.documentQuestionAnswering(args, options);
    if (!inference_results)
      throw new Error("Missing output for documentQuestionAnswering");
    const answer = inference_results.answer;
    const end = inference_results.end;
    const score = inference_results.score;
    const start = inference_results.start;
    answers.push(answer);
    jsons.push({ answer, end, score, start });
  }
  return { answer: answers, json: jsons, _omni_status: 200 };
}
async function featureExtraction(inference, block_payload, model2, options, job_ctx, service) {
  let inputs5 = block_payload.inputs;
  if (!Array.isArray(inputs5))
    inputs5 = [inputs5];
  if (!inputs5 || inputs5.length === 0)
    throw new Error("Missing inputs for featureExtraction");
  const args = { model: model2, inputs: inputs5 };
  const inference_results = await inference.featureExtraction(args, options);
  if (!inference_results)
    throw new Error("Missing output for featureExtraction");
  return { features: inference_results, json: { features: inference_results }, _omni_status: 200 };
}
async function fillMask(inference, block_payload, model2, options, job_ctx, service) {
  const inputs5 = block_payload.inputs;
  if (!inputs5)
    throw new Error("Missing text for fillMask");
  const args = { inputs: inputs5 };
  const inference_results = await inference.fillMask(args, options);
  if (!inference_results)
    throw new Error("Missing output for fillMask");
  const token_strs = [];
  const jsons = [];
  for (const inference_result of inference_results) {
    const sequence = inference_result.sequence;
    const score = inference_result.score;
    const token = inference_result.token;
    const token_str = inference_result.token_str;
    token_strs.push(token_str);
    jsons.push({ sequence, score, token, token_str });
  }
  return { token_str: token_strs, json: jsons, _omni_status: 200 };
}
async function imageClassification(inference, block_payload, model2, options, job_ctx, service) {
  const labels = [];
  const jsons = [];
  let image_cdns = block_payload.image;
  if (!Array.isArray(image_cdns))
    image_cdns = [image_cdns];
  if (!image_cdns || image_cdns.length === 0)
    throw new Error("Missing image");
  for (const image_cdn of image_cdns) {
    const url = image_cdn.url;
    const raw_image = await service.app.cdn.get(image_cdn.ticket);
    const data = raw_image.data;
    const args = { model: model2, data };
    const inference_results = await inference.imageClassification(args, options);
    if (!inference_results)
      throw new Error("Missing classification_output for image_classification_task");
    for (const classification_output of inference_results) {
      const label = classification_output.label;
      const score = classification_output.score;
      labels.push(label);
      jsons.push({ url, label, score });
    }
  }
  return { label: labels, json: jsons, _omni_status: 200 };
}
async function imageSegmentation(inference, block_payload, model2, options, job_ctx, service) {
  const mask_cdns = [];
  const jsons = [];
  let image_cdns = block_payload.images;
  if (!Array.isArray(image_cdns))
    image_cdns = [image_cdns];
  if (!image_cdns || image_cdns.length === 0)
    throw new Error("Missing images");
  for (const image_cdn of image_cdns) {
    const raw_image = await service.app.cdn.get(image_cdn.ticket);
    const data = raw_image.data;
    const args = { model: model2, data };
    const inference_results = await inference.imageSegmentation(args, options);
    if (!inference_results)
      throw new Error("Missing segmentation_output for image_segmentation_task");
    for (const segmentation_output of inference_results) {
      const mask_b64 = segmentation_output.mask;
      const label = segmentation_output.label;
      const score = segmentation_output.score;
      const mask_cdn = await blobToImageCdn(mask_b64, job_ctx, service);
      mask_cdns.push(mask_cdn);
      jsons.push({ mask: mask_cdn, label, score });
    }
  }
  return { masks: mask_cdns, json: jsons, _omni_status: 200 };
}
async function imageToImage(inference, block_payload, model2, options, job_ctx, service) {
  const output_image_cdns = [];
  let images = block_payload.images;
  const prompt = block_payload.prompt;
  const strength = block_payload.strength;
  const negative_prompt = block_payload.negative_prompt;
  const height = block_payload.height;
  const width = block_payload.width;
  const num_inference_steps = block_payload.num_inference_steps;
  const guidance_scale = block_payload.guidance_scale;
  const guess_mode = block_payload.guess_mode || false;
  const parameters = { prompt, strength, negative_prompt, height, width, num_inference_steps, guidance_scale, guess_mode };
  if (!Array.isArray(images))
    images = [images];
  if (!images || images.length === 0)
    throw new Error("Missing images");
  for (const image of images) {
    const raw_image = await service.app.cdn.get(image.ticket);
    const inputs5 = raw_image.data;
    const args = { model: model2, inputs: inputs5, parameters };
    const inference_results = await inference.imageToImage(args, options);
    if (!inference_results)
      throw new Error("Missing image_to_image_output for image_to_image_task");
    for (const blob of inference_results) {
      const image_cdn = await blobToImageCdn(blob, job_ctx, service);
      output_image_cdns.push(image_cdn);
    }
  }
  return { images: output_image_cdns, _omni_status: 200 };
}
async function imageToText(inference, block_payload, model2, options, job_ctx, service) {
  const texts = [];
  let image_cdn = block_payload.image;
  if (!Array.isArray(image_cdn))
    image_cdn = [image_cdn];
  if (!image_cdn || image_cdn.length === 0)
    throw new Error("Missing image");
  for (const image of image_cdn) {
    const raw_image = await service.app.cdn.get(image.ticket);
    const data = raw_image.data;
    const args = { model: model2, data };
    const text_output = await inference.imageToText(args, options);
    if (!text_output)
      throw new Error("Missing text_output for image_to_text_task");
    texts.push(text_output);
  }
  return { text: texts, _omni_status: 200 };
}
async function objectDetection(inference, block_payload, model2, options, job_ctx, service) {
  const images = block_payload.image;
  if (!images || images.length === 0)
    throw new Error("Missing images");
  if (!model2)
    throw new Error("Missing model");
  const labels = [];
  const jsons = [];
  for (const image of images) {
    const raw_image = await service.app.cdn.get(image.ticket);
    const data = raw_image.data;
    const args = { model: model2, data };
    const inference_results = await inference.objectDetection(args, options);
    if (!inference_results)
      throw new Error("Missing inference_results for object_detection_task");
    const box = inference_results.box;
    const label = inference_results.label;
    const score = inference_results.score;
    labels.push(label);
    jsons.push({ box, label, score });
  }
  return { label: labels, json: jsons, _omni_status: 200 };
}
async function questionAnswering(inference, block_payload, model2, options, job_ctx, service) {
  const context = block_payload.context;
  const question = block_payload.question;
  if (!context || !question)
    throw new Error("Missing context or question");
  const inputs5 = { context, question };
  const args = { inputs: inputs5 };
  const result = await inference.questionAnswering(args, options);
  const answer = result.answer;
  const end = result.end;
  const score = result.score;
  const start = result.start;
  const json = { answer, end, score, start };
  return { answer, json, _omni_status: 200 };
}
async function sentenceSimilarity(inference, block_payload, model2, options, job_ctx, service) {
  const text1 = block_payload.sentence1;
  const text2 = block_payload.sentence2;
  if (!text1 || !text2)
    throw new Error("Two sentences were not provided.");
  const args = { inputs: { text1, text2 } };
  const results = await inference.sentenceSimilarity(args, options);
  const similarities = results;
  return { similarity: similarities, _omni_status: 200 };
}
async function summarization(inference, block_payload, model2, options, job_ctx, service) {
  const inputs5 = block_payload.inputs;
  if (!inputs5)
    throw new Error("Missing input_text for summarization_task");
  const min_length = block_payload.min_length;
  const max_length = block_payload.max_length;
  const top_k = block_payload.top_k;
  const top_p = block_payload.top_p;
  const temperature = block_payload.temperature || 1;
  const repetition_penalty = block_payload.repetition_penalty;
  const max_time = block_payload.max_time;
  const args = {
    model: model2,
    inputs: inputs5,
    parameters: { max_length, max_time, min_length, repetition_penalty, temperature, top_k, top_p }
  };
  const results = await inference.summarization(args, options);
  const summary_text = results.summary_text;
  return { summary_text, _omni_status: 200 };
}
async function tableQuestionAnswering(inference, block_payload, model2, options, job_ctx, service) {
  const query = block_payload.query;
  if (!query)
    throw new Error("Missing query for tableQuestionAnswering");
  if (typeof block_payload.table !== "object") {
    throw new Error("block_payload.table must be an object");
  }
  const table = {};
  for (const key in block_payload.table) {
    if (!Array.isArray(block_payload.table[key])) {
      throw new Error(`block_payload.table.${key} must be an array of strings`);
    }
    table[key] = block_payload.table[key];
  }
  const inputs5 = { table, query };
  const args = { model: model2, inputs: inputs5 };
  if (!table)
    throw new Error("Missing table for tableQuestionAnswering");
  const results = await inference.tableQuestionAnswering(args, options);
  const answer = results.answer;
  const aggregator = results.aggregator;
  const cells = results.cells;
  const coordinates = results.coordinates;
  const json = { answer, aggregator, cells, coordinates };
  return { answer, json, _omni_status: 200 };
}
async function tabularClassification(inference, block_payload, model2, options, job_ctx, service) {
  if (typeof block_payload.table !== "object") {
    throw new Error("block_payload.data must be an object");
  }
  const data = {};
  for (const key in block_payload.table) {
    if (!Array.isArray(block_payload.table[key])) {
      throw new Error(`block_payload.table.${key} must be an array of strings`);
    }
    data[key] = block_payload.table[key];
  }
  if (!data)
    throw new Error("Missing data for tabularClassification");
  const inputs5 = { data };
  const args = { model: model2, inputs: inputs5 };
  const results = await inference.tabularClassification(args, options);
  const labels = results;
  return { label: labels, _omni_status: 200 };
}
async function tabularRegression(inference, block_payload, model2, options, job_ctx, service) {
  if (typeof block_payload.data !== "object") {
    throw new Error("block_payload.data must be an object");
  }
  const data = {};
  for (const key in block_payload.table) {
    if (!Array.isArray(block_payload.table[key])) {
      throw new Error(`block_payload.table.${key} must be an array of strings`);
    }
    data[key] = block_payload.table[key];
  }
  if (!data)
    throw new Error("Missing data for tabularRegression");
  const inputs5 = { data };
  const args = { model: model2, inputs: inputs5 };
  const results = await inference.tabularRegression(args, options);
  const labels = results;
  return { labels, _omni_status: 200 };
}
async function textClassification(inference, block_payload, model2, options, job_ctx, service) {
  const inputs5 = block_payload.inputs;
  if (!inputs5)
    throw new Error("Missing inputs for textClassification");
  const args = { model: model2, inputs: inputs5 };
  const results = await inference.textClassification(args, options);
  const labels = [];
  const jsons = [];
  for (const result of results) {
    const label = result.label;
    const score = result.score;
    const json = { label, score };
    labels.push(label);
    jsons.push(json);
  }
  return { label: labels, json: jsons, _omni_status: 200 };
}
async function textGeneration(inference, block_payload, model2, options, job_ctx, service) {
  const inputs5 = block_payload.inputs;
  if (!inputs5)
    throw new Error("Missing inputs for textGeneration");
  const do_sample = block_payload.do_sample || true;
  const max_new_tokens = block_payload.max_new_tokens;
  const max_time = block_payload.max_time;
  const num_return_sequences = block_payload.num_return_sequences || 1;
  const repetition_penalty = block_payload.repetition_penalty;
  const return_full_text = block_payload.return_full_text || true;
  const temperature = block_payload.temperature || 1;
  const top_k = block_payload.top_k;
  const top_p = block_payload.top_p;
  const truncate = block_payload.truncate;
  const stop_sequences = block_payload.stop_sequences || [];
  const parameters = { do_sample, max_new_tokens, max_time, num_return_sequences, repetition_penalty, return_full_text, temperature, top_k, top_p, truncate, stop_sequences };
  const args = { model: model2, inputs: inputs5, parameters };
  const results = await inference.textGeneration(args, options);
  const generated_text = results.generated_text;
  return { generated_text, _omni_status: 200 };
}
async function textToImage(inference, block_payload, model2, options, job_ctx, service) {
  const prompt = block_payload.prompt;
  if (!prompt)
    throw new Error("Missing prompt for textToImage");
  const negative_prompt = block_payload.negative_prompt;
  const height = block_payload.height;
  const width = block_payload.width;
  const num_inference_steps = block_payload.num_inference_steps;
  const guidance_scale = block_payload.guidance_scale;
  const inputs5 = prompt;
  const parameters = { negative_prompt, height, width, num_inference_steps, guidance_scale };
  const args = { model: model2, inputs: inputs5, parameters };
  const results = await inference.textToImage(args, options);
  const blob = results;
  const image_cdn = await blobToImageCdn(blob, job_ctx, service);
  return { image: image_cdn, _omni_status: 200 };
}
async function textToSpeech(inference, block_payload, model2, options, job_ctx, service) {
  const inputs5 = block_payload.inputs;
  if (!inputs5)
    throw new Error("Missing inputs for textToSpeech");
  const args = { model: model2, inputs: inputs5 };
  const results = await inference.textToSpeech(args, options);
  const blob = results;
  const audio_cdn = await blobToAudioCdn(blob, job_ctx, service);
  return { audio: audio_cdn, _omni_status: 200 };
}
async function tokenClassification(inference, block_payload, model2, options, job_ctx, service) {
  const inputs5 = block_payload.inputs;
  if (!inputs5)
    throw new Error("Missing inputs for tokenClassification");
  const aggregation_strategy = block_payload.aggregation_strategy || "simple";
  const parameters = { aggregation_strategy };
  const args = { model: model2, inputs: inputs5, parameters };
  const results = await inference.tokenClassification(args, options);
  const entity_groups = [];
  const jsons = [];
  for (const result of results) {
    const entity_group = result.entity_group;
    const score = result.score;
    const start = result.start;
    const end = result.end;
    const word = result.word;
    const json = { entity_group, score, start, end, word };
    entity_groups.push(entity_group);
    jsons.push(json);
  }
  return { entity_group: entity_groups, json: jsons, _omni_status: 200 };
}
async function translation(inference, block_payload, model2, options, job_ctx, service) {
  const inputs5 = block_payload.inputs;
  if (!inputs5)
    throw new Error("Missing inputs for translation");
  const args = { model: model2, inputs: inputs5 };
  const results = await inference.translation(args, options);
  const translation2 = results.translation_text;
  return { translation: translation2, _omni_status: 200 };
}
async function visualQuestionAnswering(inference, block_payload, model2, options, job_ctx, service) {
  const question = block_payload.question;
  if (!question)
    throw new Error("Missing question for visualQuestionAnswering");
  let image_cdns = block_payload.image;
  if (!Array.isArray(image_cdns))
    image_cdns = [image_cdns];
  if (!image_cdns)
    throw new Error("Missing image for visualQuestionAnswering");
  const answers = [];
  const jsons = [];
  for (const image_cdn of image_cdns) {
    const raw_image = await service.app.cdn.get(image_cdn.ticket);
    const image = raw_image.data;
    const blob = new Blob([image.buffer], { type: "application/octet-stream" });
    const args = { model: model2, inputs: { image: blob, question } };
    const results = await inference.visualQuestionAnswering(args, options);
    const answer = results.answer;
    const score = results.score;
    const json = { answer, score };
    answers.push(answer);
    jsons.push(json);
  }
  return { answer: answers, json: jsons, _omni_status: 200 };
}
async function zeroShotClassification(inference, block_payload, model2, options, job_ctx, service) {
  let inputs5 = block_payload.inputs;
  if (!inputs5)
    throw new Error("Missing inputs for zeroShotClassification");
  if (!Array.isArray(inputs5))
    inputs5 = [inputs5];
  const candidate_labels = block_payload.candidate_labels;
  if (!candidate_labels)
    throw new Error("Missing candidate_labels for zeroShotClassification");
  if (!Array.isArray(candidate_labels))
    throw new Error("You need at least two candidate_labels for zeroShotClassification");
  if (candidate_labels.length < 2)
    throw new Error("You need at least two candidate_labels for zeroShotClassification");
  if (candidate_labels.length > 10)
    throw new Error("You can use at most 10 candidate_labels for zeroShotClassification");
  const multi_label = block_payload.multi_label || false;
  const parameters = { candidate_labels, multi_label };
  const args = { model: model2, inputs: inputs5, parameters };
  const results = await inference.zeroShotClassification(args, options);
  const all_labels = [];
  const jsons = [];
  for (const result of results) {
    const labels = result.labels;
    const scores = result.scores;
    const sequence = result.sequence;
    const json = { labels, scores, sequence };
    all_labels.push(labels);
    jsons.push(json);
  }
  return { labels: all_labels, json: jsons, _omni_status: 200 };
}
async function zeroShotImageClassification(inference, block_payload, model2, options, job_ctx, service) {
  let image_cdns = block_payload.image;
  if (!Array.isArray(image_cdns))
    image_cdns = [image_cdns];
  if (!image_cdns || image_cdns.length === 0)
    throw new Error("Missing images for zeroShotImageClassification");
  const candidate_labels = block_payload.candidate_labels;
  if (!candidate_labels)
    throw new Error("Missing candidate_labels for zeroShotImageClassification");
  if (!Array.isArray(candidate_labels))
    throw new Error("You need at least two candidate_labels for zeroShotImageClassification");
  if (candidate_labels.length < 2)
    throw new Error("You need at least two candidate_labels for zeroShotImageClassification");
  if (candidate_labels.length > 10)
    throw new Error("You can use at most 10 candidate_labels for zeroShotImageClassification");
  const parameters = { candidate_labels };
  const labels = [];
  const jsons = [];
  for (const image_cdn of image_cdns) {
    const raw_image = await service.app.cdn.get(image_cdn.ticket);
    const image = raw_image.data;
    const args = { model: model2, inputs: image, parameters };
    const results = await inference.zeroShotImageClassification(args, options);
    const url = image_cdn.url;
    for (const result of results) {
      const label = result.label;
      const score = result.score;
      const json = { label, score, url };
      labels.push(label);
      jsons.push(json);
    }
  }
  return { labels, json: jsons, _omni_status: 200 };
}
async function processHuggingface(payload, service) {
  const block_payload = payload.body;
  if (!block_payload)
    throw new Error("Missing payload for huggingface block");
  const blockManager = service.server.blocks;
  const baseUrl = blockManager.getNamespace("huggingface")?.api?.basePath ?? "";
  const credentialService = service.app.services.get("credentials");
  let hf_token;
  try {
    hf_token = await credentialService.get(payload.job_ctx.user, "huggingface", baseUrl, "Bearer");
  } catch {
    omnilog.warn(
      "huggingface token not found. Using a token would double the speed of the free inference from Huggingface"
    );
  }
  let endpoint = payload.integration.operationId;
  if ("_huggingface" in block_payload) {
    const rep = block_payload._huggingface;
    delete block_payload._huggingface;
    endpoint = rep.endpoint;
  }
  if (payload.integration.key === "huggingface_hub") {
    switch (endpoint) {
      case "models": {
        const tag = block_payload.tag;
        const max_entries = block_payload.max_entries || MAX_ENTRIES;
        const results = {};
        if (!tag)
          throw new Error("Missing tag for huggingface_hub models");
        results[tag] = await getModels2(tag, max_entries);
        results.result = { "ok": true };
        return results;
      }
      default:
        return null;
    }
  } else if (payload.integration.key === "huggingface") {
    const model2 = block_payload.model;
    const use_cache = block_payload.use_cache || true;
    const wait_for_model = block_payload.wait_for_model || false;
    const options = { use_cache, wait_for_model };
    const job_ctx = payload.job_ctx;
    let inference = null;
    if (!hf_token)
      inference = new HfInference();
    else
      inference = new HfInference(hf_token);
    switch (endpoint) {
      case "audio-classification": {
        const results = await audioClassification(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "audio-to-audio": {
        const results = await audioToAudio(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "automatic-speech-recognition": {
        const results = await automaticSpeechRecognition(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "conversational": {
        const results = await conversational(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "document-question-answering": {
        const results = await documentQuestionAnswering(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "feature-extraction": {
        const results = await featureExtraction(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "fill-mask": {
        const results = await fillMask(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "image-classification": {
        const results = await imageClassification(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "image-segmentation": {
        const results = await imageSegmentation(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "image-to-image": {
        const results = await imageToImage(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "image-to-text": {
        const results = await imageToText(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "object-detection": {
        const results = await objectDetection(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "question-answering": {
        const results = await questionAnswering(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "sentence-similarity": {
        const results = await sentenceSimilarity(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "summarization": {
        const results = await summarization(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "table-question-answering": {
        const results = await tableQuestionAnswering(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "tabular-classification": {
        const results = await tabularClassification(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "tabular-regression": {
        const results = await tabularRegression(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "text-classification": {
        const results = await textClassification(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "text-generation": {
        const results = await textGeneration(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "text-to-image": {
        const results = await textToImage(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "text-to-speech": {
        const results = await textToSpeech(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "token-classification": {
        const results = await tokenClassification(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "translation": {
        const results = await translation(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "visual-question-answering": {
        const results = await visualQuestionAnswering(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "zero-shot-classification": {
        const results = await zeroShotClassification(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      case "zero-shot-image-classification": {
        const results = await zeroShotImageClassification(inference, block_payload, model2, options, job_ctx, service);
        return results;
      }
      default: {
        console.warn(`Unknown Huggingface endpoint ${endpoint}`);
        return null;
      }
    }
  }
  return null;
}
async function fetchData2(tag) {
  try {
    console.log(`Fetching data for tag ${tag}`);
    const response = await axios5.get(`https://huggingface.co/api/models?filter=${tag}`);
    return response.data;
  } catch (error) {
    console.error("Error fetching data:", error);
    throw error;
  }
}
function sortAndFormatData2(data, max_entries, tag) {
  return data.sort((a, b) => b.downloads * b.likes - a.downloads * a.likes).slice(0, max_entries).map((model2) => ({
    model_id: model2.modelId,
    title: `${model2.modelId} [${model2.likes}] @ ${model2.modelId.split("/")[0]}`,
    likes: model2.likes,
    downloads: model2.downloads,
    date: model2.createdAt,
    author: model2.modelId.split("/")[0],
    tag
  }));
}
async function getModels2(tag, max_entries = 20) {
  try {
    const models = await fetchData2(tag);
    const formattedData = sortAndFormatData2(models, max_entries, tag);
    const output = [""];
    for (const model2 of formattedData) {
      output.push(model2.model_id);
    }
    console.log(JSON.stringify(output, null, 2));
    return output;
  } catch (err) {
    console.error("Error processing data:", err.message);
  }
}
async function blobToAudioCdn(blob, job_ctx, service) {
  return await blobToCdn(blob, job_ctx, service, "audio/mpeg");
}
async function blobToImageCdn(blob, job_ctx, service) {
  return await blobToCdn(blob, job_ctx, service, "image/png");
}
async function blobToCdn(blob, job_ctx, service, type2) {
  let array_data;
  if (typeof blob === "string") {
    array_data = Buffer.from(blob, "base64");
  } else if (blob instanceof Blob) {
    array_data = await blob.arrayBuffer();
    type2 = blob.type;
  } else if (blob instanceof ArrayBuffer) {
    array_data = blob;
  } else {
    throw new Error("Unsupported blob type");
  }
  const buffer = Buffer.from(array_data);
  const cdn = await service.app.cdn.putTemp(
    buffer,
    {
      mimeType: type2,
      userId: job_ctx?.userId,
      jobId: job_ctx?.jobId
    }
  );
  return cdn;
}

// src/services/RestConsumerService/RESTConsumerService.ts
var TASK_PROTOCOL_VERSION2 = "aardvark";
var SignatureTelemetry = class {
  requestCount;
  responseCount;
  exceptionCount;
  smoothedDuration;
  latestResponseCode;
  backoffDuration;
  durationBuckets;
  constructor() {
    this.requestCount = 0;
    this.responseCount = 0;
    this.exceptionCount = 0;
    this.smoothedDuration = null;
    this.latestResponseCode = null;
    this.backoffDuration = 0;
    this.durationBuckets = /* @__PURE__ */ new Map();
  }
  incrementRequestCount() {
    this.requestCount += 1;
  }
  updateOnResponse() {
    this.responseCount += 1;
    this.backoffDuration = 0;
  }
  updateOnException() {
    this.exceptionCount += 1;
    this.backoffDuration = Math.min(this.backoffDuration * 1.5 + 20, 3e4);
  }
  updateOnHttp429TooManyRequests() {
    this.backoffDuration = Math.min(this.backoffDuration * 2 + 200, 3e4);
  }
  addToDurationBucket(duration) {
    const bucketIndex = Math.floor(Math.log2(duration));
    const bucket = this.durationBuckets.get(bucketIndex) ?? { count: 0, sum: 0, sumSquared: 0 };
    bucket.count += 1;
    bucket.sum += duration;
    bucket.sumSquared += duration * duration;
    this.durationBuckets.set(bucketIndex, bucket);
  }
  summarize(url) {
    return `TelemetrySummary(${url}) : SmoothedDuration:${this.smoothedDuration}, ResponseCount:${this.responseCount}, ExceptionCount:${this.exceptionCount}, LatestResponseCode:${this.latestResponseCode}`;
  }
  // Serialize the instance to a JSON string
  toJSON() {
    return JSON.stringify(this);
  }
};
var RESTConsumerService = class extends Service8 {
  connection;
  channel;
  integrations;
  config;
  constructor(id4, manager, config2) {
    super(id4, manager, config2 || {});
    this.config = config2;
    this.integrations = /* @__PURE__ */ new Map();
  }
  get server() {
    return this.manager.app;
  }
  // -------------------------------------------------------------------------------------
  // Define a helper function to generate the endpoint URL from the information in the config
  endpointURL() {
    let username = this.config.username;
    let password = this.config.password;
    if (username && password) {
      username = typeof username === "function" ? username() : username;
      password = typeof password === "function" ? password() : password;
      return this.config.endpoint.replace("{{username}}", username).replace("{{password}}", password);
    }
    return "";
  }
  // -------------------------------------------------------------------------------------
  /// Define a helper function to get the API signature for the given API name
  async getAPISignature(integration) {
    try {
      const blockManager = this.server.blocks;
      const signature = blockManager.getAPISignature(integration.key, integration.operationId);
      this.debug("Signature ", JSON.stringify(signature, null, 2));
      return signature;
    } catch (error) {
      throw new Error(`Invalid API signature for message API ${integration.key}.${integration.operationId}`, error.message);
    }
  }
  // Store request cookies with corresponding data
  requestMap = /* @__PURE__ */ new Map();
  // Store URLs as keys with instances of SignatureTelemetry as values
  signatureMap = /* @__PURE__ */ new Map();
  // -------------------------------------------------------------------------------------
  // Define a helper function that returns a unique UUID v4 string
  generateUniqueCookie() {
    return uuidv43();
  }
  // -------------------------------------------------------------------------------------
  async sleep(ms) {
    if (ms <= 0) {
      await Promise.resolve();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
  async securityScheme(securitySpecs, userId, apiNamespace, baseUrl, requestConfig) {
    const credentialService = this.app.services.get("credentials");
    for (const security of securitySpecs) {
      if (security.type === "http_basic") {
        const username = await credentialService.get(userId, apiNamespace, baseUrl, "username");
        const password = await credentialService.get(userId, apiNamespace, baseUrl, "password");
        if (!username || !password) {
          if (security.isOptional) {
            this.info(`Missing credentials for namespace '${apiNamespace}'`);
          } else {
            this.error(`Missing credentials for namespace '${apiNamespace}'`);
          }
          continue;
        }
        requestConfig.headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
      } else if (security.type === "http_bearer") {
        if (security.requireKeys && security.requireKeys.length > 0) {
          const token = await credentialService.get(userId, apiNamespace, baseUrl, security.requireKeys[0].id);
          if (!token) {
            if (security.isOptional) {
              this.info(`Missing credentials for namespace '${apiNamespace}'`);
            } else {
              this.error(`Missing credentials for namespace '${apiNamespace}'`);
            }
            continue;
          }
          requestConfig.headers.Authorization = `${capitalize(security.requireKeys[0].id)} ${token}`;
        }
      } else if (security.type === "apiKey") {
        if (security.requireKeys && security.requireKeys.length > 0) {
          const credKey = security.requireKeys[0];
          if (credKey) {
            const apiKey = await credentialService.get(userId, apiNamespace, baseUrl, credKey.id);
            if (!apiKey) {
              if (security.isOptional) {
                this.info(`Missing credentials for namespace '${apiNamespace}'`);
              } else {
                this.error(`Missing credentials for namespace '${apiNamespace}'`);
              }
              continue;
            }
            if (credKey.in === "header") {
              requestConfig.headers[credKey.id] = apiKey;
            } else if (credKey.in === "query") {
              requestConfig.params[credKey.id] = apiKey;
            } else if (credKey.in === "cookie") {
              requestConfig.headers.Cookie = requestConfig.headers.Cookie ? `${requestConfig.headers.Cookie}; ${credKey.id}=${apiKey}` : `${credKey.id}=${apiKey}`;
            } else {
              this.error(`Unsupported security scheme parameter location '${credKey.in}'`);
              continue;
            }
          }
        } else {
          if (security.isOptional) {
            this.info("Missing security scheme parameter name");
          } else {
            this.error("Missing security scheme parameter name");
          }
          continue;
        }
      } else if (security.type === "oauth2") {
        if (security.oauth?.authorizationCode) {
          try {
            const token = await credentialService.getOAuth2AccessToken(userId, apiNamespace, baseUrl);
            requestConfig.headers.Authorization = token;
          } catch (err) {
            if (security.isOptional) {
              this.info(`Access token failure for namespace '${apiNamespace}'`, err);
            } else {
              this.error(`Access token failure for namespace '${apiNamespace}'`, err);
            }
            continue;
          }
        } else {
          if (security.isOptional) {
            this.info(`Unsupported oauth flow type '${security.oauth}'`);
          } else {
            this.error(`Unsupported oauth flow type '${security.oauth}'`);
          }
          continue;
        }
      } else {
        if (security.isOptional) {
          this.info(`Unsupported security scheme type '${security.type}'`);
        } else {
          this.error(`Unsupported security scheme type '${security.type}'`);
        }
        continue;
      }
    }
  }
  // -------------------------------------------------------------------------------------
  // Register an Axios request with the provided signature and return a unique request cookie
  async registerAxiosRequest(signature) {
    const requestCookie = this.generateUniqueCookie();
    const requestTimestamp = Date.now();
    this.requestMap.set(requestCookie, { requestTimestamp, url: signature.url });
    let urlEntry = this.signatureMap.get(signature.url);
    if (urlEntry == null) {
      urlEntry = new SignatureTelemetry();
      this.signatureMap.set(signature.url, urlEntry);
    }
    urlEntry.incrementRequestCount();
    if (urlEntry.backoffDuration > 0) {
      omnilog7.log(`Sleeping for ${urlEntry.backoffDuration} ms before making another request`);
      await this.sleep(urlEntry.backoffDuration);
    }
    return requestCookie;
  }
  // -------------------------------------------------------------------------------------
  // Register an Axios response associated with the requestCookie
  registerAxiosResponse(requestCookie, status, data) {
    const requestEntry = this.requestMap.get(requestCookie);
    if (!requestEntry) {
      omnilog7.error(`Error: Invalid or duplicate response for request ${requestCookie}`);
      return;
    }
    this.requestMap.delete(requestCookie);
    const url = requestEntry.url;
    const telemetry = this.signatureMap.get(url);
    if (telemetry == null) {
      omnilog7.error(`Error: Telemetry object not found for URL ${url}`);
      return;
    }
    const responseTimestamp = Date.now();
    const requestTimestamp = requestEntry.requestTimestamp;
    const duration = responseTimestamp - requestTimestamp;
    telemetry.addToDurationBucket(duration);
    telemetry.smoothedDuration = telemetry.smoothedDuration ? telemetry.smoothedDuration * 0.5 + duration * 0.5 : duration;
    if (status === "exception") {
      telemetry.latestResponseCode = "exception";
      telemetry.updateOnException();
      return;
    }
    const responseCode = data.status;
    telemetry.latestResponseCode = responseCode;
    if (responseCode >= 200 && responseCode < 300) {
      telemetry.updateOnResponse();
    } else if (responseCode === 429) {
      telemetry.updateOnHttp429TooManyRequests();
    } else {
      telemetry.updateOnException();
    }
  }
  safeDeepClone(obj, cloned = /* @__PURE__ */ new WeakMap()) {
    if (typeof obj !== "object" || obj === null) {
      return obj;
    }
    if (cloned.has(obj)) {
      return cloned.get(obj);
    }
    const clone = Array.isArray(obj) ? [] : {};
    cloned.set(obj, clone);
    for (const key in obj) {
      if (obj.hasOwnProperty?.(key)) {
        clone[key] = this.safeDeepClone(obj[key], cloned);
      }
    }
    return clone;
  }
  sanitizeRequest(requestConfig) {
    const newRequestConfig = this.safeDeepClone(requestConfig);
    if (newRequestConfig.headers) {
      delete newRequestConfig.headers;
    }
    return newRequestConfig;
  }
  // -------------------------------------------------------------------------------------
  // Define a helper function to execute an axios call with the provided message object
  async executeAxiosCall(payload) {
    if (!payload?.integration) {
      this.error("Invalid message: message or integration missing", payload);
      throw new Error("Invalid message: message or integration missing");
    }
    if (payload.integration.key.startsWith("omni-core-replicate:")) {
      const credentialService = this.app.services.get("credentials");
      const blockManager = this.server.blocks;
      let baseUrl = blockManager.getNamespace("replicate")?.api?.basePath ?? "";
      if (baseUrl.endsWith("/")) {
        baseUrl = baseUrl.slice(0, -1);
      }
      if (baseUrl.endsWith("/v1/v1")) {
        baseUrl = baseUrl.slice(0, -3);
      } else if (!baseUrl.endsWith("/v1")) {
        baseUrl += "/v1";
      }
      const { owner, model: model2, version } = payload.body._replicate;
      delete payload.body._replicate;
      const replicate = new Replicate({
        auth: await credentialService.get(payload.job_ctx.user, "replicate", baseUrl, "token")
      });
      const input = payload.body;
      const output = await replicate.run(`${owner}/${model2}:${version}`, { input });
      return { output, _omni_status: 200 };
    }
    if (payload.integration.key.startsWith("huggingface")) {
      const results = await processHuggingface(payload, this);
      if (results)
        return results;
    }
    payload.headers ??= {};
    const signature = JSON.parse(JSON.stringify(await this.getAPISignature(payload.integration)));
    signature.contentType ??= "application/json";
    if (!signature?.url || !signature.method || !signature.contentType) {
      this.error("invalid signature", payload.integration, signature);
      throw new Error(`Unknown API signature for message API '${payload.integration}'`);
    }
    let urlObject;
    if (payload.params && Array.isArray(payload.params) && payload.params.length > 0) {
      const query = {};
      for (const param of payload.params) {
        if (param.in === "path") {
          signature.url = signature.url.replace(`{${param.name}}`, param.value);
          delete payload.body[param.name];
        } else if (param.in === "header" && param.value !== "") {
          payload.headers[param.name] ??= param.value;
          delete payload.body[param.name];
        } else if (param.in === "query") {
          query[param.name] = param.value;
          delete payload.body[param.name];
        }
      }
      urlObject = new URL(signature.url);
      urlObject.search = new URLSearchParams(query).toString();
      signature.url = urlObject.toString();
    }
    let responseType = "json";
    if (payload.responseContentType) {
      if (payload.responseContentType.startsWith("audio/") || payload.responseContentType.startsWith("application/ogg") || payload.responseContentType.startsWith("video/") || payload.responseContentType.startsWith("image/") || payload.responseContentType.startsWith("application/octet-stream")) {
        responseType = "arraybuffer";
      } else if (payload.responseContentType.startsWith("text/")) {
        responseType = "text";
      }
    }
    let data = JSON.parse(JSON.stringify(payload.body));
    if (signature.method.toLowerCase() !== "get") {
      if (signature.requestContentType === "multipart/form-data") {
        const blockManager = this.server.blocks;
        const block7 = blockManager.getBlock(payload.integration.block);
        const formData = new FormData();
        for (const key in data) {
          if (block7) {
            const input = block7.inputs[key];
            if (input.format === "binary") {
              if (data[key] && typeof data[key] === "object" && data[key].fid && typeof data[key].fid === "string") {
                const cdnRecord = await this.app.cdn.get({ fid: data[key].fid }, {}, "stream");
                if (cdnRecord) {
                  const stream = cdnRecord.data;
                  formData.append(key, stream, {
                    filename: cdnRecord.fileName || "file.bin",
                    contentType: cdnRecord.mimeType
                  });
                  continue;
                }
              }
            }
          }
          if (Array.isArray(data[key])) {
            data[key].forEach((item, index) => {
              Object.keys(item).forEach((propertyKey) => {
                const name = `${key}[${index}][${propertyKey}]`;
                formData.append(name, item[propertyKey]);
              });
            });
          } else {
            formData.append(key, data[key]);
          }
        }
        data = formData;
      }
    }
    const requestConfig = {
      method: signature.method,
      url: signature.url,
      data: signature.method.toLowerCase() !== "get" ? data : void 0,
      params: signature.method.toLowerCase() === "get" ? data : void 0,
      timeout: payload.timeout ?? 1e3 * 60 * 4,
      headers: payload.headers || {},
      responseType,
      responseEncoding: payload.responseEncoding || "utf8"
      // context: payload.job_ctx || undefined,
    };
    requestConfig.headers["Content-Type"] = signature.requestContentType || "application/json";
    const requestCookie = await this.registerAxiosRequest(signature);
    const httpClient = this.app.services.get("http_client");
    if (signature.security && signature.security.length > 0) {
      const context = payload.job_ctx || {};
      await this.securityScheme(signature.security, context.user, payload.integration.key, signature.url, requestConfig);
    }
    try {
      this.info("Executing axios call with configuration:", this.sanitizeRequest(requestConfig));
      const response = await httpClient.request(requestConfig);
      if (response?.data && response.data instanceof Buffer) {
        response.data = {
          // @ts-ignore
          result: await this.app.cdn.putTemp(response.data, {
            mimeType: payload.responseContentType,
            userId: payload.job_ctx?.userId,
            jobId: payload.job_ctx?.jobId
          })
        };
      }
      this.verbose("Axios call successful");
      this.registerAxiosResponse(requestCookie, "response", response);
      if (response.data && typeof response.data === "string") {
        return { result: response.data };
      }
      return { ...response.data };
    } catch (error) {
      let originalError = null;
      if (error instanceof HTTPClientError) {
        if (error.retryable) {
          throw error;
        } else {
          originalError = error.originalError;
        }
      } else {
        originalError = error;
      }
      const sanitizedError = {
        requestConfig: this.sanitizeRequest(requestConfig),
        error: {
          message: originalError.message,
          details: originalError.response?.data?.error || originalError.response?.data,
          code: originalError.code
        }
      };
      this.error("Axios call failed with error:", sanitizedError);
      this.registerAxiosResponse(requestCookie, "exception", originalError);
      throw new Error(JSON.stringify(sanitizedError));
    }
  }
  // -------------------------------------------------------------------------------------
  // Helper to publish a successful result
  enqueueResult(taskId, shardId, results) {
    this.verbose("Axios call successful", taskId);
    const resultMessage = {
      taskId,
      result: results,
      server: {
        hostname: os2.hostname(),
        /* platform: os.platform(),
        release: os.release(),
        type: os.type(),
        arch: os.arch(),
        cpus: os.cpus(), */
        protocol: TASK_PROTOCOL_VERSION2
      }
    };
    delete results.error;
    this.verbose("Publishing result message", this.config.exchange.name, `RESULTS-${TASK_PROTOCOL_VERSION2}.${shardId}`);
    if (this.channel == null) {
      throw new Error("Channel not initialized");
    }
    void this.channel.publish(
      this.config.exchange.name,
      `RESULTS-${TASK_PROTOCOL_VERSION2}.${shardId}`,
      Buffer.from(JSON.stringify(resultMessage))
    );
  }
  enqueueFailure(taskId, shardId, error) {
    this.error("Axios call failed with error", error);
    const resultMessage = {
      taskId,
      error,
      server: {
        hostname: os2.hostname(),
        /* platform: os.platform(),
        release: os.release(),
        type: os.type(),
        arch: os.arch(),
        cpus: os.cpus(), */
        protocol: TASK_PROTOCOL_VERSION2
      }
    };
    void this.channel?.publish(
      this.config.exchange.name,
      `RESULTS-${TASK_PROTOCOL_VERSION2}.${shardId}`,
      Buffer.from(JSON.stringify(resultMessage))
    );
  }
  // -------------------------------------------------------------------------------------
  // Override the parent load() method to set up the AMQP connection and message consumer
  async start() {
    const config2 = this.config;
    this.connection = connect(this.endpointURL(), this.app.config);
    this.success("Connection to AMQP Task server established");
    const channel = this.channel = await this.connection.createChannel();
    await this.channel.assertExchange(config2.exchange.name, config2.exchange.type, config2.exchange.options);
    this.success("Asserted exchange " + config2.exchange.name);
    const queueName = this.id + "-" + TASK_PROTOCOL_VERSION2 + "-queue" + (config2.fixedQueue ?? "");
    const routingKey = `REST-${TASK_PROTOCOL_VERSION2}.requests` + (config2.fixedQueue ?? "");
    const deadLetterQueueName = this.id + "-" + TASK_PROTOCOL_VERSION2 + "-dead-letter-queue";
    const deadLetterRoutingKey = "REST-" + TASK_PROTOCOL_VERSION2 + ".dead-letter";
    if (this.config.retry && !this.config.retry.disabled) {
      await this.channel.assertQueue(deadLetterQueueName, {
        deadLetterExchange: config2.exchange.name,
        deadLetterRoutingKey: routingKey,
        messageTtl: this.config.retry?.delay
      });
      await this.channel.bindQueue(deadLetterQueueName, config2.exchange.name, deadLetterRoutingKey);
      this.success("Dead letter queue created and bound to jobs exchange");
      await this.channel.assertQueue(queueName, {
        deadLetterExchange: deadLetterQueueName,
        deadLetterRoutingKey
      });
    } else {
      await this.channel.assertQueue(queueName);
    }
    await this.channel.bindQueue(queueName, config2.exchange.name, routingKey);
    this.success("Queue created and bound to jobs exchange, waiting to consume messages");
    void this.channel.consume(queueName, async (message) => {
      this.verbose("Message received", message);
      try {
        if (!message?.content?.toString()) {
          throw new Error("Invalid message received");
        }
        const payload = JSON.parse(message.content.toString());
        if (!payload?.taskId) {
          throw new Error("Missing payload or taskId, discarding:" + JSON.stringify(payload));
        }
        this.verbose(`Received message with payload: ${JSON.stringify(payload)}`);
        let result;
        try {
          result = await this.executeAxiosCall(payload);
          this.enqueueResult(payload.taskId, payload.shardId, result);
        } catch (error) {
          let e = null;
          if (typeof error === "string") {
            e = { message: error };
          } else if (error instanceof HTTPClientError) {
            if (!this.config.retry.disabled && error.retryable) {
              const headers = message.headers;
              const retryCount = headers?.retry_count ?? 0;
              omnilog7.debug("Retryable error", error, retryCount);
              const max_retries = this.config.retry.maxRetries;
              if (retryCount < max_retries) {
                await channel.publish("omni_tasks", deadLetterRoutingKey, message.content, { headers: { retry_count: retryCount + 1 } });
              } else {
                e = { message: error.message, details: error.originalError.details };
              }
            } else {
              e = { message: error.message, details: error.originalError.details };
            }
          } else if (error instanceof Error) {
            e = { message: error.message || error.toString(), details: error.details };
          } else {
            e = { message: JSON.stringify(error, null, 2) };
          }
          if (e) {
            this.enqueueFailure(payload.taskId, payload.shardId, e);
          }
        } finally {
          channel.ack(message);
        }
      } catch (error) {
        omnilog7.error(`Failed to process message with error: ${error}`, error);
        if (message) {
          let payload = null;
          try {
            payload = JSON.parse(message.content.toString());
          } catch (ex) {
            omnilog7.error("Failed to parse message", message);
          }
          if (payload?.taskId && payload.shardId) {
            this.enqueueFailure(payload.taskId, payload.shardId, error);
          }
          channel.ack(message);
        }
      }
    });
    return true;
  }
};

// src/integrations/Authentication/AuthIntegration.ts
import { EObjectAction as EObjectAction3, Group as Group3, Organisation as Organisation3, User as User4, Workflow as Workflow2, omnilog as omnilog8 } from "omni-shared";

// src/helper/permission.ts
import { defineAbility } from "@casl/ability";
import { Group as Group2, EObjectAction as EObjectAction2, EObjectName } from "omni-shared";
import { performance as performance4 } from "perf_hooks";
import assert from "node:assert";
async function getGroupByMemberId(db, userId) {
  const start = performance4.now();
  const query = {
    _id: {
      $gte: `${Group2.modelName}:`,
      // i.e. _id.startswith(userId + ':')
      $lt: `${Group2.modelName}:\u10FFFF`
    },
    members: {
      $elemMatch: {
        id: userId
      }
    }
  };
  try {
    const result = await db.find(query) || [];
    const end = performance4.now();
    omnilog.trace(`getGroupByMemberId(${userId}) took ${(end - start).toFixed()} ms`);
    return result;
  } catch (err) {
    const end = performance4.now();
    omnilog.info(`getGroupByMemberId(${userId}) returned an error in ${(end - start).toFixed()} ms`);
    db.error(err);
    return [];
  }
}
async function setAcceptedTOS(db, user) {
  try {
    user.tosAccepted = Date.now();
    assert(user._id != null, "User ID is null");
    const dbuserobj = await db.getDocumentById("user" /* USER */, user.id, [], false);
    dbuserobj.tosAccepted = user.tosAccepted;
    await db.putDocumentById("user" /* USER */, user.id, dbuserobj);
    return user.tosAccepted;
  } catch (err) {
    db.error(err);
    return 0;
  }
}
var loadUserPermission = async function(db, user) {
  const start = performance4.now();
  const groups = await getGroupByMemberId(db, user.id);
  const groupIds = groups.map((group) => group.id);
  const permissions = groups.map((group) => group.permission).flat();
  permissions.push(
    // User can edit their own details
    {
      action: [EObjectAction2.READ, EObjectAction2.UPDATE],
      subject: EObjectName.USER,
      conditions: { id: user.id }
    }
  );
  permissions.push(
    // Allow user to read workflows that are shared with them
    {
      action: [EObjectAction2.READ],
      subject: EObjectName.WORKFLOW,
      conditions: { sharedWith: { $elemMatch: { id: user.id } } }
    }
  );
  permissions.push(
    // Allow user to read workflows that are shared with their team
    {
      action: [EObjectAction2.READ],
      subject: EObjectName.WORKFLOW,
      conditions: { sharedWith: { $elemMatch: { id: { $in: groupIds.map((id4) => id4) } } } }
    }
  );
  if (user.organisation != null && user.organisation.id) {
    permissions.push({
      action: [EObjectAction2.READ],
      subject: EObjectName.WORKFLOW,
      conditions: { sharedWith: { $elemMatch: { id: user.organisation?.id } } }
    });
  }
  permissions.push({
    action: [EObjectAction2.UPDATE, EObjectAction2.DELETE],
    subject: EObjectName.WORKFLOW,
    conditions: { owner: user.id }
  });
  permissions.push({
    subject: EObjectName.WORKFLOW,
    action: [EObjectAction2.CREATE, EObjectAction2.READ, EObjectAction2.EXECUTE],
    conditions: [{ meta: { organisation: { id: user.organisation?.id } } }, { org: { id: user.organisation?.id } }]
  });
  permissions.filter((rule) => rule !== null);
  const end = performance4.now();
  omnilog.info(`loadPermission took ${(end - start).toFixed()} ms`);
  return permissions;
};
var PermissionChecker = class {
  _ability;
  constructor(rules) {
    omnilog.debug("User permission ", rules);
    this._ability = defineAbility((allow, forbid) => {
      for (const rule of rules) {
        const fields = void 0;
        allow(rule.action, rule.subject, fields, rule.conditions);
      }
    });
  }
  can(action, subject, field) {
    return this._ability.can(action, subject, field);
  }
};

// src/integrations/Authentication/handlers/user.ts
var createAcceptTOSHandler = function(integration, config2) {
  return {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            username: { type: "string" },
            tosAccepted: { type: "string" }
          }
        }
      }
    },
    handler: async function(request, reply) {
      const user = request.user;
      user.tosAccepted = await setAcceptedTOS(integration.db, user);
      if (user) {
        return await reply.send({ username: user.username, tosAccepted: user.tosAccepted });
      }
      return await reply.code(200).send();
    }
  };
};
var createGetAuthenticatedUserHandler = function(integration, config2) {
  return {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            username: { type: "string" },
            isAdmin: { type: "boolean" },
            tosAccepted: { type: "string" }
          }
        }
      }
    },
    handler: async function(request, reply) {
      const user = request.user;
      if (user) {
        const ability = request.session.get("permission");
        if (ability == null) {
          request.session.set("permission", await loadUserPermission(integration.db, user));
        }
        return await reply.send({
          username: user.username,
          isAdmin: await integration.isAdmin(user),
          tosAccepted: user.tosAccepted
        });
      }
      return await reply.code(200).send();
    }
  };
};
var createLoginHandler = function(integration, config2) {
  return {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            username: { type: "string" },
            isAdmin: { type: "boolean" },
            tosAccepted: { type: "string" }
          }
        }
      }
    },
    handler: async function(request, reply) {
      const user = request.user;
      await integration.login(request);
      await reply.send({
        username: user.username,
        isAdmin: await integration.isAdmin(user),
        tosAccepted: user.tosAccepted
      });
    }
  };
};
var createLogoutHandler = function(config2) {
  return {
    handler: async function(request, reply) {
      try {
        await request.session.destroy();
      } catch (err) {
        return await reply.send(err);
      }
    }
  };
};
var createGenerateTokenHandler = function(integration, config2) {
  return {
    schema: {
      body: {
        type: "object",
        required: ["scopes", "expiresIn"],
        properties: {
          scopes: {
            type: "array",
            items: {
              type: "object",
              required: ["action", "subject"],
              properties: {
                action: { type: "string" },
                subject: { type: "string" },
                orgId: { type: "string" },
                workflowIds: {
                  type: "array",
                  items: { type: "string" }
                }
              }
            }
          },
          expiresIn: { type: "number" }
        }
      },
      response: {
        200: {
          type: "object",
          properties: {
            token: { type: "string" }
          }
        },
        500: {
          type: "object",
          properties: {
            error: { type: "string" }
          }
        }
      }
    },
    handler: async function(request, reply) {
      const { scopes, expiresIn } = request.body || {};
      try {
        if (integration.app.settings.get("omni:feature.permission")?.value) {
          const ability = new PermissionChecker(request.session.get("permission"));
          if (!ability) {
            throw new Error("Action not permitted");
          }
          for (const scope of scopes) {
            const { action, subject, orgId, workflowIds } = scope;
            if (!ability.can(action, subject)) {
              integration.debug("Action not permitted: ", action, subject);
              throw new Error("Action not permitted");
            }
          }
        }
        const user = request.user;
        const token = await integration.generateJwtToken(scopes, user, expiresIn);
        return await reply.code(200).send({ token });
      } catch (err) {
        integration.error("Error generating token: ", err);
        return await reply.code(500).send("Internal error");
      }
    }
  };
};

// src/integrations/Authentication/AuthIntegration.ts
import crypto4 from "crypto";
import jwt2 from "jsonwebtoken";

// src/integrations/Authentication/handlers/oauth2.ts
var oauth2Handler = function(integration, config2) {
  return {
    handler: async function(request, reply) {
      const user = request.user;
      if (!user) {
        return await reply.code(401).send({ error: "Unauthorized" });
      }
      const ns = request.query.ns;
      const vault = integration.manager.app.services.get("credentials");
      const authUrl = await vault.generateAuthUrl(user, ns);
      reply.redirect(authUrl);
    },
    schema: {
      querystring: {
        type: "object",
        properties: {
          ns: { type: "string" }
        },
        required: ["ns"]
      },
      response: {
        "4xx": {
          type: "object",
          properties: {
            error: { type: "string" }
          }
        },
        "3xx": {
          type: "string"
        }
      }
    }
  };
};
var oauth2CallbackHandler = function(integration, config2) {
  return {
    schema: {
      params: {
        type: "object",
        properties: {
          ns: { type: "string" }
        },
        required: ["ns"]
      },
      querystring: {
        type: "object",
        properties: {
          code: { type: "string" },
          scope: { type: "string" }
        },
        required: ["code", "scope"]
      },
      response: {
        302: {
          description: "Redirection response",
          type: "null"
          // Since no body is sent on a redirect
        },
        401: {
          type: "object",
          properties: {
            error: { type: "string" }
          }
        },
        500: {
          type: "object",
          properties: {
            error: { type: "string" }
          }
        }
      }
    },
    handler: async function(request, reply) {
      const user = request.user;
      if (user == null) {
        return await reply.code(401).send({ error: "Unauthorized" });
      }
      const ns = request.params.ns;
      const code = request.query.code;
      const scopes = request.query.scope;
      const vault = integration.manager.app.services.get("credentials");
      const success = await vault.generateAccessToken(user, ns, code, scopes);
      if (success) {
        reply.redirect("/");
      } else {
        reply.code(500).send({ error: "Failed to get access token" });
      }
    }
  };
};

// src/integrations/Authentication/AuthIntegration.ts
var AuthIntegration = class extends APIIntegration {
  db;
  constructor(id4, manager, config2) {
    super(id4, manager, config2 || {});
    this.db = manager.app.services.get("db");
  }
  get serviceConfig() {
    return this.config;
  }
  async load() {
    this.handlers.set("login", createLoginHandler);
    this.handlers.set("logout", createLogoutHandler);
    this.handlers.set("getAuthenticatedUser", createGetAuthenticatedUserHandler);
    this.handlers.set("generateToken", createGenerateTokenHandler);
    this.handlers.set("oauth2", oauth2Handler);
    this.handlers.set("oauth2Callback", oauth2CallbackHandler);
    this.handlers.set("acceptTos", createAcceptTOSHandler);
    return await super.load();
  }
  /**
   * When a user logs in the system would:
   * - load the user permissions
   * - load the user settings
   *
   * @param user
   */
  async login(request) {
    const user = request.user;
    const ability = await loadUserPermission(this.db, user);
    request.session.set("permission", ability);
    omnilog8.debug("Login user", user.id, request.session.sessionId, ability);
  }
  async isAdmin(user) {
    const groups = await getGroupByMemberId(this.db, user.id);
    for (const group of groups) {
      if (group.name.toLowerCase() === "admin") {
        return true;
      }
    }
    return false;
  }
  validateRequestParameters(params) {
    const { username, password, email, status, credit, groups } = params;
    const error = [];
    if (username && !validateName(username)) {
      this.error("Invalid username");
      error.push("Invalid username");
    }
    if (password && !validatePassword(password)) {
      this.error("Invalid password");
      error.push("Invalid password");
    }
    if (email && !validateEmail(email)) {
      this.error("Invalid email");
      error.push("Invalid email");
    }
    if (status && !validateStatus(status)) {
      this.error("Invalid status");
      error.push("Invalid status");
    }
    if (credit && !validateCredit(credit)) {
      this.error("Invalid credit");
      error.push("Invalid credit");
    }
    return error;
  }
  async getUserByUsername(username) {
    try {
      const query = {
        username: username.toLowerCase()
      };
      const result = await this.db.find(query);
      if (result && result.length > 0) {
        return result[0];
      } else {
        return null;
      }
    } catch (err) {
      this.error(err);
      throw err;
    }
  }
  async handleRegister(username, password, tier) {
    const validationErrors = this.validateRequestParameters({ username, password });
    if (!username || !password || validationErrors.length > 0) {
      throw new Error("Invalid request parameters " + validationErrors.join(", "));
    }
    if (tier && !await validateTier(this.db, tier)) {
      throw new Error("Invalid tier");
    }
    try {
      const user = await this.getUserByUsername(username);
      if (user == null) {
        return await this.createUser(username, password, tier);
      } else {
        throw new Error("Unauthorized access");
      }
    } catch (err) {
      this.error(err);
      throw err;
    }
  }
  async generateJwtToken(scopes, issuer, expiresIn = 3600) {
    this.debug("Generating token with scopes: ", scopes);
    try {
      const jwtSecret = this.app.settings.get("omni:auth.jwt.secret")?.value;
      if (jwtSecret) {
        const token = jwt2.sign(
          {
            scopes,
            issuerId: issuer?.id || "",
            tokenId: generateId()
          },
          jwtSecret,
          { expiresIn }
        );
        return token;
      } else {
        throw new Error("JWT secret not configured");
      }
    } catch (err) {
      this.error(err);
      throw err;
    }
  }
  async createUser(username, password, tier) {
    const salt = crypto4.randomBytes(16);
    const hashedPassword = hashPassword(password, salt);
    const newOrg = new Organisation3(generateId(), `Org-${generateId()}`);
    newOrg.createdAt = Math.floor(Date.now() / 1e3);
    newOrg.lastUpdated = Math.floor(Date.now() / 1e3);
    const newGroup = new Group3(generateId(), "Admin");
    newGroup.createdAt = Math.floor(Date.now() / 1e3);
    newGroup.lastUpdated = Math.floor(Date.now() / 1e3);
    newGroup.organisation = { id: newOrg.id, name: newOrg.name };
    newGroup.permission = [
      // Admin rights: r/w users from the same org
      {
        subject: User4.modelName,
        action: [EObjectAction3.CREATE, EObjectAction3.READ, EObjectAction3.UPDATE, EObjectAction3.DELETE],
        conditions: [{ organisation: { id: newOrg.id } }]
      },
      // Admin rights: r/w groups from the same org
      {
        subject: Group3.modelName,
        action: [EObjectAction3.CREATE, EObjectAction3.READ, EObjectAction3.UPDATE, EObjectAction3.DELETE],
        conditions: [{ organisation: { id: newOrg.id } }]
      },
      // Admin rights: r/w/x workflows of the same org
      {
        subject: Workflow2.modelName,
        action: [
          EObjectAction3.CREATE,
          EObjectAction3.READ,
          EObjectAction3.UPDATE,
          EObjectAction3.DELETE,
          EObjectAction3.EXECUTE
        ],
        conditions: [{ org: { id: newOrg.id } }]
      }
    ];
    const newUser = new User4(generateId(), username.toLowerCase());
    newUser.password = hashedPassword.toString("hex");
    newUser.salt = salt.toString("hex");
    newUser.tier = tier;
    newUser.organisation = { id: newOrg.id, name: newOrg.name };
    newUser.createdAt = Math.floor(Date.now() / 1e3);
    newUser.lastUpdated = Math.floor(Date.now() / 1e3);
    await this.db.put(newUser);
    newOrg.members = [{ id: newUser.id, name: newUser.username }];
    newOrg.groups = [{ id: newGroup.id, name: newGroup.name }];
    await this.db.put(newOrg);
    newGroup.members = [{ id: newUser.id, name: newUser.username }];
    await this.db.put(newGroup);
    return newUser;
  }
};

// src/integrations/CdnIntegrations/LocalCdnIntegration.ts
import fs7 from "fs/promises";
import { createReadStream } from "fs";
import { ensureDir as ensureDir3, exists } from "fs-extra";
import { performance as performance5 } from "perf_hooks";
import sharp3 from "sharp";
import { Readable, PassThrough } from "stream";
import murmurHash from "imurmurhash";
import { customAlphabet as customAlphabet2 } from "nanoid";
import path14 from "path";
import { file as tmpFile } from "tmp-promise";

// src/integrations/CdnIntegrations/fileUtils.ts
import mime from "mime-types";
import detectContentType from "detect-content-type";
import { fileTypeFromBuffer } from "file-type";
import sanitize2 from "sanitize-filename";
import { extname as extname2, basename as basename2 } from "path";
var mangleFilename = function(fileName, overrideExtension) {
  const newName = sanitize2(fileName, { replacement: "_" }).toLowerCase();
  let ext = extname2(newName);
  const base = basename2(newName, ext);
  if (overrideExtension && !overrideExtension.startsWith(".")) {
    overrideExtension = "." + overrideExtension;
  }
  ext = overrideExtension || extname2(newName) || "";
  return `${base}${ext}`;
};
var sanitizeFilename = function(fileName, extName) {
  return mangleFilename(
    fileName,
    extName
  );
};
var detectFileDetails = async function(fid, data, opts) {
  let { fileName, mimeType, encoding } = opts;
  let extName = "";
  fileName = fileName?.trim();
  if (fileName) {
    const fromBuffer = await fileTypeFromBuffer(data);
    if (fromBuffer) {
      mimeType ||= mime.lookup(fileName) || fromBuffer.mime;
      extName ||= extname2(fileName) || fromBuffer.ext;
    }
    mimeType ||= mime.lookup(fileName) || detectContentType(data);
    fileName = basename2(fileName, extName);
    extName ||= mime.extension(mimeType) || ".bin";
  } else {
    const fromBuffer = await fileTypeFromBuffer(data);
    if (fromBuffer) {
      mimeType ||= fromBuffer.mime;
      extName ||= fromBuffer.ext;
    }
    mimeType ||= detectContentType(data);
    if (encoding === "utf8") {
      fileName = data.toString("utf8").substring(0, 20).trim().replace(/[^a-z0-9]/gi, "_");
      if (mimeType.startsWith("text/markdown")) {
        extName = "md";
      } else if (mimeType.startsWith("text/html")) {
        extName = "html";
      } else if (mimeType.startsWith("text/svg")) {
        extName = "html";
      } else {
        extName = mime.extension(mimeType) || "txt";
      }
    } else {
      fileName = `${Date.now()}_${fid.replace(",", "-")}`;
      extName = mime.extension(mimeType) || "bin";
    }
  }
  return {
    sanitizedFilename: sanitizeFilename(fileName, extName),
    extName,
    mimeType
  };
};

// src/integrations/CdnIntegrations/LocalCdnIntegration.ts
var HARD_DELETE_AFTER_MINUTES = 60 * 24 * 7;
var THUMBNAIL_RETENTION = "7d";
var MIN_SIZE = 32;
var MAX_SIZE = 512;
var ALLOWED_FIT_OPTIONS = ["cover", "contain", "fill", "inside", "outside"];
var ALLOWED_POSITION_OPTIONS = [
  "center",
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
  "entropy",
  "attention"
];
var fidRegex = /[^a-z0-9,]/g;
var NANOID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
var fidGenerator = customAlphabet2(NANOID_ALPHABET, 10);
var CdnObjectNotFoundError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "CDN_NOT_FOUND";
  }
};
var LocalCdnIntegration = class extends CdnIntegration {
  missCache;
  constructor(id4, manager, config2) {
    super(id4, manager, config2 || {});
    this.missCache = /* @__PURE__ */ new Set();
    if (this.detailConfig.root == null || this.detailConfig.url == null) {
      throw new Error("Local CDN Integration requires a root and url set in the configuration!");
    }
  }
  get detailConfig() {
    return this.config.local;
  }
  async load() {
    this.info("CDN is LOCAL", this.detailConfig);
    return await super.load();
  }
  async writeObject(key, data) {
    const file = this.getPathForFid(key);
    this.debug("writeObject()", key, file);
    await fs7.writeFile(file, data);
    return await fs7.stat(file);
  }
  async hasFile(key) {
    const file = this.getPathForFid(key);
    this.info("hasFile", key, file);
    try {
      const stats = await fs7.stat(file);
      if (stats.isFile()) {
        this.info("hasFile true");
        return true;
      }
    } catch {
      this.verbose("hasFile()", "file not found", key, file);
    }
    this.info("hasFile false");
    this.verbose("hasFile()", "isFile false", key, file);
    return false;
  }
  async readObject(key) {
    const file = this.getPathForFid(key);
    this.debug("readObject()", key, file);
    if (await this.hasFile(key)) {
      return await fs7.readFile(file);
    }
    this.kvStorage.del(`file.${key}`);
    throw new CdnObjectNotFoundError(`cdn.readObject(): no record found for ${key}`);
  }
  async deleteObject(key) {
    const file = this.getPathForFid(key);
    const stat3 = await fs7.stat(file);
    if (stat3 && stat3.isFile()) {
      this.verbose(`Purging expired file ${key} from local CDN`);
      this.debug("deleteObject()", key, file);
      try {
        await fs7.unlink(file);
        return true;
      } catch (ex) {
        this.warn(`Error Purging expired file ${key} from local CDN`, ex);
        return false;
      }
    }
    return false;
  }
  getPathForFid(fid) {
    fid = fid.replace(fidRegex, "");
    const [volume, file] = fid.split(",");
    const fileName = `${this.detailConfig.root}/${volume}/${file}`;
    this.verbose("getPathForFid", fid, fileName);
    return fileName;
  }
  async exportFile(fid, exportDir, fileName, opts) {
    const file = this.getPathForFid(fid);
    const exportFile = path14.join(exportDir, fileName);
    ensureDir3(exportDir);
    if (await exists(exportFile) && !opts.overwrite) {
      return;
    }
    await fs7.copyFile(file, exportFile);
  }
  // This fires whenever the kvstore expires a ew
  async onExpired(purgedKeys = []) {
    this.info(`Purging ${purgedKeys.length} expired files from local CDN`);
    for (const key of purgedKeys) {
      if (key.startsWith("file.")) {
        const fid = key.substring(5);
        try {
          await this.deleteObject(fid);
        } catch (ex) {
          this.verbose(`Error Purging expired file ${fid} from local CDN`, ex);
        }
      }
    }
  }
  // returns a ticket for a file
  async assign(opts) {
    opts ??= {};
    const volumeId = Math.floor(Math.random() * 99).toString().padStart(2, "0");
    const fileId = fidGenerator(10).padStart(10, "0");
    await ensureDir3(`${this.detailConfig.root}/${volumeId}`);
    const ret = {
      fid: `${volumeId},${fileId}`,
      count: 1,
      url: this.detailConfig.url,
      publicUrl: this.detailConfig.url
    };
    return ret;
  }
  // sets the expiry for a file
  async setExpiry(file, userId, expiry) {
    if (file && file.fid) {
      if (expiry != null) {
        this.kvStorage.setExpiry(`file.${file.fid}`, expiry);
        file.expires = expiry;
      } else {
        this.kvStorage.setExpiry(`file.${file.fid}`, null);
        file.expires = Number.MAX_SAFE_INTEGER;
      }
      return this.updateFileEntry(file);
    }
  }
  async softDelete(fid) {
    if (!fid || typeof fid !== "string" || fid.length < 10) {
      this.warn("Softdelete Invalid fid", fid);
      return false;
    }
    fid = fid.replace(fidRegex, "");
    const obj = this.kvStorage.get(`file.${fid}`);
    if (obj != null) {
      this.info("Soft deleting", fid);
      const hard_delete_after_ms = HARD_DELETE_AFTER_MINUTES * 1e3 * 60;
      if (obj.localImport?.hash) {
        this.kvStorage.del("local-import." + obj.localImport.hash);
      }
      this.kvStorage.softDelete(`file.${fid}`, obj.expiry ?? Date.now() + hard_delete_after_ms);
      return true;
    } else {
      return false;
    }
  }
  guessIfBase64(str) {
    if (!str || str.length & 3) {
      return false;
    }
    const mainBodyPattern = /^[A-Za-z0-9+/]+$/;
    const suffixPattern = /^(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})?$/;
    const mainBody = str.substring(0, str.length - 4);
    const suffix = str.substring(str.length - 4);
    return mainBodyPattern.test(mainBody) && suffixPattern.test(suffix);
  }
  // Writes a file to storage using the assigned ticket
  // It will try to infer the mime type and extension and alter the ticket fid to amend inferred extension if needed
  async write(record, ticket, opts, meta) {
    this.info("cdn.write()", "writing file", ticket, opts);
    meta = JSON.parse(JSON.stringify(meta || {})) ?? {};
    if (record.data.url && !record.data.ticket) {
      record.data = record.data.url;
    }
    let encoding = "binary";
    if (typeof record.data === "string") {
      encoding = "base64";
      if (opts.mimeType?.startsWith("text/")) {
        opts.fileType ??= EOmniFileTypes3.document;
        encoding = "utf8";
      } else if (record.data.indexOf("data:") === 0) {
        record.data = record.data.split(",")[1];
      } else if (
        // seems like a  url, use our interfal fetch to get it
        // Note: this does act as a CORS proxy
        record.data.indexOf("http") === 0 || record.data.indexOf("/fid/") === 0
      ) {
        const resp = await CdnIntegration.fetch(record.data);
        record.data = resp.data;
      } else if (record.data.indexOf("fid://") === 0) {
        const fid = record.data.split("://")[1];
        this.success("cdn:write()", "found fid, returning", fid);
        return await this.getByFid(fid);
      } else if (this.guessIfBase64(record.data)) {
        this.warn("Someone passed a base64 encoded image without header into cdn.write(), so we guessed...");
      } else {
        encoding = "utf8";
        opts.fileType ??= EOmniFileTypes3.document;
      }
      record.data = Buffer.from(record.data, encoding);
    }
    if (!record.data) {
      throw new Error("cdn.write(): no data supplied");
    }
    const { mimeType, sanitizedFilename } = await detectFileDetails(ticket.fid, record.data, opts);
    const fileType = opts.fileType ?? CdnResource.determineFileTypeFromMimeType(mimeType) ?? EOmniFileTypes3.file;
    let nsfw2;
    if (fileType === EOmniFileTypes3.image) {
      try {
        if (this.app.options.uncensored) {
          meta.nsfw = {
            status: "disabled",
            reason: "--uncensored option activated"
          };
        } else {
          const result2 = await this.app.nsfwCheck(record.data, { maxDimensions: 299 });
          nsfw2 = { ...result2.classes, isNsfw: result2.isNsfw, status: "success" };
          meta.nsfw = nsfw2;
        }
      } catch (err) {
        this.error("nsfwCheck failed", err);
        meta.nsfw = {
          status: "failed",
          reason: err?.message
        };
      }
    }
    const result = await this.writeObject(ticket.fid, record.data);
    let ttl = this.parseTTL(opts.ttl ?? "");
    const expiresAt = ttl > 0 ? ttl + Date.now() : Number.MAX_SAFE_INTEGER;
    const file = new CdnResource({
      fid: ticket.fid,
      ticket,
      fileType,
      expires: expiresAt,
      // permanent
      fileName: sanitizedFilename,
      size: result.size,
      url: this.getCdnUrl(ticket),
      furl: "",
      mimeType,
      meta
    });
    if (file.isImage()) {
      file.meta = Object.assign(file.meta, CdnResource.getImageMeta(record.data));
    }
    if (ttl > 0) {
    } else {
      ttl = void 0;
    }
    let tags;
    if (opts.tags && Array.isArray(opts.tags) && opts.tags.length > 0) {
      tags = opts.tags.map((t) => `tag.${t}`);
    }
    if (opts.jobId) {
      tags ??= [];
      tags = tags.concat([`job.${opts.jobId}`]);
    }
    this.kvStorage.set(
      `file.${ticket.fid}`,
      file,
      ttl ? ttl + Date.now() : void 0,
      tags,
      opts.userId?.trim().toLowerCase()
    );
    this.missCache.delete(ticket.fid);
    this.verbose("cdn.write()", result);
    if (opts.userId) {
      const server = this.app;
      await server.sendToastToUser(opts.userId, {
        message: `File created: ${file.fileName}`,
        options: { type: "info" }
      });
    }
    return file;
  }
  async updateFileEntry(file) {
    if (file) {
      file.fileName = sanitizeFilename(file.fileName);
      this.kvStorage.updateValue(`file.${file.fid}`, file);
    }
    return await Promise.resolve(file);
  }
  async importLocalFile(filePath, tags = [], userId) {
    const buffer = await fs7.readFile(filePath);
    const inputString = buffer.toString("binary");
    const hash = murmurHash(inputString + filePath).result().toString();
    const exists2 = await this.find(`local-import:${hash}`);
    if (exists2) {
      this.info("Local File with hash", hash, "already exists");
      return exists2;
    } else {
      this.info("Importing Local File with hash ", hash, "...");
      const result = await this.put(buffer, { fileName: path14.basename(filePath), tags, userId }, { localImport: {
        filePath,
        hash
      } });
      delete result.data;
      this.kvStorage.set(`local-import.${hash}`, result.fid);
      return result;
    }
  }
  async importSampleFile(filePath, tags = [], userId) {
    const buffer = await fs7.readFile(filePath);
    const inputString = buffer.toString("binary");
    const hash = murmurHash(inputString + filePath).result().toString();
    const existsFid = this.kvStorage.get(`sample-import.${hash}`);
    if (existsFid) {
      this.info("Sample with hash", hash, "already exists");
      return null;
    } else {
      this.info("Importing sample with hash ", hash, "...");
      const result = await this.put(buffer, { fileName: path14.basename(filePath), tags, userId }, {
        localImport: filePath,
        hash
      });
      this.kvStorage.set(`sample-import.${hash}`, result.fid);
      return result;
    }
  }
  async put(data, opts, meta) {
    opts ??= {};
    const ticket = await this.assign(opts);
    if (ticket != null) {
      const result = await this.write({ data }, ticket, opts, meta);
      this.success("put()", result, result.ticket);
      return result;
    }
    throw new Error("cdn.put(): no Ticket supplied");
  }
  // Store a file for a temporary period of time
  async putTemp(data, opts, meta) {
    opts ??= {};
    opts.ttl ??= this.detailConfig.default_ttl;
    this.info("cdn.putTemp()", opts, meta, this.detailConfig);
    return await this.put(data, opts, meta);
  }
  // returns the volume server for a specific fid
  async find(fid, userId) {
    if (fid == null || fid.length == 0) {
      throw new Error("Null file identifier passed to cdn.find");
    }
    if (fid.startsWith("sample-import:")) {
      const actualFid = this.kvStorage.get(fid.replace("sample-import:", "sample-import."));
      console.warn("looking for static file", fid, actualFid);
      if (actualFid != null) {
        fid = actualFid;
      }
    }
    if (fid.startsWith("local-import:")) {
      const actualFid = this.kvStorage.get(fid.replace("local-import:", "local-import."));
      console.warn("looking for local file", fid, actualFid);
      if (actualFid != null) {
        fid = actualFid;
      }
    }
    const ret = await Promise.resolve(this.kvStorage.get(`file.${fid}`, true));
    const res = this.kvStorage._getRowValue(ret);
    if (res) {
      res.fid ??= fid;
      res.expires = res.expiry;
      const resource = new CdnResource(res);
      return resource;
    } else {
      return null;
    }
  }
  async getByFid(fid, opts, format) {
    return await this.get({ fid }, opts, format);
  }
  async get(ticket, opts, format) {
    if (ticket instanceof CdnResource || ticket.ticket) {
      ticket = ticket.ticket;
    }
    let fid = ticket.fid;
    if (!fid) {
      const error = new CdnObjectNotFoundError(`cdn.get(): no record found for ${ticket.fid}`);
      throw error;
    }
    const cdnRecord = await this.find(fid);
    if (cdnRecord === null) {
      const error = new CdnObjectNotFoundError(`cdn.get(): no record found for ${ticket.fid}`);
      throw error;
    }
    fid = cdnRecord.fid;
    if (format === "stream") {
      const fileLocation = this.getPathForFid(fid);
      if (await this.hasFile(fid)) {
        cdnRecord.data = createReadStream(fileLocation).on("error", (err) => {
          this.error("get() failed with error", err);
        });
        return cdnRecord;
      } else {
        this.kvStorage.del(`file.${ticket.fid}`);
        const error = new CdnObjectNotFoundError(`cdn.get(): no record found for ${ticket.fid}`);
        throw error;
      }
    } else if (format === "file") {
      cdnRecord.data = await tmpFile();
      await fs7.copyFile(this.getPathForFid(fid), cdnRecord.data.path);
      return cdnRecord;
    }
    const data = await this.readObject(fid);
    if (format === "base64" || format === "asBase64") {
      cdnRecord.data = data.toString("base64");
    } else {
      cdnRecord.data = data;
    }
    if (!cdnRecord.fid) {
      cdnRecord.fid = fid;
    }
    return cdnRecord;
  }
  async checkFileExists(fid) {
    const record = await this.find(fid);
    return record != null;
  }
  async serveFile(fid, opts, reply) {
    const start = performance5.now();
    opts ??= {};
    const result = this.serveFileInternal(fid, opts, reply);
    const statusCode = reply?.statusCode ?? "unknownStatusCode";
    this.debug(`CDN: ${fid} ${statusCode} took ${Math.max(1, performance5.now() - start).toFixed()} ms`);
    return await result;
  }
  async serveFileResponse(download, file, dataStream, reply) {
    if (download) {
      return reply.header("Content-Description", "File Transfer").header("Content-Length", file.size).header("Content-Type", "application/octet-stream").header("Content-Disposition", `attachment; filename="${file.fileName}"`).header("Content-Transfer-Encoding", "binary").send(dataStream);
    } else {
      return reply.header("Content-Length", file.size).header("Content-type", file.mimeType).header("Content-Disposition", `inline; filename="${file.fileName}"`).header("Content-Transfer-Encoding", "binary").header(
        "Cache-Control",
        `public, max-age=${file.expires ? Math.max(0, file.expires - Date.now() / 1e3) : 24 * 60 * 60}, immutable`
      ).send(dataStream);
    }
  }
  async serveFileInternal(fid, opts, reply) {
    const lastDotIndex = fid.lastIndexOf(".");
    if (lastDotIndex !== -1) {
      fid = fid.substring(0, lastDotIndex);
    }
    if (this.missCache.has(fid)) {
      return this.fileNotFoundReply(reply, "missCache");
    }
    const hash = murmurHash(JSON.stringify(opts)).result().toString();
    const thumbnailKey = `thumb.${fid}.${hash}`;
    const cachedThumbnail = this.kvStorage.get(thumbnailKey);
    if (cachedThumbnail) {
      this.verbose("CDN: thumbnail from cache", thumbnailKey);
      return reply.send(cachedThumbnail);
    }
    try {
      const file = await this.get({ fid }, {}, "stream");
      if (file == null || file.data == null) {
        this.missCache.add(fid);
        return this.fileNotFoundReply(reply, `${file == null ? "file is null" : "no data"}`);
      }
      const dataStream = file.data;
      const pass = new PassThrough();
      const download = opts.download === "true" || opts.download === true;
      if (!file.isImage()) {
        return await this.serveFileResponse(download, file, dataStream, reply);
      }
      let width = parseInt(opts.width?.toString() ?? "");
      let height = parseInt(opts.height?.toString() ?? "");
      const fit = opts.fit;
      const position = opts.position;
      if (isNaN(width) && !isNaN(height)) {
        width = height;
      } else if (!isNaN(width) && isNaN(height)) {
        height = width;
      }
      if (width > 0 && height > 0) {
        if (width % 32 === 0 && height % 32 === 0 && width >= MIN_SIZE && width <= MAX_SIZE && height >= MIN_SIZE && height <= MAX_SIZE && (fit === void 0 || ALLOWED_FIT_OPTIONS.includes(fit)) && (position === void 0 || ALLOWED_POSITION_OPTIONS.includes(position))) {
          let transform = sharp3().resize({
            width,
            height,
            fit,
            position,
            fastShrinkOnLoad: true
          });
          if (file.meta.nsfw?.isNsfw && !this.app.options.uncensored) {
            transform = transform.blur(20);
          }
          dataStream.pipe(transform).pipe(pass);
          const chunks = [];
          return await new Promise((resolve, reject) => {
            pass.on("data", (chunk) => chunks.push(chunk)).on("end", () => {
              this.info("CDN: thumbnail generated", thumbnailKey);
              const thumbnailBuffer = Buffer.concat(chunks);
              const ttl = Math.max(
                1,
                Math.min(
                  this.parseTTL(THUMBNAIL_RETENTION),
                  file.expires ? file.expires - Date.now() : this.parseTTL(THUMBNAIL_RETENTION)
                )
              );
              this.kvStorage.set(thumbnailKey, thumbnailBuffer, ttl > 0 ? ttl + Date.now() : void 0);
              file.size = thumbnailBuffer.length;
              resolve(this.serveFileResponse(download, file, Readable.from(thumbnailBuffer), reply));
            });
          });
        } else {
          return reply.status(422).send({ error: "Invalid resize options provided." + JSON.stringify(opts) });
        }
      }
      return await this.serveFileResponse(download, file, dataStream, reply);
    } catch (ex) {
      this.missCache.add(fid);
      omnilog.error(ex);
      if (ex instanceof CdnObjectNotFoundError) {
        return this.fileNotFoundReply(reply, ex.message);
      }
      return reply.status(500).send({ error: "Internal server error" });
    }
  }
  fileNotFoundReply(reply, reason) {
    return reply.status(410).header("Cache-Control", "no-cache, no-store, must-revalidate").send({ exists: false, reason });
  }
};

// src/integrations/Chat/handlers/chat.ts
var resolveService = function(integration) {
  return integration.app.services.get("chat");
};
var appendToChatExport = function() {
  return {
    description: "Get chat history",
    params: [
      { name: "contextId", required: true, type: "string", description: "The chat context id" },
      { name: "payload", required: false, type: "object", description: "Client compatible chat payload" }
    ]
  };
};
var appendToChatHandler = function(integration, config2) {
  return {
    schema: {
      params: {
        type: "object",
        properties: {
          contextId: { type: "string" }
        },
        required: ["contextId"]
      },
      body: {
        type: "object",
        properties: {
          payload: {
            type: "object",
            properties: {
              msgstore: { type: "object" },
              version: { type: "number" },
              ts: { type: "number" }
            },
            required: ["msgstore", "version", "ts"]
          }
        },
        required: ["payload"]
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "string" }
          }
        },
        400: {
          type: "object",
          properties: {
            error: { type: "string" }
          }
        },
        500: {
          type: "object",
          properties: {
            error: { type: "string" }
          }
        }
      }
    },
    handler: function(request, reply) {
      const chatService = resolveService(integration);
      const contextId = request?.params?.contextId;
      const body = request.body;
      if (!body) {
        return reply.status(400).send({ error: "Bad request or parameters" });
      }
      const user = request.user;
      chatService.writeAppend(user.id, contextId, body.payload, body.payload.ts).then(() => {
        return reply.status(200).send({ success: "ok" });
      }).catch((error) => {
        omnilog.error(error);
        return reply.status(500).send({ error: "Unable to update chat context history" });
      });
    }
  };
};
var clearChatHistoryClientExport = function() {
  return {
    description: "Clear chat history",
    params: [{ name: "contextId", required: true, type: "string", description: "The context id" }]
  };
};
var clearChatHistoryHandler = function(integration, config2) {
  return {
    schema: {
      params: {
        type: "object",
        properties: {
          contextId: { type: "string" }
        },
        required: ["contextId"]
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "string" }
          }
        },
        500: {
          type: "object",
          properties: {
            error: { type: "string" }
          }
        }
      }
    },
    handler: function(request, reply) {
      const user = request.user;
      const contextId = request?.params?.contextId;
      const chatService = resolveService(integration);
      chatService.clearChatHistory(user.id, contextId).then((result) => {
        return reply.status(200).send({ success: "ok" });
      }).catch((error) => {
        omnilog.error(error);
        return reply.status(500).send({ error: "Unable to find clear context history for context " + contextId });
      });
    }
  };
};
var getChatHistoryClientExport = function() {
  return {
    description: "Get chat history",
    params: [
      { name: "contextId", required: true, type: "string", description: "The context id" },
      {
        name: "up_to_ts",
        required: false,
        type: "number",
        description: "The latest inclusive timestamp to fetch to. Defaults to NOW"
      },
      {
        name: "length",
        required: false,
        type: "number",
        description: "The latest inclusive timestamp to fetch to. Defaults to 10"
      }
    ]
  };
};
var getChatHistoryHandler = function(integration, config2) {
  return {
    schema: {
      params: {
        type: "object",
        properties: {
          contextId: { type: "string" }
        },
        required: ["contextId"]
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "string" },
            result: {
              type: "object",
              properties: {
                up_to_ts: { type: "number" },
                result: {
                  type: "array",
                  items: {
                    ts: { type: "number" },
                    version: { type: "number" },
                    msgstore: {
                      type: "object",
                      properties: {
                        message: { type: "string" },
                        sender: { type: "string" },
                        workflowId: { type: "string" }
                      }
                    }
                  }
                }
              }
            }
          },
          required: ["success", "result"]
        },
        500: {
          type: "object",
          properties: {
            error: { type: "string" }
          },
          required: ["error"]
        }
      }
    },
    handler: function(request, reply) {
      const user = request.user;
      const contextId = request?.params?.contextId;
      const chatService = resolveService(integration);
      chatService.getChatContext(user.id, contextId).then((chatContext) => {
        return reply.status(200).send({ success: "ok", result: chatContext.partialGet(ChatContext.MAX_LENGTH, Date.now()) });
      }).catch((error) => {
        omnilog.error(error);
        return reply.status(500).send({ error: "Unable to find chat context history for context " + contextId });
      });
    }
  };
};

// src/integrations/Chat/ChatIntegration.ts
var ChatIntegration = class extends APIIntegration {
  constructor(id4, manager, config2) {
    super(id4, manager, config2 || {});
  }
  async load() {
    this.handlers.set("chatHistory", getChatHistoryHandler);
    this.clientExports.set("chatHistory", getChatHistoryClientExport);
    this.handlers.set("append", appendToChatHandler);
    this.clientExports.set("append", appendToChatExport);
    this.handlers.set("clear", clearChatHistoryHandler);
    this.clientExports.set("clear", clearChatHistoryClientExport);
    return await super.load();
  }
};

// src/integrations/Mercenaries/handlers/ping.ts
var pingClientExport = function() {
  return {
    description: "Ping the server",
    params: []
  };
};
var ping = function(payload) {
  return { ping: "pong", payload: payload || {} };
};
var createPingHandler = function(integration, config2) {
  return {
    handler: function(request, reply) {
      let body = request.body || {};
      integration.debug("Ping request", body);
      body = ping(body);
      return reply.send(body);
    }
  };
};

// src/integrations/Mercenaries/handlers/fetch.ts
var createFetchExport = function() {
  return {
    description: "Fetch a url via the server",
    params: [
      {
        name: "url",
        type: "string",
        description: "The url to fetch",
        required: true
      }
    ]
  };
};
var serverFetch = async function(integration, url) {
  const httpClient = integration.app.services.get("http_client");
  const response = await httpClient.request({
    url,
    timeout: 30 * 1e3,
    // 30 seconds time-out
    responseType: "arraybuffer"
  });
  const headers = {
    "Content-Length": response.data.length,
    "Content-Type": response.headers["content-type"]
  };
  return { data: response.data, headers };
};
var createFetchHandler = function(integration, config2) {
  return {
    handler: async function(request, reply) {
      try {
        const imagePath = request.query.url ?? request.body?.url;
        if (imagePath == null) {
          integration.warn("Missing url parameter", request.query, request.body);
          return await reply.status(422).send({ error: "Missing url parameter" });
        }
        integration.debug("/server_fetch request:\n", imagePath, "\n");
        const response = await serverFetch(integration, imagePath);
        reply.header("Content-Length", response.headers["Content-Length"]);
        reply.header("Content-Type", response.headers["Content-Type"]);
        return await reply.status(200).send(response.data);
      } catch (error) {
        integration.error("Error", error);
        return await reply.status(500).send(error);
      }
    }
  };
};

// src/integrations/Mercenaries/handlers/integrations.ts
var createIntegrationsHandler = function(integration, config2) {
  return {
    handler: function(request, reply) {
      const body = Array.from(integration.manager.clientExports);
      return reply.send(body);
    }
  };
};

// src/integrations/Mercenaries/handlers/runscript.ts
var runScriptClientExport = function() {
  return {
    description: "run a script",
    params: []
  };
};
var createRunScriptHandler = function(integration, config2) {
  return {
    handler: async function(request, reply) {
      const body = request.body;
      const script = request.params.script;
      if (script != null && script.trim?.() != "") {
        integration.debug("Runscript request", script, body);
        try {
          const result = await integration.runScript(request, script, body);
          return await reply.send(result);
        } catch (ex) {
          integration.error(ex);
          const message = ex.message || "Unknown error";
          if (message.indexOf("ENOENT") > -1) {
            return await reply.code(404).send({ error: "No such command" });
          }
          return await reply.code(500).send({ error: ex.message });
        }
      } else {
        return await reply.code(400).send({ error: "Invalid script name" });
      }
    }
  };
};

// src/integrations/Mercenaries/handlers/sse.ts
var createListenHandler = function(integration, config2) {
  return {
    handler: function(request, reply) {
      const user = request.user;
      const sessionId = request.session.sessionId;
      if (!user || !sessionId) {
        integration.error("SSE: User not logged in", sessionId, user);
        return reply.status(403).send({ error: "User not logged in" });
      }
      try {
        const messagingService = integration.app.services.get("messaging");
        messagingService.onConnectionCreate(request, reply);
      } catch (ex) {
        integration.error("SSE: Error creating connection", ex);
        return reply.status(500).send({ error: "Error creating connection" });
      }
    }
  };
};

// src/integrations/Mercenaries/handlers/component.ts
var addEditPatchComponentClientExport = function() {
  return {
    description: "add/remove/edit components",
    params: []
  };
};

// src/integrations/Mercenaries/handlers/components.ts
var getComponentsClientExport = function() {
  return {
    description: "Get available components from the server",
    params: []
  };
};
var getComponentsHandler = function(integration, config2) {
  return {
    schema: {
      querystring: {
        type: "object",
        properties: {
          includeDefinitions: { type: "boolean" }
        },
        required: ["includeDefinitions"]
      },
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string" },
              flags: { type: "number" },
              macros: {
                type: "object",
                properties: {
                  exec: { type: "string" },
                  save: { type: "string" }
                }
              },
              origin: { type: "string" },
              customData: { type: "object" },
              displayNamespace: { type: "string" },
              displayOperationId: { type: "string" },
              apiNamespace: { type: "string" },
              apiOperationId: { type: "string" },
              responseContent: { type: "string" },
              category: { type: "string" },
              enabled: { type: "boolean" },
              errors: { type: "array", items: { type: "string" } },
              tags: { type: "array", items: { type: "string" } },
              description: { type: "string" },
              title: { type: "string" },
              method: { type: "string" },
              renderTemplate: { type: "string" },
              hash: { type: "string" },
              name: { type: "string" },
              inputs: { type: "object" },
              outputs: { type: "object" },
              controls: { type: "object" },
              meta: { type: "object" }
            }
          }
        },
        403: {
          type: "object",
          properties: {
            error: { type: "string" }
          }
        }
      }
    },
    handler: async function(request, reply) {
      const user = request.user;
      const sessionId = request.session.sessionId;
      if (!user || !sessionId) {
        integration.error("User not logged in", sessionId, user);
        return await reply.status(403).send({ error: "User not logged in" });
      }
      const body = Object.assign(
        { includeDefinitions: false },
        request.body,
        request.query
      );
      integration.debug("Components request", body);
      const blockManager = integration.app.blocks;
      const result = await blockManager.getAllBlocks(body.includeDefinitions);
      if (result && Array.isArray(result)) {
        integration.debug("Components result", result.length);
      }
      return result;
    }
  };
};

// src/integrations/Mercenaries/handlers/credentials.ts
import { User as User5, omnilog as omnilog9 } from "omni-shared";
var errorCredentialSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    error: { type: "string" }
  },
  required: ["ok", "error"]
};
var setUserKeySchema = {
  body: {
    type: "object",
    properties: {
      apiNamespace: { type: "string" },
      variableName: { type: "string" },
      credential: { type: "string" },
      meta: { type: "object" }
    },
    required: ["apiNamespace", "variableName", "credential"]
  },
  response: {
    200: {
      type: "object",
      properties: {
        ok: { type: "boolean" }
      }
    },
    500: errorCredentialSchema
  }
};
var bulkAddUserKeysSchema = {
  body: {
    type: "object",
    properties: {
      keys: {
        type: "array",
        items: {
          type: "object",
          properties: {
            apiNamespace: { type: "string" },
            variableName: { type: "string" },
            credential: { type: "string" }
          },
          required: ["apiNamespace", "variableName", "credential"]
        }
      }
    },
    required: ["keys"]
  },
  response: {
    200: {
      type: "object",
      properties: {
        ok: { type: "boolean" }
      }
    },
    500: errorCredentialSchema
  }
};
var revokeUserKeySchema = {
  querystring: {
    type: "object",
    properties: {
      apiNamespace: { type: "string" },
      variableName: { type: "string" }
    },
    required: ["apiNamespace", "variableName"]
  },
  response: {
    200: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        error: { type: "string" }
      },
      required: ["ok"]
    },
    500: errorCredentialSchema
  }
};
var createSetUserKeyHandler = function(integration, config2) {
  return {
    schema: setUserKeySchema,
    handler: async function(request, reply) {
      const { apiNamespace, variableName, credential } = request.body;
      const user = request.user;
      const credentialService = integration.app.services.get("credentials");
      if (credentialService) {
        try {
          await credentialService.setUserCredential(user, apiNamespace, variableName, credential);
          await reply.code(200).send({ ok: true });
        } catch (err) {
          integration.error(err);
          await reply.code(500).send({ ok: false, error: "Internal Server Error" });
        }
      } else {
        integration.error("CredentialService is disabled");
        await reply.code(500).send({ ok: true, error: "Setting user credential is not supported" });
      }
    }
  };
};
var bulkSetUserKeysHandler = function(integration, config2) {
  return {
    schema: bulkAddUserKeysSchema,
    handler: async function(request, reply) {
      const { keys } = request.body || {};
      const user = request.user;
      const credentialService = integration.app.services.get("credentials");
      if (credentialService) {
        if (Array.isArray(keys)) {
          for (const k of keys) {
            try {
              omnilog9.debug("bulkSetUserKeysHandler", k);
              await credentialService.setUserCredential(user, k.apiNamespace, k.variableName, k.credential);
            } catch (err) {
              integration.error(err);
            }
          }
        }
        await reply.code(200).send({ ok: true });
      } else {
        integration.error("CredentialService is disabled");
        await reply.code(500).send({ ok: true, error: "Setting user credential is not supported" });
      }
    }
  };
};
var createRevokeUserKeyHandler = function(integration, config2) {
  return {
    schema: revokeUserKeySchema,
    handler: async function(request, reply) {
      const apiNamespace = request.query.apiNamespace;
      const variableName = request.query.variableName;
      const user = request.user;
      const credentialService = integration.app.services.get("credentials");
      if (credentialService) {
        try {
          if (await credentialService.revokeUserCredentials(user, apiNamespace, variableName)) {
            await reply.code(200).send({ ok: true });
          } else {
            await reply.code(200).send({ ok: false, error: "Failed to revoke key" });
          }
        } catch (err) {
          integration.error(err);
          await reply.code(500).send({ ok: false, error: "Internal Server Error" });
        }
      } else {
        integration.error("CredentialService is disabled");
        await reply.code(500).send({ ok: true, error: "User credential is not supported" });
      }
    }
  };
};
var createListUserKeysHandler = function(integration, config2) {
  return {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            keys: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  meta: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      description: { type: "string" },
                      revoked: { type: "boolean" }
                    }
                  },
                  apiNamespace: { type: "string" },
                  tokenType: { type: "string" },
                  owner: { type: "string" }
                }
              }
            }
          },
          required: ["ok", "keys"]
        },
        500: errorCredentialSchema
      }
    },
    handler: async function(request, reply) {
      const user = request.user;
      const credentialService = integration.app.services.get("credentials");
      if (credentialService) {
        try {
          const keys = await credentialService.listKeyMetadata(user.id, User5.modelName);
          await reply.code(200).send({ ok: true, keys });
        } catch (err) {
          integration.error(err);
          await reply.code(500).send({ ok: false, error: "Internal Server Error" });
        }
      } else {
        integration.error("CredentialService is disabled");
        await reply.code(500).send({ ok: true, error: "User credential is not supported" });
      }
    }
  };
};
var createGetRequiredKeysHandler = function(integration, config2) {
  return {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            requiredCredentials: {
              type: "object",
              additionalProperties: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  displayName: { type: "string" },
                  credential: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        displayName: { type: "string" },
                        type: { type: "string", enum: ["apiKey", "oauth2"] },
                        hasKey: { type: "boolean" }
                      }
                    }
                  }
                },
                required: ["id", "displayName", "credential"]
              }
            }
          },
          required: ["ok", "requiredCredentials"]
        },
        500: errorCredentialSchema
      }
    },
    handler: async function(request, reply) {
      try {
        const user = request.user;
        const credentialService = integration.app.services.get("credentials");
        const keys = await credentialService.listKeyMetadata(user.id, User5.modelName);
        const blockManager = integration.app.blocks;
        const namespaces = blockManager.getAllNamespaces();
        const requiredCredentials = {};
        await Promise.all(
          namespaces.map(async (namespace) => {
            try {
              const requiredCredentialsForNamespace = blockManager.getRequiredCredentials(namespace.namespace);
              requiredCredentialsForNamespace.forEach((item) => {
                item.hasKey = keys.some((key) => {
                  return key.apiNamespace === namespace.namespace && key.tokenType === item.id;
                });
              });
              if (!requiredCredentialsForNamespace || Object.keys(requiredCredentialsForNamespace).length === 0) {
                return;
              }
              requiredCredentials[namespace.namespace] = {
                id: `${namespace.namespace}${namespace.version ? "@" + namespace.version : ""}`,
                displayName: namespace.title ?? namespace.namespace,
                credential: requiredCredentialsForNamespace
              };
            } catch (err) {
              integration.error(err);
            }
          })
        );
        await reply.code(200).send({ ok: true, requiredCredentials });
      } catch (err) {
        integration.error(err);
        await reply.code(500).send({ ok: false, error: "Internal Server Error" });
      }
    }
  };
};

// src/integrations/Mercenaries/handlers/extensions.ts
var getExtensions = function(integration) {
  const app = integration.app;
  const extensions = app.extensions.all().map((extension) => {
    const config2 = extension.extensionConfig;
    return {
      id: config2.id,
      description: config2.description,
      title: config2.title,
      scripts: {
        client: config2.scripts?.client
      },
      blocks: config2.blocks,
      patches: config2.patches,
      errors: extension.errors,
      ...config2.client || {}
    };
  });
  return extensions;
};
var createGetExtensionHandler = function(integration, config2) {
  return {
    // schema: {
    //   response: {
    //     200: {
    //       type: 'array',
    //       items: {
    //         type: 'object',
    //         properties: {
    //           id: { type: 'string' },
    //           description: { type: 'string' },
    //           title: { type: 'string' },
    //           scripts: { type: 'object' },
    //           blocks: {
    //             type: 'array',
    //             items: {
    //               type: 'object',
    //             },
    //           },
    //           patches: {
    //             type: 'array',
    //             items: {
    //               type: 'object',
    //             }
    //           },
    //           errors: {
    //             type: 'array',
    //             items: {
    //               type: 'object',
    //             }
    //           },
    //           addToWorkbench: { type: 'boolean' },
    //           singleton: { type: 'boolean' },
    //           winbox: { type: 'object' },
    //         }
    //       }
    //     }
    //   }
    // },
    handler: function(request, reply) {
      let body = request.body || {};
      integration.debug("Ping request", body);
      body = getExtensions(integration);
      return reply.send(body);
    }
  };
};

// src/integrations/Mercenaries/MercsDefaultIntegration.ts
import { stat as stat2 } from "fs/promises";
import sanitize3 from "sanitize-filename";
var runScript = async function(integration, context, scriptName, payload, opts) {
  let extension;
  if (scriptName.includes(":")) {
    let extensionId;
    [extensionId, scriptName] = scriptName.split(":");
    extension = integration.app.extensions.get(extensionId);
    if (!extension) {
      throw new Error(`Invalid Script ${extensionId}:${scriptName}`);
    }
  }
  scriptName = sanitize3(scriptName);
  const fileName = extension ? extension.getScriptFile(scriptName) : `${process.cwd()}/scripts/${scriptName}.js`;
  if (await stat2(fileName)) {
    let result = null;
    const modules = {};
    try {
      modules.script = (await import(`file://${fileName}?version=${Number(/* @__PURE__ */ new Date())}`)).default;
      const inputContext = context;
      const ctxContent = {
        userId: inputContext.user?.id || inputContext.userId,
        sessionId: inputContext.session?.sessionId || inputContext.sessionId,
        user: inputContext.user,
        session: inputContext.session,
        integration,
        app: integration.app
      };
      const ctx = {
        ...ctxContent,
        getData: () => ctxContent
      };
      ctx.request = Object.prototype.hasOwnProperty.call(context, "workflowId") ? void 0 : context;
      if (modules.script.permission) {
        integration.info("Checking required permission for script", fileName);
        let userPermission = ctx.session?.get("permission");
        if (!userPermission) {
          integration.info("No permission found in session, trying to load user permission from DB");
          const db = integration.app.services.get("db");
          const user = await db.get(`user:${ctx.userId}`);
          userPermission = await loadUserPermission(db, user);
        }
        const ability = new PermissionChecker(userPermission);
        await modules.script.permission(ctx, ability, payload);
      }
      integration.info("Invoking server script", fileName);
      result = await modules.script.exec(ctx, payload || {}, opts);
      integration.verbose("runscript result", result);
    } catch (e) {
      const error = e.message || e;
      integration.error(error);
      throw e;
    } finally {
      delete modules.script;
    }
    return result;
  } else {
    throw new Error(`Script not found: ${fileName}`);
  }
};
var MercsDefaultIntegration = class extends APIIntegration {
  constructor(id4, manager, config2) {
    super(id4, manager, config2 || {});
  }
  async load() {
    this.handlers.set("ping", createPingHandler);
    this.handlers.set("getExtensions", createGetExtensionHandler);
    this.handlers.set("fetch", createFetchHandler);
    this.handlers.set("listen", createListenHandler);
    this.handlers.set("integrations", createIntegrationsHandler);
    this.handlers.set("runscript", createRunScriptHandler);
    this.handlers.set("components", getComponentsHandler);
    this.handlers.set("setUserKey", createSetUserKeyHandler);
    this.handlers.set("revokeUserKey", createRevokeUserKeyHandler);
    this.handlers.set("listUserKeys", createListUserKeysHandler);
    this.handlers.set("getRequiredKeys", createGetRequiredKeysHandler);
    this.handlers.set("bulkAddUserKeys", bulkSetUserKeysHandler);
    this.clientExports.set("ping", pingClientExport);
    this.clientExports.set("fetch", createFetchExport);
    this.clientExports.set("runscript", runScriptClientExport);
    this.clientExports.set("components", getComponentsClientExport);
    this.clientExports.set("addEditPatchComponent", addEditPatchComponentClientExport);
    return await super.load();
  }
  async runScript(request, scriptName, payload, opts) {
    return await runScript(this, request, scriptName, payload, opts);
  }
  async runScriptFromWorkflow(ctx, scriptName, payload, opts) {
    return await runScript(this, ctx, scriptName, payload, opts);
  }
};

// src/integrations/WorkflowIntegration/WorkflowIntegration.ts
import {
  Collection,
  CreatePaginatedObject,
  EObjectAction as EObjectAction6,
  Workflow as Workflow4,
  omnilog as omnilog10
} from "omni-shared";
import { v4 as uuidv44 } from "uuid";

// src/integrations/WorkflowIntegration/handlers/exec.ts
import { EObjectAction as EObjectAction4, EObjectName as EObjectName2 } from "omni-shared";
import assert2 from "node:assert";
var execWorkflowClientExport = function() {
  return {
    description: "Execute a workflow",
    params: [
      { name: "workflow", required: true, type: "object", description: "The workflow to execute" },
      { name: "args", required: false, type: "object", description: "optional args" },
      { name: "startNode", required: false, type: "number", description: "optional start node" }
    ]
  };
};
var stopWorkflowClientExport = function() {
  return {
    description: "Stop currently running workflows",
    params: []
  };
};
var startWorkflow = async (integration, workflowId, session, user, args, startNode, sender, flags) => {
  assert2(session.sessionId !== void 0);
  sender ??= "omni";
  args ??= {};
  startNode ??= 0;
  const workflow = await integration.getRecipe(workflowId, user.id, true);
  if (!workflow) {
    throw new Error(`Recipe not found: ${workflowId}`);
  }
  integration.debug("startRecipe by id", workflowId);
  const jobService = integration.app.services.get("jobs");
  return await jobService.startRecipe(workflow, session.sessionId, user.id, args, startNode, sender);
};
var stopWorkflowHandler = function(integration, config2) {
  return {
    schema: {
      body: {
        type: "object",
        properties: {
          jobId: { type: "string" }
        }
      },
      response: {
        200: {
          type: "object",
          properties: {}
        }
      }
    },
    handler: async function(request, reply) {
      const jobService = integration.app.services.get("jobs");
      const body = request.body || {};
      const jobsStopped = jobService.stopJob(body.jobId);
      omnilog.log(`stopWorkflow stopped ${jobsStopped} jobs`);
      return await reply.status(200).send({});
    }
  };
};
var execWorkflowHandler = function(integration, config2) {
  return {
    schema: {
      body: {
        type: "object",
        properties: {
          workflow: { type: "string" },
          // version: { type: 'string' },
          args: { type: "object" },
          startNode: { type: "number" }
        },
        required: ["workflow"]
      },
      response: {
        200: {
          type: "object",
          properties: {
            result: {
              type: "object",
              properties: {
                status: { type: "string" },
                jobId: { type: "string" },
                sender: { type: "string" }
              },
              required: ["status", "jobId", "sender"]
            }
          }
        },
        403: {
          type: "object",
          properties: {
            error: { type: "string" }
          }
        },
        500: {
          type: "object",
          properties: {
            error: { type: "string" }
          }
        }
      }
    },
    handler: async function(request, reply) {
      const body = request.body || {};
      const user = request.user;
      const sender = "omni";
      integration.debug("Execute request", body);
      try {
        if (integration.app.settings.get("omni:feature.permission")?.value) {
          const ability = new PermissionChecker(request.session.get("permission"));
          if (!ability?.can(EObjectAction4.EXECUTE, EObjectName2.WORKFLOW)) {
            return await reply.status(403).send({ error: "You do not have permission to execute the workflow" });
          }
        }
        const result = await startWorkflow(
          integration,
          body.workflow,
          request.session,
          user,
          body.args,
          body.startNode,
          sender
        );
        return await reply.status(200).send({ result: { status: "JOB_STARTED", jobId: result.jobId, sender } });
      } catch (ex) {
        integration.error(ex);
        return await reply.status(500).send({ error: "An error occurred" });
      }
    }
  };
};

// src/integrations/WorkflowIntegration/handlers/jobs.ts
var jobsClientExport = function() {
  return {
    description: "Get information about jobs from the server",
    params: []
  };
};
var getJobs = function(integration, payload) {
  const jobService = integration.app.services.get("jobs");
  const jobs = (Array.from(jobService.jobs.values()) ?? []).map((c) => c.toJSON(payload));
  return { jobs };
};
var createJobsHandler = function(integration, config2) {
  return {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            jobs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  state: { type: "string" },
                  user: { type: "string" }
                }
              }
            }
          }
        }
      }
    },
    handler: function(request, reply) {
      const body = Object.assign({}, request.body, request.query);
      integration.debug("Jobs request", body);
      const result = getJobs(integration, body);
      return reply.send(result);
    }
  };
};

// src/integrations/WorkflowIntegration/WorkflowIntegration.ts
import { OmniComponentMacroTypes as OmniComponentMacroTypes44 } from "omni-sockets";

// src/integrations/WorkflowIntegration/handlers/results.ts
var getWorkflowResultsClientHandler = function() {
  return {
    description: "Return job results",
    params: [
      { name: "jobId", required: true, type: "string", description: "The job to retrieve results for" }
    ]
  };
};
var createGetWorkflowResultsHandler = function(integration, config2) {
  return {
    schema: {
      querystring: {
        type: "object",
        properties: {
          jobId: { type: "string" }
        },
        required: ["jobId"]
      },
      response: {
        200: {
          type: "object",
          properties: {
            text: { type: "array", items: { type: "string" } },
            job: {
              type: "object",
              additionalProperties: true,
              properties: {}
            }
          },
          additionalProperties: true,
          required: ["job"]
        }
      }
    },
    handler: async function(request, reply) {
      const body = request.body || request.query;
      const jobService = integration.app.services.get("jobs");
      const storage = jobService.kvStorage;
      try {
        if (!storage) {
          throw new Error("No storage available");
        }
        const result = storage.get("result." + body.jobId);
        if (!result) {
          return await reply.status(404).send({ error: "Job not found" });
        }
        if (result.job.userId !== request.user.id) {
          return await reply.status(403).send({ error: "Unauthorized access" });
        }
        return await reply.status(200).send(result);
      } catch (ex) {
        return await reply.status(500).send({ error: ex.message });
      }
    }
  };
};

// src/integrations/WorkflowIntegration/handlers/workflow.ts
import { EObjectAction as EObjectAction5, EObjectName as EObjectName3, Workflow as Workflow3 } from "omni-shared";
import sanitize4 from "sanitize-filename";
var getMetaSchema = function() {
  return {
    type: "object",
    properties: {
      name: { type: "string" },
      author: { type: "string" },
      description: { type: "string" },
      category: { type: "string" },
      help: { type: "string" },
      created: { type: "number" },
      updated: { type: "number" },
      pictureUrl: { type: "string" },
      tags: {
        type: "array",
        items: { type: "string" }
      }
    }
  };
};
var getRecipeSchema = function(withReteNodes = true) {
  const schema = {
    type: "object",
    properties: {
      id: { type: "string" },
      // version: { type: 'string' },
      _rev: { type: "string" },
      owner: { type: "string" },
      org: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string" },
          name: { type: "string" }
        }
      },
      meta: getMetaSchema(),
      api: {
        type: "object",
        additionalProperties: true
      },
      ui: {
        type: "object",
        template: {
          type: "string"
        },
        additionalProperties: true
      }
    }
  };
  if (!withReteNodes) {
    return schema;
  }
  const schemaWithRete = {
    ...schema,
    properties: {
      ...schema.properties,
      rete: {
        type: "object",
        // ...TODO...
        additionalProperties: true
      }
    }
  };
  return schemaWithRete;
};
var deleteWorkflowClientExport = function() {
  return {
    description: "delete a workflow",
    params: [
      { name: "id", required: true, type: "string", description: "The workflow to delete" },
      { name: "_rev", required: false, type: "string", description: "The current revision of the workflow" }
    ]
  };
};
var createDeleteWorkflowHandler = function(integration, config2) {
  return {
    handler: async function(request, reply) {
      const workflowId = request.params.workflowId;
      const _id = `wf:${workflowId}`;
      integration.debug("deleteWorkflow", _id);
      const workflow = await integration.db.get(_id);
      if (!workflow) {
        return await reply.code(404).send({ error: "Workflow not found" });
      }
      const ability = new PermissionChecker(request.session.get("permission"));
      if (!ability.can(EObjectAction5.DELETE, Workflow3.fromJSON(workflow))) {
        return await reply.code(401).send({ error: "Insufficient permission: DELETE" });
      }
      const result = await integration.deleteWorkflow(workflow);
      return await reply.status(200).send({ success: "ok", result });
    }
  };
};
var getWorkflowsClientExport = function() {
  return {
    description: "Get a list of workflows",
    params: []
  };
};
var createGetWorkflowsHandler = function(integration, config2) {
  return {
    schema: {
      querystring: {
        type: "object",
        properties: {
          bookmark: {
            type: "string"
          },
          limit: {
            type: "string"
          }
        }
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: {
              type: "string"
            },
            workflows: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: {
                    type: "string"
                  },
                  owner: {
                    type: "string"
                  },
                  canDelete: {
                    type: "boolean"
                  },
                  starred: {
                    type: "boolean"
                  },
                  meta: getMetaSchema(),
                  ui: {
                    type: "object",
                    template: {
                      type: "string"
                    },
                    additionalProperties: true
                  }
                }
              }
            },
            skipped: {
              type: "number"
            },
            remaining: {
              type: "number"
            },
            currBookmark: {
              type: "string"
            },
            nextBookmark: {
              type: "string"
            },
            prevBookmark: {
              type: "string"
            }
          }
        }
      }
    },
    handler: async function(request, reply) {
      const user = request.user;
      const bookmark = request.query.bookmark;
      const pageSize = request.query.limit ? parseInt(request.query.limit) : 10;
      if (pageSize < 1 || pageSize > 500) {
        return await reply.status(400).send({ error: "Invalid pageSize" });
      }
      const userIds = [user.id, "-----public-----"];
      const collection = await integration.getWorkflowSummariesAsCollection(userIds, true);
      const ability = new PermissionChecker(request.session.get("permission"));
      const page = collection.getPage(pageSize, bookmark);
      const workflowsDisplayed = page.page.map((item) => {
        const workflow = item.value;
        let canDelete = true;
        if (integration.app.settings.get("omni:feature.permission")?.value) {
          canDelete = ability.can(EObjectAction5.DELETE, Workflow3.fromJSON(workflow));
        }
        let owner = "Unknown";
        if (workflow.owner === "-----public-----") {
          owner = "mercenaries.ai";
        } else if (workflow.owner === user.id) {
          owner = "You";
        }
        const starred = Math.random() > 0.8;
        return {
          ...workflow,
          id: item.id,
          owner,
          canDelete,
          starred
        };
      });
      return await reply.status(200).send({
        success: "ok",
        workflows: workflowsDisplayed,
        skipped: page.skipped,
        remaining: page.remaining,
        currBookmark: page.currBookmark,
        nextBookmark: page.nextBookmark,
        prevBookmark: page.prevBookmark
      });
    }
  };
};
var cloneWorkflowHandlerClientExport = function() {
  return {
    description: "clone a workflow to a new user",
    params: []
  };
};
var cloneWorkflowHandler = function(integration, config2) {
  return {
    schema: {
      body: {
        type: "object",
        properties: {
          id: { type: "string" },
          // version: { type: 'string' },
          meta: getMetaSchema()
        },
        required: ["id"]
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "string" },
            workflow: getRecipeSchema()
          },
          required: ["success", "workflow"]
        },
        403: {
          type: "object",
          properties: {
            error: { type: "string" }
          },
          required: ["error"],
          additionalProperties: false
        }
      }
    },
    handler: async function(request, reply) {
      const user = request.user;
      if (integration.app.settings.get("omni:feature.permission")?.value) {
        const ability = new PermissionChecker(request.session.get("permission"));
        if (!ability?.can(EObjectAction5.CREATE, EObjectName3.WORKFLOW)) {
          throw new Error("Unauthorized access");
        }
      }
      const body = request.body;
      const result = await integration.cloneRecipe(body.id, user, body.meta);
      if (!result) {
        return await reply.status(403).send({ error: "Workflow clone unsuccessful" });
      }
      return await reply.status(200).send({ success: "ok", workflow: result });
    }
  };
};
var updateWorkflowHandlerClientExport = function() {
  return {
    description: "Update a workflow",
    params: [
      { name: "id", required: true, type: "string", description: "The recipe id" },
      { name: "rete", required: false, type: "object", description: "The new rete" },
      { name: "meta", required: false, type: "object", description: "The new meta" }
    ]
  };
};
var createUpdateWorkflowHandler = function(integration, config2) {
  return {
    schema: {
      body: {
        type: "object",
        required: ["id", "rete"],
        properties: {
          id: { type: "string" },
          rete: { type: "object", additionalProperties: true },
          meta: getMetaSchema(),
          ui: { type: "object", additionalProperties: true }
        }
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "string" },
            workflow: getRecipeSchema(),
            flags: { type: "array", items: { type: "string" } }
          }
        },
        403: {
          type: "object",
          properties: {
            error: { type: "string" }
          }
        }
      }
    },
    handler: async function(request, reply) {
      const user = request.user;
      const body = request.body || {};
      if (integration.app.settings.get("omni:feature.permission")?.value) {
        const ability = new PermissionChecker(request.session.get("permission"));
        if (!ability?.can(EObjectAction5.UPDATE, EObjectName3.WORKFLOW)) {
          throw new Error(`Insufficient permission: ${EObjectAction5.UPDATE} ${EObjectName3.WORKFLOW}`);
        }
      }
      const result = await integration.updateWorkflow(body.id, { rete: body.rete, meta: body.meta }, user);
      if (!result) {
        console.log("updateWorkflowHandler: updateWorkflow returned null");
        return await reply.status(403).send({ error: "Workflow update unsuccessful" });
      }
      const flags = [];
      if (result.owner === user.id)
        flags.push("owner");
      if (result.owner === "-----public-----") {
        flags.push("public");
        flags.push("readonly");
      }
      return await reply.status(200).send({ success: "ok", workflow: result, flags });
    }
  };
};
var createWorkflowClientExport = function() {
  return {
    description: "Create a new workflow",
    params: [
      { name: "rete", required: true, type: "object", description: "The workflows rete" },
      { name: "meta", required: false, type: "object", description: "The workflows meta data" }
    ]
  };
};
var createWorkflowClientHandler = function(integration, config2) {
  return {
    schema: {
      schema: {
        body: {
          type: "object",
          properties: {
            rete: {
              type: "object",
              additionalProperties: true
            },
            meta: getMetaSchema()
          },
          required: ["rete", "meta"]
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "string" },
              workflow: getRecipeSchema()
            },
            required: ["success", "workflow"]
          }
        }
      }
    },
    handler: async function(request, reply) {
      const user = request.user;
      const body = request.body || {};
      if (integration.app.settings.get("omni:feature.permission")?.value) {
        const ability = new PermissionChecker(request.session.get("permission"));
        if (!ability?.can(EObjectAction5.CREATE, EObjectName3.WORKFLOW)) {
          throw new Error("Unauthorized access");
        }
      }
      const result = await integration.createWorkflow(body, user);
      return await reply.status(200).send({ success: "ok", workflow: result });
    }
  };
};
var loadWorkflowHandlerClientExport = function() {
  return {
    description: "Load a workflow",
    params: []
  };
};
var loadWorkflowHandler = function(integration, config2) {
  return {
    schema: {
      params: {
        type: "object",
        properties: {
          workflowId: { type: "string" }
          // version: { type: 'string' }
        },
        required: ["workflowId"]
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "string" },
            workflow: getRecipeSchema(),
            flags: { type: "array", items: { type: "string" } }
          },
          required: ["success", "workflow", "flags"]
        },
        404: {
          type: "object",
          properties: {
            error: { type: "string" }
          },
          required: ["error"]
        },
        500: {
          type: "object",
          properties: {
            success: { type: "string" },
            error: { type: "string" }
          },
          required: ["success", "error"]
        }
      }
    },
    handler: async function(request, reply) {
      if (!integration.db) {
        return await reply.status(500).send({ success: "error", error: "Internal server error" });
      }
      const user = request.user;
      const workflowId = request.params.workflowId;
      const workflow = await integration.getRecipe(workflowId, user.id, true);
      if (!workflow) {
        return await reply.status(404).send({ error: "Workflow not found" });
      }
      const flags = [];
      if (workflow.owner === user.id)
        flags.push("owner");
      if (workflow.owner === "-----public-----") {
        flags.push("public");
        flags.push("readonly");
      }
      return await reply.status(200).send({ success: "ok", workflow, flags });
    }
  };
};
var downloadWorkflowHandler = function(integration, config2) {
  return {
    // schema: {
    //   params: {
    //     type: 'object',
    //     properties: {
    //       workflowId: { type: 'string' }
    //       // version: { type: 'string' }
    //     },
    //     required: ['workflowId']
    //   },
    //   response: {
    //     200: getRecipeSchema(true),
    //     404: {
    //       type: 'object',
    //       properties: {
    //         error: { type: 'string' }
    //       },
    //       required: ['error']
    //     },
    //     500: {
    //       type: 'object',
    //       properties: {
    //         error: { type: 'string' }
    //       },
    //       required: ['error']
    //     }
    //   }
    // },
    handler: async function(request, reply) {
      if (!integration.db) {
        return await reply.status(500).send({ success: "error", error: "Internal server error" });
      }
      const user = request.user;
      const workflowId = request.params.workflowId;
      const workflow = await integration.getRecipe(workflowId, user.id, true);
      if (!workflow) {
        return await reply.status(404).send({ error: "Workflow not found" });
      }
      let fileName = `${workflow.meta.name}_${workflow.id.replace(
        /[^a-zA-Z0-9-_]/g,
        "_"
      )}_${Date.now()}.sql`;
      fileName = sanitize4(fileName);
      const exportFile = await integration.exportWorkflow(workflowId, user.id, fileName);
      return await reply.header("Content-Disposition", `attachment; filename="${fileName}"`).header("Content-Type", "application/vnd.sqlite3").status(200).send(exportFile);
    }
  };
};

// src/integrations/WorkflowIntegration/WorkflowIntegration.ts
import { readFileSync as readFileSync4, unlinkSync as unlinkSync2 } from "fs";
import path15 from "path";
var WorkflowIntegration = class extends APIIntegration {
  db;
  constructor(id4, manager, config2) {
    super(id4, manager, config2 || {});
    this.db = manager.app.services.get("db");
  }
  async load() {
    this.app.api2._post = {
      url_array_to_cdn: async function(ctx, data) {
        return await Promise.all(
          data.map((obj) => {
            return ctx.app.cdn.putTemp(obj.url, { userId: ctx.userId, jobId: ctx.jobId });
          })
        );
      }
    };
    this.startWorkflow = startWorkflow;
    this.handlers.set("load", loadWorkflowHandler);
    this.clientExports.set("load", loadWorkflowHandlerClientExport);
    this.handlers.set("create", createWorkflowClientHandler);
    this.clientExports.set("create", createWorkflowClientExport);
    this.handlers.set("clone", cloneWorkflowHandler);
    this.clientExports.set("clone", cloneWorkflowHandlerClientExport);
    this.handlers.set("update", createUpdateWorkflowHandler);
    this.clientExports.set("update", updateWorkflowHandlerClientExport);
    this.handlers.set("getWorkflows", createGetWorkflowsHandler);
    this.handlers.set("deleteWorkflow", createDeleteWorkflowHandler);
    this.handlers.set("results", createGetWorkflowResultsHandler);
    this.handlers.set("exec", execWorkflowHandler);
    this.handlers.set("stop", stopWorkflowHandler);
    this.handlers.set("jobs", createJobsHandler);
    this.handlers.set("download", downloadWorkflowHandler);
    this.clientExports.set("exec", execWorkflowClientExport);
    this.clientExports.set("stop", stopWorkflowClientExport);
    this.clientExports.set("getWorkflows", getWorkflowsClientExport);
    this.clientExports.set("deleteWorkflow", deleteWorkflowClientExport);
    this.clientExports.set("results", getWorkflowResultsClientHandler);
    this.clientExports.set("jobs", jobsClientExport);
    return await super.load();
  }
  async deleteWorkflow(workflow) {
    const _id = `wf:${workflow.id}`;
    let _rev = workflow._rev;
    if (!_rev) {
      const doc = await this.db.get(_id);
      if (!doc) {
        throw new Error(`deleteWorkflow: workflow ${workflow.id} not found`);
      }
      _rev = doc?._rev;
    }
    return await this.db.delete({ _id, _rev });
  }
  // Creates a new Workflow
  async createWorkflow(data, user) {
    const id4 = uuidv44();
    if (user.organisation == null) {
      throw new Error(`createWorkflow: user ${user.id} does not have an organization`);
    }
    const meta = {
      created: Date.now(),
      updated: Date.now(),
      author: "Anonymous",
      name: data.meta?.name ?? "New Recipe",
      description: data.meta?.description ?? "No description.",
      category: data.meta?.category ?? "",
      pictureUrl: data.meta?.pictureUrl ?? void 0,
      help: data.meta?.help ?? "",
      tags: (data.meta?.tags ?? []).filter((tag) => tag !== "template")
      // Exclude 'template' tag
    };
    const workflow = new Workflow4(id4, {
      owner: user.id,
      org: user.organisation
    });
    workflow.setRete(data.rete);
    workflow.setMeta(meta);
    const result = await this.db.put(workflow);
    if (!result) {
      throw new Error(`createWorkflow: failed to create workflow ${id4}`);
    }
    workflow._rev = result._rev;
    this.success(`Workflow ${workflow.id} created by ${user.id}`);
    return workflow;
  }
  // clones an existing workflow
  async cloneWorkflow(workflowId, version, user, meta) {
    omnilog10.warn("cloneWorkflow: deprecated, use cloneRecipe instead");
    return await this.cloneRecipe(workflowId, user, meta);
  }
  async cloneRecipe(workflowId, user, meta) {
    const existingWorkflow = await this.getRecipe(workflowId, user.id, true);
    if (existingWorkflow != null) {
      const wf = JSON.parse(JSON.stringify(existingWorkflow));
      wf.meta = Object.assign(wf.meta, meta ?? { name: `${wf.meta.name} (my copy)` });
      const clonedWorkflow = await this.createWorkflow(
        {
          meta: wf.meta,
          rete: wf.rete
        },
        user
      );
      return clonedWorkflow;
    }
  }
  // Saves a workflow if it does not exist
  async saveWorkflowIfNotExists(workflow, user) {
    const userId = typeof user === "object" ? user.id : user;
    const realUser = typeof user === "object" ? user : await this.app.services.get("db").get(`user:${userId}`);
    if (realUser) {
      const existingWorkflow = await this.getRecipe(workflow.id, userId, true);
      if (existingWorkflow != null) {
        return existingWorkflow;
      } else {
        return await this.createWorkflow(
          {
            meta: workflow.meta,
            rete: workflow.rete
          },
          realUser
        );
      }
    } else {
      throw new Error(`User ${userId} not found`);
    }
  }
  // Updates an existing workflow (but does not change the owner!)
  async updateWorkflow(workflowId, update, user, opts) {
    const userId = typeof user === "object" ? user.id : user;
    const workflow = await this.getRecipe(workflowId, userId, false);
    if (!workflow) {
      console.log("Workflow not found for update");
      return;
    }
    let changed = false;
    if (update.rete) {
      workflow.setRete(update.rete);
      changed = true;
    }
    if (update.meta) {
      workflow.setMeta(update.meta);
      changed = true;
    }
    const mercsServer = this.app;
    const blockNames = Array.from(new Set(Object.values(workflow.rete.nodes).map((n) => n.name)));
    const blocks2 = (await mercsServer.blocks.getInstances(blockNames, void 0)).blocks;
    if (!opts?.suppressMacroExecution) {
      workflow.ui = {};
      await Promise.all(
        Array.from(Object.values(workflow.rete.nodes)).map(async (n) => {
          const c = blocks2.find((b) => b.name === n.name);
          if (c != null && c.macros?.save) {
            const saveMacro = mercsServer.blocks.getMacro(c, OmniComponentMacroTypes44.ON_SAVE);
            if (saveMacro) {
              try {
                changed = await saveMacro(n, workflow, {
                  app: mercsServer,
                  user: userId
                });
              } catch (ex) {
                omnilog10.error(`Error executing macro ${OmniComponentMacroTypes44.ON_SAVE} for ${c?.name}`, ex);
              }
            } else {
              omnilog10.warn(`No ${OmniComponentMacroTypes44.ON_SAVE} macro found for ${c?.name}`);
            }
          }
        })
      );
    }
    const result = await this.db.put(workflow);
    workflow._rev = result._rev;
    this.success(`Workflow ${workflow.id} updated by ${userId}`);
    return workflow;
  }
  async getWorkflow(id4, version, user, allowPublic = true) {
    omnilog10.warn("getWorkflow: deprecated, use getRecipe instead");
    return await this.getRecipe(id4, user, allowPublic);
  }
  async getRecipe(id4, user, allowPublic = true) {
    if (!id4) {
      throw new Error("getWorkflow: id is null");
    }
    const userIds = [];
    if (user) {
      userIds.push(user);
    }
    if (allowPublic) {
      userIds.push("-----public-----");
    }
    this.debug(`getWorkflow: id:${id4} user:${user} allowPublic:${allowPublic}`);
    const workflowJson = await this.db.getDocumentById("wf" /* WORKFLOW */, id4, userIds, allowPublic);
    if (!workflowJson) {
      return null;
    }
    return Workflow4.fromJSON(workflowJson);
  }
  async getWorkflowSummariesAsCollection(ownerIds, includePublic) {
    const records = await this.db.getDocumentsByOwnerId("wf" /* WORKFLOW */, ownerIds, includePublic);
    const collection = new Collection("creator", "owner", "org", null);
    records.docs.forEach((doc) => {
      collection.add({
        type: "wf" /* WORKFLOW */,
        id: doc._id.replace("wf:", ""),
        value: {
          name: doc.meta?.name || "unknownName",
          owner: doc.meta?.owner || doc.owner,
          pictureUrl: doc.meta.pictureUrl || doc.pictureUrl || "",
          description: doc.meta.description || doc.description || "unknownDesc",
          aiUsage: doc.ai_usage ?? doc.aiUsage ?? "",
          created: doc.created
        }
      });
    });
    return collection;
  }
  async getWorkflowsForSessionUser(ctx, docsPerPage, page, filter = "") {
    const recipeOwner = ctx.user.recipeOwner;
    const userIds = [];
    if (recipeOwner == void 0 || recipeOwner == "user")
      userIds.push(ctx.user.id);
    if (recipeOwner == void 0 || recipeOwner == "public")
      userIds.push("-----public-----");
    const queryFilter = /* @__PURE__ */ new Map();
    if (filter !== "") {
      queryFilter.set("id", filter);
      queryFilter.set("meta.name", filter);
      queryFilter.set("meta.description", filter);
      queryFilter.set("meta.tags", filter);
    }
    const result = await this.db.getDocumentsByOwnerIdV2(
      "wf" /* WORKFLOW */,
      userIds,
      page,
      docsPerPage,
      queryFilter
    );
    if (result.docs) {
      result.docs.sort((a, b) => {
        return b.meta.updated - a.meta.updated;
      });
    }
    const ability = new PermissionChecker(ctx.session.get("permission"));
    const workflows = result.docs.map((x) => {
      const workflow = Workflow4.fromJSON(x);
      return {
        _id: workflow._id,
        _rev: workflow._rev,
        canDelete: ability.can(EObjectAction6.DELETE, workflow),
        id: workflow.id,
        meta: workflow.meta,
        org: workflow.org,
        ui: workflow.ui,
        owner: workflow.owner
      };
    });
    const responseObj = CreatePaginatedObject();
    responseObj.data = workflows;
    responseObj.page = result.page;
    responseObj.docsPerPage = result.docsPerPage;
    responseObj.totalPages = result.totalPages;
    responseObj.totalDocs = result.totalDocs;
    return responseObj;
  }
  async exportWorkflow(workflowId, userId, fileName) {
    omnilog10.debug("exportWorkflow", workflowId, userId);
    const workflow = await this.getRecipe(workflowId, userId, true);
    if (!workflow) {
      throw new Error("Workflow not found");
    }
    const blockNames = Array.from(new Set(Object.values(workflow.rete.nodes).map((n) => n.name)));
    const blocks2 = (await this.app.blocks.getInstances(blockNames, userId, void 0))?.blocks;
    if (!blocks2 || blocks2.length === 0) {
      throw new Error("Invalid workflow");
    }
    const exportFile = new KVStorage(this, {
      // @ts-ignore
      dbPath: this.config.tempExportDir ?? this.config.settings?.paths?.tmpPath ?? "./data.local/tmp",
      dbName: fileName
    });
    await exportFile.init();
    await Promise.all(Object.values(workflow.rete.nodes).map(async (n) => {
      const c = blocks2.find((b) => b.name === n.name);
      for (const inputKey of Object.keys(c.inputs)) {
        if (c.inputs[inputKey].format === "password") {
          n.data[inputKey] = "";
        }
        if (["image", "file", "audio", "video", "document"].includes(c.inputs[inputKey].customSocket)) {
          if (n.data[inputKey] && n.data[inputKey].startsWith("fid:")) {
            const resource = await this.app.cdn.get({ fid: n.data[inputKey].replace("fid://", "") });
            omnilog10.debug("Resource", resource.data ? resource.data.length : "null");
            if (resource) {
              exportFile.set(n.data[inputKey], resource.data);
            } else {
              console.error(`Resource ${n.data[inputKey]} not found`);
            }
          }
        }
      }
    }));
    exportFile.set(`wf:${workflow.id}`, workflow);
    await exportFile.stop();
    const exportFilePath = path15.join(exportFile.config.dbPath, fileName);
    const fileBuff = readFileSync4(exportFilePath);
    unlinkSync2(path15.join(exportFile.config.dbPath, fileName));
    return fileBuff;
  }
  async importWorkflow(userId, fid) {
    const resource = await this.app.cdn.get({ fid: fid.replace("fid://", "") });
    const kv = new KVStorage(this.app, {
      //@ts-ignore
      dbPath: this.config.tempExportDir ?? "./data.local/tmp"
    });
    await kv.initFromBuffer(resource.data);
    const newFidMap = /* @__PURE__ */ new Map();
    const cdnEntries = kv.getAny("fid://");
    for (const kvPair of cdnEntries) {
      const cdnResource = await this.app.cdn.put(kvPair.value, { userId });
      const key = kvPair.key.replace("fid://", "");
      newFidMap.set(key, cdnResource);
      console.log(`found in kv storate: key = ${key} and stored its cdnResource: ${JSON.stringify(cdnResource)}`);
    }
    const kvEntries = kv.getAny("wf:");
    if (!kvEntries || kvEntries.length === 0) {
      const error_message = "No workflows to be imported";
      console.error(error_message);
      throw new Error(error_message);
    }
    const result = [];
    for (const kvPair of kvEntries) {
      const workflow = kvPair.value;
      const blockNames = Array.from(new Set(Object.values(workflow.rete.nodes).map((n) => n.name)));
      const blocks2 = (await this.app.blocks.getInstances(blockNames, userId, "missing_block"))?.blocks;
      let error_list = "";
      for (const node of Object.values(workflow.rete.nodes)) {
        const block7 = blocks2.find((b) => b.name === node.name);
        if (!block7) {
          const error_message = `Block ${node.name} not found`;
          console.error(error_message);
          error_list += error_message + "\n";
        } else {
          for (const inputKey of Object.keys(block7.inputs)) {
            if (["image", "file", "audio", "video", "document"].includes(block7.inputs[inputKey].customSocket)) {
              if (node.data[inputKey] && typeof node.data[inputKey] === "string" && node.data[inputKey].startsWith("fid:")) {
                const key = node.data[inputKey].replace("fid://", "");
                const cdnResource = newFidMap.get(key);
                const newFid = cdnResource.fid;
                if (newFid) {
                  node.data[inputKey] = `fid://${newFid}`;
                  if (node.data.preview) {
                    node.data.preview = [cdnResource];
                  }
                } else {
                  const error = `Resource key ${key} not found in kv ${JSON.stringify(newFidMap)}
`;
                  error_list += error;
                  console.error(error);
                }
              }
            }
          }
        }
      }
      if (error_list !== "") {
        console.error(error_list);
      }
      const saved_workflow = await this.saveWorkflowIfNotExists(workflow, userId);
      result.push(saved_workflow);
    }
    return result;
  }
};

// src/run.ts
import { Command } from "commander";
import path16 from "path";
registerOmnilogGlobal();
omnilog.wrapConsoleLogger();
var config = loadServerConfig("../../.mercs.yaml");
var packagejson = JSON.parse(
  fs8.readFileSync("package.json", { encoding: "utf-8" })
);
var serverConfig = config.server;
serverConfig.version = packagejson.version;
var server_config = serverConfig;
process.on("unhandledRejection", (reason, promise) => {
  omnilog.trace();
  omnilog.error("Uncaught error in", promise, reason);
  process.exit(1);
});
var bootstrap = async () => {
  const program = new Command();
  program.option("-u, --updateExtensions", "Update all extensions").option("-rb, --refreshBlocks", "Refresh block definitions").option("-px, --pruneExtensions", "Prune deprecated extensions").option("-R, --resetDB <scope>", "Reset the database on startup. Valid scopes: blocks,settings").option("--chown <user>", "Reparent all unowned files in CDN storage to this user").option("-ll, --loglevel <level>", "Set logging level", serverConfig.logger.level.toString()).option("--emittery", "Enable emittery debug logs. Always disabled on log level silent(0).").option("--verbose", "Max logging level").option(
    "-purl, --publicUrl <url>",
    "Set the external address for services that requires it",
    server_config.network.public_url
  ).option(
    "--fastifyopt <fastifyopt>",
    "Advanced Fastify options - JSON Object",
    JSON.stringify({ bodyLimit: 32 * 1024 * 1024 })
  ).option("-p, --port <port>", "Overwrite the listening port", "1688").option("--openBrowser").option("-nx, --noExtensions", "Disable all (non core) extensions").option("-s, --secure <secure>", "Enforce secure connection", false).option("--dburl <url>", "Connection URL to the DB").option("--dbuser <user>", "DB admin user", "admin@local.host").option("--viteProxy <url>", "Specify vite debugger URL").option("--autologin", "Autologin user").option("--uncensored", "Disable NSFW protections").option("--flushLogs", "Flush logs to DB").option("--noupdate", "Disable update checks").option("--createUser <userpass>", "Create a user with the given username and password in the format username:password").requiredOption("-l, --listen <addr>", "Sets the interface the host listens on");
  program.action((options) => {
    omnilog.setCustomLevel("emittery", options.emittery ? OmniLogLevels.verbose : OmniLogLevels.silent);
    omnilog.level = options.verbose ? OmniLogLevels.verbose : Number.parseInt(options.loglevel);
    const isLocalStack = options.listen === "127.0.0.1";
    if (options.autologin === void 0) {
      options.autologin = isLocalStack;
    }
    if (options.flushLogs === void 0) {
      options.flushLogs = true;
    }
    if (!options.dburl) {
      server_config.services.db.pocketbaseDbUrl = isLocalStack ? serverConfig.services.db.pocketbase.local.dbUrl : serverConfig.services.db.pocketbase.development.dbUrl;
    } else {
      server_config.services.db.pocketbaseDbUrl = options.dburl;
    }
    server_config.services.db.pocketbaseDbAdmin = options.dbuser;
    server_config.services.db.flushLogs = options.flushLogs;
    const publicURL = new URL(options.publicUrl);
    server_config.network.public_url = options.publicUrl;
    server_config.session.cookie.secure = options.secure;
    const currentCDNLocalRoute = new URL(server_config.integrations.cdn.localRoute);
    server_config.integrations.cdn.local.url = publicURL.host;
    currentCDNLocalRoute.protocol = publicURL.protocol;
    currentCDNLocalRoute.hostname = publicURL.hostname;
    currentCDNLocalRoute.port = publicURL.port;
    server_config.integrations.cdn.localRoute = currentCDNLocalRoute.href;
    void boot(options);
  });
  program.parse();
};
var boot = async (options) => {
  const server = new Server_default("mercs", serverConfig, options);
  await server.initGlobalSettings();
  const extensionPath = path16.join(process.cwd(), "extensions");
  omnilog.status_start("--- Ensuring core extensions -----");
  await ServerExtensionManager.ensureCoreExtensions(extensionPath, packagejson.version);
  omnilog.status_success("OK");
  omnilog.status_start("--- Updating extensions -----");
  await ServerExtensionManager.updateExtensions(extensionPath, packagejson.version, options);
  omnilog.status_success("OK");
  if (options.pruneExtensions) {
    omnilog.status_start("--- Pruning extensions -----");
    await ServerExtensionManager.pruneExtensions(extensionPath);
    omnilog.status_success("OK");
  }
  omnilog.status_start("Booting Server");
  const dbConfig = Object.assign({ id: "db" }, server_config.services?.db);
  server.use(DBService, dbConfig, "service");
  const messagingConfig = Object.assign(
    { id: "messaging" },
    serverConfig.services?.messaging
  );
  server.use(MessagingServerService, messagingConfig, "service");
  const amqpConfig = Object.assign({ id: "amqp" }, serverConfig.services?.amqp);
  server.use(AmqpService, amqpConfig);
  if (!serverConfig.services?.credentials?.disabled) {
    if (serverConfig.services?.credentials?.type === "local") {
      const store = new LocalFileCredentialStore(serverConfig.services?.credentials?.storeConfig);
      server.use(
        CredentialService,
        Object.assign({ id: "credentials" }, serverConfig.services?.credentials, { store })
      );
    } else if (serverConfig.services?.credentials?.type === "vaultWarden") {
      const store = new VaultWardenCredentialStore(serverConfig.services?.credentials?.storeConfig);
      server.use(
        CredentialService,
        Object.assign({ id: "credentials" }, serverConfig.services?.credentials, { store })
      );
    } else {
      server.debug("\u26A0\uFE0FDefault to KV storage");
      server.use(CredentialService, Object.assign({ id: "credentials" }, serverConfig.services?.credentials));
    }
  } else {
    server.warn("\u26A0\uFE0FCredentialService is disabled in config.");
  }
  if (!serverConfig.services?.rest_consumer?.disabled) {
    const consumerConfig = Object.assign(
      { id: "rest_consumer" },
      serverConfig.services?.rest_consumer
    );
    server.use(RESTConsumerService, consumerConfig);
  } else {
    server.warn("\u26A0\uFE0FRestConsumerService is disabled in config.");
  }
  server.use(HttpClientService, { id: "http_client" });
  const apiConfig = {
    id: "api",
    host: "http://127.0.0.1:1688",
    // remote API is disabled?
    integrationsUrl: "/api/v1/mercenaries/integrations"
  };
  server.use(APIServerService, apiConfig);
  const cdnConfig = Object.assign({ id: "cdn" }, serverConfig.integrations?.cdn);
  server.use(LocalCdnIntegration, cdnConfig, "integration");
  const jobControllerServiceConfig = Object.assign(
    { id: "jobs" },
    serverConfig.services?.jobs
  );
  server.use(JobControllerService, jobControllerServiceConfig);
  const chatServiceConfig = Object.assign({ id: "chat" });
  server.use(ChatService, chatServiceConfig);
  const listenOn = new URL("http://0.0.0.0:1688");
  listenOn.hostname = options.listen;
  listenOn.protocol = options.secure ? "https" : "http";
  listenOn.port = options.port;
  const fastifyOptions = JSON.parse(options.fastifyopt);
  const corsOrigin = [listenOn.origin];
  if (options.viteProxy !== void 0) {
    corsOrigin.push(options.viteProxy);
  }
  const dbuser = options.dbuser;
  const adminUsername = dbuser.split(":")[0] ?? "admin@local.host";
  const adminPassword = dbuser.split(":")[1] ?? "admin@local.host";
  const fastifyConfig = {
    id: "httpd",
    listen: { host: listenOn.hostname, port: Number.parseInt(listenOn.port) },
    cors: { origin: corsOrigin, credentials: true },
    autologin: options.autologin,
    admin: {
      username: adminUsername,
      password: adminPassword
    },
    proxy: {
      enabled: options.viteProxy !== void 0,
      viteDebugger: options.viteProxy
    },
    plugins: {},
    opts: fastifyOptions,
    session: {
      secret: serverConfig.session.secret,
      cookie: serverConfig.session.cookie,
      kvStorage: serverConfig.kvStorage
    },
    rateLimit: {
      global: serverConfig.network.rateLimit.global,
      max: serverConfig.network.rateLimit.max,
      timeWindow: serverConfig.network.rateLimit.timeWindow
    }
  };
  server.use(FastifyServerService, fastifyConfig);
  const mercsIntegrationConfig = Object.assign(
    { id: "mercenaries" },
    serverConfig.integrations?.mercenaries
  );
  server.use(MercsDefaultIntegration, mercsIntegrationConfig);
  const workflowConfig = Object.assign(
    { id: "workflow" },
    serverConfig.integrations?.workflow
  );
  server.use(WorkflowIntegration, workflowConfig);
  const authConfig = Object.assign({ id: "auth" }, serverConfig.integrations?.auth);
  server.use(AuthIntegration, authConfig);
  const chatConfig = Object.assign({ id: "chat" }, serverConfig.integrations?.chat);
  server.use(ChatIntegration, chatConfig);
  await server.init();
  await server.load();
  await server.start();
  omnilog.status_success(`Server has started and is ready to accept connections on ${listenOn.origin}`);
  omnilog.status_success("Ctrl-C to quit.");
  if (await headlesscommands(server, options)) {
    process.exit(0);
  }
  if (options.openBrowser) {
    switch (os3.platform()) {
      case "win32":
        exec(`start ${options.publicUrl}`);
        break;
      case "darwin":
        exec(`open ${options.publicUrl}`);
        break;
    }
  }
};
var headlesscommands = async (server, options) => {
  if (options.createUser) {
    omnilog.status_start("--- Running Command - CreateUser -----");
    const authService = server.integrations.get("auth");
    const tokens = options.createUser.split(":");
    assert3(tokens.length === 2, "Invalid username:password format. Expecting format <username:password>");
    omnilog.status_start(`Creating ${tokens[0]}`);
    const existUser = await authService.getUserByUsername(tokens[0]);
    if (existUser !== null) {
      omnilog.status_success(`User ${tokens[0]} already exists`);
      return true;
    }
    const user = await authService.handleRegister(tokens[0], tokens[1]);
    omnilog.status_success(`Created ${user.username} with ID ${user.id}`);
    return true;
  }
  return false;
};
bootstrap().catch((err) => {
  omnilog.trace();
  omnilog.error("Caught unhandled exception during bootstrap: ", err);
  process.exit(1);
});
//# sourceMappingURL=run.js.map
