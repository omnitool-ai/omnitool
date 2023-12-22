/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */
import { type RESTConsumerService } from "./RESTConsumerService";
import { HfInference } from '@huggingface/inference';
import { type CredentialService } from '../CredentialsService/CredentialService.js'
import axios from 'axios';

const MAX_ENTRIES = 25;

export async function processHuggingface(payload: any, service: RESTConsumerService) 
{
    const block_payload = payload.body;
    if (!block_payload) throw new Error('Missing payload for huggingface block');

    // TODO: should get base path from the block execution?
    const blockManager = service.server.blocks;
    const baseUrl = blockManager.getNamespace('huggingface')?.api?.basePath ?? '';

    const credentialService = service.app.services.get('credentials') as CredentialService;
    let hf_token:string|undefined;
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

    if (payload.integration.key === 'huggingface_hub') 
    {
        // huggingface_hub 
        switch (endpoint)
        {
            case 'models':
            {
                const tag = block_payload.tag;
                const max_entries  = block_payload.max_entries || MAX_ENTRIES;
                const results: Record<string,any> = {};

                if (!tag) throw new Error('Missing tag for huggingface_hub models');
                results[tag] = await getModels(tag , max_entries);
                results.result = {"ok":true};

                return results;
            }

            default:
                return null;
        }
    }
    else if (payload.integration.key === 'huggingface') 
    {
        

        // You can also omit "model" to use the recommendedc model for the task
        const model = block_payload.model;
        const job_ctx = payload.job_ctx;

        let inference = null;
        if (!hf_token) inference = new HfInference();
        else inference = new HfInference(hf_token);

        switch (endpoint) 
        {
            case 'text_to_image': 
            {
                const prompt = block_payload.prompt || 'award winning high resolution photo of a white tiger';
                const negative_prompt = block_payload.negative_prompt || 'blurry';

                const blob = await inference.textToImage({
                    model,
                    inputs: prompt,
                    parameters: {
                        negative_prompt
                    }
                });
                                
                const image_cdn = blobToImageCdn(blob, job_ctx, service)
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
                    const result_cdn = blobToImageCdn(blob, job_ctx, service)
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
    }

    // could not process it? return null, which will cause the request to be processed normally
    return null;
}

async function fetchData(tag:string)
{
    try
    {
        console.log(`Fetching data for tag ${tag}`);
        const response = await axios.get(`https://huggingface.co/api/models?filter=${tag}`);
        return response.data;
    } catch (error)
    {
        console.error("Error fetching data:", error);
        throw error;
    }
}

function sortAndFormatData(data:any, max_entries:number, tag:string)
{
    
    return data
        .sort((a:any, b:any) => (b.downloads * b.likes) - (a.downloads * a.likes))
        .slice(0, max_entries)//@ts-ignore
        .map(model => ({
            model_id: model.modelId,
            title: `${model.modelId} [${model.likes}] @ ${model.modelId.split('/')[0]}`,
            likes: model.likes,
            downloads: model.downloads,
            date: model.createdAt,
            author: model.modelId.split('/')[0],
            tag
        }));
}

async function getModels(tag:string, max_entries:number = 20)
{
    try
    {
        const models = await fetchData(tag);
        const formattedData = sortAndFormatData(models, max_entries, tag);

        // Extract model IDs and save to another file
        //@ts-ignore
        const output = [""];
        for (const model of formattedData)
        {
            output.push(model.model_id);
        }
        console.log(JSON.stringify(output, null, 2));

        return output;

    } catch (err:any)
    {
        console.error("Error processing data:", err.message);
    }
}

async function blobToImageCdn(blob: any, job_ctx:any, service: RESTConsumerService) {

    const array_image = await blob.arrayBuffer();
    const type = blob.type;
    const buffer = Buffer.from(array_image);

    //@ts-ignore
    const image_cdn = await service.app.cdn.putTemp(buffer, 
    {
        mimeType: type,
        userId: job_ctx?.userId,
        jobId: job_ctx?.jobId
    });

    return image_cdn;

}
/*
function toCamelCase(str: string) {
    return str
      // First, convert any spaces or hyphens to underscores
      .replace(/[\s-]+/g, '_')
      // Split the string at each underscore
      .split('_')
      // Map through the array and capitalize the first letter of each word except the first word
      .map((word, index) => index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      // Join the array back into a single string
      .join('');
  }
*/