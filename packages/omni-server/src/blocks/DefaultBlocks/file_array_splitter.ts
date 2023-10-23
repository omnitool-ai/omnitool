/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// --------------------------------------------------------------------------
// File Array Manipulator: Component to manipulate arrays in various ways
// --------------------------------------------------------------------------

import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';
import deepmerge from 'deepmerge';
import defaultMeta from './meta.json' assert { type: 'json' };

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'fileArrayManipulator')
  .fromScratch()
  .set(
    'description',
    'Perform file array manipulation with operations like splitting based on criteria such as separating the first item, dividing even and odd indexed items, or isolating the last item.'
  )
  .set('title', 'File Array Manipulator')
  .set('category', Category.DATA_TRANSFORMATION)
  .setMethod('X-CUSTOM');

component
  .addInput(
    component
      .createInput('f1', 'array', 'cdnObjectArray')
      .set('title', 'Files')
      .set('description', 'Array of files')
      .setRequired(true)
      .toOmniIO()
  )

  .addInput(
    component
      .createInput('op', 'string', 'string')
      .set('title', 'Operation')
      .set('description', 'Operation to perform')
      .setChoices(['split_first_rest', 'split_even_odd', 'split_rest_last'], 'split_first_rest')
      .toOmniIO()
  )

  .addOutput(
    component
      .createOutput('f1', 'array', 'cdnObjectArray')
      .set('title', 'Files 1')
      .set('description', 'First Output')
      .toOmniIO()
  )

  .addOutput(
    component
      .createOutput('f2', 'array', 'cdnObjectArray')
      .set('title', 'Files 2')
      .set('description', 'Second output')
      .toOmniIO()
  )

  .setMacro(OmniComponentMacroTypes.EXEC, async (payload: any, ctx: WorkerContext) => {
    if (payload.f1.length > 1) {
      if (payload.op === 'split_first_rest') {
        const f1 = payload.f1.slice(0, 1);
        const f2 = payload.f1.slice(1);
        return { f1, f2 };
      } else if (payload.op === 'split_even_odd') {
        const f1 = payload.f1.filter((_: any, i: number) => i % 2 === 0);
        const f2 = payload.f1.filter((_: any, i: number) => i % 2 === 1);
        return { f1, f2 };
      } else if (payload.op === 'split_rest_last') {
        const f1 = payload.f1.slice(0, payload.f1.length - 2);
        const f2 = payload.f1.slice(payload.f1.length - 1);
        return { f1, f2 };
      }
    } else if (payload.f1.length == 1) {
      return { f1: payload.f1[0] };
    } else {
      return {};
    }
  })

  .setMeta(deepmerge({ source: { summary: component.data.description } }, defaultMeta));

const FileArraySplitterComponent = component.toJSON();

export default FileArraySplitterComponent;
