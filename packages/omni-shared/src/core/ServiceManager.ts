/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type IApp } from './App.js';
import { Manager } from './Manager.js';
import { type IServiceConfig } from './Service.js';

class ServiceManager extends Manager {
  constructor(app: IApp) {
    super(app);
    Object.defineProperty(this, 'services', { get: () => this.children });
  }

  register(Ctor: any, config: IServiceConfig, wrapper?: any) {
    this.debug(`registering ${config.id} service`);
    let service = new Ctor(config.id, this, config);
    if (wrapper && typeof wrapper === 'function') {
      service = wrapper(service);
    }
    this.children.set(config.id, service);
    service.create?.();
    return service;
  }

  async load(): Promise<boolean> {
    this.debug('loading services...');
    const success = await super.load();
    if (!success) {
      this.error('failed to load services');
      return false;
    }
    this.success('services loaded');
    return true;
  }

  async start(): Promise<boolean> {
    this.debug('starting services...');
    await super.start();
    this.success('services started');
    return true;
  }
}

export { ServiceManager };
