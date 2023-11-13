/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { runBlock } from './blocks.js';
import {
  save_text_to_cdn,
  save_json_to_cdn,
  get_json_from_cdn,
  save_json_to_cdn_as_buffer,
  get_chunks_from_cdn,
  get_cached_cdn,
  save_chunks_cdn_to_db,
  downloadTextsFromCdn
  ,
} from './cdn.js';
import {
  createComponent,
  setComponentInputs,
  setComponentOutputs,
  setComponentControls
  ,
} from './component.js';
import { get_db, user_db_delete, user_db_get, user_db_put } from './database.js';
import {
  walkDirForExtension,
  validateDirectoryExists,
  validateFileExists,
  readJsonFromDisk,
  fetchJsonFromUrl
  ,
} from './files.js';
import {
  is_valid,
  clean_string,
  sanitizeJSON,
  console_log,
  console_warn,
  combineStringsWithoutOverlap,
  rebuildToTicketObjectsIfNeeded,
  parse_text_to_array,
  pauseForSeconds,
  printObject,
  blockOutput,
  runRecipe,
  sanitizeName,
  combineValues,
  makeToast,
} from './utils.js';

/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */
import {
  DEFAULT_UNKNOWN_CONTEXT_SIZE,
  Llm,
  generateModelId,
  getModelNameAndProviderFromId,
  isProviderAvailable,
  addLocalLlmChoices,
  deduceLlmTitle,
  deduceLlmDescription,
  getModelsDirJson,
  fixJsonString
  ,
} from './llm.js';
import {
  getLlmQueryInputs,
  async_getLlmQueryComponent,
  extractLlmQueryPayload,
  LLM_QUERY_OUTPUT,
  LLM_QUERY_CONTROL
  ,
} from './llmComponent.js';

import { getLlmChoices, queryLlmByModelId, getModelMaxSize, DEFAULT_LLM_MODEL_ID } from './llms.js';

import { Llm_Openai } from './llm_Openai.js';
import { countTokens } from './tiktoken.js';
import { Tokenizer } from './tokenizer.js';
import { Tokenizer_Openai } from './tokenizer_Openai.js';

export { runBlock };
export {
  save_text_to_cdn,
  save_json_to_cdn,
  get_json_from_cdn,
  save_json_to_cdn_as_buffer,
  get_chunks_from_cdn,
  get_cached_cdn,
  save_chunks_cdn_to_db,
  downloadTextsFromCdn
};
export { createComponent, setComponentInputs, setComponentOutputs, setComponentControls };
export { get_db, user_db_delete, user_db_get, user_db_put };
export { walkDirForExtension, validateDirectoryExists, validateFileExists, readJsonFromDisk, fetchJsonFromUrl };
export {
  is_valid,
  clean_string,
  sanitizeJSON,
  console_log,
  console_warn,
  combineStringsWithoutOverlap,
  rebuildToTicketObjectsIfNeeded,
  parse_text_to_array,
  pauseForSeconds,
  printObject,
  blockOutput,
  runRecipe,
  sanitizeName,
  combineValues,
  makeToast,
};

export {
  Llm,
  generateModelId,
  getModelNameAndProviderFromId,
  isProviderAvailable,
  addLocalLlmChoices,
  deduceLlmTitle,
  deduceLlmDescription,
  getModelsDirJson,
  fixJsonString
};
export { DEFAULT_UNKNOWN_CONTEXT_SIZE };
export { getLlmQueryInputs, async_getLlmQueryComponent, extractLlmQueryPayload };
export { LLM_QUERY_OUTPUT, LLM_QUERY_CONTROL };
export { getLlmChoices, queryLlmByModelId, getModelMaxSize };
export { DEFAULT_LLM_MODEL_ID };
export { Llm_Openai };
export { countTokens };
export { Tokenizer };
export { Tokenizer_Openai };
