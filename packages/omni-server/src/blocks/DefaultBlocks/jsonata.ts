/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import Exp from 'jsonata';
import { OAIBaseComponent, type WorkerContext, OmniComponentMacroTypes, BlockCategory as Category } from 'omni-sockets';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, 'jsonata')
  .fromScratch()
  .set(
    'description',
    'Manipulate and transform JSON objects by applying a **JSONata expression** to the input data. See [JSONata Exerciser](https://try.jsonata.org) for details.'
  )
  .set('title', 'JSONata Transformation')
  .set('category', Category.DATA_TRANSFORMATION)
  .setMethod('X-CUSTOM');
component
  .addInput(component.createInput('transform', 'string').set('title', 'Transform').setRequired(true).toOmniIO())
  .addInput(component.createInput('object', 'array', 'objectArray').set('title', 'JSON Object').toOmniIO())
  .addOutput(component.createOutput('object', 'array', 'objectArray').set('title', 'JSON Object').toOmniIO())
  .addOutput(component.createOutput('text', 'string').set('title', 'Text').toOmniIO())
  .setMacro(OmniComponentMacroTypes.EXEC, async (payload: { transform: string; object: any }, ctx: WorkerContext) => {
    const expression = Exp(payload.transform);
    const result = await expression.evaluate(payload.object);
    if (typeof result === 'undefined') {
      throw new Error(`undefined jsonata result. Input object: ${JSON.stringify(payload.object, null, 2)}
        Possible reasons:
        1. The JSONata expression is incorrect or malformed.
        2. The JSONata expression is correct but does not match any property in the input object. Please find the input object in the log and check its structure.
        3. The input object is null or undefined.
        4. There is a logical error in the JSONata expression that prevents it from returning a value.`);
    }
    if (typeof result === 'string') {
      let p;
      try {
        p = JSON.parse(result);
      } catch (e) {
        // ignore
      }

      return { object: p, text: result };
    }
    return { object: result, text: JSON.stringify(result) };
  });
const JSONataComponent = component.toJSON();
export default JSONataComponent;
