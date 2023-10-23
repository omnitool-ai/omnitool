/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

class OmniResource {
  static isPlaceholder(obj: any) {
    return obj?.onclick != null;
  }

  static isAudio(obj: any) {
    return (
      (obj && !OmniResource.isPlaceholder(obj) && obj?.mimeType?.startsWith('audio/')) ||
      obj.mimeType == 'application/ogg'
    );
  }

  static isImage(obj: any) {
    return obj && !OmniResource.isPlaceholder(obj) && obj?.mimeType?.startsWith('image/');
  }

  static isDocument(obj: any) {
    return (
      obj &&
      !OmniResource.isPlaceholder(obj) &&
      (obj?.mimeType?.startsWith('text/') || obj?.mimeType?.startsWith('application/pdf'))
    );
  }
}

export { OmniResource };
