/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { EOmniFileTypes, ICdnResource } from '../types.js';

export class OmniBaseResource {
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
  meta: {
    type?: string;
    dimensions?: { width: number; height: number };
    created?: number;
    creator?: string;
    nsfw?: any;
  };

  constructor(resource: ICdnResource) {
    this.fid = resource.fid || resource.ticket?.fid;
    if (!this.fid) throw new Error('Invalid resource, fid missing');
    this.ticket = resource.ticket;
    this.fileName = resource.fileName;
    this.size = resource.size;
    this.data = resource.data;
    this.url = resource.url;
    this.mimeType = resource.mimeType;
    this.expires = resource.expires;
    this.meta = resource.meta || {};
    this.meta.created = this.meta.created || Date.now();
    let ext = this.fileName.split('.').pop();
    this.furl = `fid://${this.fid}.${ext}`;
    this.fileType =
      OmniBaseResource.determineFileTypeFromMimeType(this.mimeType) || resource.fileType || EOmniFileTypes.file;
  }

  static determineFileTypeFromMimeType(mimeType?: string): EOmniFileTypes | undefined {
    const validFileTypes = [
      EOmniFileTypes.audio,
      EOmniFileTypes.document,
      EOmniFileTypes.image,
      EOmniFileTypes.video,
      EOmniFileTypes.file
    ];

    if (mimeType) {
      let ft = mimeType.split('/')[0];

      if (validFileTypes.includes(ft as EOmniFileTypes)) {
        return ft as EOmniFileTypes;
      }

      if (ft.startsWith('text/')) {
        return EOmniFileTypes.document;
      }

      if (ft === 'application/ogg') {
        return EOmniFileTypes.audio;
      }

      if (ft === 'application/pdf') {
        return EOmniFileTypes.document;
      }

      if (ft === 'video/') {
        return EOmniFileTypes.video;
      }
    }

    return undefined;
  }

  isAudio(): boolean {
    if (this.fileType === EOmniFileTypes.audio) {
      return true;
    }
    if (this.mimeType) {
      return this.mimeType?.startsWith('audio/') || this.mimeType?.startsWith('application/ogg');
    }
    return false;
  }

  isVideo(): boolean {
    if (this.fileType === EOmniFileTypes.video) {
      return true;
    }
    if (this.mimeType) {
      return this.mimeType?.startsWith('video/');
    }
    return false;
  }

  isImage(): boolean {
    if (this.fileType === EOmniFileTypes.image) {
      return true;
    }
    if (this.mimeType) {
      return this.mimeType?.startsWith('image/');
    }
    return false;
  }
  isDocument(): boolean {
    if (this.fileType === EOmniFileTypes.document) {
      return true;
    }
    if (this.mimeType) {
      return this.mimeType?.startsWith('text/') || this.mimeType?.startsWith('application/pdf');
    }
    return false;
  }

  asBase64(addHeader?: boolean): string | undefined {
    if (this.data instanceof Buffer) {
      if (addHeader) {
        return `data:${this.mimeType};base64,${this.data.toString('base64')}`;
      } else {
        return this.data.toString('base64');
      }
    } else if (typeof this.data === 'string') {
      return this.data;
    }
  }
}
