/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type IManager, type IAPIServiceConfig, type IRemoteAPI, APIService, type IAPIDefinition } from 'omni-shared';
interface IAPIServerServiceConfig extends IAPIServiceConfig {}

class ServerAPIHandler {
  private readonly _apiDefinition: IAPIDefinition;

  constructor(apiDefinition: IAPIDefinition) {
    this._apiDefinition = apiDefinition;
  }

  get key(): string {
    return this._apiDefinition.key;
  }

  get handler(): Function {
    return this._apiDefinition.handler;
  }

  get params(): any[] {
    return this._apiDefinition.params;
  }

  get description(): string {
    return this._apiDefinition.description ?? '';
  }
}

class APIServerService extends APIService {
  _apiHandlers = new Map<string, ServerAPIHandler>();

  constructor(id: string, manager: IManager, config: IAPIServerServiceConfig) {
    super(id, manager, config || { id });
  }

  get handlers(): Map<string, ServerAPIHandler> {
    return this._apiHandlers;
  }

  register(apiDefinition: IAPIDefinition) {
    this._apiHandlers.set(apiDefinition.key, new ServerAPIHandler(apiDefinition));
  }

  hasHandler(key: string): boolean {
    return this._apiHandlers.has(key);
  }
}

export { APIServerService, type IAPIServerServiceConfig, type IRemoteAPI };
