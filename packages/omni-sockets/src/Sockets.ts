/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

/*import { Socket } from 'rete'

const numSocket = new Socket('Number value')
const promptSocket = new Socket('Prompt value')
const textSocket = new Socket('String value')
const textArraySocket = new Socket('String Array value')
const imageArraySocket = new Socket('Image Array value')
const imageSocket = new Socket('Image Socket')
const JSONSocket = new Socket('Object Socket')
const JSONArraySocket = new Socket('Object Array Socket')
const audioArraySocket = new Socket('Audio Array value')
const urlSocket = new Socket('Url value')
const booleanSocket = new Socket('Boolean value')
const markdownSocket = new Socket('Markdown value')
const toolArraySocket = new Socket('Tool Array Socket')

const isValidSocket = (socket: any) => {
  return socket === numSocket || socket === promptSocket || socket === audioArraySocket || socket === textSocket ||
    socket === imageArraySocket || socket === imageSocket || socket === JSONSocket || socket === JSONArraySocket ||
    socket === urlSocket || socket === booleanSocket || socket === textArraySocket || socket === markdownSocket ||
    socket === toolArraySocket
}

const createSocket = (name: string) => new Socket(name)

const getSocketFromString = (socketType: string) => {
  switch (socketType) {
    case 'number':
    case 'float':
    case 'integer':
      return numSocket
    case 'bool':
    case 'boolean':
      return booleanSocket
    case 'prompt':
      return promptSocket
    case 'string':
      return textSocket
    case 'string[]':
      return textArraySocket
    case 'image[]':
      return imageArraySocket
    case 'image':
      return imageSocket
    case 'object':
      return JSONSocket
    case 'object[]':
      return JSONArraySocket
    case 'audio[]':
      return audioArraySocket
    case 'url':
      return urlSocket
    case 'markdown':
      return markdownSocket
    case 'tool[]':
      return toolArraySocket
    default:
      throw new Error(`Invalid socket type: ${socketType}`)
  }
}

export { JSONArraySocket, JSONSocket, audioArraySocket, booleanSocket, createSocket, getSocketFromString, imageArraySocket, imageSocket, isValidSocket, markdownSocket, numSocket, promptSocket, textArraySocket, textSocket, toolArraySocket, urlSocket }
*/
