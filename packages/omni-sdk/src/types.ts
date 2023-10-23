/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

export const OMNI_SDK_VERSION = '0.9.5';

export enum OmniSDKClientMessages {
  REGISTRATION = 'client_registration',
  DEREGISTRATION = 'client_deregistration',
  SEND_CHAT_MESSAGE = 'client_send_chat',
  RUN_CLIENT_SCRIPT = 'client_run_cscript',
  SIGNAL_INTENT = 'client_signal_intent',
  WINDOW_MESSAGE = 'client_window_message',
  SHOW_TOAST = 'client_show_toast',
  SHOW_EXTENSION = 'client_show_extension',
  LOAD_RECIPE = 'client_load_recipe',
}

export enum OmniSDKStorageKeys {
  INTENT_MAP = 'omni-intentMap'
}

export enum OmniSDKClientEvents {
  DATA_UPDATED = 'data_updated',
  CUSTOM_EVENT = 'custom_event',
  CHAT_MESSAGE_RECEIVED = 'chat_message_received'
}

export enum OmniSDKHostMessages {
  ACKNOWLEDGE = 'host_acknowledge',
  CLIENT_SCRIPT_RESPONSE = 'host_cscript_response',
  SYNC_DATA = 'host_sync_data',
  CHAT_COMMAND = 'host_chat_command',
  CHAT_MESSAGE_RECEIVED = 'host_chat_message_received',
  CUSTOM_EVENT = 'custom_extension_event'
  // ... any other host-specific messages
}

export interface IOmniMessage {
  type: OmniSDKClientMessages | OmniSDKHostMessages;
  token?: string;
}

export interface IOmniClientWindowMessage extends IOmniMessage {
  type: OmniSDKClientMessages.WINDOW_MESSAGE;
  action: 'hide' | 'show' | 'close';
  args: any;
}

export interface IOmniHostCustomEventMessage extends IOmniMessage {
  type: OmniSDKHostMessages.CUSTOM_EVENT;
  extensionId: string;
  eventId: string;
  eventArgs: any;
}

export interface IOmniClientRegistrationMessage extends IOmniMessage {
  type: OmniSDKClientMessages.REGISTRATION;
}

export interface IOmniClientDeregistrationMessage extends IOmniMessage {
  type: OmniSDKClientMessages.DEREGISTRATION;
}

export interface IOmniClientSignalIntentMessage extends IOmniMessage {
  type: OmniSDKClientMessages.SIGNAL_INTENT;
  intent: 'show' | 'edit' | 'hide';
  target: string;
  payload: any;
  opts: any;
}

export interface IOmniClientShowExtensionMessage extends IOmniMessage {
  type: OmniSDKClientMessages.SHOW_EXTENSION;
  action: 'open' | 'close';
  extensionId: string;
  args?: any;
  page?: string;
  opts?: any;
}

export interface IOmniClientLoadRecipeMessage extends IOmniMessage {
  type: OmniSDKClientMessages.LOAD_RECIPE;
  recipeId: string;
  recipeVersion: string;
}

export interface IOmniClientRunClientScript extends IOmniMessage {
  type: OmniSDKClientMessages.RUN_CLIENT_SCRIPT;
  script: string;
  args: any;
  invokeId: string;
}

export interface IOmniClientShowToastMessage extends IOmniMessage {
  type: OmniSDKClientMessages.SHOW_TOAST;
  message: string;
  options?: { description?: string; type?: string; position?: string; html?: string };
}

export interface IOmniClientChatMessage extends IOmniMessage {
  type: OmniSDKClientMessages.SEND_CHAT_MESSAGE;
  message: {
    content: string;
    type: string;
    attachments?: any;
    flags?: string[];
  };
}

export interface IOmniHostSyncData extends IOmniMessage {
  type: OmniSDKHostMessages.SYNC_DATA;
  packet: 'intentMap';
  frame: any;
}

export interface IOmniHostChatMessageReceived extends IOmniMessage {
  type: OmniSDKHostMessages.CHAT_MESSAGE_RECEIVED;
  message: any;
}

export interface IOmniCScriptResult extends IOmniMessage {
  type: OmniSDKHostMessages.CLIENT_SCRIPT_RESPONSE;
  result: any;
  invokeId: string;
}

export interface ICdnResource {
  fid: string;
  ticket: {
    fid: string;
  };
  fileName: string;
  size: number;
  data?: any; //Buffer | string | ReadStream | FileResult
  url: string;
  furl: string;
  expires?: number;
  mimeType?: string;
  fileType: EOmniFileTypes;
  meta: {};
}

export enum EOmniFileTypes {
  image = 'image',
  audio = 'audio',
  document = 'document',
  video = 'video',
  file = 'file'
}
