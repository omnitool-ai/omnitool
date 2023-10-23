/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { console_warn, createComponent } from '../../../src/utils/omni-utils.js';
import { type WorkerContext, BlockCategory as Category } from 'omni-sockets';

const NS_OMNI = 'omnitool';

const group_id = NS_OMNI;
const id = 'images_to_markdown';
const title = 'Images to Markdown';
const category = Category.DATA_TRANSFORMATION;
const description = 'Transform an array of images and their corresponding captions into a markdown document.';
const summary = description;

const inputs = [
  { name: 'title', type: 'string', customSocket: 'text', description: 'The title of the markdown.' },
  { name: 'images', type: 'array', customSocket: 'imageArray', description: 'Images to be included in the markdown.' },
  {
    name: 'captions',
    type: 'object',
    customSocket: 'object',
    description: 'Captions to be included in the markdown in the format { "captions": ["caption1", "caption2", ...] }.'
  },
  {
    name: 'entry_name',
    type: 'string',
    customSocket: 'text',
    defaultValue: 'Panel',
    description: 'The name to be used for each picture, e.g. panel, page or illustration'
  },
  {
    name: 'append_to',
    type: 'string',
    customSocket: 'text',
    description: 'Optional. The name of the markdown to append the new markdown to.'
  }
];
const outputs = [
  { name: 'markdown', type: 'string', customSocket: 'text', description: 'The markdown created from the inputs.' },
  { name: 'info', type: 'string', customSocket: 'text', description: 'Information about the block execution' }
];

const controls = null;
const links = {};

export const ImagesToMarkdownComponent = createComponent(
  group_id,
  id,
  title,
  category,
  description,
  summary,
  links,
  inputs,
  outputs,
  controls,
  parsePayload
);

async function parsePayload(payload: any, ctx: WorkerContext) {
  const title = payload.title;
  const images_cdns = payload.images;
  const captions_object = payload.captions;
  const entry_name = payload.entry_name;
  const captions = captions_object?.captions;
  const append_to = payload.append_to;

  if ((!images_cdns || images_cdns.length == 0) && (!captions_object || captions.length == 0)) {
    throw new Error(`No images or captions specified`);
  }

  let info = '';
  const image_urls = [];
  // extract the urls from the images
  for (const image_cdn of images_cdns) {
    image_urls.push(image_cdn.url);
  }

  // Initialize the markdownString
  let markdown = '';

  // Check if the title is not empty or null and add it to the markdownString
  if (title) {
    markdown += `# ${title}\n\n`;
  } else {
    info += `No title specified\n`;
  }

  if (!entry_name || entry_name == '') {
    info += `No Entry Name specified\n`;
  }

  // Determine the length of the shorter array
  const minLen = Math.min(image_urls.length, captions.length);

  // Iterate over both arrays up to the length of the shorter array
  for (let i = 0; i < minLen; i++) {
    markdown += `## ${entry_name} ${i + 1}\n\n`;
    markdown += `![${captions[i]}](${image_urls[i]})`;
    markdown += `${captions[i]}\n\n`;
    markdown += `---\n\n`; // Add a divider between pages
  }

  // If there are more images than captions, append the extra images
  for (let i = minLen; i < image_urls.length; i++) {
    markdown += `## ${entry_name} ${i + 1}\n\n`;
    markdown += `![](${image_urls[i]})\n\n`;
    markdown += `---\n\n`; // Add a divider between pages
    info += `No caption for image ${i + 1}\n`;
  }

  // If there are more captions than images, append the extra captions
  for (let i = minLen; i < captions.length; i++) {
    markdown += `## ${entry_name} ${i + 1}\n\n`;
    markdown += `${captions[i]}\n\n`;
    markdown += `---\n\n`; // Add a divider between pages
    info += `No image for caption ${i + 1}\n`;
  }

  if (!markdown || markdown == '') throw new Error(`No markdown created`);
  if (info.length > 0) console_warn(info);
  else info = 'ok';

  if (append_to && append_to != '') markdown = append_to + '\n\n' + markdown;

  return { result: { ok: true }, markdown, info };
}
