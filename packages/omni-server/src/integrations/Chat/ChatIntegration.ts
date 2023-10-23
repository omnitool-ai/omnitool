/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// ---------------------------------------------------------------------------------------------
// Integration for Chat APIS
// ---------------------------------------------------------------------------------------------

import { type IntegrationsManager } from 'omni-shared';
import { APIIntegration, type IAPIIntegrationConfig } from '../APIIntegration.js';
import {
  getChatHistoryHandler,
  getChatHistoryClientExport,
  appendToChatHandler,
  appendToChatExport,
  clearChatHistoryHandler,
  clearChatHistoryClientExport
} from '../Chat/handlers/chat.js';

interface IChatIntegrationConfig extends IAPIIntegrationConfig {}

class ChatIntegration extends APIIntegration {
  constructor(id: string, manager: IntegrationsManager, config: IChatIntegrationConfig) {
    super(id, manager, config || {});
  }

  async load() {
    this.handlers.set('chatHistory', getChatHistoryHandler);
    this.clientExports.set('chatHistory', getChatHistoryClientExport);

    this.handlers.set('append', appendToChatHandler);
    this.clientExports.set('append', appendToChatExport);

    this.handlers.set('clear', clearChatHistoryHandler);
    this.clientExports.set('clear', clearChatHistoryClientExport);
    return await super.load();
  }
}

export { ChatIntegration, type IChatIntegrationConfig };
