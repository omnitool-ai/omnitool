/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

const BetterSqlite3 = require('better-sqlite3');
const fs = require('node:fs');
const { getExecutable } = require('./pocketdbutils.js');
const { spawn } = require('node:child_process');
const yaml = require('js-yaml');
const { omniCwd, sleep } = require('./utils');
const path = require('node:path');

const MARKED = '.migrated';

function ensure_sqlite(dbPath) {
  const dbFile = 'legacy_monolith.db';
  const dbFullPath = path.join(dbPath, dbFile);
  if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(dbPath, { recursive: true });
  }
  const sqlitedb = new BetterSqlite3(dbFullPath);

  if (!tableExists(sqlitedb, 'kvstore')) {
    console.log(`[DB Migration] Creating SQLite DB store for the first time in:\n${dbFullPath}`);
    const initSql = fs.readFileSync(path.join(omniCwd(), 'packages/omni-server/src/core', 'KVInit.sql'), {
      encoding: 'utf-8'
    });
    sqlitedb.exec(initSql);
  }
  return sqlitedb;
}

function tableExists(sqlitedb, tableName) {
  const row = sqlitedb
    .prepare(
      `SELECT name
    FROM sqlite_master
    WHERE type='table' AND name=?;`
    )
    .get(tableName);

  return Boolean(row);
}

async function migrate_from_pocket(pocketpath) {
  // launch pocketdb and migrate data to sqlite
  const mercsYamlPath = path.join(omniCwd(), '.mercs.yaml');
  const defaultConfig = yaml.load(fs.readFileSync(mercsYamlPath, 'utf8'));
  const sqlitedb = ensure_sqlite(path.join(omniCwd(), 'packages', 'omni-server', defaultConfig.server.services.db.kvStorage.dbPath));
  // if pocket is not installed, skip
  if (!fs.existsSync(path.join(pocketpath, getExecutable()))) {
    return;
  }
  // migration completed, skip
  if (fs.existsSync(path.join(pocketpath, MARKED))) {
    return;
  }

  let dbprocess = spawn(path.join(pocketpath, getExecutable()), ['serve']);
  console.log('[DB Migration] Starting...');
  const PocketBase = (await import('pocketbase')).default;  
  let pb = new PocketBase('http://127.0.0.1:8090');
  pb.autoCancellation(false);

  // fetch all records from pocketbase
  let retry = 10;
  let records = [];
  while(retry > 0 ) {
    try {
      records = await pb.collection('legacyMonoCollection').getFullList();
      break;
    }
    catch(e) {
      if (e.originalError.cause.code === 'ECONNREFUSED') {
        retry--;
        await sleep(500);
      }
      else {
        throw e;
      }
    }
  }
  records.forEach(record => {
    const sql = `INSERT OR IGNORE INTO kvstore (key, value, valueType) VALUES (?, ?, 'object');`;
    const stmt = sqlitedb.prepare(sql);
    stmt.run(record.omni_id, JSON.stringify(record.blob));
  });
  dbprocess.kill();
  console.log('[DB Migration] Migration OK. Archiving pocketdb...');
  fs.writeFileSync(path.join(pocketpath, MARKED), Date.now().toString());
}

module.exports = { migrate_from_pocket }