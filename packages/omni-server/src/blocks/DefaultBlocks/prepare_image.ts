/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, OmniComponentMacroTypes, type WorkerContext, BlockCategory as Category } from 'omni-sockets';

import sharp from 'sharp';

const block = OAIBaseComponent.create('omnitool', 'prepare_image');

block
  .fromScratch()
  .set(
    'description',
    'Prepare an image for further processing. Retrieve the source image and apply various transformations such as resizing, cropping, extending with black bars or blurred background, and creating a mask.'
  )
  .set('title', 'Prepare Image')
  .set('category', Category.IMAGE_MANIPULATION)
  .setMethod('X-CUSTOM');

block.addInput(
  block
    .createInput('Source', 'object', 'image')
    .set('description', 'Source image')
    .setControl({ controlType: 'AlpineLabelComponent' })
    .toOmniIO()
);

block.addOutput(block.createOutput('Result', 'object', 'image').toOmniIO());

block.addOutput(block.createOutput('Mask', 'image', 'image').toOmniIO());

block.addOutput(block.createOutput('Width', 'number').toOmniIO());

block.addOutput(block.createOutput('Height', 'number').toOmniIO());

const controlComposer = block.createControl('Target');
controlComposer.setRequired(true).setControlType('AlpineSelectComponent');

controlComposer.setChoices([
  { title: 'Stable Diffusion XL', value: 'sdxl' },
  { title: 'Stable Diffusion 2.1', value: 'sd2.1' },
  { title: 'Stable Diffusion 1.5', value: 'sd1.5' },
  { title: '720p', value: '720p' },
  { title: '1080p', value: '1080p' },
  { title: '4k Wallpaper', value: '4k' },
  { title: '8k', value: '8k' },
  { title: 'Facebook Banner', value: 'facebook' },
  { title: 'Facebook Profile', value: 'fbprofile' },
  { title: 'Google Meet Background', value: 'gmbackground' },
  { title: 'Instagram', value: 'instagram' },
  { title: 'Phone Wallpaper', value: 'phone' },
  { title: 'Snapchat', value: 'snapchat' },
  { title: 'Thumbnail', value: 'thumbnail' },
  { title: 'WeChat', value: 'wechat' },
  { title: 'YouTube Cover', value: 'youtube' },

  { title: 'A4', value: 'a4' },
  { title: 'US Letter', value: 'us_letter' },
  { title: 'Photo Portrait', value: '12x18' },
  { title: 'Photo Landscape', value: '18x12' }
]);

block.addControl(controlComposer.toOmniControl());

type Dimensions = [number, number, number | undefined, string];

function getSize(value: string): Dimensions {
  const sizeMap: Record<string, Dimensions> = {
    sdxl: [1024, 1024, undefined, 'png'],
    'sd1.5': [512, 512, undefined, 'png'],
    'sd2.1': [768, 768, undefined, 'png'],
    phone: [1080, 1920, undefined, 'jpg'],
    '4k': [3840, 2160, undefined, 'jpg'],
    '1080p': [1920, 1080, undefined, 'jpg'],
    '720p': [1280, 720, undefined, 'jpg'],
    '8k': [7680, 4320, undefined, 'jpg'],
    youtube: [1280, 720, undefined, 'jpg'],
    facebook: [820, 312, undefined, 'jpg'],
    fbprofile: [180, 180, undefined, 'jpg'],
    gmbackground: [1920, 1090, undefined, 'jpg'],
    instagram: [1080, 1080, undefined, 'jpg'],
    snapchat: [1080, 1920, undefined, 'jpg'],
    thumbnail: [150, 150, undefined, 'jpg'],
    wechat: [900, 500, undefined, 'jpg'],

    a4: [Math.round(8.27 * 300), Math.round(11.69 * 300), 300, 'jpg'], // 2480 x 3508
    us_letter: [Math.round(8.5 * 300), Math.round(11 * 300), 300, 'jpg'], // 2550 x 3300
    '12x18': [3600, 5400, 300, 'jpg'],
    '18x12': [5400, 3600, 300, 'jpg']
  };

  return sizeMap[value] || [1024, 1024, undefined, 'jpg'];
}

interface ROI {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface ImageInfo {
  buffer: Buffer;
  width: number;
  height: number;
  targetWidth: number;
  targetHeight: number;
  roi?: ROI; // Optional: Region-of-Interest or "safe region", e.g. for faces or masks
}

async function fetchAndProcessImage(cdnRecord: any, ctx: WorkerContext): Promise<ImageInfo> {
  const entry = await ctx.app.cdn.get(cdnRecord.ticket);
  const buffer = entry.data;

  // Use Sharp to get image dimensions
  const image = sharp(buffer).rotate(); // Fix EXIF rotation
  const metadata = await image.metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  return {
    buffer,
    width,
    height,
    targetWidth: width,
    targetHeight: height
  };
}

async function createMask(imageInfo: ImageInfo, feather: number): Promise<Buffer> {
  const { targetWidth, targetHeight } = imageInfo;

  let { roi } = imageInfo;
  roi ??= {
    x0: 0,
    y0: 0,
    x1: targetWidth,
    y1: targetHeight
  };

  // Conditionally inset the ROI if it's not touching the border
  const insetROI = {
    x0: roi.x0 + (roi.x0 > 0 ? feather : 0),
    y0: roi.y0 + (roi.y0 > 0 ? feather : 0),
    x1: roi.x1 - (roi.x1 < targetWidth ? feather : 0),
    y1: roi.y1 - (roi.y1 < targetHeight ? feather : 0)
  };

  // Create a rectangle for the inset ROI
  const interior: Buffer = await sharp({
    create: {
      width: insetROI.x1 - insetROI.x0,
      height: insetROI.y1 - insetROI.y0,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 } // Black
    }
  })
    .png()
    .toBuffer();

  // Initialize sharp transform for the mask to white and composite the black rectangle
  let intermediateBuffer: Buffer = await sharp({
    create: {
      width: targetWidth,
      height: targetHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 } // White
    }
  })
    .composite([
      {
        input: interior,
        top: insetROI.y0,
        left: insetROI.x0
      }
    ])
    .png()
    .toBuffer();

  // Apply feathering (blur) to the entire image in a new Sharp instance
  if (feather > 0) {
    const sigma = 1 + feather / 2;
    intermediateBuffer = await sharp(intermediateBuffer).blur(sigma).png().toBuffer();
  }

  // Get the mask image data as a Buffer
  const maskImageData: Buffer = await sharp(intermediateBuffer).png().toBuffer();

  return maskImageData;
}

async function SoftScale(imageInfo: ImageInfo, target: string): Promise<ImageInfo> {
  const { width: originalWidth, height: originalHeight, targetWidth, targetHeight } = imageInfo;
  const scaleFactorX = targetWidth / originalWidth;
  const scaleFactorY = targetHeight / originalHeight;
  const maxScaleFactor = Math.max(scaleFactorX, scaleFactorY);
  let scaleFudge = 1.03;

  if (target === 'thumbnail') {
    scaleFudge = 1.15;
  }

  const scaleFactorA = Math.min(scaleFactorX * scaleFudge, scaleFactorY * scaleFudge, maxScaleFactor);
  const scaleFactorB = Math.min(
    scaleFactorX * scaleFudge * scaleFudge,
    scaleFactorY * scaleFudge * scaleFudge,
    maxScaleFactor
  );

  let scaledWidth = Math.round(originalWidth * scaleFactorA);
  let scaledHeight = Math.round(originalHeight * scaleFactorA);
  if (scaleFactorX < scaleFactorY) {
    scaledHeight = Math.round(originalHeight * scaleFactorB);
  } else {
    scaledWidth = Math.round(originalWidth * scaleFactorB);
  }

  // Perform the actual resizing here and update the buffer
  const newBuffer = await sharp(imageInfo.buffer).resize(scaledWidth, scaledHeight, { fit: 'fill' }).toBuffer();

  return {
    ...imageInfo,
    buffer: newBuffer,
    width: scaledWidth,
    height: scaledHeight
  };
}

async function SoftCrop(imageInfo: ImageInfo): Promise<ImageInfo> {
  const { width, height, targetWidth, targetHeight } = imageInfo;

  // Calculate the cropping dimensions
  const cropX = Math.max(0, Math.round((width - targetWidth) / 2));
  const cropY = Math.max(0, Math.round((height - targetHeight) / 2));

  // Perform the actual cropping and update the buffer
  const newBuffer = await sharp(imageInfo.buffer)
    .extract({
      left: cropX,
      top: cropY,
      width: Math.min(width, targetWidth),
      height: Math.min(height, targetHeight)
    })
    .toBuffer();

  return {
    ...imageInfo,
    buffer: newBuffer,
    width: Math.min(width, targetWidth),
    height: Math.min(height, targetHeight)
  };
}

async function ExtendWithBlackBars(imageInfo: ImageInfo): Promise<ImageInfo> {
  const { width, height, targetWidth, targetHeight, roi } = imageInfo;

  // Calculate the dimensions for the black bars
  let extendX = Math.round((targetWidth - width) / 2);
  let extendY = Math.round((targetHeight - height) / 2);

  if (roi) {
    // Calculate how to move the ROI towards the center
    const targetCenterX = targetWidth / 2;
    const targetCenterY = targetHeight / 2;
    const roiCenterX = (roi.x0 + roi.x1) / 2;
    const roiCenterY = (roi.y0 + roi.y1) / 2;

    extendX = Math.round(targetCenterX - roiCenterX);
    extendY = Math.round(targetCenterY - roiCenterY);

    // Clamp the values to ensure they are within allowable dimensions
    extendX = Math.max(0, Math.min(extendX, targetWidth - width));
    extendY = Math.max(0, Math.min(extendY, targetHeight - height));
  }

  // Perform the actual extension and update the buffer
  const newBuffer = await sharp(imageInfo.buffer)
    .extend({
      top: extendY,
      bottom: targetHeight - height - extendY,
      left: extendX,
      right: targetWidth - width - extendX,
      background: { r: 0, g: 0, b: 0, alpha: 1 } // Black
    })
    .toBuffer();

  return {
    ...imageInfo,
    buffer: newBuffer,
    width: targetWidth,
    height: targetHeight,
    roi: { x0: extendX, y0: extendY, x1: targetWidth - extendX, y1: targetHeight - extendY }
  };
}

async function ExtendWithBlurredBackground(imageInfo: ImageInfo): Promise<ImageInfo> {
  const { width, height, targetWidth, targetHeight, roi } = imageInfo;

  // Calculate the dimensions for the blurred background
  let extendX = Math.round((targetWidth - width) / 2);
  let extendY = Math.round((targetHeight - height) / 2);

  if (roi) {
    // Calculate how to move the ROI towards the center
    const targetCenterX = targetWidth / 2;
    const targetCenterY = targetHeight / 2;
    const roiCenterX = (roi.x0 + roi.x1) / 2;
    const roiCenterY = (roi.y0 + roi.y1) / 2;

    extendX = Math.round(targetCenterX - roiCenterX);
    extendY = Math.round(targetCenterY - roiCenterY);

    // Clamp the values to ensure they are within allowable dimensions
    extendX = Math.max(0, Math.min(extendX, targetWidth - width));
    extendY = Math.max(0, Math.min(extendY, targetHeight - height));
  }

  // Create a blurred background
  const blurRadius = Math.max(targetWidth, targetHeight) / 32;
  const blurredBuffer = await sharp(imageInfo.buffer)
    .resize(targetWidth, targetHeight, { fit: 'fill' })
    .blur(blurRadius)
    .toBuffer();

  // Composite the original image over the blurred background
  const newBuffer = await sharp(blurredBuffer)
    .composite([
      {
        input: imageInfo.buffer,
        blend: 'over',
        left: extendX,
        top: extendY
      }
    ])
    .toBuffer();

  return {
    ...imageInfo,
    buffer: newBuffer,
    width: targetWidth,
    height: targetHeight,
    roi: { x0: extendX, y0: extendY, x1: targetWidth - extendX, y1: targetHeight - extendY }
  };
}

block.setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {
  const source = payload.Source;
  const target = payload.Target;

  const [targetWidth, targetHeight, dpi, fileFormat] = getSize(target);

  let imageInfo = await fetchAndProcessImage(source, ctx);
  imageInfo.targetWidth = targetWidth;
  imageInfo.targetHeight = targetHeight;

  imageInfo = await SoftScale(imageInfo, target);

  imageInfo = await SoftCrop(imageInfo);
  const useBlackBars = false;
  if (useBlackBars) {
    imageInfo = await ExtendWithBlackBars(imageInfo);
  } else {
    imageInfo = await ExtendWithBlurredBackground(imageInfo);
  }

  const feather = 8; // Set the feather amount here
  const maskImageData = await createMask(imageInfo, feather);

  let transform = sharp(imageInfo.buffer);

  if (dpi) {
    transform = transform.withMetadata({ density: dpi });
  }

  if (fileFormat) {
    transform = transform.toFormat(fileFormat as any);
  }

  const imageData: Buffer = await transform.toBuffer();

  return { Result: imageData, Mask: maskImageData, Width: imageInfo.width, Height: imageInfo.height };
});

const PrepareImageBlock = block.toJSON();
export default PrepareImageBlock;
