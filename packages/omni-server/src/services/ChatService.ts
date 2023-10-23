/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type IManager, type IServiceConfig, Service } from 'omni-shared';
import type Server from '../core/Server.js';
import { type DBService, OMNITOOL_DOCUMENT_TYPES } from './DBService.js';
import type Nano from 'nano';

interface IChatServiceConfig extends IServiceConfig {}

interface ChatGetResult {
  result: object[]; // client compatible payload
  up_to_ts: number;
}

class ChatContext implements Nano.MaybeDocument {
  _id?: string | undefined;
  _rev?: string | undefined;

  static MAX_LENGTH = 50;

  id: string;
  thread: ChatEntry[];
  constructor(contextId: string) {
    this.id = contextId;
    this.thread = new Array<ChatEntry>();
  }

  partialGet(length: number, up_to_ts: number): object {
    const resultObj: ChatGetResult = {
      result: [],
      up_to_ts: -1
    };
    resultObj.up_to_ts = up_to_ts;
    let searchIndex = -1;
    // search backwards to the timestamp and then retrieve further
    // back until length
    for (let i = this.thread.length - 1; i >= 0; --i) {
      const entry: ChatEntry = this.thread[i];
      if (entry.ts <= up_to_ts) {
        searchIndex = i;
        break;
      }
    }
    // inclusive +1
    const startIndex = Math.max(0, searchIndex - length + 1);
    resultObj.result = this.thread.slice(startIndex, searchIndex + 1).map((e) => e.payload);
    return resultObj;
  }

  append(clientPayload: object, ts: number): void {
    let insertAfterIndex = this.thread.length;
    for (let i = this.thread.length - 1; i >= 0; --i) {
      const entry: ChatEntry = this.thread[i];
      if (ts > entry.ts) {
        break;
      }
      insertAfterIndex = i;
    }
    this.thread.splice(insertAfterIndex, 0, new ChatEntry(ts, clientPayload));
  }

  prune(): void {
    while (this.thread.length > ChatContext.MAX_LENGTH) {
      this.thread.shift();
    }
  }

  static async fromDB(key: string, storage: DBService): Promise<ChatContext | null> {
    try {
      // we should not need to form our own key here...
      const dbDoc: ChatContext | null = (await storage.get(`${OMNITOOL_DOCUMENT_TYPES.CHAT}:${key}`)) as ChatContext;
      if (dbDoc !== null) {
        return Object.assign(new ChatContext(''), dbDoc);
      }
      return null;
    } catch (e) {
      omnilog.warn('Failed to load chat thread from DB ', e);
      return null;
    }
  }

  async saveToDB(key: string, storage: DBService): Promise<Nano.MaybeDocument> {
    return await storage.putDocumentById(OMNITOOL_DOCUMENT_TYPES.CHAT, key, this, this._rev);
  }

  clear(): void {
    this.thread.length = 0;
  }
}

class ChatEntry {
  ts: number;
  payload: any;
  constructor(ts: number, payload: object) {
    this.ts = ts;
    this.payload = payload;
  }
}

class ChatService extends Service {
  chatSessions: Map<string, Map<string, ChatContext>>;

  constructor(id: string, manager: IManager, config: IServiceConfig) {
    super(id, manager, config);
    this.chatSessions = new Map<string, Map<string, ChatContext>>();
  }

  static GetDBKey(userId: string, contextId: string): string {
    return `${userId}:${contextId}`;
  }

  getApp(): Server {
    return this.app as Server;
  }

  getDB(): DBService {
    return this.app.services.get('db') as DBService;
  }

  async randomSleep(): Promise<void> {
    // Sleep for a random amount of time between 100ms to 200ms
    await new Promise<void>((resolve) => setTimeout(resolve, Math.floor(Math.random() * 100) + 100));
  }

  async writeAppend(userId: string, contextId: string, msgobj: object, ts: number): Promise<void> {
    let retry = 3;
    // check and set operations in case of revision clash
    // will need to put this into a generic helper for DB services
    while (retry > 0) {
      try {
        const context = await this.getChatContext(userId, contextId);
        context.append(msgobj, ts);
        context.prune();
        await context.saveToDB(ChatService.GetDBKey(userId, contextId), this.getDB());
        return;
      } catch (e: any) {
        if (e.statusCode === 409) {
          // 409 == Conflict
          retry--;
          await this.randomSleep();
        } else {
          throw e;
        }
      }
    }
  }

  async clearChatHistory(userId: string, contextId: string): Promise<boolean> {
    let retry = 3;
    while (retry > 0) {
      try {
        const context = await this.getChatContext(userId, contextId);
        context.clear();
        await context.saveToDB(ChatService.GetDBKey(userId, contextId), this.getDB());
        return true;
      } catch (e: any) {
        if (e.statusCode === 409) {
          // 409 == Conflict
          retry--;
          await this.randomSleep();
        } else {
          throw e;
        }
      }
    }
    return true;
  }

  async getChatContext(userId: string, contextId: string): Promise<ChatContext> {
    const value = await ChatContext.fromDB(ChatService.GetDBKey(userId, contextId), this.getDB());
    return value ?? new ChatContext(contextId);
  }

  async load(): Promise<boolean> {
    return true;
  }
}

export { ChatService, ChatContext, type IChatServiceConfig };
