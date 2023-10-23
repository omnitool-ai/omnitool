/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import axios from 'axios';
import { Service, omnilog, type IManager, type IMessage, type IServiceConfig } from 'omni-shared';
import { ChatUtils } from '../utils/ChatUtils';

const getCurrentLocalTime = () =>
  new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(
    new Date()
  );

abstract class RenderExtension {
  _id: string;
  _opts: any;
  constructor(config: { id: string }, opts?: any) {
    this._id = config.id;
    this._opts = opts;
  }

  get id(): string {
    return this._id;
  }

  get opts(): any {
    return this._opts;
  }
}

abstract class ChatRenderer extends RenderExtension {
  constructor(config: { id: string }, opts?: any) {
    super(config, opts);
  }

  load?(): Promise<void> {
    return Promise.resolve();
  }

  abstract render(content: { type: string; value: any }): string;
}

interface IChatClientServiceConfig extends IServiceConfig {
  initialState: object;
  workbench: any;
}

class ChatClientService extends Service {
  state: any;
  _renderers = new Map<string, ChatRenderer>();
  workbench: null;
  _pendingAsyncJobUpdates: Map<string, boolean>;

  constructor(id: string, manager: IManager, config: IChatClientServiceConfig) {
    super(id, manager, config || { id });
    this.state = config.initialState ?? {};
    this.workbench = config.workbench;
    this._pendingAsyncJobUpdates = new Map();
  }

  async registerRenderer(renderer: ChatRenderer): Promise<void> {
    this.info(`registering renderer ${renderer.id}`);
    this._renderers.set(renderer.id, renderer);
    await renderer.load?.(); // if there's a load function, call it.
  }

  // handle multiple per user in the future
  readonly activeContextId = 0;

  // Render all content in a message
  renderMessage(content: Array<{ type: string; value: string }>) {
    if (content?.length === 0) return null;
    // Render using the chat render extension system
    return content.map((c) => this.renderContent(c)).join('\n');
  }

  async onChatMessage(serverMessage: IMessage): Promise<void> {
    // TODO: run in parallel
    await this._onChatMessage(serverMessage);
    await this.updateChatServer(serverMessage, Date.now());
  }

  async _onChatMessage(serverMessage: any): Promise<void> {
    const message = serverMessage.body;
    if (!message) return;
    const { from, flags, workflowId } = serverMessage;
    const { attachments, content } = message;

    const text = this.renderMessage(content);

    const msg = {
      sender: from || 'omni',
      text,
      whenText: getCurrentLocalTime(),
      attachments: 0,
      // @ts-ignore
      workflowId: workflowId ?? this.workbench?.activeWorkflow?.id,
      flags: flags || new Set()
    };

    for (const key in attachments) {
      if (['sender', 'text', 'whenText', 'attachments'].includes(key)) {
        continue;
      }

      if (attachments.key) {
        // Temp fix for old images
        attachments?.[key]?.forEach?.((attachment: any) => {
          const fid = attachment && (attachment.fid ?? attachment?.ticket?.fid);
          if (fid) {
            attachment.url = '/fid/' + fid;
          }
        });
      }

      // @ts-ignore
      msg[key] = attachments[key];

      msg.attachments += isNaN(attachments[key]?.length) ? 0 : attachments[key]?.length;
    }

    await this.emitGlobalEvent('chat_message_added', [msg]);
    this.state.messages.push(msg);
  }

  async updateChatServer(msgstore: object, ts: number): Promise<void> {
    if (ChatUtils.IsAsyncJobMessage(msgstore)) {
      const jobId = ChatUtils.GetAsyncJobIdFromMessage(msgstore);
      if (jobId !== null) {
        // we will handle these in postUpdateChatServer as callbacks
        this._pendingAsyncJobUpdates.set(jobId, true);
      }
      return;
    }

    if (!ChatUtils.ShouldPersist(msgstore)) {
      return;
    }

    // @ts-ignore
    if (this.workbench === null || this.workbench.activeWorkflow === null) {
      return;
    }

    // @ts-ignore
    msgstore.workflowId = this.workbench.activeWorkflow.id;

    await axios
      .put(`/api/v1/chat/${this.activeContextId}`, { payload: { msgstore, version: 0, ts } }, { withCredentials: true })
      .then(
        (result) => {},
        (error) => {
          omnilog.error(error.message);
        }
      );
  }

  async clearChat(): Promise<void> {
    await axios.delete(`/api/v1/chat/${this.activeContextId}`, { withCredentials: true }).then(
      (result) => {},
      (error) => {
        omnilog.error(error.message);
      }
    );
  }

  async postUpdateChatServerForJobs(payload: object, jobId: string, ts: number): Promise<void> {
    if (this._pendingAsyncJobUpdates.get(jobId)) {
      await this.updateChatServer(payload, ts);
      this._pendingAsyncJobUpdates.delete(jobId);
    }
  }

  // render a single content entry in a message using it's registered renderer
  renderContent(content: { type: string; value: any }): string {
    const ext = this._renderers.get(content.type);
    if (ext != null) {
      return ext.render(content);
    } else {
      return `Error: Unknown chat renderer type ${content.type}`;
    }
  }

  create() {
    this.info(`${this.id} create`);
    return true;
  }

  async load() {
    this.info(`${this.id} load`);
    return true;
  }

  async start() {
    this.info(`${this.id} start`);
    return true;
  }

  async stop() {
    this.info(`${this.id} stop`);
    return true;
  }
}

export { ChatClientService, ChatRenderer, RenderExtension, type IChatClientServiceConfig };
