/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'video_input');

component
  .fromScratch()
  .set('description', 'Retrieve a video from the file manager or URL.')
  .set('title', 'Video Input')
  .set('category', Category.INPUT_OUTPUT)
  .setMethod('X-CUSTOM');

component
  .addInput(
    component
      .createInput('video', 'string', 'video', { customSettings: { do_no_return_data: true } })
      .set('title', 'Video')
      .set('description', 'The video')
      .toOmniIO()
  )
  .addInput(
    component.createInput('videoUrl', 'string').set('title', 'Url').set('description', 'The video url').toOmniIO()
  )
  .addOutput(
    component.createOutput('video', 'object', 'video').set('title', 'Video').set('description', 'The video').toOmniIO()
  )
  .addOutput(component.createOutput('duration', 'number').set('description', 'The duration of the video').toOmniIO())
  .addOutput(
    component.createOutput('size', 'number').set('description', 'The size of the video').setHidden(true).toOmniIO()
  )
  .addOutput(component.createOutput('mimeType', 'string').set('description', 'The mimetype').setHidden(true).toOmniIO())
  .addOutput(component.createOutput('ext', 'string').set('description', 'The extension').setHidden(true).toOmniIO())
  .addOutput(
    component.createOutput('fid', 'string').set('description', 'The unique file identifier').setHidden(true).toOmniIO()
  )
  .addOutput(
    component.createOutput('url', 'string').set('description', 'The url of the video').setHidden(true).toOmniIO()
  )
  .setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {
    try {
      if (!payload.video && !payload.videoUrl) {
        return {}; // do not trigger error when no video is provided
      }
      // If 'video' is not provided but 'url' is provided, save the video to the CDN
      if (!payload.video && payload.videoUrl) {
        const savedVideo = await ctx.app.cdn.putTemp(payload.videoUrl, { userId: ctx.userId, jobId: ctx.jobId });
        if (!savedVideo) {
          throw new Error('Failed to save the video from the url to the CDN');
        }
        payload.video = savedVideo; // Set the savedVideo as the video input
      }
      if (!payload.video) {
        return null; // do not throw error when no video is provided
      }
      // const videoInfo = await ctx.app.blocks.runBlock(ctx, 'omnitool.video_info', { video: payload.video });
      // if (videoInfo && videoInfo.video) {
      //   const { meta, size, mimeType, fid, url } = videoInfo.video;
      //   return {
      //     video: videoInfo.video,
      //     duration: meta.duration,
      //     size,
      //     mimeType,
      //     ext: meta.type,
      //     fid,
      //     url,
      //   };
      // }

      // throw new Error('Video info is not available');
      return { video: payload.video };
    } catch (error) {
      console.error(error);
      throw error;
    }
  });

const VideoInputBlock = component.toJSON();
export default VideoInputBlock;
