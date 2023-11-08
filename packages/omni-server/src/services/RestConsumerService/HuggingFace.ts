/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */
import { RESTConsumerService } from "./RESTConsumerService";
import { HfInference } from '@huggingface/inference';
import { type CredentialService } from '../CredentialsService/CredentialService.js'

export async function processHuggingface(payload: any, service: RESTConsumerService) 
{
    const block_payload = payload.body;
    if (!block_payload) throw new Error('Missing payload for huggingface block');

    // TODO: should get base path from the block execution?
    const blockManager = service.server.blocks;
    const baseUrl = blockManager.getNamespace('huggingface')?.api?.basePath ?? '';

    const credentialService = service.app.services.get('credentials') as CredentialService;
    let hf_token = null;
    try 
    {
        hf_token = await credentialService.get(payload.job_ctx.user, 'huggingface', baseUrl, 'Bearer');
    } catch 
    {
        omnilog.warn(
            'huggingface token not found. Using a token would double the speed of the free inference from Huggingface'
        );
    }

    let endpoint = payload.integration.operationId;

    // the operationId can be overwritten by a .endpoint in block_payload._huggingface
    if ('_huggingface' in block_payload) 
    {
        const rep = block_payload._huggingface;
        delete block_payload._huggingface;
        endpoint = rep.endpoint;
    }

    // You can also omit "model" to use the recommended model for the task
    const model = block_payload.model;
    let inference = null;
    if (!hf_token) inference = new HfInference();
    else inference = new HfInference(hf_token);

    switch (endpoint) 
    {
        case 'text_to_image': {
            const prompt = block_payload.prompt || 'award winning high resolution photo of a white tiger';
            const negative_prompt = block_payload.negative_prompt || 'blurry';

            const blob = await inference.textToImage({
                model,
                inputs: prompt,
                parameters: {
                    negative_prompt
                }
            });

            const array_image = await blob.arrayBuffer();
            const type = blob.type;
            const buffer = Buffer.from(array_image);

            //@ts-ignore
            const image_cdn = await service.app.cdn.putTemp(buffer, {
                mimeType: type,
                userId: payload.job_ctx?.userId,
                jobId: payload.job_ctx?.jobId
            });

            return { image: image_cdn, _omni_status: 200 };
        }

        case 'image_to_text': 
        {
            let image_cdns = block_payload.image;
            if (!Array.isArray(image_cdns)) image_cdns = [image_cdns];

            if (!image_cdns) throw new Error('Missing images for image_to_text_task');

            let text_output = '';
            for (const image_cdn of image_cdns) {
                //@ts-ignore
                const raw_image = await service.app.cdn.get(image_cdn.ticket);
                const data = raw_image.data;
                const output = await inference.imageToText({ data, model });
                const generated_text = output?.generated_text;
                text_output = `${text_output}${generated_text}\n`;
            }
            return { text_output, _omni_status: 200 };
        }

        case 'summarization': 
        {
            //inputs
            const input_text = block_payload.input_text;
            if (!input_text) throw new Error('Missing input_text for summarization_task');

            //parameters
            const min_length = block_payload.min_length;
            const max_length = block_payload.max_length;
            const top_k = block_payload.top_k;
            const top_p = block_payload.top_p;
            const temperature = block_payload.temperature || 1.0;
            const repetition_penalty = block_payload.repetition_penalty;
            const max_time = block_payload.max_time;
            const args = {
                model,
                inputs: input_text,
                parameters: { max_length, max_time, min_length, repetition_penalty, temperature, top_k, top_p }
            };

            //options
            const use_cache = block_payload.use_cache || true;
            const wait_for_model = block_payload.wait_for_model || false;
            const options = { use_cache, wait_for_model };

            const summary_output = await inference.summarization(args, options);
            const summary_text = summary_output.summary_text;
            return { summary_text, _omni_status: 200 };
        }

        case 'image_to_image':
        {
            let image_cdns = block_payload.inputs;
            if (!Array.isArray(image_cdns)) image_cdns = [image_cdns];
            if (!image_cdns) throw new Error('Missing images for image_to_image');

            const images = [];
            for (const image_cdn of image_cdns) {
                //@ts-ignore
                const raw_image = await service.app.cdn.get(image_cdn.ticket);
                const inputs = raw_image.data.buffer; // required to use .buffer while all the other inferences don't... Bug?

                //parameters
                const prompt = block_payload.prompt;
                const strength = block_payload.strength;
                const negative_prompt = block_payload.negative_prompt;
                const height = block_payload.height;
                const width = block_payload.width;
                const num_inference_steps = block_payload.num_inference_steps;
                const guidance_scale = block_payload.guidance_scale;
                const guess_mode = block_payload.guess_mode || false;

                const args = {
                    model,
                    inputs,
                    parameters: {
                        prompt,
                        strength,
                        negative_prompt,
                        height,
                        width,
                        num_inference_steps,
                        guidance_scale,
                        guess_mode
                    }
                };

                //options
                const options = {}; // specify options if any

                const blob = await inference.imageToImage(args, options);
                const array_image = await blob.arrayBuffer();
                const type = blob.type;
                const buffer = Buffer.from(array_image);

                //@ts-ignore
                const result_cdn = await service.app.cdn.putTemp(buffer, {
                    mimeType: type,
                    userId: payload.job_ctx?.userId,
                    jobId: payload.job_ctx?.jobId
                });
                images.push(result_cdn);
            }

            return { images, _omni_status: 200 };
        }

        case 'image_segmentation': 
        {
            let image_cdn = block_payload.data;
            if (Array.isArray(image_cdn) && image_cdn.length > 0) image_cdn = image_cdn[0];
            if (!image_cdn) throw new Error('Missing images for image_to_image');

            //data
            //@ts-ignore
            const raw_image = await service.app.cdn.get(image_cdn.ticket);
            const data = raw_image.data;

            if (!data) throw new Error('Missing data for image_to_image_task');
            const args = { model, data };

            //options
            const options = {}; // specify options if any

            const segmentation_outputs = await inference.imageSegmentation(args, options);
            if (!segmentation_outputs) throw new Error('Missing segmentation_output for image_segmentation_task');

            const labels = [];
            const masks = [];
            const scores = [];

            for (const segmentation_output of segmentation_outputs) {
                const label = segmentation_output.label;
                const mask_b64 = segmentation_output.mask;
                const score = segmentation_output.score;

                labels.push(label);
                masks.push(mask_b64);
                scores.push(score);
            }
            return { labels, masks, scores, _omni_status: 200 };
        }
    }

    throw new Error(`Unsupported huggingface endpoint ${endpoint}`);
}



// ApiType for Hugging Face. See https://huggingface.co/docs/hub/api
// interface HuggingfaceApiType {
//   named_endpoints: Record<string, {
//           parameters: {
//               label: string
//               component: string
//               type: string
//               description?: string
//           }[]
//           returns: {
//               label: string
//               component: string
//               type: string
//               description: string
//           }[]
//           type: {
//               continuous: boolean
//               generator: boolean
//           }
//       }>
//   unnamed_endpoints: Record<string, unknown>
// }

// type HuggingfaceInputType = Record<string, string | number | boolean>;

// interface Status {
// queue: boolean
// code?: string
// success?: boolean
// stage: 'pending' | 'error' | 'complete' | 'generating'
// size?: number
// position?: number
// eta?: number
// message?: string
// progress_data?: Array<{
//     progress: number | null
//     index: number | null
//     length: number | null
//     unit: string | null
//     desc: string | null
// }>
// time?: Date
// }

// function buildHuggingfaceParameterArray(api: any, input: HuggingfaceInputType, endpoint: string = '/run')
// {
//   try
//   {
//     const endpoint_definition = api.named_endpoints[endpoint];

//     if (!endpoint_definition) {
//         throw new Error(`Endpoint ${endpoint} not found in the API object`);
//     }

//     const result = endpoint_definition.parameters.map((param: any) => {
//         const key = param.label.toLowerCase().replace(/ /g, '_');
//         return input[key];
//     });

//     return result;
//   }
//   catch(err)
//   {
//     omnilog.error(`Error in buildHuggingfaceParameterArray: ${err}`);
//     return [];
//   }
// }