/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { AnyClass } from "@casl/ability/dist/types/types";
import {  LLM, BaseLLMParams} from "langchain/llms";

interface AlpacaInput {
  /** Sampling temperature to use */
  temperature: number;

  /**
   * Maximum number of tokens to generate in the completion.
   */
  maxTokens: number;
  app: any;
  /** Model to use */
  model: string;
}

export class AlpacaLLM extends LLM implements AlpacaInput {
  temperature = 0;

  maxTokens = 250;

  model: string;
  app: any;

  constructor(fields?: Partial<AlpacaInput> & BaseLLMParams) {
    super(fields ?? {});
    this.maxTokens = fields?.maxTokens ?? this.maxTokens;
    this.temperature = fields?.temperature ?? this.temperature;
    this.model = fields?.model ?? "alpaca";
    this.app = fields?.app;
  }

  _llmType() {
    return "alpaca";
  }

  async _call(prompt: string, _stop?: string[]): Promise<string> {

    //@ts-ignore
    let pl = {user_id: "user", use_cache : true, do_sample: true, repetition_penalty: 1.1, temperature: 0.01, message: prompt, max_new_tokens:200}
    omnilog.log(pl)

    // Hit the `generate` endpoint on the `large` model
    const generateResponse = await this.app.api2.alpaca.createCompletion(pl)

    try {
      return generateResponse;
    } catch {
      omnilog.log(generateResponse);
      throw new Error("Could not parse response.");
    }
  }


}