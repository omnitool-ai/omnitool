/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

export class HTTPClient {
  fetch: Function;
  constructor(
    fetchFn: Function = (input: RequestInfo | URL, init?: RequestInit | undefined): Promise<Response> =>
      window.fetch(input, init)
  ) {
    this.fetch = fetchFn;
  }

  async executeRequest(input: RequestInfo | URL, init?: RequestInit | undefined) {
    return await this.fetch(input, init);
  }
}
