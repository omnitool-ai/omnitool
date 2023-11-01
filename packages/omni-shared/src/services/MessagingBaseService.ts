/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type IServiceConfig, Service } from '../core/Service.js';
import { type ServiceManager } from '../core/ServiceManager.js';

interface IMessagingServiceBaseConfig extends IServiceConfig {}

class MessagingServiceBase extends Service {
  constructor(id: string, manager: ServiceManager, config: IMessagingServiceBaseConfig) {
    super(id, manager, config || { id: 'messaging' });
    this.config = config;
  }
}

interface IMessage extends IMessageHeader {
  body?: any;
}

interface IMessageHeader {
  type: string;
  to?: string; // usually: 'system' or another userId
  from?: string;
  flags?: Set<string> | string[];
}

export enum OmniSSEMessages {
  CLIENT_TOAST = 'client:toast',
  CUSTOM_EXTENSION_EVENT = 'custom_extension_event',
  SHOW_EXTENSION = 'extension:show'
}

export interface IOmniSSEMessageCustomExtensionEvent extends IMessage {
  type: OmniSSEMessages.CUSTOM_EXTENSION_EVENT;
  body: {
    extensionId: string;
    eventId: any;
    eventArgs: any;
  };
}

export interface IOmniSSEMessageShowExtensionEvent extends IMessage {
  type: OmniSSEMessages.SHOW_EXTENSION;
  body: {
    extensionId: string,
    args?: any,
    page?: string,
    opts?: any
  }
}

export interface IOmniSSEMessageClientToast extends IMessage {
  type: OmniSSEMessages.CLIENT_TOAST;
  body: {
    message: string;
    options: {
      description?: string;
      type?: 'default' | 'danger' | 'success' | 'warning' | 'info';
      position?: string;
      html?: string;
    };
  };
}

export interface IMessageDeliveryOpts {
  no_cache?: boolean;
  expireAt?: number;
}

export { MessagingServiceBase, type IMessagingServiceBaseConfig, type IMessage, type IMessageHeader };
