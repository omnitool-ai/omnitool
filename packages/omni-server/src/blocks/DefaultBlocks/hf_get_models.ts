/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { user_db_get, user_db_put, setComponentInputs, setComponentOutputs } from '../../utils/omni-utils.js';
import type { Workflow } from 'omni-shared'
import axios from 'axios';
import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';

const NAMESPACE = 'huggingface_utils';
const OPERATION_ID = "getModels";
const TITLE = 'Get Huggingface Models';
const DESCRIPTION = 'Get top Huggingface models for a given tag, sorted in a number of ways.';
const CATEGORY = 'hugginface';

const HUGGINGFACE_BASE_KEY = "RESERVED_huggingface_models";
const HUGGINGFACE_TAGS = [
    "audio-classification"
    , "audio-to-audio"
    , "automatic-speech-recognition"
    , "conversational"
    //, "depth-estimation" // <------------------ not implemented
    , "document-question-answering"
    , "feature-extraction"
    , "fill-mask"
    , "image-classification"
    , "image-segmentation"
    , "image-to-image"
    , "image-to-text"
    , "object-detection"
    //, "video-classification" // <------------------ not implemented
    , "question-answering"
    , "reinforcement-learning"// <------------------ not implemented
    , "question-answering"
    , "sentence-similarity"
    , "summarization"
    , "table-question-answering"
    , "tabular-classification"
    , "tabular-regression"
    , "text-classification"
    , "text-generation"
    , "text-to-image"
    , "text-to-speech"
    //, "text-to-video" // <------------------ not implemented
    , "token-classification"
    , "translation"
    //, "unconditional-image-generation" // <------------------ not implemented
    , "visual-question-answering"
    , "zero-shot-classification"
    , "zero-shot-image-classification"];


const huggingface_sorts = ["trending", "likes", "downloads", "date"];
const inputs = [
    { name: 'tag', type: 'string', title: 'Tag', customSocket: 'text', defaultValue: 'text-to-image', description: 'Tag to filter the models by.', choices: HUGGINGFACE_TAGS },
    { name: 'criteria', type: 'string', defaultValue: 'trending', title: "Criteria", description: "The criteria to sort the models ", choices: huggingface_sorts },
    { name: 'max_entries', type: 'number', defaultValue: 25, minimum: 1, maximum: 100, step: 1, description: "The number of models to return." },
];

const outputs = [
    { name: 'model', type: 'string', customSocket: "text", description: 'The selected model' },
    { name: 'tag', type: 'string', customSocket: "text", description: 'The selected tag' },
];

let baseComponent = OAIBaseComponent.create(NAMESPACE, OPERATION_ID)
    .fromScratch()
    .set('title', TITLE)
    .set('category', CATEGORY)
    .set('description', DESCRIPTION)
    .setMethod('X-CUSTOM');

baseComponent = setComponentInputs(baseComponent, inputs);
baseComponent = setComponentOutputs(baseComponent, outputs);
baseComponent.addControl(
    baseComponent
        .createControl('button')
        .set('title', 'Update')
        .setControlType('AlpineButtonComponent')
        .setCustom('buttonAction', 'script')
        .setCustom('buttonValue', 'save')
        .set('description', 'Update')
        .toOmniControl()
);
baseComponent.setMacro(OmniComponentMacroTypes.ON_SAVE, onSave);
baseComponent.setMacro(OmniComponentMacroTypes.EXEC, processPayload);
export const HuggingfaceListModelsComponent = baseComponent.toJSON();

async function onSave(node: any, recipe: Workflow, ctx: { app: any, userId: string, inputs: any })
{

    const tag:string = node.data.tag;
    const criteria:string = node.data.criteria;
    const max_entries:number = node.data.max_entries;
    //const refresh = node.data.refresh;
    //const block_id = node.id;
    const key = `${HUGGINGFACE_BASE_KEY}_${tag}_${criteria}_${max_entries}`;
    let cached_models = await user_db_get(ctx, key);

    debugger;
    if (!cached_models)
    {
        cached_models = await getModels(tag, max_entries, criteria);
        if (cached_models && cached_models.length > 0 && !("error" in cached_models))
            await user_db_put(ctx, cached_models, key);
    }

    if (cached_models && cached_models.length > 0)
    {
        const inputsObject:any = {};
        const model_socket:any = {};
        model_socket.title = `${tag} Models`;
        model_socket.name = 'model';
        model_socket.type = 'string';
        model_socket.customSocket = 'text';
        model_socket.choices = cached_models;
        //model_socket.defaultValue = cached_models[0];

        inputsObject[model_socket.name] = model_socket;
        node.data['x-omni-dynamicInputs'] = inputsObject;
    }
    return true;
}

async function processPayload(payload: any, ctx: WorkerContext)
{
    debugger;
    //const dynamic_inputs = ctx.node.data['x-omni-dynamicInputs'];
    //const models = ctx.node.data['x-omni-dynamicInputs'].model;
    const model = payload.model;
    const tag = payload.tag;
    return { result: { "ok": true }, model, tag };
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

function sortAndFormatData(data:any, max_entries:number, tag:string, criteria:string)
{
    let sortFunction;

    switch (criteria)
    {
        case 'trending':
            sortFunction = (a:any, b:any) => (b.downloads * b.likes) - (a.downloads * a.likes);
            break;
        case 'likes':
            sortFunction = (a:any, b:any) => b.likes - a.likes;
            break;
        case 'downloads':
            sortFunction = (a:any, b:any) => b.downloads - a.downloads;
            break;
        case 'date':
            sortFunction = (a:any, b:any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            break;
        default:
            throw new Error(`Unknown sorting criteria: ${criteria}`);
    }

    return data
        .sort(sortFunction)
        .slice(0, max_entries)
        //@ts-ignore
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

async function getModels(tag:string, max_entries:number = 20, criteria:string = 'trending')
{
    try
    {
        const models = await fetchData(tag);
        const formattedData = sortAndFormatData(models, max_entries, tag, criteria);

        // Extract model IDs and save to another file
        //@ts-ignore
        const output = [];
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
