/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type IManager, Service, type IServiceConfig } from 'omni-shared';

interface IStorageServiceConfig extends IServiceConfig {}

class StorageService extends Service {
  constructor(id: string, manager: IManager, config: IStorageServiceConfig) {
    super(id, manager, config || { id });
  }

  create() {
    this.info(`${this.id} create`);
    return true;
  }

  async load() {
    this.info(`${this.id} load`);
    return true;
  }

  async start() {
    this.info(`${this.id} start`);
    return true;
  }

  async stop() {
    this.info(`${this.id} stop`);

    return true;
  }
}

export { StorageService, type IStorageServiceConfig };
