/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

//@ts-check

// @ts-ignore
async function runBlock(ctx, block_name, args, outputs = {}) {
  try {
    const app = ctx.app;
    if (!app) {
      throw new Error('[runBlock] app not found in ctx');
    }
    const blocks = app.blocks;
    if (!blocks) {
      throw new Error('[runBlock] blocks not found in app');
    }

    const result = await blocks.runBlock(ctx, block_name, args, outputs);
    return result;
  } catch (err) {
    throw new Error(`Error running block ${block_name}: ${err}`);
  }
}

export { runBlock };
