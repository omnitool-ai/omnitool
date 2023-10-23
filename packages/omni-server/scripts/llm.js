/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

const isBlockAvailable = (ctx, block) => {
  return ctx.app.blocks.hasBlock(block)
}

const runBlock = async (ctx, block, args) => {

  return ctx.app.blocks.runBlock(ctx, block, args)

}

const getInternetInfo = async (ctx, prompt) => {
  console.log('getInternetInfo')

  const topic = await runBlock(ctx, 'openai.simpleChatGPT', {
    prompt,
    model: 'gpt-3.5-turbo',
    instruction: 'Identify the main subject of the user\'s query. Answer just with that. For example if the user asks \'who is helmut kohl\', respond with \'Helmut Kohl\'. If the user asks \'where is the golden gate bridge\', respond with \'San Francisco\'. If the user\'s query mentions "news", include that in your response, e.g. "celebrity news", "AI news", "tech news" etc. Just respond with the immediate topic only, no additional words.'
  })

  if (topic.error) {
    console.error(`Failed to find topic with error ${topic.error}`)
  }

  const ddgQuery = topic.error ? prompt : topic.text

  try {
    console.log(`Query DuckDuckGo API for ${ddgQuery}`)
    const url = 'https://api.duckduckgo.com?format=json&limit=3&q=' + encodeURIComponent(ddgQuery)
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    })

    const data = await response.json()
    const ddgText = data.AbstractText ?? data.Text
    if (!ddgText) {
      console.log(`No results from DuckDuckGo for ${ddgQuery}`)
      return null
    }
    let blob = `Here are the results from a DuckDuckGo query for "${ddgQuery}":\n\n`

    /*
      for (let index = 0; index < data.length; index++) {
        blob += `[${index}] "${data[index].snippet}"\nURL:${data[index].link}\n\n`;
      }
    */
    blob += `[${1}] "${ddgText}"\nURL:${data.AbstractURL}\nSource:${data.AbstractSource}\n`

    blob +=
      'Instructions: Using the provided web search results, write a comprehensive reply to the next user query. Make sure to cite results using [[number](URL)] markdown notation after the reference. If the provided search results refer to multiple subjects with the same name, write separate answers for each subject. Ignore your previous response if any. If you use these citations, always end your response with a citation block listing each reference in the form of [number] - (URL) '
    return blob
  } catch (error) {
    console.error('Error:', error)
  }
  return null
}

const script = {
  name: 'llm',

  exec: async function (ctx, payload) {
    payload = JSON.parse(payload)

    if (payload.action === 'run_block') {
      const { block, args, data } = payload
      args.user = ctx.userId

      const canScanPII = isBlockAvailable(ctx, 'omni-extension-pii-scrubber.redactPII')

      // Optional PII removal using default settings
      if (canScanPII && data.redact_pii) {
        const py = JSON.stringify({ conversation: data.conversation, prompt: args.prompt })
        const result = await runBlock(ctx, 'omni-extension-pii-scrubber.redactPII', { text: py })
        if (result.text) {
          const restore = JSON.parse(result.text)
          data.conversation = restore.conversation
          args.prompt = restore.prompt
          console.log('PII removal:', py)
        } else {
          throw new Error('PII removal failed' + result.error)
        }
      } else {
        console.log('PII removal not enabled or unavailable')
      }

      const systemMessage = `You are ChatGPT also known as ChatGPT, a large language model trained by OpenAI. Strictly follow the users instructions. Knowledge cutoff: 2021-09-01 Current date: ${(new Date()).toLocaleDateString()}`
      if (data.internet_access) {
        const blob = await getInternetInfo(ctx, args.prompt)
        const extra = blob ? [{ role: 'user', content: blob }] : ['']
        const prompt = { role: 'user', content: args.prompt }
        data.conversation = [{ role: 'system', content: systemMessage }].concat(extra, data.conversation, [prompt])
        args.instruction = data.conversation.filter((item) => item.role === 'system').map((item) => item.content).join('\n\n')
        args.prompt = data.conversation.filter((item) => item.role !== 'system').map((item) => item.content).join('\n\n')
      } else {
        const prompt = { role: 'user', content: args.prompt }
        data.conversation = [{ role: 'system', content: systemMessage }].concat(data.conversation, [prompt])
        args.instruction = data.conversation.filter((item) => item.role === 'system').map((item) => item.content).join('\n\n')
        args.prompt = data.conversation.filter((item) => item.role !== 'system').map((item) => item.content).join('\n\n')
      }

      const result = await runBlock(ctx, block, args)
      if (!result)
      {
        result.error('NULL result from runBlock')
      }

      return { text: result.error || result.text }
    }
  }

}

export default script
/*
method: `POST`,
headers: {
  "content-type": `application/json`,
  accept: `application/json`,
},
body: JSON.stringify({
  conversation_id: window.conversation_id,
  action: 'prompt',
  model: model.options[model.selectedIndex].value,
  conversation: await get_conversation(window.conversation_id),
  internet_access: document.getElementById("switch").checked,
  prompt: message,
  content_type: "text"
})});
*/
