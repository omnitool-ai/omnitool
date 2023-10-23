/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import Handlebars, { type HelperDelegate } from 'handlebars';
import { marked } from 'marked';

const mdRenderer = new marked.Renderer();
mdRenderer.link = function (_href, _title, _text) {
  const link = marked.Renderer.prototype.link.apply(this, arguments as any);
  return link.replace('<a', "<a target='_blank'");
};

class MarkdownEngine {
  handlebars: typeof Handlebars;
  private asyncResolvers: Record<string, (token: string) => Promise<any>> = {};

  constructor() {
    this.handlebars = Handlebars.create();
  }

  registerAsyncResolver(directive: string, resolverFunction: (token: string) => Promise<any>) {
    this.asyncResolvers[directive] = resolverFunction;
  }

  registerToken(tokenName: string, resolver: HelperDelegate) {
    this.handlebars.registerHelper(tokenName, resolver);
  }

  async getAsyncDataForDirective(directive: string, token: string): Promise<any> {
    const resolver = this.asyncResolvers[directive];
    if (!resolver) {
      throw new Error(`No resolver registered for directive: ${directive}`);
    }
    return await resolver(token);
  }

  extractDirectiveData(statement: any): { name?: string; param?: string } {
    if (statement.type === 'MustacheStatement' || statement.type === 'BlockStatement') {
      const name = statement.path?.original;
      const param = statement.params?.[0]?.original;

      return {
        name,
        param
      };
    }

    return {};
  }

  async preprocessData(markdownContent: string): Promise<{ content: string; data: any }> {
    const data: any = {};

    const tokens = this.extractTokens(markdownContent);

    for (const [placeholder, originalDirective] of tokens) {
      const parsed = Handlebars.parse(originalDirective);
      const directiveData = this.extractDirectiveData(parsed.body[0]);
      const directive = directiveData?.name;
      const token = directiveData?.param;

      if (directive && token) {
        const tokenData = await this.getAsyncDataForDirective(directive, token);
        data[placeholder] = tokenData;
        markdownContent = markdownContent.replace(placeholder, originalDirective);
      }
    }

    return { content: markdownContent, data };
  }

  extractTokens(content: string): Map<string, string> {
    const tokenRegex = /{{(BUTTON|INPUT)[^}]+}}/g;
    const tokens = new Map<string, string>();
    let match;

    while ((match = tokenRegex.exec(content)) !== null) {
      const placeholder = `TOKEN_${tokens.size + 1}`;
      tokens.set(placeholder, match[0]);
      content = content.replace(match[0], placeholder);
    }

    return tokens;
  }

  injectTokens(content: string, tokens: Map<string, string>): string {
    let processedContent = content;

    tokens.forEach((value, key) => {
      processedContent = processedContent.replace(key, value);
    });

    return processedContent;
  }

  async render(markdownContent: string): Promise<string> {
    const tokens = this.extractTokens(markdownContent);
    const md = marked.parse(markdownContent, { renderer: mdRenderer });
    const injectedContent = this.injectTokens(md, tokens);
    const { content, data } = await this.preprocessData(injectedContent);
    const replacedContent = this.handlebars.compile(content)(data);

    return replacedContent;
  }
}

export { MarkdownEngine };
