/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

//@ts-check

import { console_log } from './utils.js';

const OMNITOOL_DOCUMENT_TYPES_USERDOC = 'udoc';

// @ts-ignore
function get_effective_key(ctx, key) {
  return `${ctx.userId}:${key}`;
}

// @ts-ignore
function get_db(ctx) {
  const db = ctx.app.services.get('db');
  return db;
}

// @ts-ignore
async function user_db_delete(ctx, key, rev = undefined) {
  const db = get_db(ctx);
  const effectiveKey = get_effective_key(ctx, key);
  console_log(`DELETING key: ${effectiveKey}`);

  let effective_rev = rev;
  if (effective_rev === undefined) {
    try {
      const get_result = await db.getDocumentById(OMNITOOL_DOCUMENT_TYPES_USERDOC, effectiveKey);
      effective_rev = get_result._rev;

      console_log(`fixing rev SUCCEEDED - deleteted rev ${effective_rev}`);

      try {
        await db.deleteDocumentById(OMNITOOL_DOCUMENT_TYPES_USERDOC, effectiveKey, effective_rev);
      } catch (e) {
        console.warn(`deleting ${key} = ${effectiveKey} failed with error: ${e}`);
      }
      return true;
    } catch (e) {
      console_log('deleting: fixing rev failed');
    }
  }
}

// @ts-ignore
async function user_db_put(ctx, value, key, rev = undefined) {
  const db = get_db(ctx);
  const effectiveKey = get_effective_key(ctx, key);

  console_log(`put: ${key} = ${effectiveKey} with rev ${rev}`);

  let effective_rev = rev;
  if (effective_rev === undefined) {
    try {
      const get_result = await db.getDocumentById(OMNITOOL_DOCUMENT_TYPES_USERDOC, effectiveKey);
      effective_rev = get_result._rev;

      console_log(`fixing rev SUCCEEDED - deleteted rev ${effective_rev}`);
    } catch (e) {
      console_log('fixing rev failed');
    }
  }

  try {
    const json = await db.putDocumentById(OMNITOOL_DOCUMENT_TYPES_USERDOC, effectiveKey, { value }, effective_rev);
    if (json == null) {
      console_log(`put: ${key} = ${effectiveKey} failed`);
      return false;
    } else {
      console_log(`put: ${key} = ${effectiveKey} succeeded`);
    }
  } catch (e) {
    throw new Error(`put: ${key} = ${effectiveKey} failed with error: ${e}`);
  }

  return true;
}

// @ts-ignore
async function user_db_get(ctx, key) {
  const effectiveKey = get_effective_key(ctx, key);
  const db = get_db(ctx);

  let json = null;
  try {
    json = await db.getDocumentById(OMNITOOL_DOCUMENT_TYPES_USERDOC, effectiveKey);
  } catch (e) {
    console_log(`usr_db_get: ${key} = ${effectiveKey} failed with error: ${e}`);
  }

  if (json == null) return null;

  const json_value = json.value;
  if (json_value == null) {
    console_log(`usr_db_get NULL VALUE. DELETING IT: ${key} = ${effectiveKey} json = ${JSON.stringify(json)}`);
    await db.deleteDocumentById(OMNITOOL_DOCUMENT_TYPES_USERDOC, effectiveKey, json._rev);
    return null;
  }

  return json_value;
}

export { get_db, user_db_delete, user_db_get, user_db_put };
