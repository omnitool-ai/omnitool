/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import Client from './core/Client.js';

import { ClientExtension, ClientExtensionManager } from './core/ClientExtensionManager.js';
import { APIClientService, type IAPIClientServiceConfig } from './services/APIClientService.js';
import { StorageService, type IStorageServiceConfig } from './services/StorageService.js';
import { AuthService, type AuthServiceConfig } from './services/AuthService';
import { JobControllerClientService, type IJobControllerClientServiceConfig } from './services/JobControllerService.js';
import { ChatUtils, ChatMessageStorageTypes } from './utils/ChatUtils.js';
export { CommandService, type ICommandServiceConfig } from './services/CommandService.js';
export * from './services/ChatClientService.js';
export { MessagingClientService, type IMessagingClientServiceConfig } from './services/MessagingClientService.js';
const createClient = (id: string, config?: any, Ctor = Client) => {
  const client = new Ctor(id, config);
  return client;
};

export {
  Client,
  createClient,
  JobControllerClientService,
  type IJobControllerClientServiceConfig,
  StorageService,
  type IStorageServiceConfig,
  APIClientService,
  type IAPIClientServiceConfig,
  AuthService,
  type AuthServiceConfig,
  ClientExtension,
  ClientExtensionManager,
  ChatUtils,
  ChatMessageStorageTypes
};
