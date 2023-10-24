/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import {
  type ChatClientService,
  Client,
  ClientExtensionManager,
  type JobControllerClientService,
  type MessagingClientService
} from 'omni-client-services';
import { Workbench } from './workbench';
import { OmniSDKHost, MarkdownEngine } from 'omni-sdk';

import {
  OmniSSEMessages,
  Manager,
  type IOmniSSEMessageCustomExtensionEvent,
  type IOmniSSEMessageClientToast,
  insane
} from 'omni-shared';
import CodeRenderer from './renderers/chat/CodeRenderer';
import MarkdownRenderer from './renderers/chat/MarkdownRenderer';
import OmniComponentRenderer from './renderers/chat/OmniComponentRenderer';
import OmniComponentMetaRenderer from './renderers/chat/OmniComponentMetaRenderer';
import OmniJobRenderer from './renderers/chat/OmniJobRenderer';
import OmniRestErrorRenderer from './renderers/chat/OmniRestErrorRenderer';
import PlainTextRenderer from './renderers/chat/PlainTextRenderer';
import OmniBillingTabRenderer from './renderers/chat/OmniBillingTabRenderer';
import OmniSettingsRenderer from './renderers/chat/OmniSettingsRenderer';
import OmniExtensionListRenderer from './renderers/chat/OmniExtensionListRenderer';

import { OAIComponent31, type OAIBaseComponent, type OmniComponentFormat } from 'omni-sockets';
//@ts-expect-error
import WinBox from '@winbox/src/js/winbox.js';
import '@winbox/src/css/winbox.css';

enum ReteCurveType {
  CurveBasis = 'curveBasis',
  CurveBasisClosed = 'curveBasisClosed',
  CurveBasisOpen = 'curveBasisOpen',
  CurveBump = 'curveBump',
  CurveBundle = 'curveBundle',
  CurveCardinal = 'curveCardinal',
  CurveCardinalClosed = 'curveCardinalClosed',
  CurveCardinalOpen = 'curveCardinalOpen',
  CurveCatmullRom = 'curveCatmullRom',
  CurveCatmullRomOpen = 'curveCatmullRomOpen',
  CurveLinear = 'curveLinear',
  CurveLinearClosed = 'curveLinearClosed',
  CurveMonotone = 'curveMonotone',
  CurveNatural = 'curveNatural',
  CurveRadial = 'curveRadial',
  CurveStep = 'curveStep'
}

enum ReteSettings {
  curve = 'curve'
}

class ClientBlockManager extends Manager {
  private readonly factories: Map<string, Function>;
  private readonly componentCache: Map<string, OAIBaseComponent>;

  constructor(app: OmnitoolClient) {
    super(app);

    this.factories = new Map();
    this.componentCache = new Map();

    this.registerType('OAIComponent31', OAIComponent31.fromJSON);
  }

  public registerType(key: string, Factory: Function): void {
    if (!key) throw new Error('registerType(): key cannot be undefined');
    if (!Factory || typeof Factory !== 'function') throw new Error(`Factory ${key} must be a function`);
    if (this.factories.has(key)) throw new Error(`Block type ${key} already registered`);
    this.factories.set(key, Factory);
  }

  get client(): OmnitoolClient {
    return this.app as OmnitoolClient;
  }

  private async _rpc(fName: string, args: any): Promise<any> {
    return await this.client.runScript('blockManager', { command: fName, args }, { fromChatWindow: false });
  }

  public async getInstance(key: string): Promise<OAIBaseComponent | undefined> {
    const ret = await this.getInstances([key]);
    return ret ? ret[0] : undefined;
  }

  // return a composed block. If the key responds to a patch, the patch is applied to the underlying block
  public async getInstances(keys: string[]): Promise<OAIBaseComponent[]> {
    if (!keys) throw new Error('getInstances(): key cannot be undefined');

    // Check the cache first
    let found = (keys.map((k) => this.componentCache.get(k)) as OAIBaseComponent[]) || [];
    const missing = keys.filter((k) => !this.componentCache.has(k));

    // Retrieve any missing
    if (missing.length > 0) {
      const userId = undefined;
      const blocks = (await this._rpc('getInstances', [missing, userId, 'missing_block'])) as OmniComponentFormat[];
      const results = await Promise.all(
        blocks.map(async (block: OmniComponentFormat) => {
          const Factory = this.factories.get(block.type || 'OAIComponent31');
          if (!Factory) {
            throw new Error(`Internal error, Block type ${block.type} not registered`);
          }
          const instance = Factory(block); // return the composed block
          this.componentCache.set(instance.name, instance);
          return instance;
        })
      );
      found.push(...results);
    }
    found = found.filter((r) => r !== undefined);
    return found;
  }
}

// Custom client
class OmnitoolClient extends Client {
  clipboard: any = {};
  workbench: Workbench;
  uiSettings: any = {};
  reteSettings: {
    curve: ReteCurveType;
    curvature: number;
    arrow: boolean;
  };

  windows: Map<string, WinBox>;
  sdkHost: OmniSDKHost<OmnitoolClient>;
  public readonly markdownEngine: MarkdownEngine;

  private readonly _blocks: ClientBlockManager;

  constructor(id: string, options: any) {
    super(id, options);
    this.markdownEngine = new MarkdownEngine();
    this.windows = new Map<string, WinBox>();
    this.sdkHost = new OmniSDKHost<OmnitoolClient>(this).init();

    // @ts-ignore
    this.workbench = new window.Alpine.reactive(new Workbench(this));
    const client = this;

    this._blocks = new ClientBlockManager(this);

    //@ts-expect-error
    this.reteSettings = new window.Alpine.reactive({
      curve: window.localStorage.getItem('settings.rete.curve') ?? ReteCurveType.CurveBasis,
      arrow: window.localStorage.getItem('settings.rete.arrow') === 'true',
      curvature: parseFloat(window.localStorage.getItem('settings.rete.curvature') ?? '0.3')
    });

    for (const key in ReteSettings) {
      const value = window.localStorage.getItem(`settings.rete.${key}`);
      if (value) {
        //@ts-ignore
        this.reteSettings[key] = value;
      }
    }

    // @ts-ignore
    this.uiSettings = new window.Alpine.reactive({
      minimalChat: window.localStorage.getItem('settings.minimalChat') === 'true',
      chatSide: window.localStorage.getItem('settings.chatSide') ?? 'left',
      tabBarStyle: window.localStorage.getItem('settings.tabBarStyle') ?? 'tabs',
      chatMinimized: window.localStorage.getItem('settings.chatMinimized') === 'true' ?? false,
      async toggleMinimal() {
        this.minimalChat = !this.minimalChat;
        window.localStorage.setItem('settings.minimalChat', this.minimalChat);
        await client.emit('request_editor_resize', {});
      },
      async toggleSide() {
        this.chatSide = this.chatSide === 'left' ? 'right' : 'left';
        window.localStorage.setItem('settings.chatSide', this.chatSide);
        await client.emit('request_editor_resize', {});
      },
      async toggleMinimized(val?: boolean) {
        this.chatMinimized = val !== undefined ? val : !this.chatMinimized;
        window.localStorage.setItem('settings.chatMinimized', this.chatMinimized ? 'true' : 'false');
        await client.emit('request_editor_resize', {});
      }
    });
    // @ts-ignore
    this.extensions = new window.Alpine.reactive(new ClientExtensionManager(this));
  }

  showToast(
    message: string,
    options: {
      description?: string;
      type?: 'default' | 'danger' | 'success' | 'warning' | 'info';
      position?: string;
      html?: string;
    } = { description: '', type: 'default', position: 'top-right', html: '' }
  ) {
    const description = options.description || '';
    const type = options.type || 'default';
    const position = options.position || 'top-right';
    const html = options.html || '';

    window.dispatchEvent(new CustomEvent('toast-show', { detail: { type, message, description, position, html } }));
  }

  showTopBanner(
    bannerTitle: string,
    bannerDescription: string,
    options: {
      link?: string;
    }
  ) {
    const link = options.link ?? '';
    window.dispatchEvent(new CustomEvent('top-banner-show', { detail: { bannerTitle, bannerDescription, link } }));
  }

  closeWindow(singletonHash?: string): boolean {
    const win = this.getWindow(singletonHash);
    if (win) {
      win.close();
    }
    return !!win;
  }

  public getWindow(singletonHash?: string): WinBox | undefined {
    return singletonHash ? this.windows.get(singletonHash) : undefined;
  }

  public toggleWindow(url: string, singletonHash: string | undefined, opts: any): WinBox | undefined {
    opts ??= {};
    opts.minwidth ??= '600px';
    opts.minheight ??= '500px';
    opts.x ??= 'center';
    opts.y ??= 'center';

    if (singletonHash)
    {
      this.closeWindow(singletonHash)
      url += `&omniHash=${singletonHash}`;
    }

    const template = document.createElement('div');
    template.innerHTML = `
        <div class="wb-header">
            <div class="wb-control">
                <span class="wb-custom"></span>
                <span class="wb-close"></span>
            </div>
            <div class="wb-drag">
                <div class="wb-title">
                </div>
            </div>
        </div>
        <div class="wb-body"></div>
    `;

    const window = new WinBox(
      Object.assign(
        {},
        {
          title: opts.title,
          url,
          class: [],
          autosize: true
        },
        opts,
        {
          onclose: () => {
            if (singletonHash) {
              this.windows.delete(singletonHash);
              this.sdkHost.deregister(singletonHash);
            }
            this.workbench.refreshUI();
          }
        }
      )
    );

    if (singletonHash) {
      this.windows.set(singletonHash, window);
    }

    this.workbench.refreshUI();
    return window;
  }

  get blocks(): ClientBlockManager {
    return this._blocks;
  }

  async onConfigure(): Promise<boolean> {
    this.success('onConfigure');
    return true;
  }

  async onLoad(): Promise<boolean> {
    this.success('onLoad');

    return true;
  }

  async onStart(): Promise<boolean> {
    const renderInitTasks: Promise<void>[] = [];

    renderInitTasks.push(this.chat.registerRenderer(new PlainTextRenderer()));
    renderInitTasks.push(this.chat.registerRenderer(new MarkdownRenderer()));
    renderInitTasks.push(this.chat.registerRenderer(new OmniJobRenderer()));
    renderInitTasks.push(this.chat.registerRenderer(new OmniComponentRenderer()));
    renderInitTasks.push(this.chat.registerRenderer(new OmniComponentMetaRenderer()));
    renderInitTasks.push(this.chat.registerRenderer(new OmniRestErrorRenderer()));
    renderInitTasks.push(this.chat.registerRenderer(new OmniBillingTabRenderer()));
    renderInitTasks.push(this.chat.registerRenderer(new OmniSettingsRenderer()));
    renderInitTasks.push(this.chat.registerRenderer(new OmniExtensionListRenderer()));
    renderInitTasks.push(this.chat.registerRenderer(new CodeRenderer()));

    await Promise.all(renderInitTasks);

    this.io.registerMessageHandler({ type: 'chat', handler: this.chat.onChatMessage.bind(this.chat) });
    this.io.registerMessageHandler({
      type: OmniSSEMessages.CLIENT_TOAST,
      handler: (message: IOmniSSEMessageClientToast): any => {
        this.showToast(message.body.message, message.body.options);
      }
    });
    this.io.registerMessageHandler({ type: 'chat:system', handler: this.chat.onChatMessage.bind(this.chat) });
    this.io.registerMessageHandler({
      type: OmniSSEMessages.CUSTOM_EXTENSION_EVENT,
      handler: (message: IOmniSSEMessageCustomExtensionEvent) => {
        const { extensionId, eventId, eventArgs } = message.body;
        this.sdkHost.signalCustomEvent(extensionId, eventId, eventArgs);
      }
    });

    // Subscribe to messages from the server
    this.io.registerMessageHandler({ type: 'job:status', handler: this.jobs.handleMessages.bind(this.jobs) });
    this.io.registerMessageHandler({ type: 'job:error', handler: this.jobs.handleMessages.bind(this.jobs) });
    this.io.registerMessageHandler({ type: 'job:update', handler: this.jobs.handleMessages.bind(this.jobs) });

    this.events.on('chat_message_added', async (eventData: any) => {
      const [message] = eventData;
      console.log(message);
      this.sdkHost.signalChatMessageReceived(message);
    });

    await this.io.startSSE(''); // Start the SSE connection to receive real time messages from the server.
    await this.workbench.load(); // Initialize the workbench

    return true;
  }

  get io(): MessagingClientService {
    return this.services.get('messaging') as unknown as MessagingClientService;
  }

  get jobs(): JobControllerClientService {
    return this.services.get('jobs') as unknown as JobControllerClientService;
  }

  get chat(): ChatClientService {
    return this.services.get('chat') as unknown as ChatClientService;
  }

  addImageToClipboard(images: any) {
    if (!images) {
      return;
    }

    if (!Array.isArray(images)) {
      images = [images];
    }

    this.clipboard ??= {};
    this.clipboard.images ??= [];
    this.clipboard.images = this.clipboard.images.concat(images);
  }
}

export { OmnitoolClient };
