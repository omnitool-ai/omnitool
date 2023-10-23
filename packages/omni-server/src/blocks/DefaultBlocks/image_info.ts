/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';
const NS_OMNI = 'omnitool';
const component = OAIBaseComponent.create(NS_OMNI, 'image_info')
  .fromScratch()
  .set(
    'description',
    'Retrieve details (width, height, size, mimetype, extension, file identifier, and URL) from a given image.'
  )
  .set('title', 'Image Info')
  .set('category', Category.IMAGE_OPERATIONS)
  .setMethod('X-CUSTOM');
component
  .addInput(
    component.createInput('image', 'object', 'image').set('description', 'An image object').setRequired(true).toOmniIO()
  )

  .addOutput(component.createOutput('image', 'object', 'image').set('description', 'An image object').toOmniIO())

  .addOutput(component.createOutput('width', 'number').set('description', 'The width of the image').toOmniIO())

  .addOutput(component.createOutput('height', 'number').set('description', 'The height of the image').toOmniIO())

  .addOutput(component.createOutput('size', 'number').set('description', 'The size of the image').toOmniIO())

  .addOutput(component.createOutput('mimeType', 'string').set('description', 'The mimetype').toOmniIO())

  .addOutput(component.createOutput('ext', 'string').set('description', 'The extension').toOmniIO())

  .addOutput(component.createOutput('fid', 'string').set('description', 'The unique file identifier').toOmniIO())

  .addOutput(component.createOutput('url', 'string').set('description', 'The url of the image').toOmniIO())

  .setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {
    try {
      const imageInput = payload.image;
      if (imageInput) {
        return {
          image: imageInput,
          width: imageInput.meta?.width,
          height: imageInput.meta?.height,
          size: imageInput.size,
          mimeType: imageInput.mimeType,
          ext: imageInput.meta?.type,
          fid: imageInput.fid,
          url: imageInput.url
        };
      } else {
        throw new Error('Image payload is not available');
      }
    } catch (error) {
      console.error(error);
      throw error;
    }
  });

const ImageInfoComponent = component.toJSON();
export default ImageInfoComponent;
