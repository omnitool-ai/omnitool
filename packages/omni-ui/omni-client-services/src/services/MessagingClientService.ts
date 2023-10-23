/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import {
  type IMessagingServiceBaseConfig,
  MessagingServiceBase,
  type ServiceManager,
  type IMessage
} from 'omni-shared';
import { fetchEventSource, EventStreamContentType } from '@microsoft/fetch-event-source';

class RetriableError extends Error {}
class FatalError extends Error {}

interface IMessagingClientServiceConfig extends IMessagingServiceBaseConfig {}

class MessagingClientService extends MessagingServiceBase {
  _hadConnection: boolean = false;
  _isConnected: boolean = false;
  _isFatal: boolean = false;
  abortController: AbortController = new AbortController();
  messageHandlers: Map<string, Function> = new Map<string, Function>();

  constructor(id: string, manager: ServiceManager, config: IMessagingClientServiceConfig) {
    super(id, manager, config || { id: 'messaging' });
    this.config = config;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  async setConnectionState(value: boolean, fatal?: boolean, reason?: string) {
    this._hadConnection = this._hadConnection || value;
    if (value !== this._isConnected || (this._isFatal !== fatal && fatal === true)) {
      this._isConnected = value;
      this._isFatal = fatal ?? false;
      this.info(
        'SSE Connection state changed to ',
        value ? 'connected' : 'disconnected',
        fatal ? ' (fatal)' : !value ? '(retrying...) ' : ''
      );

      await this.emit(this._isConnected ? 'connected' : 'disconnected', {
        fatal: fatal === true,
        reason: reason?.toString() ?? ''
      });
    }
  }

  get serviceConfig(): IMessagingClientServiceConfig {
    return this.config as IMessagingClientServiceConfig;
  }

  async load() {
    this.subscribeToGlobalEvent('registerMessageHandler', this.registerMessageHandler.bind(this));
    this.subscribeToGlobalEvent('send:message', this.onMessage.bind(this));
  }

  async start() {
    return true;
  }

  registerMessageHandler(def: { type: string; handler: Function }) {
    if (!this.messageHandlers.has(def.type)) {
      this.messageHandlers.set(def.type, def.handler);
    } else {
      throw new Error(`A message handler for type '${def.type}' is already registered.`);
    }
  }

  decodeServerMessage(serverMessage: any): IMessage | null {
    try {
      const result = this.app.parse(serverMessage);
      if (result.flags) {
        result.flags = new Set(result.flags);
      }
      return result;
    } catch (ex) {
      omnilog.error('Error decoding server message', ex, serverMessage);
      return null;
    }
  }

  stopSSE(): void {
    this.abortController.abort();
  }

  async onMessage(msg: any) {
    const self = this;
    let message;
    // message coming from server needs to be decoded
    if (msg.data && msg.data.length > 0) {
      message = this.decodeServerMessage(msg.data);
    } else if (msg.type != null) {
      message = msg;
    }

    if (message) {
      if (message.type === 'close') {
        self.warn('SSE Connection closed by server, not retrying. Reason: ', message.body);
        await self.setConnectionState(false, true, message.body.message);
        self.abortController.abort();
        return;
      }

      // guard invocation of handlers so they don't take down the event source on error
      let source;
      try {
        if (message.type && self.messageHandlers.has(message.type)) {
          const handler = self.messageHandlers.get(message.type);
          if (handler != null) {
            source = 'handler:' + message.type;
            handler.call(this, message);
          } else {
            source = 'event:' + message.type;
            await self.emit(message.type, message);
          }
        }

        // Legacy support
        const legacy = { ...message.body };
        source = 'legacy:' + JSON.stringify(legacy);
        //self.debug('Legacy SSE Message', legacy);
        await self.emitGlobalEvent('sse_message', legacy);
      } catch (ex) {
        self.error('Error invoking SSE message handling', source, ex);
      }
    } else {
      self.warn('SSE Message was not a valid message and will be ignored', msg);
    }
  }

  async startSSE(target: string): Promise<boolean> {
    if (this.isConnected) {
      this.warn('SSE connection is already running. Ignoring double start.');
      return false;
    }

    const self = this;
    this.info('Connecting to SSE EventSource at ', target + '/api/v1/mercenaries/listen');
    const bootSSE = async () => {
      await fetchEventSource(target + `/api/v1/mercenaries/listen?reconnect=${self._hadConnection}`, {
        signal: self.abortController.signal,
        openWhenHidden: true,

        async onopen(response) {
          if (response.ok && response.headers.get('content-type')?.startsWith(EventStreamContentType)) {
            self.info('SSE Connection opened');
            await self.setConnectionState(true);
          } else if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            self.error('SSE Client Error - fataling', response.status);
            let text =
              'A connection to the server could not be established (Error ' +
              response.status +
              '). Please try again in a few minutes.';
            switch (response.status) {
              case 401:
                text =
                  'The server responded with an authorisation error (401). The most likely reason is that your session has expired or the server was restarted. Please refresh the page to re-authenticate.';
                break;
              case 403:
                text =
                  'The server responded with an authentication error (403). The most likely reason is that your session has expired or the server was restarted. Please refresh the page to re-authenticate.';
                break;
              case 500:
                text = 'The server responded with an internal server error (500). Please try again in a few minutes.';
                break;
              case 502:
                text =
                  'The server responded with a bad gateway error (502). The most likely reason is that the server is restarting. Please refresh the page to re-authenticate.';
                break;
            }

            await self.setConnectionState(false, true, text);
            throw new FatalError();
          } else {
            self.error('SSE Client Issue - retrying', response.status, response.headers);
            await self.setConnectionState(false, false);
            throw new RetriableError();
          }
        },
        onmessage(msg) {
          if (msg.event === 'FatalError') {
            throw new FatalError(msg.data);
          }
          self.info('SSE Message', msg);
          void self.onMessage(msg);
        },
        onclose() {
          self.warn('onClose() retryable');
          void self.setConnectionState(false, false);
          throw new RetriableError();
        },
        onerror(err) {
          if (err instanceof FatalError) {
            void self.setConnectionState(false, true, err.message);
            self.error('SSE Fatal Error', err);
            throw err; // rethrow to stop the operation
          } else {
            void self.setConnectionState(false, false);
            self.error('SSE Retryable Error', err);
            // do nothing to automatically retry. You can also
            // return a specific retry interval here.
          }
        }
      });
    };

    void bootSSE();

    return true;
  }
}

export { MessagingClientService, type IMessagingClientServiceConfig };
