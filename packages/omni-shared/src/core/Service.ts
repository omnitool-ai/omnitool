/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { Managed, type IManaged } from './Manager.js';
import { type ServiceManager } from './ServiceManager.js';

interface IServiceConfig {
  id: string;
}

interface IService extends IManaged {}

class Service extends Managed implements IService {
  constructor(id: string, manager: ServiceManager, config: IServiceConfig) {
    super(id, manager, config);
  }
}

export { Service, type IService, type IServiceConfig };
