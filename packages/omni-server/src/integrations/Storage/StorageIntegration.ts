/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------------------------------------
// Integration for Storage APIS
// ---------------------------------------------------------------------------------------------

import { type IntegrationsManager, type IAPISignature, type IProxyAPIRoute } from 'omni-shared';
import { APIIntegration, type IAPIIntegrationConfig } from '../APIIntegration.js';

// import { createSegmentationHandler, segmentationdClientExport } from "./handlers/seaweed.js"

interface IStorageIntegrationConfig extends IAPIIntegrationConfig {}

class StorageIntegration extends APIIntegration {
  constructor(id: string, manager: IntegrationsManager, config: IStorageIntegrationConfig) {
    super(id, manager, config || {});
  }

  async load() {
    // this.handlers.set('segmentation', createSegmentationHandler)
    // this.clientExports.set('segmentation', segmentationdClientExport)

    return await super.load();
  }
}

export { StorageIntegration, type IStorageIntegrationConfig };
