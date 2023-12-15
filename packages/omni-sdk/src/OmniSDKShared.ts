/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type IOmniMessage, type OmniSDKClientMessages, type OmniSDKHostMessages } from './types';

import { OmniResource } from './Resources/OmniResource';
import { OmniBaseResource } from './Resources/OmniBaseResource';
import { HTTPClient } from './Utils/HttpClient';

import EventEmitter from 'emittery';
import type OmniSDKClient from './OmniSDKClient';

export default class OmniSDKShared {
  protected messageHandlers: {
    [key in OmniSDKClientMessages | OmniSDKHostMessages]?: (
      message: IOmniMessage,
      source: MessageEventSource | null
    ) => void;
  } = {};
  protected _isClient = false; // Default to false, meaning it's considered as host by default

  public static Resource = OmniResource;
  public Resource = OmniResource;
  public events = new EventEmitter();
  protected intentMap: Map<string, any> = new Map<string, any>();

  protected _httpClient: HTTPClient;

  constructor() {
    this._initMessageListener();
    this._httpClient = new HTTPClient();
  }

  public unload(): void {
    window.removeEventListener('message', this._messageListenerHandler);
    console.log('Message listener removed.');
  }

  protected _initMessageListener(): void {
    window.addEventListener('message', this._messageListenerHandler, false);
    console.log('Message listener initialized.');
  }

  protected addMessageHandler(
    type: OmniSDKClientMessages | OmniSDKHostMessages,
    handler: (message: IOmniMessage, source: MessageEventSource | null) => void
  ): void {
    this.messageHandlers[type] = handler;

  }

  private _messageListenerHandler = (event: MessageEvent): void => {
    if (event.origin !== window.location.origin) {
      console.warn(`Dropping Message received from an unknown origin: ${event.origin}`);
      return;
    }

    try {
      const data = event.data as IOmniMessage;
      const handler = this.messageHandlers[data.type];
      if (handler) {
        handler.call(this, data, event.source);
      } else {
        console.warn(`No handler found for message type: ${data.type}`);
      }
    } catch (error) {
      console.error('Error processing the message:', error);
    }
  };


  public getLocalValue(key: string, value: any): any
  {

    let finalKey = key
    // In an extensions    
    if (this._isClient)
    {
      finalKey = "omni/"+(this as  unknown as OmniSDKClient)._extensionId + "/" + key
    }
    else
    {
      finalKey = "omni/host/" + key
    }

    let stored = globalThis.localStorage.getItem(finalKey)
    
    if (stored !== null)
    {
      let record = JSON.parse(stored)
      let value = record.value

      switch (record.type)
      {        
        case 'boolean': value = value === 'true' ? true : false; break;
        case 'object':
        case 'number': 
        case 'string': break; 
        default: 
          console.warn("Unsupported value type", record.type, "on", key) 
          return null
        }
      return value;
    }

    return null

  }

  public setLocalValue(key: string, value: any)
  {
    if (key == null || key.length == 0)
    {
      throw new Error("Invalid null Key passed into setLocalValue")
    }

    let finalKey = key
    // In an extensions    
    if (this._isClient)
    {
      finalKey = "omni/"+(this as  unknown as OmniSDKClient)._extensionId + "/" + key
    }
    else
    {
      finalKey = "omni/host/" + key
    }

    if (value === null || value === undefined)
    {
      globalThis.localStorage.removeItem(finalKey)
      return
    }


    const valueType = typeof(value)
    let finalValue = value
    switch(valueType)
    {
      case 'number':
      case 'string': 
      case 'object': break;
      case 'boolean': finalValue = value ? "true" : "false"; break;

      default: 
        console.warn("Unsupported value type", valueType, "on", key)
        return;
      } 

    globalThis.localStorage.setItem(finalKey, JSON.stringify({
      type: valueType,
      value
    }))

  }

  protected send(message: IOmniMessage, token?: string) {
    if (this._isClient) {
      console.log('Sending message from client:', message);
      //@ts-ignore
      message.token = this.token;
      message = JSON.parse(JSON.stringify(message));
      window.parent.postMessage(message, '*');
    } else {
      // Host logic to send message is implemented in OmniHost.
      console.warn('Attempted to send a message from the host without specifying a target.');
    }
  }

  public async runServerScript(scriptName: string, payload: any) {
    const response = await this._httpClient.executeRequest('/api/v1/mercenaries/runscript/' + scriptName, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    return data;
  }

  public canEditFile(file: OmniBaseResource) {
    if (!file) {
      return false;
    }
    return this.intentMap.has(`file:edit:${file.mimeType}`);
  }

  public canViewFile(file: OmniBaseResource) {
    if (!file) {
      return false;
    }
    return this.intentMap.has(`file:show:${file.mimeType}`);
  }

  public async getFileObject(fid: string): Promise<OmniBaseResource | null> {
    try {
      const response = await this._httpClient.executeRequest('/fid/' + fid + '?obj=true', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      const data = await response.json();
      if (data) {
        console.log('getFileObject', data);
        return new OmniBaseResource(data);
      } else {
        console.warn(`No valid file object found for fid ${fid}`);
        return null;
      }
    } catch (ex) {
      console.error(ex);
      return null;
    }
  }

  public async getFileBlob(fid: string): Promise<Blob | null> {
    try {
      const response = await this._httpClient.executeRequest('/fid/' + fid + '?download=true');
      const blob = await response.blob();
      return blob;
    } catch (ex) {
      console.error(ex);
      return null;
    }
  }

  public async uploadFiles(files: FileList, storageType: 'temporary' | 'permanent' = 'temporary') {
    if (files?.length > 0) {
      let result = await Promise.all(
        Array.from(files).map(async (file) => {
          this.uploadSingleFile(file, storageType);
        })
      );

      result = result.filter((r) => r);
      return result;
    } else {
      return [];
    }
  }

  public async uploadSingleFile(file: File, storageType: 'temporary' | 'permanent' = 'temporary') {
    const form = new FormData();
    form.append('storageType', storageType);
    form.append('file', file, file.name || Date.now().toString());

    try {
      const response = await fetch('/fid', {
        method: 'POST',
        body: form
      });

      if (response.ok) {
        const data = await response.json();

        if (data.length > 0 && data[0].ticket && data[0].fid) {
          return data[0];
        } else {
          console.warn('Failed to upload file', { data, file });
          return null;
        }
      } else {
        console.warn('Failed to upload file', { response, file });
        return null;
      }
    } catch (error) {
      console.error('Failed to upload file', { error, file });
      return null;
    }
  }

  public async startRecipe(id: string, args: any) {
    const response = await fetch('/api/v1/workflow/exec', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ workflow: id, args })
    });

    const data = await response.json();

    if (data.status === 'JOB_STARTED') {
      return { ...data }; /* jobId: result.jobId,*/
    }
  }

  public async downloadFile(fileObject: OmniBaseResource, fileName?: string): Promise<void> {
    const fid = fileObject.fid;
    const filename = fileName || fileObject.fileName;

    fetch('/fid/' + fid + '?download=true')
      .then((response) => response.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      })
      .catch((error) => console.error(error));
  }
}
