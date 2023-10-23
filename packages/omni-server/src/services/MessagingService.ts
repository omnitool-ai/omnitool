/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type FastifyReply, type FastifyRequest } from 'fastify';
import {
  MessagingServiceBase,
  type IMessage,
  type IMessageHeader,
  type IMessagingServiceBaseConfig,
  type ServiceManager,
  type User,
  type OmniSSEMessages,
  type IMessageDeliveryOpts
} from 'omni-shared';
import NodeCache from 'node-cache';

interface IMessagingServerServiceConfig extends IMessagingServiceBaseConfig {
  maxCacheSizePerUser: number;
  nodeCache?: {
    checkperiod: number;
  };
  keepaliveInterval: number;
}

class MessageComposer {
  message: IMessage;

  constructor(type: string) {
    this.message = {
      type,

      body: {}
    };
  }

  static create(type: string): MessageComposer {
    return new MessageComposer(type);
  }

  to(to: string): MessageComposer {
    this.message.to = to;
    return this;
  }

  from(from: string): MessageComposer {
    this.message.from = from;
    return this;
  }

  setPayload(payload: any): MessageComposer {
    this.message.body = payload;
    return this;
  }

  setFlags(flags: string[]): MessageComposer {
    this.message.flags = flags;
    return this;
  }

  toMessage(): IMessage {
    return this.message;
  }
}

class MessagingServerService extends MessagingServiceBase {
  messageCache: NodeCache;
  connections: Map<string, FastifyReply>;
  heartbeat: NodeJS.Timeout | null;

  constructor(id: string, manager: ServiceManager, config: IMessagingServerServiceConfig) {
    super(id, manager, config || {});
    this.config = config;
    this.messageCache = new NodeCache();
    this.connections = new Map();
    this.heartbeat = null;
  }

  get serviceConfig(): IMessagingServerServiceConfig {
    return this.config as IMessagingServerServiceConfig;
  }

  startHeartbeat(): void {
    if (this.heartbeat == null) {
      const interval = this.serviceConfig.keepaliveInterval;
      if (interval && interval > 0) {
        this.heartbeat = setInterval(this.onTick.bind(this), interval);
        this.info(`SSE keepalive timer active at ${interval} ms`);
      } else {
        this.info('Not using keepalive timer for SSE. (services.messaging.keepaliveInterval = 0) ');
      }
    }
  }

  stopHeartbeat(): void {
    if (this.heartbeat != null) {
      clearTimeout(this.heartbeat);
      this.heartbeat = null;
      this.debug('SSE keepalive timer cancelled');
    }
  }

  async stop(): Promise<void> {
    this.stopHeartbeat();
    const conn = Array.from(this.connections.values());
    for (let i = 0; i < conn.length; i++) {
      conn[i]?.raw?.end();
    }
    this.connections.clear();
  }

  onTick() {
    if (this.connections.size > 0) {
      this.broadcast({ type: 'keepalive', body: {} });
    }
  }

  createMessage(header: IMessageHeader, body: any): IMessage {
    return { ...header, body };
  }

  async load() {
    this.info('MessagingService loading');

    const nodeCacheOptions: NodeCache.Options = this.serviceConfig.nodeCache || { checkperiod: 6000 };
    this.messageCache = new NodeCache(nodeCacheOptions);

    this.subscribeToGlobalEvent('session_created', this.onSessionCreate.bind(this));
    this.subscribeToGlobalEvent('session_destroyed', this.onSessionDestroy.bind(this));
    this.success('MessagingService loaded');

    // legacy hook

    this.subscribeToGlobalEvent('sse_user_message', (args: [string, IMessageHeader, any, IMessageDeliveryOpts?]) => {
      const [userId, header, body, opts] = args;
      const message = MessagingServerService.createServerMessage(header, body);
      this.sendUser(userId, message, opts);
    });

    this.subscribeToGlobalEvent('sse_message', (o: any) => {
      if (o.sessionId) {
        const message = MessagingServerService.createServerMessage({ type: o.type }, o);
        this.send(o.sessionId, message, { no_cache: false });
      }
    });
  }

  async start() {
    return true;
  }

  static createServerMessage(header: IMessageHeader, body: any): IMessage {
    return { ...header, body };
  }

  composeMessage(type: string): MessageComposer {
    return MessageComposer.create(type);
  }

  // send event to a specific session
  async send(sessionId: string, message: IMessage, deliveryOpts?: IMessageDeliveryOpts) {
    const connection = this.connections.get(sessionId);

    if (!(connection != null && this.sendSSEMessage(connection, message))) {
      if (!deliveryOpts?.no_cache) {
        const cachedMessages = this.messageCache.get<IMessage[]>(sessionId) || [];
        const { maxCacheSizePerUser = 1000 } = this.serviceConfig;
        if (cachedMessages.length >= maxCacheSizePerUser) {
          this.warn(
            'SSE: Message cache full',
            sessionId,
            cachedMessages.length,
            this.serviceConfig.maxCacheSizePerUser
          );
          cachedMessages.shift(); // Remove the oldest message if the cache is full
        }
        cachedMessages.push(message);
        this.messageCache.set(sessionId, cachedMessages, deliveryOpts?.expireAt || 0);
      }
    }
  }

  async sendUser(userId: string, message: IMessage, deliveryOpts?: IMessageDeliveryOpts) {
    for (const [sessionId, connection] of this.connections) {
      const user: User = connection.request.user as User;
      if (user && user.id === userId) {
        await this.send(sessionId, message, deliveryOpts);
      }
    }
  }

  // send event to all connected sessions
  async broadcast(message: IMessage, deliveryOpts?: IMessageDeliveryOpts) {
    for (const [sessionId] of this.connections) {
      await this.send(sessionId, message, deliveryOpts);
    }
  }

  // session is created. SSE connection does not yet exist
  async onSessionCreate([sessionId, user]: [string, User]) {
    if (!this.messageCache.has(sessionId)) {
      this.messageCache.set(sessionId, []);
    }
  }

  async onConnectionCreate(request: FastifyRequest, reply: FastifyReply) {
    const user: User = request.user as User;
    const sessionId = request.session.sessionId;

    if (!user || !sessionId) {
      this.error('SSE: User not logged in', sessionId, user);
      return await reply.status(403).send({ error: 'User not logged in' });
    }

    const ip = request.ip;
    const userAgent = request.headers['user-agent'];
    const hadConnection = this.connections.has(sessionId);
    if (hadConnection) {
      const existingConnection = this.connections.get(sessionId);
      if (existingConnection != null) {
        this.sendSSEMessage(existingConnection, {
          type: 'close',
          body: {
            reason: 'new_connection',
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

    const messages = this.messageCache.get<IMessage[]>(sessionId);
    if (messages != null) {
      messages.forEach((message) => this.sendSSEMessage(reply, message));
      this.messageCache.del(sessionId);
    }

    // @ts-ignore
    if (!hadConnection && !request.query.reconnect) {
      const welcomeMessage = MessagingServerService.createServerMessage(
        {
          type: 'chat',
          to: user.id,
          from: 'omni'
        },
        {
          content: [
            {
              value: `Welcome to **omniTool**, *@${user.username}*.\nGet started with the /help command.\nYou can file bugs by messaging **@bugbear** a one liner of your issue. `,
              type: 'text/markdown'
            }
          ],
          attachments: {
            commands: [
              {
                title: '/help',
                id: 'help',
                args: [],
                classes: ['animate-pulse']
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

    request.socket.on('close', () => {
      this.onSSEDisconnect(sessionId);
    });

    // @ts-ignore
    reply.sse('ok');
  }

  sendSSEMessage(connection: FastifyReply, message: IMessage): boolean {
    const data = this.app.stringify(message ?? { empty: true });

    try {
      if (!connection.sent) {
        connection.sse({ id: 'sse', data });
        this.verbose('sse -> ', data);
        return true;
      } else {
        this.warn('SSE: Connection already closed');
        return false;
      }
    } catch (error: unknown) {
      this.error(`Error sending SSE message: ${(error as { message: string }).message}`, error);
      return false;
    }
  }

  onSSEDisconnect(sessionId: string) {
    if (this.connections.has(sessionId)) {
      this.connections.delete(sessionId);
    }
    this.info(`SSE: Connection closed for session ${sessionId}. Connection count: ${this.connections.size}.`);

    if (this.connections.size == 0) {
      this.stopHeartbeat();
    }
  }

  onSessionDestroy(sessionId: string) {
    if (this.connections.has(sessionId)) {
      const existingConnection = this.connections.get(sessionId) as FastifyReply;
      this.sendSSEMessage(existingConnection, {
        type: 'close',
        body: {
          reason: 'session_expired',
          message: 'Your session has been expired.'
        }
      });
      this.connections.delete(sessionId);
      setTimeout(() => {
        try {
          existingConnection.raw.end();
        } catch (ex) {}
      }, 2);
    }
    this.warn('Session destroyed');
    this.messageCache.del(sessionId);
  }
}

export { MessagingServerService, type IMessagingServerServiceConfig };
