/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import Table from 'cli-table3';

// ------------------------------------------------------------------------------------------
// A drop in replacement for RabbitMQ
// ------------------------------------------------------------------------------------------

import Database from 'better-sqlite3';
import { EventEmitter } from 'events';
import path from 'path';
import { count, debug } from 'console';

interface Message {
  content: Buffer
  headers?: any
  ack: () => void
  nack: () => void
}

interface ConnectionOptions {
  consumerTag: NodeJS.Timeout;
}

interface QueueOptions {
  deadLetterExchange?: string
  deadLetterRoutingKey?: string
  messageTtl?: number
}

interface MessageOptions {
  headers?: {
    retry_count?: number;
  }
};

interface IMockMQMigration  {
  version: number;
  queries: string[];
};

const EXCHANGE_VERSION = 1;

const migrations: IMockMQMigration[] = [
  // example migrations
  {
    version: EXCHANGE_VERSION,
    queries: [
      'ALTER TABLE queue ADD COLUMN dead_letter_exchange TEXT;',
      'ALTER TABLE queue ADD COLUMN dead_letter_routing_key TEXT;',
      'ALTER TABLE queue ADD COLUMN message_ttl TEXT;',
      'ALTER TABLE messages ADD COLUMN retry_count TEXT;',
      'ALTER TABLE messages ADD COLUMN created_at TEXT;',
    ]
  },
];


class SQLite3MessageQueue {
  private static instance: SQLite3MessageQueue;

  private readonly db: Database.Database;
  private readonly concurrency: number;
  private readonly emitter: EventEmitter;
  private readonly interval: number;

  constructor (concurrency: number = 1, interval: number = 1000 * 10, config:any = {}) {

    //this.db = new Database(path.join(process.cwd(), 'data.local', 'db', 'queue.db'))
    const dbQueuePath = config.settings.paths?.dbQueuePath ?? 'data.local/db/queue.db';
    this.db = new Database(path.join(process.cwd(), dbQueuePath));

    this.concurrency = concurrency
    this.emitter = new EventEmitter()
    this.interval = interval
    const version = (this.db.prepare('PRAGMA user_version;').get() as {user_version:number}).user_version || 0
    omnilog.debug('Exchange version: ' + version)
    if (version === 0) {
      // Blank slate, just create the tables to the latest version
      this.db.exec('CREATE TABLE IF NOT EXISTS exchange (name TEXT PRIMARY KEY, type TEXT, options TEXT);')
      this.db.exec('CREATE TABLE IF NOT EXISTS queue (name TEXT PRIMARY KEY, dead_letter_exchange TEXT, dead_letter_routing_key TEXT, message_ttl INTEGER);')
      this.db.exec(`CREATE TABLE IF NOT EXISTS binding (
                      exchange TEXT,
                      queue TEXT,
                      routingKey TEXT,
                      FOREIGN KEY(exchange) REFERENCES exchange(name),
                      FOREIGN KEY(queue) REFERENCES queue(name),
                      UNIQUE(exchange, queue, routingKey) ON CONFLICT IGNORE
                    );`)
      this.db.exec(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, exchange TEXT, routingKey TEXT,
                    status TEXT DEFAULT 'sent', payload TEXT, retry_count INTEGER, created_at TIMESTAMP,
                    FOREIGN KEY(exchange) REFERENCES exchange(name));`)
      this.db.exec(`PRAGMA user_version = ${EXCHANGE_VERSION};`);
    } else {
      // Check if we need to run migrations
      if (version < EXCHANGE_VERSION) {
        this.runMigrations(version)
      }
    }

    this.db.pragma('integrity_check')
    this.db.pragma('vacuum')
  }

  private runMigrations(version: number): void {
    migrations.sort((a, b) => a.version - b.version);
    const filtered = migrations.filter((migration:IMockMQMigration) => migration.version > version);

    const transaction = this.db.transaction(() => {
      filtered.forEach((migration:IMockMQMigration) => {

        omnilog.info("Migrating MQ exchange from version " + version + " to " + migration.version + "...")
        migration.queries.forEach(query => {
          omnilog.debug("Executing queries: " + query)
          this.db.exec(query);
        });

        // Update the user_version after each migration
        this.db.exec(`PRAGMA user_version = ${migration.version};`);
        omnilog.info("KVstorage migrated to version " + version)
      });
    });
    transaction();
  }  

  public static getInstance(config:any): SQLite3MessageQueue {
    if (!SQLite3MessageQueue.instance) {
      SQLite3MessageQueue.instance = new SQLite3MessageQueue(undefined, undefined, config);
    }

    return SQLite3MessageQueue.instance;
  }

  async purgeQueue(queue: string): Promise<void> {
    try {
      const stmt = this.db.prepare('DELETE FROM messages;'); // /*WHERE routingKey = ?*/')
      stmt.run();
    } catch (error) {
      omnilog.error(error);
    }
  }

  async connect(): Promise<SQLite3MessageQueue> {
    return await Promise.resolve(this);
  }

  async createChannel(): Promise<SQLite3MessageQueue> {
    return await Promise.resolve(this);
  }

  async assertExchange(name: string, type: string, options: any): Promise<SQLite3MessageQueue> {
    try {
      const stmt = this.db.prepare('INSERT OR IGNORE INTO exchange (name, type, options) VALUES (?, ?, ?)');
      stmt.run(name, type, JSON.stringify(options));
    } catch (error) {
      omnilog.error(error);
    }
    await this.debugExchange(name)
    return await Promise.resolve(this)
  }

  async assertQueue (queue: string, options?: QueueOptions): Promise<SQLite3MessageQueue> {
    try {
      const stmt = this.db.prepare('INSERT OR IGNORE INTO queue (name, dead_letter_exchange, dead_letter_routing_key, message_ttl) VALUES (?, ?, ?, ?)')
      stmt.run(queue, options?.deadLetterExchange, options?.deadLetterRoutingKey, options?.messageTtl)
    } catch (error) {
      omnilog.error(error);
    }
    return await Promise.resolve(this);
  }

  async bindQueue(queue: string, exchange: string, routingKey: string): Promise<SQLite3MessageQueue> {
    try {
      const stmt = this.db.prepare('INSERT INTO binding (exchange, queue, routingKey) VALUES (?, ?, ?)');
      stmt.run(exchange, queue, routingKey);
    } catch (error) {
      omnilog.error(error);
    }
    return await Promise.resolve(this);
  }

  async publish(exchange: string, routingKey: string, content: Buffer, options?: MessageOptions): Promise<void> {
    try {
      const createdAt = new Date().toISOString()
      const retryCount = options?.headers?.retry_count ?? 0;
      const stmt = this.db.prepare('INSERT INTO messages (exchange, routingKey, payload, retry_count, created_at) VALUES (?, ?, ?, ?, ?)')
      const result = stmt.run(exchange, routingKey, content.toString(), retryCount, createdAt)
      const rowId = result.lastInsertRowid
      this.emitter.emit('message')
      omnilog.info(`Published message to ${exchange} with routing key ${routingKey}`)
      
      // Get the queue
      const queueStmt = this.db.prepare('SELECT queue FROM binding WHERE exchange = ? AND routingKey = ?')
      const queue = queueStmt.get(exchange, routingKey) as { queue: string }
      if (queue) {
        // Get the message ttl
        const queueDetailsStmt = this.db.prepare('SELECT message_ttl, dead_letter_exchange, dead_letter_routing_key FROM queue WHERE name = ?')
        const { message_ttl, dead_letter_exchange, dead_letter_routing_key } = queueDetailsStmt.get(queue.queue) as { message_ttl: number,dead_letter_exchange: string, dead_letter_routing_key: string }
        if (message_ttl) {
          // Set timeout to delete the message after the message ttl
          setTimeout(() => {
            if (dead_letter_exchange && dead_letter_routing_key) {
              const createdAt = new Date().toISOString()
              const moveStmt = this.db.prepare('INSERT INTO messages (exchange, routingKey, payload, status, retry_count, created_at) VALUES (?, ?, ?, ?, ?, ?)')
              moveStmt.run(dead_letter_exchange, dead_letter_routing_key, content.toString(), 'sent', retryCount, createdAt)
              omnilog.info(`Message expired, moving to ${dead_letter_exchange} with routing key ${dead_letter_routing_key}`)
              // Delete the original message
              const deleteStmt = this.db.prepare('DELETE FROM messages WHERE id = ?')
              deleteStmt.run(rowId)
            }
          }, message_ttl)
        }
      }
    } catch (error) {
      omnilog.error(error);
    }
  }

  async consume(queue: string, callback: (msg: Message) => void): Promise<ConnectionOptions> {
    let active = 0;
    const processMessage = () => {
      if (active >= this.concurrency) return;
      this.db.transaction(() => {
        try {
          const getBindingStmt = this.db.prepare('SELECT * FROM binding WHERE queue = ?');
          const bindings = getBindingStmt.all(queue) as Array<{ exchange: string; routingKey: string }>;
          for (const binding of bindings) {
            const stmt = this.db.prepare(`SELECT id, * FROM messages WHERE exchange = ? AND routingKey = ?
                                          AND status = 'sent' ORDER BY id LIMIT 1`)
            const row = stmt.get(binding.exchange, binding.routingKey) as { id: number, payload: string, created_at: string, retry_count: number }
            // omnilog.log(stmt.source + " " + binding.exchange + " " + binding.routingKey, message_ttl)
            this.debugQueue(binding.routingKey);
            if (row) {
              active++
              const msg = {
                content: Buffer.from(row.payload),
                headers: {
                  retry_count: row.retry_count
                },
                ack: () => {
                  const deleteStmt = this.db.prepare('DELETE FROM messages WHERE id = ?')
                  deleteStmt.run(row.id)
                  active--
                  if (active < this.concurrency) {
                    processMessage();
                  }
                },
                nack: () => {
                  // Delete the original message
                  const deleteStmt = this.db.prepare('DELETE FROM messages WHERE id = ?')
                  deleteStmt.run(row.id)
                  active--
                  if (active < this.concurrency) {
                    processMessage()
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

    this.emitter.on('message', processMessage);
    let intervalId = 0 as unknown as NodeJS.Timeout;
    if (this.interval > 0) {
      intervalId = setInterval(processMessage, this.interval);
    }

    return await Promise.resolve({ consumerTag: intervalId });
  }

  async cancel(consumerTag: NodeJS.Timeout): Promise<boolean> {
    if (consumerTag) {
      clearInterval(consumerTag);
    }
    omnilog.info('Cancelled consumer');
    return await Promise.resolve(true);
  }

  ack (message: Message): void {
    message.ack()
  }

  nack (message: Message): void {
    message.nack()
  }

  async debugExchange (exchange: string): Promise<void> {
    const exchangeStmt = this.db.prepare('SELECT * FROM exchange WHERE name = ?')
    const exchangeData = exchangeStmt.get(exchange) as { name: string, type: string, options: string }

    if (!exchangeData) {
      omnilog.warn(`Exchange "${exchange}" not found.`);
      return;
    }

    const bindingsStmt = this.db.prepare('SELECT queue, routingKey FROM binding WHERE exchange = ?');
    const bindings = bindingsStmt.all(exchange) as Array<{ queue: string; routingKey: string }>;

    const table = new Table({
      head: ['Exchange', 'Type', 'Queue', 'Routing Key']
    });

    for (const binding of bindings) {
      table.push([exchangeData.name, exchangeData.type, binding.queue, binding.routingKey]);
    }

    omnilog.debug(table.toString());
  }

  async debugQueue(queue: string): Promise<void> {
    const queueStmt = this.db.prepare(
      'SELECT COUNT(*) as count, status, created_at FROM messages WHERE routingKey = ? GROUP BY status'
    );
    const messages = queueStmt.all(queue) as Array<{ count: number; status: string, created_at: string }>;

    if (messages.length === 0) {
      return;
    }

    const table = new Table({
      head: ['Queue', 'Status', 'Count', 'Created At']
    });

    for (const message of messages) {
      table.push([queue, message.status, message.count, message.created_at]);
    }

    omnilog.debug(table.toString());
  }
}

export class Connection extends SQLite3MessageQueue {}

export class Channel extends SQLite3MessageQueue {}

// todo: use the string to fetch unique instances to allow for multiple queues in app
const connect = (dummy: string, config: any) => Connection.getInstance(config);

export { SQLite3MessageQueue, connect, type ConnectionOptions, type Message };
