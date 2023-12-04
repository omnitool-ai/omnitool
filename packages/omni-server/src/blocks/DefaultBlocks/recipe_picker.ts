/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */
import { runRecipe, makeToast, sanitizeName } from '../../../src/utils/omni-utils.js';
import type { Workflow } from 'omni-shared'
import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';


const component = OAIBaseComponent.create('omnitool', 'recipe_picker')
    .fromScratch()
    .set(
        'description',
        'Run a Recipe based on the passed "choice", as defined in the choices string (e.g. "color: red, green, blue"). The ID of the recipes are entered in the fields dynamically created from the comma-separated list of choice names. The Outputs of this block matches the outputs of the Recipe_Output block used in the recipes.'
    )
    .set('title', 'Recipe Picker')
    .set('category', Category.RECIPE_OPERATIONS)
    .setMethod('X-CUSTOM');
component


    .addInput(
    component
        .createInput('json', 'object', 'object')
        .set('title', 'Json')
        .set(
            'description',
            'A JSON object containing all the recipes input fields, including the one named in the Choices string (and its value).'
        )
        .setRequired(true)
        .toOmniIO()
)

    .addInput(
        component
            .createInput('choices', 'string', 'text')
            .set('title', 'Choices')
            .set(
                'description',
                'A string in the format <choice_name>: <choice_value1>, <choice_value2>, etc. E.g. "color:red, green, blue" .'
            )
            .setRequired(true)
            .toOmniIO()
    )

    .addControl(
        component
            .createControl('button')
            .set('title', 'Update')
            .setControlType('AlpineButtonComponent')
            .setCustom('buttonAction', 'script')
            .setCustom('buttonValue', 'save')
            .set('description', 'Update')
            .toOmniControl()
    )
    .addOutput(component.createOutput('text', 'string', 'text').set('title', 'Text').toOmniIO())
    .addOutput(component.createOutput('images', 'array', 'imageArray').set('title', 'Images').toOmniIO())
    .addOutput(component.createOutput('audio', 'array', 'audioArray').set('title', 'Audio').toOmniIO())
    .addOutput(component.createOutput('video', 'array', 'videoArray').set('title', 'Video').toOmniIO())
    .addOutput(component.createOutput('documents', 'array', 'documentArray').set('title', 'Documents').toOmniIO())
    .addOutput(component.createOutput('json', 'array', 'object', { array: true }).set('title', 'JSON Object(s)').toOmniIO())
    .setMacro(OmniComponentMacroTypes.ON_SAVE, onSave)
    .setMacro(OmniComponentMacroTypes.EXEC, processPayload)

export const RecipePickerComponent = component.toJSON();


async function onSave(node: any, recipe: Workflow, ctx: { app: any, userId: string, inputs: any }) {
    const choices = node.data.choices;
    if (!choices) return true;
    const choices_processed = parseChoiceString(choices);
    const choice_field = choices_processed.choice;
    const choices_names = choices_processed.values;
    
    if (!choice_field) return true;
    if (!choices_names) return true;

    const inputsObject: any = {};
    if (choices_names && choices_names.length > 0) {
        for (const choice_name of choices_names) {
            const work_name = sanitizeName(choice_name);
            const input =
            {
                title: `* ${choice_name} Recipe ID`,
                name: work_name,
                type: 'string',
                customSocket: 'text'
            }
            inputsObject[input.name] = input;
        }
    }

    node.data['x-omni-dynamicInputs'] = inputsObject;
    return true;
}
function parseChoiceString(input: string): { choice: string, values: string[] } {
    // Split the input string by the colon
    const [choice, valuesString] = input.split(':');

    // Trim the choice name and split the values by comma, then trim each value
    const values = valuesString.split(',').map(value => sanitizeName(value));

    return {
        choice: choice.trim(),
        values
    };
}

async function processPayload(payload: any, ctx: WorkerContext) {

    const json = payload.json;
    const choices = payload.choices;

    if (!choices) throw new Error(`No choices provided.`);
    if (!json) throw new Error(`No json provided.`);

    const choices_processed = parseChoiceString(choices);
    const choice_field = choices_processed.choice;
    const choices_names = choices_processed.values;
    
    if (!choice_field) throw new Error(`No choice provided.`);
    if (!choices_names) throw new Error(`No values provided.`);
    if (! (choice_field in json ) ) throw new Error(`Choice ${choice_field} not found in the json: ${JSON.stringify(json)}`);
    const choice = sanitizeName(json[choice_field]);
    if (!choice || choice.length == 0) throw new Error(`Choice ${choice_field} is empty in the json: ${JSON.stringify(json)}`);
    if (!choices_names.includes(choice)) throw new Error(`Choice ${choice} is not in the list of available choices: ${choices_names.join(', ')}`);


    const recipes: Record<string,string> = {};
    for (const choice_name of choices_names) {
        if (choice_name in payload) {
            const recipe_id = payload[choice_name];
            if (recipe_id && recipe_id.length > 0) recipes[choice_name] = recipe_id;
        }
    }

    const picked_recipe_id = recipes[choice];
    if (!picked_recipe_id) { throw new Error(`Recipe Id for choice "${choice}" is not provided.`); }

    await makeToast(ctx, `Running recipe ${picked_recipe_id} for choice ${choice}.`);
    const recipe_result = await runRecipe(ctx, picked_recipe_id, json);

    if (!recipe_result) {
        await makeToast(ctx, `Recipe ${picked_recipe_id} for choice ${choice} returned no result.`)
        return { ok: true };
    }

    const result: Record <string,any> = {};
    result.result = { ok: true };
    // loop through all the key in recipe_result and delete them if their length is 0
    //@ts-ignore
    for (const key in recipe_result) {
        //@ts-ignore
        if (recipe_result[key] && recipe_result[key].length == 0) { delete recipe_result[key]; }
        else { result[key] = recipe_result[key]; }
    }

    return result;
}