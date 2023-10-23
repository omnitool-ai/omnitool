/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type IApp } from './App.js';

import { Managed, Manager, type IManaged, type IManagedConfig, type IManager } from './Manager.js';

interface IIntegrationsConfig extends IManagedConfig {}

class IntegrationsManager extends Manager {
  private readonly _integrations: Array<[any, IIntegrationsConfig]>;

  constructor(app: IApp) {
    super(app);
    Object.defineProperty(this, 'integrations', { get: () => this.children });
    this._integrations = [];
  }

  // Unlike services, we want to delay the creation until all the services have loaded, so we
  // just store an array here which we process for the actual registration step in load()
  register(Ctor: any, config: IIntegrationsConfig) {
    this.verbose(`pre-registering ${config.id} integration`);
    this._integrations.push([Ctor, config]);
  }

  async load() {
    for (const [Ctor, config] of this._integrations) {
      this.verbose(`registering integration ${config.id}...`);
      const integration = new Ctor(config.id, this, config);
      this.children.set(config.id, integration);

      integration.create?.();
    }

    this.debug('loading integrations...');
    const result = await super.load();
    this.success('integrations loaded');
    return result;
  }

  async start(): Promise<boolean> {
    this.debug('starting integrations...');
    await super.start();
    this.success('integrations started');
    return true;
  }
}

interface IIntegration extends IManaged {
  manager: IManager;
  app: IApp;
}

class Integration extends Managed implements IIntegration {
  constructor(id: string, manager: Manager, config: IIntegrationsConfig) {
    super(id, manager, config);
  }
}

export { Integration, IntegrationsManager, type IIntegration, type IIntegrationsConfig };
