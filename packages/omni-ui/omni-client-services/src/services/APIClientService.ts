/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// -------------------------------------------------------------
//
// -------------------------------------------------------------

import { type IManager, APIService, type IAPIServiceConfig, type IRemoteAPI } from 'omni-shared';

interface IAPIClientServiceConfig extends IAPIServiceConfig {}

class APIClientService extends APIService {
  constructor(id: string, manager: IManager, config: IAPIClientServiceConfig) {
    super(id, manager, config);
  }
}

export { APIClientService, type IAPIClientServiceConfig, type IRemoteAPI };
