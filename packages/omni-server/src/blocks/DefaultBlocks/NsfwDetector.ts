/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */
import { OAIBaseComponent, OmniComponentMacroTypes, type WorkerContext, BlockCategory as Category } from 'omni-sockets';
import { type OmniBaseResource, EOmniFileTypes } from 'omni-sdk';

import { nsfwCheck } from '../../core/NSFWCheck.js';
import { emitKeypressEvents } from 'readline';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'nsfw_checker')
  .fromScratch()
  .set('title', 'NSFW.js Image Classification')
  .set('category', Category.CONTENT_MODERATION)
  .set(
    'description',
    `This block uses nsfw.js to perform nsfw classification.
    NSFW.js returns probabilities for an image to fit weighted in probabilities:    
    Hentai — Pornographic art, unsuitable for most work environments  
    Porn — Indecent content and actions, often involving genitalia  
    Sexy — Unseemly provocative content, can include nipples


  `
  )
  .setMethod('X-CUSTOM');

component
  .addInput(
    component
      .createInput('images', 'array', 'image')
      .set('title', 'Images')
      .set('description', 'One or more images')
      .setControl({
        controlType: 'AlpineLabelComponent'
      })
      .toOmniIO()
  )

  .addInput(
    component
      .createInput('pornThreshold', 'float')
      .set('title', 'Porn Threshold')
      .setConstraints(0, 1, 0.01)
      .setDefault(0.6)
      .setRequired(true)
      .set(
        'description',
        'The probability threshold for the Porn category for an image to be classified NSFW. Set to 1 to disable.'
      )
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('hentaiThreshold', 'float')
      .set('title', 'Hentai Threshold')
      .setConstraints(0, 1, 0.01)
      .setDefault(0.6)
      .set(
        'description',
        'The probability threshold for the Hentai category for an image to be classified NSFW. Set to 1 to disable.'
      )
      .toOmniIO()
  )
  .addInput(
    component
      .createInput('sexyThreshold', 'float')
      .set('title', 'Sexy Threshold')
      .setConstraints(0, 1.0, 0.01)
      .setDefault(0.6)
      .set(
        'description',
        'The probability threshold for the Sexy category for an image to be classified NSFW. Set to 1 to disable.'
      )
      .toOmniIO()
  );

component
  .addOutput(
    component
      .createOutput('sfw', 'array', 'image')
      .set('title', 'SFW Images')
      .set('description', 'Images evaluated safe')

      .toOmniIO()
  )
  .addOutput(
    component
      .createOutput('nsfw', 'array', 'image')
      .set('title', 'NSFW Images')
      .set('description', 'Images evaluated not safe.')

      .toOmniIO()
  )
  .addOutput(
    component
      .createOutput('unclassified', 'array', 'image')
      .set('title', 'Unclassified Images')
      .set('description', 'Images unable to evaluate.')
      .setControl({
        controlType: 'AlpineLabelComponent'
      })
      .toOmniIO()
  )

  .setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {
    const sfw: OmniBaseResource[] = [];
    const nsfw: OmniBaseResource[] = [];
    const unclassified: OmniBaseResource[] = [];
    if (payload.images && payload.images.length > 0) {
      await Promise.all(
        payload.images?.map(async (element: OmniBaseResource) => {
          let meta = element.meta.nsfw;
          if (meta == null || meta.status !== 'success') {
            if (element.fileType === EOmniFileTypes.image) {
              try {
                const result = await nsfwCheck(Buffer.from(element.data), { maxDimension: 0 });
                if (result) {
                  meta = { ...result.classes, status: 'success', isNsfw: result.isNsfw };
                }
              } catch (ex: unknown) {
                meta = { reason: (ex as any).message, status: 'error' };
              }
            } else {
              meta = {
                status: 'unknown',
                reason: 'not a supported image file'
              };
            }
          }

          let isNsfw;

          if (meta.status === 'success') {
            isNsfw = false;
          }

          if (payload.pornThreshold < 1 && meta.Porn != null && meta.Porn > payload.pornThreshold) {
            isNsfw = true;
          }

          if (payload.hentaiThreshold < 1 && meta.Hentai != null && meta.Hentai > payload.hentaiThreshold) {
            isNsfw = true;
          }

          if (payload.sexyThreshold < 1 && meta.Sexy != null && meta.Sexy > payload.sexyThreshold) {
            isNsfw = true;
          }

          if (isNsfw === true) {
            nsfw.push(element);
          } else if (isNsfw === false) {
            sfw.push(element);
          } else {
            unclassified.push(element);
          }
        })
      );
    }

    return { sfw, nsfw, unclassified };
  });
const NSFWCheckerBlock = component.toJSON();

export default NSFWCheckerBlock;
