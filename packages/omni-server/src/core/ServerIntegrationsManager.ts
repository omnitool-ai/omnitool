/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

//  ----------------------------------------------------------------------------------------------
//  ServerIntegrationsManager.ts
//
//    Purpose: This subclasses the generic IntegrationsManager class in omni-shared with server
//             backend specific functionality.
//
//    Usage:   Pass into the opts.integrationsManagerType parameter of the App constructor
//             to override the default generic IntegrationsManager class
//
// ----------------------------------------------------------------------------------------------

import type Server from './Server';
import { IntegrationsManager } from 'omni-shared';

interface IClientExport {
  name: string;
  description: string;
  method: string;
  params: any[];
  endpoint: string;
}

class ServerIntegrationsManager extends IntegrationsManager {
  clientExports: Set<IClientExport>;

  constructor(server: Server) {
    super(server);
    this.clientExports = new Set();
  }
}

export { ServerIntegrationsManager, type IClientExport };
