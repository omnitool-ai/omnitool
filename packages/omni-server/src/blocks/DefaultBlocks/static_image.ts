/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'input_static_image');

component
  .fromScratch()
  .set(
    'description',
    'Retrieve an image from the file manager or a URL. This is commonly used when you need to provide images stored in the file manager or via a URL as input in a recipe.'
  )
  .set('title', 'Image Input')
  .set('category', Category.INPUT_OUTPUT)
  .setMethod('X-CUSTOM');

component
  .addInput(
    component
      .createInput('img', 'string', 'image', { customSettings: { do_no_return_data: true } })
      .set('title', 'Image')
      .set('description', 'The image')
      .toOmniIO()
  )
  .addInput(
    component.createInput('imgUrl', 'string').set('title', 'Url').set('description', 'The image url').toOmniIO()
  )
  .addOutput(
    component.createOutput('img', 'object', 'image').set('title', 'Image').set('description', 'The image').toOmniIO()
  )
  .addControl(
    component
      .createControl('preview')
      .setControlType('AlpineImageGalleryComponent')
      .set('displays', 'output:img')
      .toOmniControl()
  )
  .addOutput(component.createOutput('width', 'number').set('description', 'The width of the image').toOmniIO())

  .addOutput(component.createOutput('height', 'number').set('description', 'The height of the image').toOmniIO())

  .addOutput(
    component.createOutput('size', 'number').set('description', 'The size of the image').setHidden(true).toOmniIO()
  )

  .addOutput(component.createOutput('mimeType', 'string').set('description', 'The mimetype').setHidden(true).toOmniIO())

  .addOutput(component.createOutput('ext', 'string').set('description', 'The extension').setHidden(true).toOmniIO())

  .addOutput(
    component.createOutput('fid', 'string').set('description', 'The unique file identifier').setHidden(true).toOmniIO()
  )

  .addOutput(
    component.createOutput('url', 'string').set('description', 'The url of the image').setHidden(true).toOmniIO()
  )

  .setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {
    try {
      if (!payload.img && !payload.imgUrl) {
        return {}; // do not trigger error when no image is provided
      }
      // If 'img' is not provided but 'url' is provided, save the image to the CDN
      if (!payload.img && payload.imgUrl) {
        const savedImage = await ctx.app.cdn.putTemp(payload.imgUrl, { userId: ctx.userId, jobId: ctx.jobId });
        if (!savedImage) {
          throw new Error('Failed to save the image from the url to the CDN');
        }
        payload.img = savedImage; // Set the savedImage as the img input
      }
      if (!payload.img) {
        return null; // do not throw error when no image is provided
      }
      const imageInfo = await ctx.app.blocks.runBlock(ctx, 'omnitool.image_info', { image: payload.img });
      if (imageInfo && imageInfo.image) {
        const { meta, size, mimeType, fid, url } = imageInfo.image;
        return {
          img: imageInfo.image,
          width: meta.width,
          height: meta.height,
          size,
          mimeType,
          ext: meta.type,
          fid,
          url
        };
      }

      throw new Error('Image info is not available');
    } catch (error) {
      console.error(error);
      throw error;
    }
  });

const StaticFileComponent = component.toJSON();
export default StaticFileComponent;
