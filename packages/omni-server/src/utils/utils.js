/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

//@ts-check

import { omnilog } from 'omni-shared';

const VERBOSE = true;

// @ts-ignore
function printObject(obj, text = '') {
  if (text !== '') console.log(text);
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      console_log(`Key: ${key}, Value: ${obj[key]}`);
    }
  }
}

// @ts-ignore
function is_valid(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (Array.isArray(value) && value.length === 0) {
    return false;
  }

  if (typeof value === 'object' && Object.keys(value).length === 0) {
    return false;
  }

  if (typeof value === 'string' && value.trim() === '') {
    return false;
  }

  return true;
}

// @ts-ignore
function clean_string(original) {
  if (!is_valid(original)) {
    return '';
  }

  let text = sanitizeString(original);

  // Replace newline characters with a space
  text = text.replace(/\n+/g, ' ');

  // Replace multiple spaces with a single space
  text = text.replace(/ +/g, ' ');

  return text;
}

// @ts-ignore
function sanitizeString(original, use_escape_character = false) {
  return use_escape_character
    ? original.replace(/'/g, "\\'").replace(/"/g, '\\"')
    : original.replace(/'/g, '‘').replace(/"/g, '“');
}

// @ts-ignore
function sanitizeJSON(jsonData) {
  if (!is_valid(jsonData)) return null;

  if (typeof jsonData === 'string') {
    return sanitizeString(jsonData);
  }

  if (typeof jsonData === 'object') {
    if (Array.isArray(jsonData)) {
      const new_json_array = [];
      for (let i = 0; i < jsonData.length; i++) {
        const data = jsonData[i];
        // @ts-ignore
        const sanetized_data = sanitizeJSON(data);
        if (is_valid(sanetized_data)) new_json_array.push(sanetized_data);
      }
      return new_json_array;
    } else {
      const new_json = {};
      for (const key in jsonData) {
        if (jsonData.hasOwnProperty(key)) {
          const value = jsonData[key];
          if (is_valid(value)) {
            const new_value = sanitizeJSON(value);
            // @ts-ignore
            if (is_valid(new_value)) new_json[key] = new_value;
          }
        }
      }
      return new_json;
    }
  }

  return jsonData;
}

// @ts-ignore
async function delay(ms) {
  return await new Promise((resolve) => setTimeout(resolve, ms));
}

// @ts-ignore
async function pauseForSeconds(seconds) {
  console_log('Before pause');

  await delay(seconds * 1000); // Convert seconds to milliseconds

  console_log('After pause');
}

// @ts-ignore
function console_log(...args) {
  if (VERBOSE) {
    omnilog.log(...args);
  }
}

// @ts-ignore
function console_warn(...args) {
  if (VERBOSE) {
    omnilog.warn(...args);
  }
}

// @ts-ignore
function combineStringsWithoutOverlap(str1, str2) {
  // Find the maximum possible overlap between the two strings
  let overlap = 0;
  for (let i = 1; i <= Math.min(str1.length, str2.length); i++) {
    if (str1.endsWith(str2.substring(0, i))) {
      overlap = i;
    }
  }

  // Combine the strings and remove the overlapping portion from the second string
  return str1 + str2.substring(overlap);
}

// @ts-ignore
function rebuildToTicketObjectsIfNeeded(data) {
  const documents = [];

  // Check if the data is an array of tickets

  if (Array.isArray(data) && data.every((item) => typeof item === 'object' && item !== null && item.ticket)) {
    return data; // Already in the ticket format, return as is.
  }

  // Check if the data is an array of URLs pointing to fids
  if (Array.isArray(data) && data.every((item) => typeof item === 'string')) {
    // Rebuild URLs into ticket objects

    for (let i = 0; i < data.length; i++) {
      const url = data[i];
      const fidRegex = /\/fid\/(.+)/; // Regular expression to extract the fid part after "/fid/"
      const match = url.match(fidRegex);

      if (match) {
        const baseurl = url.substring(0, match.index); // Extract the base URL before "/fid/"
        const fid = match[1]; // Extract the fid part from the regex match
        const filename = `${fid}.txt`;

        const rebuilt_cdn = {
          ticket: {
            fid,
            count: 1,
            url: baseurl,
            publicUrl: baseurl
          },
          fileName: filename,
          size: 0,
          url,
          furl: `fid://${filename}`,
          mimeType: 'text/plain; charset=utf-8',
          expires: 0,
          meta: {
            created: 0
          }
        };
        // we recerate a cdn object, knowing that most likely only the ticket will be used
        documents.push(rebuilt_cdn);
        console_log(`rebuild url = ${url} into rebuilt_cdn = ${JSON.stringify(rebuilt_cdn)}`);
      }
    }
  }
  return documents;
}

// @ts-ignore
function parse_text_to_array(candidate_text) {
  // @ts-ignore
  let texts = [];
  // @ts-ignore
  if (!is_valid(candidate_text)) return texts;
  try {
    const parsedArray = JSON.parse(candidate_text);
    if (Array.isArray(parsedArray) && parsedArray.every((elem) => typeof elem === 'string')) {
      texts = parsedArray;
    }
  } catch (error) {
    texts = [candidate_text];
  }

  console_log(`parse_text_to_array: texts = ${JSON.stringify(texts)}`);
  if (texts.length === 0) return null;
  if (texts.length === 1 && texts[0] === '') return [];

  return texts;
}

// @ts-ignore
function sanitizeName(name) {
  if (!is_valid(name)) return null;
  const sanetized_name = name
    .trim()
    .toLowerCase()
    .replace(/[ '"`\\]/g, '_');
  return sanetized_name;
}

// @ts-ignore
function combineValues(existing_value, new_value) {
  if (!existing_value) return new_value;
  if (!new_value) return existing_value;

  // if the existing entry is an array and the new entry is an array, concat them
  // if the existing entry is an array and the new entry is not an array, push the new entry
  // if the existing entry is not an array and the new entry is an array, make the old entry an array with a single element and and concat the new entry
  // if the existing entry is not an array and the new entry is not an array, build an array with both entries
  let result = null;

  if (Array.isArray(existing_value) && Array.isArray(new_value)) {
    result = existing_value.concat(new_value);
  } else if (Array.isArray(existing_value) && !Array.isArray(new_value)) {
    existing_value.push(new_value);
    result = existing_value;
  } else if (!Array.isArray(existing_value) && Array.isArray(new_value)) {
    result = [existing_value].concat(new_value);
  } else if (!Array.isArray(existing_value) && !Array.isArray(new_value)) {
    result = [existing_value, new_value];
  }

  return result;
}

// @ts-ignore
async function runRecipe(ctx, recipe_id, args) {
  if (!recipe_id) throw new Error(`No recipe id specified`);

  const integration = ctx.app.integrations.get('workflow');
  const recipe_json = await integration.getRecipe(recipe_id, ctx.userId, true);
  if (!recipe_json) throw new Error(`Recipe ${recipe_id} not found`);
  const jobService = ctx.app.services.get('jobs');
  const job = await jobService.startRecipe(recipe_json, ctx.sessionId, ctx.userId, args, 0, 'system');
  let value = null;
  await new Promise((resolve, reject) => {
    console.log('waiting for job', job.jobId);
    //@ts-ignore
    ctx.app.events.once('jobs.job_finished_' + job.jobId).then((job) => {
      // saving on the job artifacts
      let workflow_job = job;
      if (Array.isArray(workflow_job)) workflow_job = workflow_job[0];
      value = workflow_job.artifactsValue;
      resolve(job);
    });
  });

  return value;
}

// @ts-ignore
function blockOutput(args) {
  const json = { ...args };
  json.result = { ok: true };

  return json;
}

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
  combineValues
};
