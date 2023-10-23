/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// --------------------------------------------------------------------------
// Chat Input
// --------------------------------------------------------------------------

import { OAIBaseComponent, BlockCategory as Category } from 'omni-sockets';

const NS_OMNI = 'omnitool';

const component = OAIBaseComponent.create(NS_OMNI, '_block_missing')
  .fromScratch()
  .set('title', 'Warning: Missing Block')
  .set('category', Category.SYSTEM)
  .set('description', '⚠️ Missing Block ⚠️ ')
  //@ts-expect-error
  .set('renderTemplate', 'error')
  .setMethod('X-INPUT');

const Component = component.toJSON();

export default Component;
