/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */
import type { Workflow } from 'omni-shared'
import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';
import { sanitizeName } from '../../../src/utils/omni-utils.js';

const component = OAIBaseComponent.create('omnipath', 'json_packer')
    .fromScratch()
    .set(
        'description',
        'Combine its dynamic inputs into a single json.'
    )
    .set('title', 'Json Packer')
    .set('category', Category.RECIPE_OPERATIONS)
    .setMethod('X-CUSTOM');
component

    .addInput(
        component
            .createInput('fields_list', 'string')
            .set('title', 'List')
            .set('description', 'The comma separated list of inputs, in the format input_name:input_type, e.g. my_picture:image. Valid types are text, object, objectarray, array, image, audio, document, video, file. ')
            .toOmniIO()
    )

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
    .addOutput(
        component.createOutput('json', 'object', 'object').set('title', 'Json').toOmniIO()
    )
    .setMacro(OmniComponentMacroTypes.ON_SAVE, onSave)
    .setMacro(OmniComponentMacroTypes.EXEC, processPayload)

export const JsonPackerComponent = component.toJSON();

async function onSave(node: any, recipe: Workflow, ctx: { app: any, userId: string, inputs: any }) 
{
    const inputsObject: any = {};
    const fields_list = node.data.fields_list;
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

        const input =
        {
            title: `* ${socket_name}`,
            name: clean_name,
            type: type,
            customSocket: socket_type
        }
        inputsObject[input.name] = input;
    }

    node.data['x-omni-dynamicInputs'] = inputsObject;
    return true;
}

async function processPayload(payload: any, ctx: WorkerContext) 
{
    const fields_list = payload.fields_list;
    const pairs = fields_list.split(',');
    const json: Record<string, any> = {};
    for (const pair of pairs) 
    {
        const [field_name, field_type] = pair.split(':');
        const sanetized_field_name= sanitizeName(field_name);
        json[sanetized_field_name] = payload[sanetized_field_name];
    }
    
    const result: Record<string,any> = {};
    result.result = { ok: true };
    result.json = json;    
    return result;
}