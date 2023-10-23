/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */
import { omnilog } from './OmniLog.js';

import { type IApp, type ILog } from './App.js';

interface IAPISignature {
  method: string;
  url: string;
  handler: any;
  authStrategy: string | [];
  insecure: boolean;
  schema?: any;
  websocket?: any;
  config?: any;
}

interface IProxyAPIRoute {
  upstream: string;
  prefix: string;
  rewritePrefix?: string;
  http2?: boolean;
  replyOptions?: any;
}

interface IManager extends ILog {
  app: IApp;
  children: Map<string, IManaged>;
  register: (Ctor: any, config: any, wrapper: any) => any;
  has: (id: string) => boolean;
  get: (id: string) => any;
  load: () => Promise<boolean>;
  start: () => Promise<boolean>;
  stop: () => Promise<boolean>;
}

interface IManagedConfig {
  id: string;
}

interface IManaged extends ILog {
  id: string;
  app: IApp;
  manager: IManager;
  config: IManagedConfig;
  registerAPI: (opts: IAPISignature) => any;
  load?: () => Promise<boolean>;
  start?: () => Promise<boolean>;
  stop?: () => Promise<boolean>;
  subscribeToServiceEvent: (serviceOrId: any, event: string, handler: any) => void;
  subscribeToGlobalEvent: (event: string, handler: any) => any;
}

class Manager implements IManager {
  app: IApp;
  children: Map<string, IManaged>;
  info: any;
  success: any;
  debug: any;
  verbose: any;
  error: any;
  warn: any;

  constructor(app: IApp) {
    this.app = app;
    this.children = new Map<string, IManaged>();
    const logInstance = omnilog.createWithTag('Services');
    this.info = logInstance.info;
    this.success = logInstance.success;
    this.debug = logInstance.debug;
    this.verbose = logInstance.verbose;
    this.warn = logInstance.warn;
    this.error = logInstance.error;
  }

  register(Ctor: any, config: any, wrapper?: any) {
    throw new Error('Manager register method not implemented');
  }

  async load() {
    const success = true;
    for (const [id, child] of this.children) {
      this.verbose(`${id} load`);
      await child.load?.();
    }
    return success;
  }

  async start() {
    for (const [id, child] of this.children) {
      omnilog.log(`child ${id} start`);
      await child.start?.();
    }

    omnilog.log('All children started');
    return true;
  }

  async stop() {
    this.debug('stopping children...');
    for (const child of Array.from(this.children.values()).reverse()) {
      this.verbose(`${child.id} stop`);
      await child.stop?.();
    }
    this.success('children stopped');
    return true;
  }

  get(id: string) {
    return this.children.get(id);
  }

  has(id: string) {
    return this.children.has(id);
  }
}

class Managed implements IManaged {
  id: string;
  manager: IManager;
  app: IApp;
  config: IManagedConfig;
  // Logger
  info: any;
  success: any;
  debug: any;
  verbose: any;
  error: any;
  warn: any;
  trace: any;

  constructor(id: string, manager: IManager, config: any) {
    this.id = id;
    this.manager = manager;
    this.app = manager.app;
    this.config = config;

    const logInstance = omnilog.createWithTag(id);
    this.info = logInstance.info;
    this.success = logInstance.success;
    this.debug = logInstance.debug;
    this.verbose = logInstance.verbose;
    this.warn = logInstance.warn;
    this.error = logInstance.error;
    this.trace = logInstance.trace;
  }

  async emitGlobalEvent(event: string, data: any) {
    // if (app.isGlobalEventDeclared(event) === false)
    // this.warn(`[SERVICE.EMIT Global] Emitting undeclared global event '${event}' emitted on ${this.id}. Please add to app.GLOBAL_EVENTS or declare at runtime`)
    this.verbose(`[Global.EMIT] ${this.id} emits event '${event}'`);
    await this.app.events.emit(event, data);
  }

  async emit(event: string, data: any) {
    this.verbose(`[SERVICE.EMIT] ${this.id} emits event '${event}'`);
    await this.app.events.emit(`${this.id}.${event}`, data);
  }

  subscribeToServiceEvent(serviceOrId: any, event: string, handler: any) {
    const id = serviceOrId.id ?? serviceOrId;
    if (id === this.id) {
      this.error(`[SERVICE.SUB] ${this.id} subscribed to self event '${event}'`);
    }
    if (!this.app.services.has(id)) {
      this.error(`[SERVICE.SUB] ${this.id} subscribed to non-existent service event '${event}' on ${id}`);
    }
    // if (this.app.isServiceEventDeclared(id, event) === false)
    this.info(`[SERVICE.SUB Service] ${this.id} subscribed to service event '${event}' on ${id}.`);
    this.app.events.on(`${id}.${event}`, handler);
  }

  subscribeToGlobalEvent(event: string, handler: any): any {
    //  if not @app.isGlobalEventDeclared(event)
    //  @warn "[SERVICE.SUB Global] #{@id} tries to subscribe to app event #{event}, which is not declared"
    // if this.app.config.env.SERVER_DEBUG_EVENTS.indexOf('global') != -1
    this.debug(`[GLOBAL.SUB] ${this.id} subscribed to GlobalEvent ${event}`);
    this.app.events.on(event, handler);
  }

  unsubscribeFromGlobalEvent(event: string, handler: any): any {
    //  if not @app.isGlobalEventDeclared(event)
    //  @warn "[SERVICE.SUB Global] #{@id} tries to subscribe to app event #{event}, which is not declared"
    // if this.app.config.env.SERVER_DEBUG_EVENTS.indexOf('global') != -1
    this.verbose(`[GLOBAL.UNSUBSUB] ${this.id} unsubscribed from GlobalEvent ${event}`);
    this.app.events.off(event, handler);
  }

  async registerAPI({ method, url, handler, insecure, authStrategy, schema, websocket }: IAPISignature) {
    this.debug('registerAPI', method, url);
    if (!url) {
      this.error('registerAPI: url is required');
      return false;
    }

    if (handler == null || typeof handler !== 'function') {
      this.error('registerAPI: handler is required and must be a function', method, url);
      return false;
    }
    await this.emitGlobalEvent('registerAPI', { method, url, handler, insecure, authStrategy, schema, websocket });
  }
}

export { Managed, Manager, type IAPISignature, type IManaged, type IManagedConfig, type IManager, type IProxyAPIRoute };
