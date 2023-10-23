/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import {
  Configuration,
  OpenAIApi,
  ChatCompletionRequestMessage,
  CreateChatCompletionRequest,
  ConfigurationParameters,
} from "openai";
import type { IncomingMessage } from "http";
import { createParser } from "eventsource-parser";
import { BaseLLMParams, LLM } from "langchain/llms";

interface ModelParams {
  /** Sampling temperature to use, between 0 and 2, defaults to 1 */
  temperature: number;

  /** Total probability mass of tokens to consider at each step, between 0 and 1, defaults to 1 */
  topP: number;

  /** Penalizes repeated tokens according to frequency */
  frequencyPenalty: number;

  /** Penalizes repeated tokens */
  presencePenalty: number;

  /** Number of chat completions to generate for each prompt */
  n: number;

  /** Dictionary used to adjust the probability of specific tokens being generated */
  logitBias?: Record<string, number>;

  /** Whether to stream the results or not */
  app: any
}

/**
 * Input to OpenAI class.
 * @augments ModelParams
 */
interface OpenAIInput extends ModelParams {
  /** Model name to use */
  modelName: string;

  /** ChatGPT messages to pass as a prefix to the prompt */
  prefixMessages?: ChatCompletionRequestMessage[];

  /** Holds any additional parameters that are valid to pass to {@link
   * https://platform.openai.com/docs/api-reference/completions/create |
   * `openai.create`} that are not explicitly specified on this class.
   */
  modelKwargs?: Kwargs;

  /** List of stop words to use when generating */
  stop?: string[];

  /**
   * Maximum number of tokens to generate in the completion.  If not specified,
   * defaults to the maximum number of tokens allowed by the model.
   */
  maxTokens?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Kwargs = Record<string, any>;

/**
 * Wrapper around OpenAI large language models that use the Chat endpoint.
 *
 * To use you should have the `openai` package installed, with the
 * `OPENAI_API_KEY` environment variable set.
 *
 * @remarks
 * Any parameters that are valid to be passed to {@link
 * https://platform.openai.com/docs/api-reference/chat/create |
 * `openai.createCompletion`} can be passed through {@link modelKwargs}, even
 * if not explicitly available on this class.
 *
 * @augments BaseLLM
 * @augments OpenAIInput
 */
export class OpenAIChat extends LLM implements OpenAIInput {
  temperature = 1;

  topP = 1;

  frequencyPenalty = 0;

  presencePenalty = 0;

  n = 1;

  logitBias?: Record<string, number>;

  maxTokens?: number;

  modelName = "gpt-3.5-turbo";

  app: any
  prefixMessages?: ChatCompletionRequestMessage[];

  modelKwargs?: Kwargs;

  stop?: string[];



  private clientConfig: ConfigurationParameters;

  constructor(
    fields?: Partial<OpenAIInput> &
      BaseLLMParams & {
        openAIApiKey?: string;
      },
    configuration?: ConfigurationParameters
  ) {
    super(fields ?? {});


    this.modelName = fields?.modelName ?? this.modelName;
    this.prefixMessages = fields?.prefixMessages ?? this.prefixMessages;
    this.modelKwargs = fields?.modelKwargs ?? {};

    this.temperature = fields?.temperature ?? this.temperature;
    this.topP = fields?.topP ?? this.topP;
    this.frequencyPenalty = fields?.frequencyPenalty ?? this.frequencyPenalty;
    this.presencePenalty = fields?.presencePenalty ?? this.presencePenalty;
    this.n = fields?.n ?? this.n;
    this.logitBias = fields?.logitBias;
    this.maxTokens = fields?.maxTokens;
    this.stop = fields?.stop;
    this.app = fields?.app;



    this.clientConfig = {
      ...configuration,
    };
  }

  /**
   * Get the parameters used to invoke the model
   */
  invocationParams(): Omit<CreateChatCompletionRequest, "messages"> & Kwargs {
    return {
      model: this.modelName,
      temperature: this.temperature,
      top_p: this.topP,
      frequency_penalty: this.frequencyPenalty,
      presence_penalty: this.presencePenalty,
      n: this.n,
      logit_bias: this.logitBias,
      max_tokens: this.maxTokens,
      stop: this.stop,

      ...this.modelKwargs,
    };
  }

  _identifyingParams() {
    return {
      model_name: this.modelName,
      ...this.invocationParams(),
      ...this.clientConfig,
    };
  }

  /**
   * Get the identifying parameters for the model
   */
  identifyingParams() {
    return {
      model_name: this.modelName,
      ...this.invocationParams(),
      ...this.clientConfig,
    };
  }

  private formatMessages(prompt: string): ChatCompletionRequestMessage[] {
    const message: ChatCompletionRequestMessage = {
      role: "user",
      content: prompt,
    };
    return this.prefixMessages ? [...this.prefixMessages, message] : [message];
  }

  /**
   * Call out to OpenAI's endpoint with k unique prompts
   *
   * @param prompt - The prompt to pass into the model.
   * @param [stop] - Optional list of stop words to use when generating.
   *
   * @returns The full LLM output.
   *
   * @example
   * ```ts
   * import { OpenAI } from "langchain/llms";
   * const openai = new OpenAI();
   * const response = await openai.generate(["Tell me a joke."]);
   * ```
   */
  async _call(prompt: string, stop?: string[]): Promise<string> {
    if (this.stop && stop) {
      throw new Error("Stop found in input and default params");
    }

    const params = this.invocationParams();
    params.stop = stop ?? params.stop;

    const response  = await this.app.api2.openai.createChatCompletion({...params, messages: this.formatMessages(prompt)})

    let completion = response.choices[0].message?.content ?? "";

    return completion;
  }



  _llmType() {
    return "openai";
  }
}

/*
  async _call(prompt: string, _stop?: string[]): Promise<string> {

    //@ts-ignore
    // Hit the `generate` endpoint on the `large` model
    const generateResponse = await this.app.api2.openai.createChatCompletion({model: 'gpt-3.5-turbo', messages:[{ role: "user", content: prompt  }]})

    try {
      return generateResponse;
    } catch {
      omnilog.log(generateResponse);
      throw new Error("Could not parse response.");
    }
  }


}*/