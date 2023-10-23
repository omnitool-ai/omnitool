/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { App, type IAppEvents } from 'omni-shared';
import { type CommandService } from '../services/CommandService';
import { ClientExtensionManager } from './ClientExtensionManager';

class Client extends App implements IAppEvents {
  broadcastChannel?: BroadcastChannel;
  abortController: AbortController;

  scripts: Map<string, Function> = new Map<string, Function>();
  renderers = new Map<string, { regExp: RegExp; fn: Function }>();
  public extensions: ClientExtensionManager;

  constructor(id: string, config?: any) {
    super(id, config);

    this.extensions = new ClientExtensionManager(this);
    this.abortController = new AbortController();

    this.registerClientScript('help', async (args: any) => {
      const commands = Array.from(this.scripts.keys())
        .filter((s) => s !== 'help')
        .sort()
        .map((s) => {
          return {
            title: '/' + s,
            id: s,
            args: [],
            classes: [
              'btn-xs',
              'rounded',
              'bg-slate-300',
              'text-black',
              'hover:bg-slate-700',
              'hover:text-white',
              'w-32'
            ]
          };
        });

      const greetings = [
        'Welcome to **Omnitool.ai**.',
        'Greetings to **Omnitool.ai**.',
        'Salutations, to **Omnitool.ai**.',
        'Welcome, you have arrived at **Omnitool.ai**.',
        'Hello and welcome to **Omnitool.ai**.',
        'Hey there, welcome to **Omnitool.ai**.',
        'We are pleased to welcome you to **Omnitool.ai**.',
        'Thanks for trying **Omnitool.ai**.',
        'Nice to see you at **Omnitool.ai**.',
        'Good to have you at **Omnitool.ai**.',
        'Pleased to meet you at **Omnitool.ai**.',
        "Glad you're here at **Omnitool.ai**.",
        'Happy to have you at **Omnitool.ai**.',
        'Delighted to see you at **Omnitool.ai**.',
        'Thank you for being here at **Omnitool.ai**.',
        "It's a pleasure to welcome you to **Omnitool.ai**.",
        "You've arrived at the right place, **Omnitool.ai**.",
        "We've been expecting you at **Omnitool.ai**.",
        "You're in good company at **Omnitool.ai**."
      ];
      const greeting = greetings[Math.floor(Math.random() * Math.random() * greetings.length)];

      void this.sendSystemMessage(greeting, 'text/markdown', { commands });

      return { response: '', hide: true };
    });
  }

  async init() {
    try {
      this.info('Initializing Extension System...');
      await this.extensions.init();
      this.success('Extension System successfully initialized.');
    } catch (ex) {
      this.error('Unable to load extensions. Proceeding without.', ex);
    }
  }

  registerClientScript(name: string, fn: Function): void {
    this.success('registering client script', name);
    this.scripts.set(name, fn);
  }

  async sendSystemMessage(
    message: any,
    type: string = 'text/markdown',
    attachments: any = [],
    flags: any = [],
    sender: string = 'omni'
  ) {
    void this.sendSystemMessages([{ message, type }], attachments, flags, sender);
  }

  async sendSystemMessages(
    messages: Array<{ message: any; type: string }>,
    attachments: any = [],
    flags: any = [],
    sender: string = 'omni'
  ) {
    const header = { type: 'chat:system', from: sender || 'omni', flags: new Set(flags) };
    const body = {
      content: messages.map((m) => ({ value: m.message, type: m.type ?? 'text/markdown' })),
      attachments
    };
    const packet = { ...header, body };
    void this.emit('send:message', packet);
  }

  async runBlock(args: any): Promise<any> {
    const service = this.services.get('command') as CommandService;
    return await service.runServerScript('runBlock', args);
  }

  async runScript(script: string, args: any, opts?: { fromChatWindow: boolean }): Promise<any> {
    opts ??= { fromChatWindow: false };

    const client = this;
    if (!script) return { error: { message: 'No script specified' } };
    this.debug('executing script', script, args);

    if (this.scripts.has(script)) {
      const fn = this.scripts.get(script);
      try {
        const result = (await fn?.(args ?? [])) || {};
        // iterate over entries in renderers
        if (result.response) {
          const hide = result.hide ?? false;

          if (!opts.fromChatWindow) {
            if (!hide) {
              await client.sendSystemMessage(result.response);
            }
          }
          return { response: result.response, hide, result: result.result };
        } else {
          return { error: result.error };
        }
      } catch (err: any) {
        this.error('Error running client script', err);
        return { error: { message: err.message } };
      }
    } else {
      try {
        const service = this.services.get('command') as CommandService;
        return await service.runServerScript(script, args);
      } catch (err: any) {
        this.error('Error running server script', err);
        return { error: { message: err.message || err } };
      }
    }
  }

  async onStart(): Promise<boolean> {
    return true;
  }
}

export default Client;
