/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type IMessage } from 'omni-shared';

enum ChatMessageStorageTypes {
  User,
  Omni,
  AsyncJob
}

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class ChatUtils {
  static GetMessageStorageType(payload: object): ChatMessageStorageTypes {
    // @ts-ignore
    if (payload.from !== undefined && payload.from === 'omni') {
      return ChatMessageStorageTypes.Omni;
    }
    // @ts-ignore
    else if (payload.sender !== undefined && payload.sender === 'me') {
      return ChatMessageStorageTypes.User;
    } else {
      return ChatMessageStorageTypes.AsyncJob;
    }
  }

  static async IsValidImageUrl(url: string): Promise<boolean> {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) {
        return res.headers.get('Content-Type')?.startsWith('image') ?? false;
      }

      return false;
    } catch (e) {
      return false;
    }
  }

  static CreateAsyncJobServerPayload(message: string, ts: number): object {
    return { message, sender: 'asyncjob', ts };
  }

  static IsAsyncJobMessage(payload: object): boolean {
    try {
      // until we have more defined message types
      const tryServerMessage: IMessage = payload as IMessage;
      return tryServerMessage.body?.content[0]?.type === 'omni/job';
    } catch (e) {
      return false;
    }
  }

  static GetAsyncJobIdFromMessage(payload: object): string | null {
    try {
      // until we have more defined message types
      const tryServerMessage: IMessage = payload as IMessage;
      return tryServerMessage.body.content[0].value;
    } catch (e) {
      return null;
    }
  }

  static ShouldPersist(payload: object): boolean {
    // always allow user local
    if (
      this.GetMessageStorageType(payload) === ChatMessageStorageTypes.User ||
      this.GetMessageStorageType(payload) === ChatMessageStorageTypes.AsyncJob
    ) {
      return true;
    }
    // allow all texts
    const tryServerMessage: IMessage = payload as IMessage;
    // accept images
    if (ChatUtils.HasChatContentProperty(tryServerMessage, 'images')) {
      return true;
    }
    // skip commands
    if (ChatUtils.HasChatContentProperty(tryServerMessage, 'commands')) {
      return false;
    }
    // accept texts
    if (ChatUtils.HasChatContentProperty(tryServerMessage, 'text')) {
      return true;
    }
    // @ts-ignore accept all other texts
    if (payload.body?.content !== undefined) {
      return true;
    }
    return false;
  }

  static HasChatContentProperty(payload: object, name: string): boolean {
    try {
      // @ts-ignore
      return payload.body.attachments[name]?.length > 0;
    } catch (e) {
      return false;
    }
  }
}

export { ChatMessageStorageTypes, ChatUtils };
