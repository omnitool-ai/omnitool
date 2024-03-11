/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */
import { type RESTConsumerService } from "./RESTConsumerService";
import { HfInference } from '@huggingface/inference';
import { type CredentialService } from '../CredentialsService/CredentialService.js'
import axios from 'axios';

import type {
    AudioClassificationArgs, AudioClassificationOutputValue,
    AudioToAudioArgs, AudioToAudioOutputValue,
    AutomaticSpeechRecognitionArgs, AutomaticSpeechRecognitionOutput,
    ConversationalArgs, ConversationalOutput,
    DocumentQuestionAnsweringArgs, DocumentQuestionAnsweringOutput,
    FillMaskArgs, FillMaskOutput,
    FeatureExtractionArgs, FeatureExtractionOutput, 
    ImageClassificationArgs, ImageClassificationOutputValue,
    ImageSegmentationArgs, ImageSegmentationOutputValue,
    ImageToImageArgs, ImageToImageOutput,
    ImageToTextArgs, ImageToTextOutput,
    ObjectDetectionArgs, ObjectDetectionOutputValue,
    QuestionAnsweringArgs, QuestionAnsweringOutput,        
    SentenceSimilarityArgs, SentenceSimilarityOutput,    
    SummarizationArgs, SummarizationOutput,
    TableQuestionAnsweringArgs, TableQuestionAnsweringOutput,
    TabularClassificationArgs, TabularClassificationOutput,
    TabularRegressionArgs, TabularRegressionOutput,
    TextClassificationArgs, TextClassificationOutput,
    TextGenerationArgs, TextGenerationOutput,
    TextToImageArgs, TextToImageOutput,
    TextToSpeechArgs, TextToSpeechOutput,
    TokenClassificationArgs, TokenClassificationOutputValue,
    TranslationArgs, TranslationOutput,
    VisualQuestionAnsweringArgs, VisualQuestionAnsweringOutput,
    ZeroShotClassificationArgs, ZeroShotClassificationOutputValue,
    ZeroShotImageClassificationArgs, ZeroShotImageClassificationOutputValue,
    } from '@huggingface/inference/dist/index.js';


const MAX_ENTRIES = 25;

// audio-classification
async function audioClassification(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService) 
{
    const labels = [];
    const scores = [];
    const jsons = [];

    let audio_cdns = block_payload.audio;
    if (!Array.isArray(audio_cdns)) audio_cdns = [audio_cdns];
    if (!audio_cdns || audio_cdns.length === 0) throw new Error('Missing audio');
    for (const audio_cdn of audio_cdns) {
        //@ts-ignore
        const raw_audio = await service.app.cdn.get(audio_cdn.ticket);
        const data = raw_audio.data;
        const args:AudioClassificationArgs = { model, data };

        const inference_results: AudioClassificationOutputValue[] = await inference.audioClassification(args, options);
        if (!inference_results) throw new Error('Missing classification_output for audio_classification_task');

        for (const classification_output of inference_results) {
            const label = classification_output.label;
            const score = classification_output.score;

            labels.push(label);
            scores.push(score);
            jsons.push({ label, score });
        }
    }

    return { label:labels, score:scores, json:jsons, _omni_status: 200 };
}
// audio-to-audio
async function audioToAudio(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService) 
{
    const audios = [];
    const labels = [];
    let audio_cdns = block_payload.audio;
    if (!Array.isArray(audio_cdns)) audio_cdns = [audio_cdns];
    if (!audio_cdns || audio_cdns.length === 0) throw new Error('Missing audio');

    for (const audio_cdn of audio_cdns) 
    {
        //@ts-ignore
        const raw_audio = await service.app.cdn.get(audio_cdn.ticket);

        const data: any = raw_audio.data;
        const args: AudioToAudioArgs = { model, data };

        const inference_results: AudioToAudioOutputValue[] = await inference.audioToAudio(args, options);
        if (!inference_results) throw new Error('Missing result for audio_to_audio_task');
        for (const result of inference_results)
        {
            const blob = result.blob;
            const label = result.label;
            const audio_cdn = await blobToAudioCdn(blob, job_ctx, service)
            audios.push(audio_cdn);
            labels.push(label);
        }
    }
    return { audios, labels, _omni_status: 200 };
}

// automatic-speech-recognition
async function automaticSpeechRecognition(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{
    const texts = [];

    let audio_cdns = block_payload.audio;
    if (!Array.isArray(audio_cdns)) audio_cdns = [audio_cdns];
    if (!audio_cdns || audio_cdns.length === 0) throw new Error('Missing audio');

    for (const audio_cdn of audio_cdns) 
    {
        //@ts-ignore
        const raw_audio = await service.app.cdn.get(audio_cdn.ticket);

        const data: any = raw_audio.data;
        const args: AutomaticSpeechRecognitionArgs = { model, data };

        const inference_results: AutomaticSpeechRecognitionOutput = await inference.automaticSpeechRecognition(args, options);
        if (!inference_results) throw new Error('Missing transcription_output for automatic_speech_recognition_task');

        const text: string = inference_results.text;
        texts.push(text)
    }
    return { text:texts, _omni_status: 200 };
}

// conversational
async function conversational(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{
    let generated_responses:string[] = block_payload.generated_responses || [];
    if (!Array.isArray(generated_responses)) generated_responses = [generated_responses];

    let past_user_inputs: string[] = block_payload.past_user_inputs || [];
    if (!Array.isArray(past_user_inputs)) past_user_inputs = [past_user_inputs];

    const text = block_payload.text || "";
    if (!text || text.length === 0) throw new Error('Missing text for conversational_task');

    const inputs = { text, generated_responses, past_user_inputs};

    const max_length = block_payload.max_length;
    const max_time = block_payload.max_time;
    const min_length = block_payload.min_length;
    const repetition_penalty = block_payload.repetition_penalty;
    const temperature = block_payload.temperature;
    const top_k = block_payload.top_k;
    const top_p = block_payload.top_p;

    const parameters = { max_length, max_time, min_length, repetition_penalty, temperature, top_k, top_p };
    const args: ConversationalArgs = { model, inputs, parameters };

    const inference_results: ConversationalOutput = await inference.conversational(args, options);
    if (!inference_results) throw new Error('Missing conversational_output for conversational_task');

    const generated_text: string = inference_results.generated_text;
    const conversation = inference_results.conversation;

    past_user_inputs = conversation.past_user_inputs;
    generated_responses = conversation.generated_responses;
    const warnings = inference_results.warnings;

    return { generated_text, past_user_inputs, generated_responses, warnings, _omni_status: 200 };
}

// document-question-answering
async function documentQuestionAnswering(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{
    let image_cdns = block_payload.image;
    if (!Array.isArray(image_cdns)) image_cdns = [image_cdns];
    if (!image_cdns) throw new Error('Missing images for documentQuestionAnswering');

    const answers = [];
    const jsons = [];

    for (const image_cdn of image_cdns) 
    {

        //@ts-ignore
        const raw_image = await service.app.cdn.get(image_cdn.ticket);
        const image = raw_image.data;

        const question = block_payload.question;
        if (!question) throw new Error('Missing question for documentQuestionAnswering');

        const inputs = { image, question };
        const args: DocumentQuestionAnsweringArgs = { model, inputs };

        const inference_results: DocumentQuestionAnsweringOutput = await inference.documentQuestionAnswering(args, options);
        if (!inference_results) throw new Error('Missing output for documentQuestionAnswering');

        const answer:string = inference_results.answer;
        const end:number|undefined = inference_results.end;
        const score:number|undefined = inference_results.score;
        const start:number|undefined = inference_results.start;

        answers.push(answer);
        jsons.push({ answer, end, score, start });
    }

    return { answer:answers, json:jsons, _omni_status: 200 };
}

// feature-extraction
async function featureExtraction(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{
    let inputs = block_payload.inputs;
    if (!Array.isArray(inputs)) inputs = [inputs];
    if (!inputs || inputs.length === 0) throw new Error('Missing inputs for featureExtraction');

    const args: FeatureExtractionArgs = { model, inputs };

    const inference_results: FeatureExtractionOutput = await inference.featureExtraction(args, options);
    if (!inference_results) throw new Error('Missing output for featureExtraction');

    return { features: inference_results, json:{features: inference_results}, _omni_status: 200 };
}

// fill-mask
async function fillMask(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{

    const inputs:string = block_payload.inputs;
    if (!inputs ) throw new Error('Missing text for fillMask');

    const args:FillMaskArgs = { inputs };
    const inference_results: FillMaskOutput = await inference.fillMask(args, options);

    if (!inference_results) throw new Error('Missing output for fillMask');

    const token_strs = [];
    const jsons = [];

    for (const inference_result of inference_results) 
    {
        const sequence:string = inference_result.sequence; //The actual sequence of tokens that ran against the model (may contain special tokens)
        const score:number = inference_result.score; //The probability for this token.
        const token:number = inference_result.token; //The id of the token
        const token_str = inference_result.token_str; //The string representation of the token

        token_strs.push(token_str);
        jsons.push({ sequence, score, token, token_str });
    }
    return { token_str: token_strs, json:jsons, _omni_status: 200 };
}

// image-classification
async function imageClassification(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{

    const labels = [];
    const jsons = [];

    let image_cdns = block_payload.image;
    if (!Array.isArray(image_cdns)) image_cdns = [image_cdns];
    if (!image_cdns || image_cdns.length === 0) throw new Error('Missing image');
    for (const image_cdn of image_cdns) 
    {
        
        const url = image_cdn.url;
        //@ts-ignore
        const raw_image = await service.app.cdn.get(image_cdn.ticket);
        const data = raw_image.data;
        const args: ImageClassificationArgs = { model, data };

        const inference_results: ImageClassificationOutputValue[] = await inference.imageClassification(args, options);
        if (!inference_results) throw new Error('Missing classification_output for image_classification_task');

        for (const classification_output of inference_results) {
            const label = classification_output.label;
            const score = classification_output.score;

            labels.push(label);
            jsons.push({ url, label, score });
        }
    }

    return { label:labels, json:jsons, _omni_status: 200 };

}

//image-segmentation
async function imageSegmentation(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{
    const mask_cdns = [];
    const jsons =  [];

    let image_cdns = block_payload.images;
    if (!Array.isArray(image_cdns)) image_cdns = [image_cdns];
    if (!image_cdns || image_cdns.length === 0) throw new Error('Missing images');
    for (const image_cdn of image_cdns) 
    {
        //@ts-ignore
        const raw_image = await service.app.cdn.get(image_cdn.ticket);
        const data = raw_image.data;
        const args: ImageSegmentationArgs = { model, data };

        const inference_results: ImageSegmentationOutputValue[] = await inference.imageSegmentation(args, options);
        if (!inference_results) throw new Error('Missing segmentation_output for image_segmentation_task');

        for (const segmentation_output of inference_results) {
            const mask_b64:string = segmentation_output.mask; //A str (base64 str of a single channel black-and-white img) representing the mask of a segment.
            const label:string = segmentation_output.label; //The label for the class (model specific) of a segment.
            const score:number = segmentation_output.score; //A float that represents how likely it is that the detected object belongs to the given class.
            
            const mask_cdn = await blobToImageCdn(mask_b64, job_ctx, service); // our function can take b64 as input
            
            mask_cdns.push(mask_cdn);
            jsons.push({ mask:mask_cdn, label, score });
        }
    }

    return { masks: mask_cdns, json:jsons, _omni_status: 200 };
}

// image-to-image
async function imageToImage(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{

    const output_image_cdns = [];

    let images = block_payload.images;
    const prompt = block_payload.prompt;
    const strength = block_payload.strength;
    const negative_prompt = block_payload.negative_prompt;
    const height = block_payload.height;
    const width = block_payload.width;
    const num_inference_steps = block_payload.num_inference_steps;
    const guidance_scale = block_payload.guidance_scale;
    const guess_mode = block_payload.guess_mode || false;
    const parameters = { prompt, strength, negative_prompt, height, width, num_inference_steps, guidance_scale, guess_mode };

    if (!Array.isArray(images)) images = [images];
    if (!images || images.length === 0) throw new Error('Missing images');
    for (const image of images) 
    {
        //@ts-ignore
        const raw_image = await service.app.cdn.get(image.ticket);
        const inputs = raw_image.data;
        const args: ImageToImageArgs = { model,  inputs, parameters};

        const inference_results: ImageToImageOutput[] = await inference.imageToImage(args, options);
        if (!inference_results) throw new Error('Missing image_to_image_output for image_to_image_task');

        for (const blob of inference_results) 
        {
            const image_cdn = await blobToImageCdn(blob, job_ctx, service)
            output_image_cdns.push(image_cdn);
        }
    }

    return { images: output_image_cdns, _omni_status: 200 };
}

// image-to-text
async function imageToText(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{
    const texts = [];
    let image_cdn = block_payload.image;
    if (!Array.isArray(image_cdn)) image_cdn = [image_cdn];
    if (!image_cdn || image_cdn.length === 0) throw new Error('Missing image');
    for (const image of image_cdn) 
    {
        //@ts-ignore
        const raw_image = await service.app.cdn.get(image.ticket);
        const data = raw_image.data;
        const args:ImageToTextArgs = { model, data };

        const text_output: ImageToTextOutput = await inference.imageToText(args, options);
        if (!text_output) throw new Error('Missing text_output for image_to_text_task');

        texts.push(text_output);
    }

    return { text:texts, _omni_status: 200 };
}

//object-detection
async function objectDetection(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{
    const images = block_payload.image;

    if (!images || images.length === 0) throw new Error('Missing images');
    if (!model) throw new Error('Missing model');

    const labels = [];
    const jsons = [];

    for (const image of images) 
    {
        //@ts-ignore
        const raw_image = await service.app.cdn.get(image.ticket);
        const data = raw_image.data;
        const args:ObjectDetectionArgs = { model, data };

        const inference_results:ObjectDetectionOutputValue = await inference.objectDetection(args, options);
        if (!inference_results) throw new Error('Missing inference_results for object_detection_task');

        const box = inference_results.box; // A dict (with keys [xmin,ymin,xmax,ymax]) representing the bounding box of a detected object.
        const label = inference_results.label; //The label for the class (model specific) of a detected object.
        const score = inference_results.score; //A float that represents how likely it is that the detected object belongs to the given class.

        labels.push(label); 
        jsons.push({ box, label, score });
    }
    return { label:labels, json:jsons, _omni_status: 200};
}

//question-answering
async function questionAnswering(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{
    
    const context = block_payload.context;
    const question = block_payload.question;
    if (!context || !question) throw new Error('Missing context or question');
    const inputs = {context, question } 
    const args:QuestionAnsweringArgs = { inputs };
    const result:QuestionAnsweringOutput = await inference.questionAnswering(args, options);
    const answer = result.answer;
    const end = result.end;
    const score = result.score;
    const start = result.start;
    const json = { answer, end, score, start };
    return { answer, json, _omni_status: 200 };
}

//sentence-similarity
async function sentenceSimilarity(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{

    const text1 = block_payload.sentence1;
    const text2 = block_payload.sentence2;

    if (!text1 || !text2) throw new Error('Two sentences were not provided.');
    const args: SentenceSimilarityArgs = { inputs: { text1, text2 } };
    const results: SentenceSimilarityOutput = await inference.sentenceSimilarity(args, options);
    const similarities: number[] = results;
    return { similarity: similarities, _omni_status: 200 };
}

//sumaritzation
async function summarization(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{
   //inputs
   const inputs = block_payload.inputs;
   if (!inputs) throw new Error('Missing input_text for summarization_task');

   //parameters
   const min_length = block_payload.min_length;
   const max_length = block_payload.max_length;
   const top_k = block_payload.top_k;
   const top_p = block_payload.top_p;
   const temperature = block_payload.temperature || 1.0;
   const repetition_penalty = block_payload.repetition_penalty;
   const max_time = block_payload.max_time;
   const args: SummarizationArgs = {
       model,
       inputs,
       parameters: { max_length, max_time, min_length, repetition_penalty, temperature, top_k, top_p }
   };

   const results: SummarizationOutput = await inference.summarization(args, options);
   const summary_text = results.summary_text;
   return { summary_text, _omni_status: 200 };
}

//table-question-answering
async function tableQuestionAnswering(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{
    //const table:Record<string, string[]> = block_payload.table;
    const query:string = block_payload.query;
    if (!query) throw new Error('Missing query for tableQuestionAnswering');

    if (typeof block_payload.table !== 'object') {
        throw new Error('block_payload.table must be an object');
    }
    
    const table: Record<string, string[]> = {};    
    for (const key in block_payload.table) 
    {
        if (!Array.isArray(block_payload.table[key])) 
        {
            throw new Error(`block_payload.table.${key} must be an array of strings`);
        }
    
        table[key] = block_payload.table[key];
    }
    const inputs = { table, query };
    const args: TableQuestionAnsweringArgs = { model, inputs };
    if (!table) throw new Error('Missing table for tableQuestionAnswering');
    const results: TableQuestionAnsweringOutput = await inference.tableQuestionAnswering(args, options);

    const answer:string = results.answer;
    const aggregator:string = results.aggregator;
    const cells:string[] = results.cells;
    const coordinates: number[][] = results.coordinates;
    const json = { answer, aggregator, cells, coordinates };
    
    return {answer, json, _omni_status: 200 };    
    
}

//tabular-classification
async function tabularClassification(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{

    if (typeof block_payload.table !== 'object') {
        throw new Error('block_payload.data must be an object');
    }
    
    const data: Record<string, string[]> = {};    
    for (const key in block_payload.table) 
    {
        if (!Array.isArray(block_payload.table[key])) 
        {
            throw new Error(`block_payload.table.${key} must be an array of strings`);
        }
    
        data[key] = block_payload.table[key];
    }
    if (!data) throw new Error('Missing data for tabularClassification');
    const inputs = { data };
    const args: TabularClassificationArgs = { model, inputs };
    const results: TabularClassificationOutput = await inference.tabularClassification(args, options);
    const labels:number[] = results;
    return { label:labels, _omni_status: 200 };
}

//tabular-regression
async function tabularRegression(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{
    if (typeof block_payload.data !== 'object') {
        throw new Error('block_payload.data must be an object');
    }
    
    const data: Record<string, string[]> = {};    
    for (const key in block_payload.table) 
    {
        if (!Array.isArray(block_payload.table[key])) 
        {
            throw new Error(`block_payload.table.${key} must be an array of strings`);
        }
    
        data[key] = block_payload.table[key];
    }
    if (!data) throw new Error('Missing data for tabularRegression');
    const inputs = { data };
    const args: TabularRegressionArgs = { model, inputs };
    const results: TabularRegressionOutput = await inference.tabularRegression(args, options);
    const labels:number[] = results;
    return { labels, _omni_status: 200 };
}

//text-classification
async function textClassification(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{
    const inputs:string = block_payload.inputs;
    if (!inputs) throw new Error('Missing inputs for textClassification');

    const args: TextClassificationArgs = { model, inputs };
    const results: TextClassificationOutput = await inference.textClassification(args, options);
    const labels = [];
    const jsons = [];
    for (const result of results)
    {
        const label:string = result.label;
        const score:number = result.score;
        const json = { label, score };
        labels.push(label);

        jsons.push(json);
    }
    return { label:labels, json:jsons, _omni_status: 200 };
}

//text-generation
async function textGeneration(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{
    const inputs:string = block_payload.inputs;
    if (!inputs) throw new Error('Missing inputs for textGeneration');

    const do_sample:boolean = block_payload.do_sample || true;

    const max_new_tokens:number = block_payload.max_new_tokens;
    const max_time:number = block_payload.max_time;
    const num_return_sequences:number = block_payload.num_return_sequences || 1;
    const repetition_penalty:number = block_payload.repetition_penalty;
    const return_full_text:boolean = block_payload.return_full_text || true;
    const temperature:number = block_payload.temperature || 1.0;
    const top_k:number = block_payload.top_k;
    const top_p:number = block_payload.top_p;
    const truncate:number = block_payload.truncate;
    const stop_sequences:string[] = block_payload.stop_sequences || [];
    const parameters = { do_sample, max_new_tokens, max_time, num_return_sequences, repetition_penalty, return_full_text, temperature, top_k, top_p, truncate, stop_sequences };
    const args: TextGenerationArgs = { model, inputs, parameters };

    const results: TextGenerationOutput = await inference.textGeneration(args, options);
    const generated_text:string = results.generated_text;
    return { generated_text, _omni_status: 200 };
}

//  text-to-image:
async function textToImage(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{
    const prompt:string = block_payload.prompt;
    if (!prompt) throw new Error('Missing prompt for textToImage');

    const negative_prompt:string = block_payload.negative_prompt;
    const height:number = block_payload.height;
    const width:number = block_payload.width;
    const num_inference_steps:number = block_payload.num_inference_steps;
    const guidance_scale:number = block_payload.guidance_scale;

    const inputs:string = prompt;    
    const parameters = { negative_prompt, height, width, num_inference_steps, guidance_scale };
    const args: TextToImageArgs = { model, inputs, parameters };
    const results:TextToImageOutput = await inference.textToImage(args, options);
    const blob:Blob = results                    
    const image_cdn = await blobToImageCdn(blob, job_ctx, service)
    return { image: image_cdn, _omni_status: 200 };
}

//text-to-speech
async function textToSpeech(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{
    const inputs:string = block_payload.inputs;
    if (!inputs) throw new Error('Missing inputs for textToSpeech');

    const args: TextToSpeechArgs = { model, inputs };
    const results: TextToSpeechOutput = await inference.textToSpeech(args, options);
    const blob:Blob = results;
    const audio_cdn = await blobToAudioCdn(blob, job_ctx, service)
    return { audio: audio_cdn, _omni_status: 200 };
}

//token-classification
async function tokenClassification(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{
    const inputs:string = block_payload.inputs;
    if (!inputs) throw new Error('Missing inputs for tokenClassification');

    const aggregation_strategy: "none" | "simple" | "first" | "average" | "max" = block_payload.aggregation_strategy || 'simple';
    const parameters = { aggregation_strategy };
    const args: TokenClassificationArgs = { model, inputs, parameters };
    const results: TokenClassificationOutputValue[] = await inference.tokenClassification(args, options);
    const entity_groups = [];
    const jsons = [];
    for (const result of results)
    {
        const entity_group:string = result.entity_group;
        const score:number = result.score;
        const start:number = result.start;
        const end:number = result.end;
        const word:string = result.word;
        const json = { entity_group, score, start, end, word };
        entity_groups.push(entity_group);
        jsons.push(json);
    }
    return { entity_group:entity_groups, json:jsons, _omni_status: 200 };
}

//translation:
async function translation(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{
    const inputs:string = block_payload.inputs;
    if (!inputs) throw new Error('Missing inputs for translation');

    const args: TranslationArgs = { model, inputs};
    const results: TranslationOutput = await inference.translation(args, options);
    const translation:string = results.translation_text;
    return { translation, _omni_status: 200 };
}

//visual-question-answering
async function visualQuestionAnswering(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{
    const question = block_payload.question;
    if (!question) throw new Error('Missing question for visualQuestionAnswering');

    let image_cdns = block_payload.image;
    if (!Array.isArray(image_cdns)) image_cdns = [image_cdns];
    if (!image_cdns) throw new Error('Missing image for visualQuestionAnswering');

    const answers = [];
    const jsons = [];

    for (const image_cdn of image_cdns)
    {
        //@ts-ignore
        const raw_image = await service.app.cdn.get(image_cdn.ticket);
        const image = raw_image.data;
        const blob = new Blob([image.buffer], { type: 'application/octet-stream' });
        const args: VisualQuestionAnsweringArgs = { model, inputs: { image: blob, question } };
        const results: VisualQuestionAnsweringOutput = await inference.visualQuestionAnswering(args, options);
        const answer:string = results.answer;
        const score:number = results.score;
        const json = { answer, score };
        answers.push(answer);
        jsons.push(json);
    }

    return { answer:answers, json:jsons, _omni_status: 200 };
}

// zero-shot-classification:
async function zeroShotClassification(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{
    let inputs:string | string[] = block_payload.inputs;
    if (!inputs) throw new Error('Missing inputs for zeroShotClassification');
    if (!Array.isArray(inputs)) inputs = [inputs];

    const candidate_labels: string[] = block_payload.candidate_labels;
    if (!candidate_labels ) throw new Error('Missing candidate_labels for zeroShotClassification');
    if (!Array.isArray(candidate_labels)) throw new Error('You need at least two candidate_labels for zeroShotClassification');
    if (candidate_labels.length < 2) throw new Error('You need at least two candidate_labels for zeroShotClassification');
    if (candidate_labels.length > 10) throw new Error('You can use at most 10 candidate_labels for zeroShotClassification');

    const multi_label:boolean = block_payload.multi_label || false; //Boolean that is set to True if classes can overlap
    const parameters = { candidate_labels, multi_label };
    const args: ZeroShotClassificationArgs = { model, inputs, parameters};
    const results: ZeroShotClassificationOutputValue[] = await inference.zeroShotClassification(args, options);
    const all_labels = [];
    const jsons = [];

    for (const result of results)   
    {
        const labels:string[] = result.labels;
        const scores:number[] = result.scores;
        const sequence:string = result.sequence;
        const json = { labels, scores, sequence };
        all_labels.push(labels);
        jsons.push(json);

    }
    return { labels:all_labels, json:jsons, _omni_status: 200 };
}

//  zero-shot-image-classification:
async function zeroShotImageClassification(inference:any, block_payload: any, model:string, options:any, job_ctx:any, service: RESTConsumerService)
{
    let image_cdns = block_payload.image;
    if (!Array.isArray(image_cdns)) image_cdns = [image_cdns];
    if (!image_cdns || image_cdns.length === 0) throw new Error('Missing images for zeroShotImageClassification');

    const candidate_labels: string[] = block_payload.candidate_labels;
    if (!candidate_labels ) throw new Error('Missing candidate_labels for zeroShotImageClassification');
    if (!Array.isArray(candidate_labels)) throw new Error('You need at least two candidate_labels for zeroShotImageClassification');
    if (candidate_labels.length < 2) throw new Error('You need at least two candidate_labels for zeroShotImageClassification');
    if (candidate_labels.length > 10) throw new Error('You can use at most 10 candidate_labels for zeroShotImageClassification');

    const parameters = { candidate_labels };
    
    const labels = [];
    const jsons = [];

    for (const image_cdn of image_cdns)
    {
        //@ts-ignore
        const raw_image = await service.app.cdn.get(image_cdn.ticket);
        const image = raw_image.data;
        const args: ZeroShotImageClassificationArgs = { model, inputs: image, parameters};
        const results: ZeroShotImageClassificationOutputValue[] = await inference.zeroShotImageClassification(args, options);
        const url:string = image_cdn.url;
        for (const result of results)   
        {
            const label:string = result.label;
            const score:number = result.score;
            const json = { label, score, url };
            labels.push(label);
            jsons.push(json);
        }
    }
    return { labels, json:jsons, _omni_status: 200 };
}

// --------------------
// --------------------
// --------------------
// --------------------

export async function processHuggingface(payload: any, service: RESTConsumerService) 
{
    const block_payload = payload.body;
    if (!block_payload) throw new Error('Missing payload for huggingface block');

    // TODO: should get base path from the block execution?
    const blockManager = service.server.blocks;
    const baseUrl = blockManager.getNamespace('huggingface')?.api?.basePath ?? '';

    //@ts-ignore
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
        // You can also omit "model" to use the recommended model for the task
        const model = block_payload.model;
        const use_cache = block_payload.use_cache || true;
        const wait_for_model = block_payload.wait_for_model || false;
        
        const options = { use_cache, wait_for_model };        
        const job_ctx = payload.job_ctx;

        let inference = null;
        if (!hf_token) inference = new HfInference();
        else inference = new HfInference(hf_token);

        switch (endpoint) 
        {

            case 'audio-classification':
            {
                const results:any = await audioClassification(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'audio-to-audio':
            {
                const results:any = await audioToAudio(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'automatic-speech-recognition':
            {
                const results:any = await automaticSpeechRecognition(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'conversational':
            {
                const results:any = await conversational(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            // case 'depth-estimation': NOT IMPLEMENTED by Huggingface

            case 'document-question-answering':
            {
                const results:any = await documentQuestionAnswering(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'feature-extraction':
            {
                const results:any = await featureExtraction(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'fill-mask':
            {
                const results:any = await fillMask(inference, block_payload, model, options, job_ctx, service);
                return results; 
            }

            case 'image-classification':
            {
                const results:any = await imageClassification(inference, block_payload, model, options, job_ctx, service);
                return results;
            }    
            
            case 'image-segmentation':
            {
                const results:any = await imageSegmentation(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'image-to-image':
            {
                const results:any = await imageToImage(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'image-to-text':
            {
                const results:any = await imageToText(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'object-detection':
            {
                const results:any = await objectDetection(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'question-answering':
            {
                const results:any = await questionAnswering(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'sentence-similarity':
            {
                const results:any = await sentenceSimilarity(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'summarization':
            {
                const results:any = await summarization(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'table-question-answering':
            {
                const results:any = await tableQuestionAnswering(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'tabular-classification':
            {
                const results:any = await tabularClassification(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'tabular-regression':
            {
                const results:any = await tabularRegression(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'text-classification':
            {
                const results:any = await textClassification(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'text-generation':
            {
                const results:any = await textGeneration(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'text-to-image':
            {
                const results:any = await textToImage(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'text-to-speech':
            {
                const results:any = await textToSpeech(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'token-classification':
            {
                const results:any = await tokenClassification(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'translation':
            {
                const results:any = await translation(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'visual-question-answering':
            {
                const results:any = await visualQuestionAnswering(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'zero-shot-classification':
            {
                const results:any = await zeroShotClassification(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            case 'zero-shot-image-classification':
            {
                const results:any = await zeroShotImageClassification(inference, block_payload, model, options, job_ctx, service);
                return results;
            }

            default:
            {
                console.warn(`Unknown Huggingface endpoint ${endpoint}`);
                return null; // return null, which will cause the request to be processed normally
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


async function blobToAudioCdn(blob: any, job_ctx:any, service: RESTConsumerService) {
    return await blobToCdn(blob, job_ctx, service, 'audio/mpeg');
}

async function blobToImageCdn(blob: any, job_ctx:any, service: RESTConsumerService) {
    return await blobToCdn(blob, job_ctx, service, 'image/png');
}

async function blobToCdn(blob: any, job_ctx:any, service: RESTConsumerService, type: string) 
{
    let array_data;

    if (typeof blob === 'string') {
        // Base64 string
        array_data = Buffer.from(blob, 'base64');
    } else if (blob instanceof Blob) {
        // Blob object
        array_data = await blob.arrayBuffer();
        type = blob.type;
    } else if (blob instanceof ArrayBuffer) {
        // ArrayBuffer
        array_data = blob;
    } else {
        throw new Error('Unsupported blob type');
    }

    const buffer = Buffer.from(array_data);

    //@ts-ignore
    const cdn = await service.app.cdn.putTemp(buffer, 
    {
        mimeType: type,
        userId: job_ctx?.userId,
        jobId: job_ctx?.jobId
    });

    return cdn;
}