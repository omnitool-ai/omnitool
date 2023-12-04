/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */
import type { Workflow } from 'omni-shared'
import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';
import { sanitizeName } from '../../../src/utils/omni-utils.js';

const component = OAIBaseComponent.create('omnipath', 'json_unpacker')
    .fromScratch()
    .set(
        'description',
        'Dynamically unpack a json into separate outputs.'
    )
    .set('title', 'Json Unpacker')
    .set('category', Category.RECIPE_OPERATIONS)
    .setMethod('X-CUSTOM');
component

    .addInput(
        component
            .createInput('json', 'object')
            .set('title', 'Json')
            .set('description', 'The json to unpack.')
            .toOmniIO()
    )

    .addInput(
        component
            .createInput('fields_list', 'string')
            .set('title', 'List')
            .set('description', 'The comma separated list of outputs, in the format output_name:output_type, e.g. my_picture:image. Valid types are text, object, objectarray, array, image, audio, document, video, file. ')
            .toOmniIO()
    )

    //.addOutput(
    //    component.createOutput('inputs_list', 'string', 'text').set('title', 'Inputs List').toOmniIO()
    //)

    .addControl(
        component
            .createControl('button')
            .set('title', 'Save')
            .setControlType('AlpineButtonComponent')
            .setCustom('buttonAction', 'script')
            .setCustom('buttonValue', 'save')
            .set('description', 'Save')
            .toOmniControl()
    )

    .setMacro(OmniComponentMacroTypes.ON_SAVE, onSave)
    .setMacro(OmniComponentMacroTypes.EXEC, processPayload)

export const JsonUnpackerComponent = component.toJSON();

async function onSave(node: any, recipe: Workflow, ctx: { app: any, userId: string, inputs: any }) 
{
    const outputsObject: any = {};
    const fields_list = node.data.fields_list;
    if (!fields_list) return true;

    const pairs = fields_list.split(',');

    for (const pair of pairs) {
        let [socket_name, socket_type] = pair.split(':');
        socket_type = socket_type.toLowerCase().trim();
        socket_name = socket_name.trim();
        const clean_name = sanitizeName(socket_name);

        let type = "";
        switch (socket_type) {
            case 'text': type = 'string'; break;
            case 'object': type = 'object'; break;
            case 'objectarray': type = 'array'; break;
            case 'array': type = 'array'; break;
            case 'image': type = 'array'; break;
            case 'audio': type = 'array'; break;
            case 'document': type = 'array'; break;
            case 'video': type = 'array'; break;
            case 'file': type = 'array'; break;
            default: type = 'string'; break;
        }

        const output =
        {
            title: `${socket_name} *`,
            name: clean_name,
            type: type,
            customSocket: socket_type
        }
        outputsObject[output.name] = output;
    }

    node.data['x-omni-dynamicOutputs'] = outputsObject;
    return true;
}

async function processPayload(payload: any, ctx: WorkerContext) 
{
 
    const fields_list = payload.fields_list;
    let raw_json = payload.json;
    if (!raw_json) return { result: { ok: false, message: 'No json provided' } };
    if (Array.isArray(raw_json)) raw_json = raw_json[0];

    const json:any = {};
    for (const key in raw_json) 
    {
        if (key && key.length > 0) 
        {
            const sanetized_key = sanitizeName(key);
            json[sanetized_key] = raw_json[key];
        }
    }
    if (!fields_list) return { result: { ok: false, message: 'No outputs_list provided' } };

    json['result'] = { ok: true };

    //const result: Record<string, any> = {};
    //result.result = { ok: true };
    /*
    const pairs = fields_list.split(',');
    for (const pair of pairs) 
    {
        const [field_name, field_type] = pair.split(':');
        const sanetized_name = sanitizeName(field_name);
        if (json[sanetized_name]) 
        {
            if (json[sanetized_name].length === 0) 
            {
                delete json[sanetized_name];
            }
            //else
            //{
            //    result[sanetized_name] = json[sanetized_name];
            //}
        }
    }
    */
    return json;//result;
}