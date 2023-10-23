/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

//@ts-check
class Tokenizer {
  // @ts-ignore
  constructor(params = null) {}

  // @ts-ignore
  encodeText(text) {
    throw new Error('You have to implement the method: encode');
  }

  // @ts-ignore
  textIsWithinTokenLimit(text, token_limit) {
    throw new Error('You have to implement the method: isWithinTokenLimit');
  }

  // @ts-ignore
  countTextTokens(text) {
    throw new Error('You have to implement the method: countTextTokens');
  }
}

export { Tokenizer };
