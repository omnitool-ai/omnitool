/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

//----------------------------------------------------------------------------------------------------------
/*
    NSFWCheck.ts - NSFW image detection

    Purpose: This module uses the NSFWJS library to provide a simple interface for detecting NSFW images
    based on nsfw.js

    Implementation notes:

    - Due to the brittleness of tf-node and it's build chain, we are opting to load the WASM model instead
    falling back onto the tfjs wasm backend.

    - The NSFWJS library is not designed to be used in a server environment, so we have to monkey patch the
    fetch to redirect to the local filesystem

    - Since tf-node implements conversion of images into tensor3d format, we have to manually perform
    the conversion, leveraging sharp to force the image into png format and then extracting the raw pixel
    data for conversion

*/
//----------------------------------------------------------------------------------------------------------

import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import nsfw from 'nsfwjs';
import sharp from 'sharp';
import path from 'path';
import sanitize from 'sanitize-filename';

import fs from 'fs/promises';

let model: nsfw.NSFWJS | null = null;
let initializing = false;

interface NSFWOptions {
  maxDimension?: number;
}
interface Prediction {
  className: 'Neutral' | 'Drawing' | 'Hentai' | 'Porn' | 'Sexy';
  probability: number;
}

type PredictionObject = { [key in Prediction['className']]?: number };

interface NSFWResponse {
  classes: PredictionObject;
  isNsfw: boolean;
}

//@ts-ignore
const originalFetch = global.fetch;
function arrayBufferToString(buf: ArrayBuffer): string {
  const uintArray = new Uint8Array(buf);
  let result = '';
  for (let i = 0; i < uintArray.length; i++) {
    result += String.fromCharCode(uintArray[i]);
  }
  return result;
}
// --------------------------------------------
// Unfortunately, to make nsfwjs wasm work, we have to monkey patch the global fetch to redirect the file read to the local filesystem
// We do this by adding an omni:// protocol to the fetch that's constrained to accessing the models directory and sanitized
// to prevent reads outside of the models directory
// --------------------------------------------
//@ts-ignore
global.fetch = async (url: string, options: any) => {
  // in the specific case of our protocol, we want to read the file from the local filesystem
  if (url && url.startsWith?.('omni://models/')) {
    const modelPath = url.slice('omni://models/'.length);

    let dir = path.dirname(modelPath);
    let file = path.basename(modelPath);
    // sanitize the path to prevent reading outside of the models directory
    dir = dir
      .split('/')
      .map((d: string) => sanitize(d))
      .join(path.sep);
    file = sanitize(file);
    console.info('[NSFWCheck] Fetching', url, modelPath, dir, file);
    const data = await fs.readFile(path.join(process.cwd(), 'config.default', 'models', dir, file)); // Read the file from the filesystem (simplified')

    const buffer = data.buffer as ArrayBuffer;

    return {
      ok: true,
      arrayBuffer: async () => buffer,
      json: async () => {
        const text = arrayBufferToString(buffer);

        const ret = JSON.parse(text);

        return ret;
      },
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      text: async () => buffer.toString()
    };
  }

  // Otherwise, use the original fetch
  // eslint-disable-next-line @typescript-eslint/return-await
  return originalFetch(url, options);
};

// TODO: We can support different models here in the future.
// mobilenet-v2-quant is the smallest model and most efficient one at this time
// but there's a number of other options that look promising.
async function initializeModel(): Promise<void> {
  if (!model && !initializing) {
    initializing = true;
    try {
      await tf.setBackend('wasm');
      const wasmPath = process.cwd() + '/config.local/wasm/tfjs-backend-wasm.wasm';
      setWasmPaths(wasmPath);

      const modelPath = 'omni://models/nsfwjs/mobilenet-v2-quant/model.json';
      model = await nsfw.load(modelPath);
      initializing = false;
    } catch (error) {
      initializing = false;
      throw error;
    }
  }
}
function transformPredictions(predictions: Prediction[]): PredictionObject {
  return predictions.reduce<PredictionObject>((acc, prediction) => {
    acc[prediction.className] = prediction.probability;
    return acc;
  }, {});
}

const nsfwCheck = async (imageBuffer: Buffer, options: NSFWOptions = { maxDimension: 512 }): Promise<NSFWResponse> => {
  try {
    let processedBuffer = imageBuffer;

    // Resize the image if needed
    if (options.maxDimension && options.maxDimension > 0) {
      const metadata = await sharp(imageBuffer).metadata();
      let width: number | undefined;
      let height: number | undefined;
      if (metadata.width && metadata.height) {
        if (metadata.width > metadata.height) {
          height = options.maxDimension;
        } else {
          width = options.maxDimension;
        }
      }

      processedBuffer = (await sharp(imageBuffer).resize(width, height).raw().toBuffer({ resolveWithObject: true }))
        .data;
    }

    // Convert the image to tensor3d format
    const { data, info } = await sharp(processedBuffer).png().raw().toBuffer({ resolveWithObject: true });

    const rawPixelData = new Uint8Array(data.buffer);
    const imageTensor = tf.tensor3d(rawPixelData, [info.height, info.width, info.channels]);

    // Slice out the alpha channel to get only RGB
    const imageRGB = imageTensor.slice([0, 0, 0], [-1, -1, 3]);

    // Run the NSFW detection
    const predictions = await model!.classify(imageRGB);
    imageRGB.dispose();

    // Determine if the image is NSFW and apply blur if enabled
    const isNsfw = predictions.some(
      (prediction: Prediction) =>
        ((prediction.className === 'Porn' || prediction.className === 'Hentai') && prediction.probability > 0.51) ||
        (prediction.className === 'Sexy' && prediction.probability > 0.95)
    );

    return {
      classes: transformPredictions(predictions),
      isNsfw
    };
  } catch (error) {
    console.error('Error processing the image:', error);
    throw error;
  }
};

void initializeModel();

export { nsfwCheck, initializeModel };
