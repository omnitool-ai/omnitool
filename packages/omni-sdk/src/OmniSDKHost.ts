/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import OmniSDKShared from './OmniSDKShared';
import {
  type IOmniMessage,
  type IOmniClientDeregistrationMessage,
  type IOmniClientRegistrationMessage,
  type IOmniClientRunClientScript,
  type IOmniClientWindowMessage,
  type IOmniClientChatMessage,
  type IOmniClientShowToastMessage,
  OmniSDKClientMessages,
  type IOmniCScriptResult,
  OmniSDKHostMessages,
  OmniSDKStorageKeys,
  type IOmniClientSignalIntentMessage,
  type IOmniHostCustomEventMessage,
  type IOmniHostChatMessageReceived,
  type IOmniClientShowExtensionMessage,
  type IOmniClientLoadRecipeMessage,
  type IOmniClientShowTopBannerMessage
} from './types';

import { type OmniBaseResource } from './Resources/OmniBaseResource';

interface IFrameInfo {
  contentWindow: Window;
  registeredAt: Date;
}

export default class OmniSDKHost<T> extends OmniSDKShared {
  private registeredFrames: { [token: string]: IFrameInfo } = {};

  private _app: T;
  constructor(app: any) {
    super();
    this._app = app;
  }

  public get app(): T {
    return this._app as T;
  }

  public init() {
    console.log('OmniSDKHost initialized.');
    this.addMessageHandler(OmniSDKClientMessages.REGISTRATION, this._handleRegistration);
    this.addMessageHandler(OmniSDKClientMessages.DEREGISTRATION, this._handleDeregistration);
    this.addMessageHandler(OmniSDKClientMessages.SEND_CHAT_MESSAGE, this._handleSendChatMessage);
    this.addMessageHandler(OmniSDKClientMessages.RUN_CLIENT_SCRIPT, this._handleRunClientScript);
    this.addMessageHandler(OmniSDKClientMessages.SIGNAL_INTENT, this._handleSignalIntent);
    this.addMessageHandler(OmniSDKClientMessages.WINDOW_MESSAGE, this._handleWindowMessage);
    this.addMessageHandler(OmniSDKClientMessages.SHOW_TOAST, this._handleShowToast);
    this.addMessageHandler(OmniSDKClientMessages.SHOW_EXTENSION, this._handleShowExtension);
    this.addMessageHandler(OmniSDKClientMessages.LOAD_RECIPE, this._handleLoadRecipe)
    this.addMessageHandler(OmniSDKClientMessages.SHOW_TOP_BANNER, this._handleShowTopBanner);

    return this;
  }

  public registerFileIntent(
    intent: 'show' | 'edit',
    mimeType: string,
    handler: { extensionId: string; page: string; opts?: any }
  ) {
    const key = `file:${intent}:${mimeType}`;
    console.log(`Registering file intent ${key}, handler: `, handler);
    if (this.intentMap.has(key)) {
      this.intentMap.get(key).push(handler);
    } else {
      this.intentMap.set(key, [handler]);
    }
    window.localStorage.setItem(OmniSDKStorageKeys.INTENT_MAP, JSON.stringify(Array.from(this.intentMap.entries())));
  }

  public signalFileIntent(intent: 'show' | 'edit', file: OmniBaseResource, opts?: any) {
    const mt = file.mimeType?.split(';')[0].trim();

    let handlers = this.intentMap.get(`file:${intent}:${mt}`) || [];

    // No direct hit, let's try partial
    if (handlers.length == 0) {
      handlers = Array.from(this.intentMap.entries())
        .map(([key, value]) => {
          const [type, action, mimeType] = key.split(':');
          if (
            type === 'file' &&
            action === intent &&
            mimeType.endsWith('*') &&
            mt?.startsWith(mimeType.substring(0, mimeType.length - 1))
          ) {
            return value[0];
          } else {
            return undefined;
          }
        })
        .filter((v) => v !== undefined);
    }

    if (handlers.length > 0) {
      console.log(handlers[0]);

      const { extensionId, page, hOpts } = handlers[0];
      console.log(`Showing ${intent} intent for ${mt} with extension ${extensionId} and page ${page}`);
      //@ts-ignore
      this.app.workbench.showExtension(extensionId, { file }, page, Object.assign({}, opts, hOpts));
    } else {
      console.warn(`No handler found for intent ${intent} and mime type ${file.mimeType}`);
    }
  }

  public signalCustomEvent(extensionId: string, eventId: string, eventArgs: any) {
    const message: IOmniHostCustomEventMessage = {
      type: OmniSDKHostMessages.CUSTOM_EVENT,
      extensionId,
      eventId,
      eventArgs
    };
    this.send(message);
  }

  public signalChatMessageReceived(message: any) {
    if (!message.workflowId) {
      message.workflowId = 'System';
    }

    const packet: IOmniHostChatMessageReceived = {
      type: OmniSDKHostMessages.CHAT_MESSAGE_RECEIVED,
      message
    };
    console.log('Signaling Chat Message Received', packet);
    this.send(packet, '*');
  }

  public deregister(token: string): void {
    if (token && this.registeredFrames[token]) {
      console.log(`Iframe with token ${token} deregistered!`);
      delete this.registeredFrames[token];
    } else {
      console.warn(`No registered frame with token ${token}`);
    }
  }

  private async _handleRunClientScript(message: IOmniMessage): Promise<any> {
    if (message.type !== OmniSDKClientMessages.RUN_CLIENT_SCRIPT) return; // type guard

    const scriptMessage = message as IOmniClientRunClientScript;
    const script = scriptMessage.script;
    const args = scriptMessage.args;

    //@ts-ignore
    const result = await this.app.runScript(script, args);

    const response: IOmniCScriptResult = {
      type: OmniSDKHostMessages.CLIENT_SCRIPT_RESPONSE,
      invokeId: scriptMessage.invokeId,
      result: result
    };

    this.send(response, message.token!);
  }

  private _handleWindowMessage(message: IOmniMessage): void {
    if (message.type !== OmniSDKClientMessages.WINDOW_MESSAGE) return; // type guard

    const windowMessage = message as IOmniClientWindowMessage;
    const action = windowMessage.action;
    const args = windowMessage.args;
    const token = windowMessage.token;

    if (action === 'close') {
      //@ts-ignore
      this.app.closeWindow(token);
    }
  }

  private _handleSendChatMessage(message: IOmniMessage): void {
    if (message.type !== OmniSDKClientMessages.SEND_CHAT_MESSAGE) return; // type guard

    const body = (message as IOmniClientChatMessage).message;
    //@ts-ignore
    this.app.sendSystemMessage(body.content, body.type, body.attachments, body.flags);
  }

  private _handleShowExtension(message: IOmniMessage): void {
    if (message.type !== OmniSDKClientMessages.SHOW_EXTENSION) return; // type guard

    const showExtensionMessage = message as IOmniClientShowExtensionMessage;
    const { action, args, extensionId, page, opts } = showExtensionMessage;

    if (action === 'open') {
      //@ts-ignore
      this.app.workbench.showExtension(extensionId, args, page, opts);
    } else if (action === 'close') {
      alert('hideExtension Not implemented');
      //@ts-ignore
      //this.app.workbench.hideExtension(extensionId)
    }
  }

  private _handleRegistration(message: IOmniMessage, source: MessageEventSource | null): void {
    if (message.type !== OmniSDKClientMessages.REGISTRATION) return; // type guard

    const regMessage = message as IOmniClientRegistrationMessage; // narrowing the type

    if (source && regMessage.token && 'postMessage' in source && !this.registeredFrames[regMessage.token]) {
      this.registeredFrames[regMessage.token] = {
        contentWindow: source as Window,
        registeredAt: new Date()
      };
      console.log(`Iframe with token ${regMessage.token} registered!`);

      // Send the intent map to the newly registered iframe.
      this.send(
        {
          type: OmniSDKHostMessages.SYNC_DATA,
          packet: 'intentMap',
          frame: Array.from(this.intentMap.entries())
        },
        regMessage.token
      );
    }
  }

  private _handleShowToast(clientMessage: IOmniMessage): void {
    if (clientMessage.type !== OmniSDKClientMessages.SHOW_TOAST) return; // type guard

    const toastMessage = clientMessage as IOmniClientShowToastMessage; // narrowing the type
    const { message, options } = toastMessage;

    // @ts-expect-error
    this.app.showToast(message, options);
  }

  private _handleSignalIntent(message: IOmniMessage): void {
    if (message.type !== OmniSDKClientMessages.SIGNAL_INTENT) return; // type guard

    const intentMessage = message as IOmniClientSignalIntentMessage; // narrowing the type

    if (intentMessage.payload?.fid || intentMessage.payload?.ticket?.fid) {
      //@ts-ignore
      this.signalFileIntent(intentMessage.intent, intentMessage.payload, intentMessage.opts);
      return;
    }
    if (intentMessage.intent === 'show' || intentMessage.intent === 'edit') {
      //@ts-ignore
      this.app.workbench.showExtension(intentMessage.target, intentMessage.payload, undefined, intentMessage.opts);
    } else if (intentMessage.intent === 'hide') {
      //@ts-ignore
      this.app.workbench.hideExtension(intentMessage.target);
    } else {
      console.warn(`Invalid intent ${intentMessage.intent}`, intentMessage);
    }
  }

  private _handleDeregistration(message: IOmniMessage): void {
    if (message.type !== OmniSDKClientMessages.DEREGISTRATION) return; // type guard

    const deRegMessage = message as IOmniClientDeregistrationMessage; // narrowing the type
    if (deRegMessage.token && this.registeredFrames[deRegMessage.token]) {
      this.deregister(deRegMessage.token);
    }
  }

  private _handleLoadRecipe(message: IOmniMessage): void {
    if (message.type !== OmniSDKClientMessages.LOAD_RECIPE) return; // type guard

    const loadRecipeMessage = message as IOmniClientLoadRecipeMessage; // narrowing the type
    //@ts-ignore
    this.app.workbench.loadRecipe(loadRecipeMessage.recipeId, loadRecipeMessage.recipeVersion);
  }

  private _handleShowTopBanner(message: IOmniMessage): void {
    if (message.type !== OmniSDKClientMessages.SHOW_TOP_BANNER) return; // type guard

    const showTopBannerMessage = message as IOmniClientShowTopBannerMessage; // narrowing the type
    const { bannerTitle, bannerDescription, options } = showTopBannerMessage;

    // @ts-expect-error
    this.app.showTopBanner(bannerTitle, bannerDescription, options);
  }

  protected override send(message: any, token: string | '*' = '*') {
    message.token = token;
    message = JSON.parse(JSON.stringify(message)); // dereference and avoid functions/other objects from preventing the send
    if (token === '*') {
      // Broadcast to all registered iframes.
      for (const frameInfo of Object.values(this.registeredFrames)) {
        frameInfo.contentWindow.postMessage(message, '*');
      }
    } else {
      const frameInfo = this.registeredFrames[token];
      if (frameInfo) {
        frameInfo.contentWindow.postMessage(message, '*');
      } else {
        console.warn(`No registered frame with token ${token}`);
      }
    }
  }
}
