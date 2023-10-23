/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import OmniSDKShared from './OmniSDKShared';

import {
  OmniSDKClientEvents,
  type IOmniCScriptResult,
  type IOmniClientChatMessage,
  type IOmniClientRunClientScript,
  type IOmniClientSignalIntentMessage,
  type IOmniClientWindowMessage,
  type IOmniHostSyncData,
  type IOmniMessage,
  OmniSDKClientMessages,
  OmniSDKHostMessages,
  OmniSDKStorageKeys,
  type IOmniClientShowToastMessage,
  type IOmniHostCustomEventMessage,
  type IOmniHostChatMessageReceived,
  type IOmniClientShowExtensionMessage,
  type IOmniClientLoadRecipeMessage
} from './types';

export default class OmniSDKClient extends OmniSDKShared {
  options: any;
  args: any;
  token: string;
  _extensionId: string;

  constructor(extensionId: string) {
    super();

    this._isClient = true; // Indicate that this is a client instance

    this._extensionId = extensionId;
    const args = new URLSearchParams(location.search);
    this.options = JSON.parse(args.get('o') || '{}');
    this.args = JSON.parse(args.get('q') || '{}');
    if (args.has('omniHash')) {
      this.token = args.get('omniHash')!;
    } else {
      console.warn('No omniHash found in the query string, this is not a window opened by OmniHost');
      this.token = extensionId + new Date().getTime().toString();
    }
  }

  public get extensionId(): string {
    return this._extensionId;
  }

  public init( {subscriptions}: {subscriptions: OmniSDKHostMessages[]} = {subscriptions: []}) {
    console.log('OmniSDKClient initialized for ' + this.extensionId + '.');

    // Loading intentmap from local storage
    const intentMapString = window.localStorage.getItem(OmniSDKStorageKeys.INTENT_MAP);
    if (intentMapString) {
      const intentMap = JSON.parse(intentMapString);
      if (intentMap && intentMap.length > 0) {
        this.intentMap = new Map(intentMap);
      }
    }

    this.addMessageHandler(OmniSDKHostMessages.CLIENT_SCRIPT_RESPONSE, this._handleClientScriptResponse);
    this.addMessageHandler(OmniSDKHostMessages.SYNC_DATA, this._handleSyncData);
    if (subscriptions.includes(OmniSDKHostMessages.CUSTOM_EVENT)) this.addMessageHandler(OmniSDKHostMessages.CUSTOM_EVENT, this._handleCustomEvent);
    if (subscriptions.includes(OmniSDKHostMessages.CHAT_MESSAGE_RECEIVED)) this.addMessageHandler(OmniSDKHostMessages.CHAT_MESSAGE_RECEIVED, this._handleChatMessageReceived);

    this.register();
    return this;
  }

  public register(): void {
    if (this.token) {
      this.send({ type: OmniSDKClientMessages.REGISTRATION, token: this.token });
    } else {
      // Not a window opened by OmniHost`, messages won't be used.
    }
  }

  public deregister(token: string): void {
    this.send({ type: OmniSDKClientMessages.DEREGISTRATION, token: token });
  }

  public sendChatMessage(
    content: string,
    type: string = 'text/markdown',
    attachments?: { [key: string]: any },
    flags?: string[]
  ): void {
    let message: IOmniClientChatMessage = {
      type: OmniSDKClientMessages.SEND_CHAT_MESSAGE,
      message: {
        content,
        type,
        attachments,
        flags
      }
    };
    this.send(message);
  }

  // Runs a client script and responds with the result
  public async runClientScript(scriptName: string, payload: any) {
    const message: IOmniClientRunClientScript = {
      type: OmniSDKClientMessages.RUN_CLIENT_SCRIPT,
      script: scriptName,
      args: payload,
      invokeId: this.extensionId + new Date().getTime().toString()
    };
    return new Promise((resolve, reject) => {
      this.send(message);
      this.events.once(OmniSDKHostMessages.CLIENT_SCRIPT_RESPONSE + ':' + message.invokeId).then((result) => {
        resolve(result);
      });
    });
  }

  private async _handleCustomEvent(message: IOmniMessage): Promise<void> {
    if (message.type !== OmniSDKHostMessages.CUSTOM_EVENT) return;
    const msg = message as IOmniHostCustomEventMessage;

    if (msg.extensionId !== this.extensionId) return;
    this.events.emit(OmniSDKClientEvents.CUSTOM_EVENT, { eventId: msg.eventId, eventArgs: msg.eventArgs });
  }

  private async _handleSyncData(message: IOmniMessage): Promise<void> {
    if (message.type !== OmniSDKHostMessages.SYNC_DATA) return; // type guard
    let msg = message as IOmniHostSyncData;
    this.intentMap = new Map(msg.frame);
    await this.events.emit(OmniSDKClientEvents.DATA_UPDATED, [{ property: 'intentMap' }]);
  }

  private async _handleChatMessageReceived(message: IOmniMessage): Promise<void> {
    if (message.type !== OmniSDKHostMessages.CHAT_MESSAGE_RECEIVED) return; // type guard
    let msg = message as IOmniHostChatMessageReceived;

    await this.events.emit(OmniSDKClientEvents.CHAT_MESSAGE_RECEIVED, [msg.message]);
  }

  private async _handleClientScriptResponse(message: IOmniMessage): Promise<void> {
    if (message.type !== OmniSDKHostMessages.CLIENT_SCRIPT_RESPONSE) return; // type guard

    let msg = message as IOmniCScriptResult;

    await this.events.emit(OmniSDKHostMessages.CLIENT_SCRIPT_RESPONSE + ':' + msg.invokeId, msg.result);
  }

  public showExtension(
    extensionId: string,
    args: any,
    page: string = '',
    opts: any = {},
    action: 'open' | 'close' = 'open'
  ) {
    let msg: IOmniClientShowExtensionMessage = {
      type: OmniSDKClientMessages.SHOW_EXTENSION,
      extensionId,
      action,
      args,
      page,
      opts
    };
    this.send(msg);
  }

  public hide() {
    let msg: IOmniClientWindowMessage = {
      type: OmniSDKClientMessages.WINDOW_MESSAGE,
      action: 'hide',
      args: {}
    };
    this.send(msg);
  }

  public show() {
    let msg: IOmniClientWindowMessage = {
      type: OmniSDKClientMessages.WINDOW_MESSAGE,
      action: 'show',
      args: {}
    };
    this.send(msg);
  }

  public close() {
    let msg: IOmniClientWindowMessage = {
      type: OmniSDKClientMessages.WINDOW_MESSAGE,
      action: 'close',
      args: {}
    };
    this.send(msg);
  }

  public signalIntent(intent: 'show' | 'edit', target: string, payload: any, opts = {}): void {
    let message: IOmniClientSignalIntentMessage = {
      type: OmniSDKClientMessages.SIGNAL_INTENT,
      intent,
      target,
      opts: opts || {},
      payload
    };

    this.send(message);
  }

  public showToast(
    message: string,
    options: {
      description?: string;
      type?: 'default' | 'danger' | 'success' | 'warning' | 'info';
      position?: string;
      html?: string;
    }
  ): void {
    let msg: IOmniClientShowToastMessage = {
      type: OmniSDKClientMessages.SHOW_TOAST,
      message,
      options
    };
    this.send(msg);
  }

  public openRecipeInEditor(recipeId: string, recipeVersion: string): void {
    let msg: IOmniClientLoadRecipeMessage = {
      type: OmniSDKClientMessages.LOAD_RECIPE,
      recipeId,
      recipeVersion
    };
    this.send(msg);
  }

  public async runExtensionScript(scriptName: string, payload: any) {
    const response = await this._httpClient.executeRequest(
      `/api/v1/mercenaries/runscript/${this.extensionId}:` + scriptName,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      throw new Error('Server error: HTTP status ' + response.status);
    }

    const data = await response.json();

    return data;
  }

  // You can add more handlers if required for other types of messages that the ClientSDK might receive from OmniHost
}
