/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import EventEmitter from 'emittery';
import { IntegrationsManager, type Integration } from './Integrations.js';
import { OmniLogLevels, omnilog } from './OmniLog.js';
import { type Service } from './Service.js';
import { ServiceManager } from './ServiceManager.js';

// @ts-ignore
import { parse, stringify } from '@ungap/structured-clone/json';
import { Settings } from './Settings';

interface ILogger {
  withTag: (tag: string) => any;
}

interface IBroadcast {
  events: EventEmitter;
  emit: (event: string, ...args: any[]) => any;
}

interface ILog {
  info: (...args: any[]) => void;
  success: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  debug: (...args: any[]) => void;
  error: (...args: any[]) => void;
  verbose: (...args: any[]) => void;
}

interface IApp extends ILog, IBroadcast {
  id: string;
  logger: ILogger;
  services: ServiceManager;
  integrations: IntegrationsManager;
  settings: Settings;
  start: () => Promise<boolean>;
  stop: () => Promise<boolean>;
  load: () => Promise<boolean>;
  stringify: (data: any) => string;
  parse: (data: string) => any;
  emit: (event: string, ...args: any[]) => any;
}

interface IAppEvents {
  onConfigure?: () => Promise<boolean>;
  onLoad?: () => Promise<boolean>;
  onStart?: () => Promise<boolean>;
}

interface IAppOpts {
  integrationsManagerType: any;
}

enum STATE {
  CREATED = 0,
  CONFIGURED = 1,
  LOADED = 2,
  STARTED = 3,
  STOPPED = 4
}

abstract class App implements IApp {
  static STATES = STATE;
  config: any;
  id: string;
  logger: any;
  public services: ServiceManager;
  public integrations: IntegrationsManager;
  public settings: Settings;
  // Logger
  info: any;
  success: any;
  debug: any;
  verbose: any;
  error: any;
  warn: any;
  events: EventEmitter;
  state: STATE = STATE.CREATED;

  constructor(id: string, config: any, opts?: IAppOpts) {
    this.id = id;
    opts ??= {
      integrationsManagerType: IntegrationsManager
    };
    this.config = config;

    this.logger = omnilog;
    this.services = new ServiceManager(this);
    this.integrations = new (opts.integrationsManagerType || IntegrationsManager)(this);
    const loginstance = this.logger.createWithTag(id);
    this.settings = new Settings();
    this.info = loginstance.info;
    this.success = loginstance.success;
    this.debug = loginstance.debug;
    this.error = loginstance.error;
    this.verbose = loginstance.verbose;
    this.warn = loginstance.warn;

    this.events = new EventEmitter(
      omnilog.getCustomLevel('emittery') > OmniLogLevels.silent
        ? { debug: { name: 'app.events', enabled: true } }
        : undefined
    );
  }

  // registers a service or integration
  use(middleware: any, config: any, middlewareType?: string, wrapper?: any) {
    this.verbose('[APP.USE] use', middleware.name);

    if (middlewareType === 'service' || middleware.name.endsWith('Service')) {
      const service = middleware as Service;
      this.services.register(service, config, wrapper);
    } else if (middlewareType === 'integration' || middleware.name.endsWith('Integration')) {
      const integration = middleware as Integration;
      this.integrations.register(integration, config);
    } else {
      this.warn(`[APP.USE] Unknown middleware type ${middleware.name}`);
    }

    return this;
  }

  // ----- messaging
  async emit(event: string, data: any) {
    // if not @isGlobalEventDeclared(event)
    //  @warn "[APP.EMIT Global] Emitting undeclared global event '#{event}' emitted on #{@id}. Please add to app.GLOBAL_EVENTS or declare at runtime"
    this.debug('[APP.EMIT Global] emit', event);
    await this.events.emit(event, data);
  }

  // ----- app state control
  async load(): Promise<boolean> {
    if (this.state >= STATE.LOADED) {
      omnilog.warn('Cannot load more than once, ignoring call');
      return true;
    }
    const owner = this as IAppEvents;

    if (owner.onConfigure != null) {
      await owner.onConfigure();
    }
    this.state = STATE.CONFIGURED;

    // load services and integrations
    if (!(await this.services.load())) {
      throw new Error('Failed to load services, see console for details');
    }
    await this.integrations.load();

    if (owner.onLoad != null) {
      await owner.onLoad();
    }

    await this.emit('loaded', {});
    this.success('app loaded');
    this.state = STATE.LOADED;

    return true;
  }

  async start(): Promise<boolean> {
    if (this.state === STATE.STARTED) {
      omnilog.warn('Cannot start more than once, ignoring call');
      return true;
    }

    const owner = this as IAppEvents;

    // start services and integrations
    await this.services.start();
    await this.integrations.start();

    if (owner.onStart != null) {
      await owner.onStart();
    }
    this.success('app started');

    this.state = STATE.STARTED;
    await this.emit('started', {});
    return true;
  }

  async stop(): Promise<boolean> {
    this.info('app stopping');
    await this.integrations.stop();
    await this.services.stop();
    await this.emit('stopped', {});
    this.success('app stopped');
    this.state = STATE.STOPPED;
    return true;
  }

  subscribeToGlobalEvent(event: string, handler: any): any {
    //  if not @app.isGlobalEventDeclared(event)
    //  @warn "[SERVICE.SUB Global] #{@id} tries to subscribe to app event #{event}, which is not declared"
    // if this.app.config.env.SERVER_DEBUG_EVENTS.indexOf('global') != -1
    this.info(`[APP.SUB Global] ${this.id} subscribed to GlobalEvent ${event}`);
    this.events.on(event, handler);
  }

  subscribeToServiceEvent(serviceOrId: any, event: string, handler: any) {
    const id: string = serviceOrId.id ?? serviceOrId;

    if (!this.services.has(id)) {
      this.warn(
        `[SERVICE.SUB Service] ${this.id} subscribed to unknown service '${id}'. This can be ok in some cases, but usually indicates a bug.`
      );
    }
    // if (this.app.isServiceEventDeclared(id, event) === false)
    // this.warn(`[SERVICE.SUB Service] ${this.id} subscribed to undeclared service event '${event}' on ${id}. Please add to app.SERVICE_EVENTS or declare at runtime`)

    this.info(`[SERVICE.SUB App] ${this.id} subscribed to service event '${event}' on ${id}`);
    this.events.on(`${id}.${event}`, handler);
  }

  stringify(obj: any) {
    return stringify(obj, null, 2);
  }

  parse(str: string) {
    return parse(str);
  }
}

export { App, type IApp, type IAppEvents, type ILog };
