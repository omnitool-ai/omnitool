CREATE TABLE IF NOT EXISTS kvstore (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT UNIQUE NOT NULL,
          value TEXT,
          valueType TEXT NOT NULL,
          blob BLOB,
          expiry INTEGER,
          tags TEXT,
          owner TEXT,
          deleted BOOLEAN DEFAULT 0
        );
CREATE INDEX IF NOT EXISTS idx_kvstore_key ON kvstore(key);
CREATE INDEX IF NOT EXISTS idx_owner ON kvstore(owner);
PRAGMA user_version = 3;