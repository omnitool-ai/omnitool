/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

//@ts-check
import { encode, isWithinTokenLimit } from 'gpt-tokenizer';
import { Tokenizer } from './tokenizer.js';
// https://www.npmjs.com/package/gpt-tokenizer
// By default, importing from gpt-tokenizer uses cl100k_base encoding, used by gpt-3.5-turbo and gpt-4.

class Tokenizer_Openai extends Tokenizer {
  constructor() {
    super();
  }

  // @ts-ignore
  encodeText(text) {
    return encode(text);
  }

  // @ts-ignore
  countTextTokens(text) {
    const tokens = encode(text); //encoding.encode(text);
    if (tokens !== null && tokens !== undefined && tokens.length > 0) {
      const num_tokens = tokens.length;
      return num_tokens;
    } else {
      return 0;
    }
  }

  // @ts-ignore
  textIsWithinTokenLimit(text, token_limit) {
    return isWithinTokenLimit(text, token_limit);
  }
}

export { Tokenizer_Openai };
