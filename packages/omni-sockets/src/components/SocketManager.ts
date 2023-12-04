/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type oas31 as OpenAPIV3 } from 'openapi3-ts';
import type { ICustomSocketOpts } from './openapi/types';

import type CustomSocket from './Sockets/CustomSocket';
import DocumentSocket from './Sockets/DocumentSocket';
import FileObjectSocket from './Sockets/FileObjectSocket';
import PrimitiveSocket from './Sockets/PrimitiveSocket';
import JSONSocket from './Sockets/JsonSocket';
import ImageSocket from './Sockets/ImageSocket';
import VideoSocket from './Sockets/VideoSocket';
import AudioSocket from './Sockets/AudioSocket';
import NumberSocket from './Sockets/NumberSocket';
import TextSocket from './Sockets/TextSocket';
import BooleanSocket from './Sockets/BooleanSocket';
import AnySocket from './Sockets/AnySocket';

const socketTypeMap = new Map<string, typeof CustomSocket>();
socketTypeMap.set('boolean', BooleanSocket);
socketTypeMap.set('number', NumberSocket);
socketTypeMap.set('integer', NumberSocket);
socketTypeMap.set('float', NumberSocket);
socketTypeMap.set('string', TextSocket);
socketTypeMap.set('text', TextSocket);
socketTypeMap.set('json', JSONSocket);
socketTypeMap.set('file', FileObjectSocket);
socketTypeMap.set('image', ImageSocket);
socketTypeMap.set('audio', AudioSocket);
socketTypeMap.set('document', DocumentSocket);
socketTypeMap.set('video', VideoSocket);
socketTypeMap.set('any', AnySocket);

const generateSocketName = function (type: string, opts: ICustomSocketOpts): string {
  let name = type;

  if (opts.array == true) {
    name += 'Array';
  }
  if (opts.format !== undefined) {
    name += `_${opts.format}`;
  }

  return name;
};

class SocketManager {
  sockets: Map<string, CustomSocket>;
  static instance: SocketManager;
  constructor() {
    this.sockets = new Map<string, CustomSocket>();
  }

  static getSingleton(): SocketManager {
    SocketManager.instance ??= new SocketManager();
    return SocketManager.instance;
  }

  constructSocket(type: string, opts: ICustomSocketOpts): CustomSocket {
    // eslint-disable-next-line @typescript-eslint/brace-style
    let SocketType = socketTypeMap.get(type);

    if (SocketType === undefined) {
      console.warn(`Unknown socketType: ${type}, creating primimtive`);
      SocketType = PrimitiveSocket;

      //throw new Error(`Unknown socketType: ${type}`)
    }

    const name = generateSocketName(type, opts);

    //@ts-expect-error
    const socket = new SocketType(name, type, { ...opts });

    // iterate over all sockets in sockets.values and combine with new socket if their type matches
    this.sockets.forEach((s) => {
      if (s.type === type) {
        s.combineWith(socket);
        socket.combineWith(s);
      }
    });

    this.sockets.set(socket.name, socket);

    return socket;
  }

  getOrCreateSocket(type: string, opts: ICustomSocketOpts): CustomSocket {
    ['image', 'audio', 'document', 'cdnObject', 'object', 'video', 'file'].forEach((t) => {
      if (type.startsWith(t)) {
        type = t;
      }
    });

    if (type === 'object') {
      type = 'json';
    }

    if (type.startsWith('cdnObject')) {
      type = 'file';
    }

    if (type.includes('Array')) {
      opts.array = true;
    }

    if (type.includes('B64')) {
      opts.format = 'base64';
    }

    const key = generateSocketName(type, opts);

    if (this.has(key)) {
      return this.get(key) as CustomSocket;
    }

    const socket = this.constructSocket(type, opts);

    // Iterate over all sockets in sockets.values and combine with new socket if their type matches

    return socket;
  }

  add(key: string, socket: CustomSocket) {
    this.sockets.set(key, socket);
  }

  get(key: string): CustomSocket | undefined {
    return this.sockets.get(key);
  }

  has(id: string): boolean {
    return this.sockets.has(id);
  }

  isSchemaObject = (obj: any): obj is OpenAPIV3.SchemaObject => {
    return 'type' in obj || '$ref' in obj;
  };
}

export default SocketManager;
