/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

declare module 'swagger-client' {
  export default class SwaggerClient {
    constructor(url: string, options: any);
    execute(options: any): Promise<any>;
    resolve(options: any): Promise<any>;
  }
}
