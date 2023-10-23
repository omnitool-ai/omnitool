/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type IManager, Service, type IServiceConfig } from 'omni-shared';

interface ICommandServiceConfig extends IServiceConfig {}

class CommandService extends Service {
  constructor(id: string, manager: IManager, config: ICommandServiceConfig) {
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

  async runServerScript(script: string, args: any): Promise<any> {
    const endpoint = '/api/v1/mercenaries/runscript/' + script;
    this.debug('executing server script', endpoint, args);

    const result = await fetch(endpoint, {
      method: 'POST',
      mode: 'cors', // no-cors, *cors, same-origin
      cache: 'no-cache', // *default, no-cache, reload, force-cache, only-if-cached
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args)
    });
    const data = await result.json();
    return data;
  }
}

export { CommandService, type ICommandServiceConfig };
