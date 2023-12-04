/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */
import { runRecipe } from '../../../src/utils/omni-utils.js';
import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';


const component = OAIBaseComponent.create('omnitool', 'run_recipe')
    .fromScratch()
    .set(
        'description',
        'Run a recipe.'
    )
    .set('title', 'Run Recipe')
    .set('category', Category.RECIPE_OPERATIONS)
    .setMethod('X-CUSTOM');
component
    .addInput(
        component
        .createInput('recipes_list', 'string', 'text')
        .set('title', 'Recipes List')
        .set('description', 'The Id of the recipe to run')
        .setChoices({ block: "omnitool.get_recipes", map: {root: "models", title: "title", value: "value", cache: "user"}})
        .setDefault('invalid')
        .toOmniIO()
    )
    .addInput(
        component
        .createInput('recipe_id', 'string', 'text')
        .set('title', 'Recipe Id Override')
        .set('description', 'The Id of the recipe to run - override the recipes_list input')
        .toOmniIO()
    )
    .addInput(
        component
        .createInput('text', 'string', 'text')
        .set('title', 'Text')
        .set('description', 'An input string')
        .toOmniIO()
    )
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
        .createInput('audio', 'array', 'audioArray')
        .set('title', 'Audio')
        .set('description', 'One or more audio files')
        .setControl({
            controlType: 'AlpineLabelComponent'
        })
        .toOmniIO()
    )
    .addInput(
        component
        .createInput('video', 'array', 'videoArray')
        .set('title', 'Video')
        .set('description', 'One or more videos')
        .setControl({
            controlType: 'AlpineLabelComponent'
        })
        .toOmniIO()
    )
    .addInput(
        component
        .createInput('documents', 'array', 'documentArray')
        .set('title', 'Documents')
        .set('description', 'One or more documents')
        .setControl({
            controlType: 'AlpineLabelComponent'
        })
        .toOmniIO()
    )
    .addInput(
        component
        .createInput('json', 'array', 'objectArray')
        .set('title', 'JSON Object(s)')
        .set('description', 'One or more object')
        .toOmniIO()
    )
    .addInput(
        component
            .createInput('args', 'object','object')
            .set('title', 'Additional arguments')
            .set('description', 'Additional arguments to be passed as inputs - useful when the recipe uses a formio input block.')
            .toOmniIO()
    )
    .addOutput(component.createOutput('text', 'string', 'text').set('title', 'Text').toOmniIO())
    .addOutput(component.createOutput('images', 'array', 'imageArray').set('title', 'Images').toOmniIO())
    .addOutput(component.createOutput('audio', 'array', 'audioArray').set('title', 'Audio').toOmniIO())
    .addOutput(component.createOutput('video', 'array', 'videoArray').set('title', 'Video').toOmniIO())
    .addOutput(component.createOutput('documents', 'array', 'documentArray').set('title', 'Documents').toOmniIO())
    .addOutput(component.createOutput('json', 'array', 'object', { array: true }).set('title', 'JSON Object(s)').toOmniIO())
    .setMacro(OmniComponentMacroTypes.EXEC, processPayload)
   
export const RunRecipeComponent = component.toJSON();

async function processPayload(payload: any, ctx: WorkerContext) {

    let recipe_id = payload.recipe_id;
    if (!recipe_id) {
        recipe_id = payload.recipes_list;
        if (recipe_id === 'invalid') recipe_id = undefined;
    }
    if (!recipe_id) { throw new Error(`Recipe Id is not provided.`); }

    const args = payload.args;
    const json = {...args};
    for (const key in payload) {
        if (key === 'args') continue;
        json[key] = payload[key];
    }

    await ctx.app.sendToastToUser(ctx.userId, { message: `Running recipe ${recipe_id}.` });
    const recipe_result = await runRecipe(ctx, recipe_id, json);

    if (!recipe_result) {
        await ctx.app.sendToastToUser(ctx.userId, { message: `Recipe ${recipe_id} returned no result.` });
        return { ok: true };
    }

    const result: Record<string,any> = {};
    result.result = { ok: true };

    // loop through all the key in recipe_result and delete them if their length is 0
    //@ts-ignore
    for (const key in recipe_result) {
        //@ts-ignore
        if (recipe_result[key] && recipe_result[key].length === 0) { delete recipe_result[key]; }
        else { result[key] = recipe_result[key]; }
    }

    return result;
}