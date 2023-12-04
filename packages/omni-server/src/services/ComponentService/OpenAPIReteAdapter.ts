/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */




//import Ajv, { type ValidateFunction } from 'ajv';
import {
  type OmniAPIAuthenticationScheme,
  type DataType,
  type ExtendedParameterObject,
  type OmniComponentFormat,
  type OmniIO,
  type OmniIOType
} from 'omni-sockets/src/components/openapi/types';

import { type oas31 as OpenAPIV3 } from 'openapi3-ts';
//import serialize from 'serialize-javascript';
// const deserialize = function(jsString:string){  return eval('(' + jsString + ')') };

class OpenAPIReteAdapter {
  private readonly openApiDocument: OpenAPIV3.OpenAPIObject;
  private readonly namespace: string;
  private readonly credentials?: string;
  //private ajv: Ajv;
  private readonly patch: any;
  // Some OpenAPI spec doesn't have the authentication mech defined in the spec. So we need to patch the APIs
  private readonly securitySpecs?: OmniAPIAuthenticationScheme | 'disable';

  constructor(
    namespace: string,
    openApiDocument: OpenAPIV3.OpenAPIObject,
    securitySpecs?: OmniAPIAuthenticationScheme | 'disable',
    credentials?: string,
    patch: any = {}
  ) {
    this.namespace = namespace;
    this.openApiDocument = openApiDocument;
    this.credentials = credentials;
    this.patch = patch;
   // this.ajv ??= new Ajv({ strict: false });
    this.securitySpecs = securitySpecs;
  }

 /* private getValidator(schema: OpenAPIV3.SchemaObject): ValidateFunction | undefined {
    this.ajv ??= new Ajv({ strict: false });
    try {
      return this.ajv.compile(schema);
    } catch (ex) {
      omnilog.log('Exception compiling validator', schema, ex);
    }
    return undefined;
  }*/

  private constructInputSchema(operation: OpenAPIV3.OperationObject): OpenAPIV3.SchemaObject {
    const parameterObjects = (operation.parameters ?? []).filter(
      (param): param is OpenAPIV3.ParameterObject => !('$ref' in param)
    );

    const properties = parameterObjects.reduce<Record<string, OpenAPIV3.SchemaObject>>((acc, parameter) => {
      acc[parameter.name] = this.resolveSchema(parameter.schema as OpenAPIV3.SchemaObject);
      return acc;
    }, {});

    const requestBodySchema =
      operation.requestBody != null
        ? (operation.requestBody as OpenAPIV3.RequestBodyObject).content['application/json']?.schema
        : undefined;

    if (requestBodySchema != null) {
      const resolvedRequestBodySchema = this.resolveSchema(requestBodySchema as OpenAPIV3.SchemaObject);
      Object.assign(properties, resolvedRequestBodySchema.properties ?? {});
    }
    return { type: 'object', properties };
  }

  private constructOutputSchema(operation: OpenAPIV3.OperationObject): OpenAPIV3.SchemaObject {
    const response = operation.responses['200'] || operation.responses['201'] || operation.responses.default;
    const mediaType = response?.content?.['application/json'];
    const schema = mediaType?.schema as OpenAPIV3.SchemaObject;
    return this.resolveSchema(schema);
  }

  private resolveRef(ref: string): any {
    const pathParts = ref.split('/').slice(1);
    return pathParts.reduce((obj: any, part: string) => obj[part], this.openApiDocument);
  }

  private resolveSchemaCache: Record<string, OpenAPIV3.SchemaObject> = {};

  public resolveSchema(schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject): OpenAPIV3.SchemaObject {
    if ('$ref' in schema) {
      const ref = schema.$ref;
      if (this.resolveSchemaCache[ref]) {
        return this.resolveSchemaCache[ref];
      }

      const resolvedSchema = this.resolveRef(ref) as OpenAPIV3.SchemaObject;
      this.resolveSchemaCache[ref] = resolvedSchema; // Prevent infinite loop (partial fix)
      const result = this.resolveSchema(resolvedSchema);
      this.resolveSchemaCache[ref] = result; // Actual result
      return result;
    }

    if (schema.type === 'object' && schema.properties) {
      const resolvedProperties: Record<string, OpenAPIV3.SchemaObject> = {};

      for (const key in schema.properties) {
        const propertySchema = schema.properties[key];
        resolvedProperties[key] = this.resolveSchema(propertySchema);
      }

      schema = { ...schema, properties: resolvedProperties };
    }

    if (schema.type === 'array' && schema.items) {
      const resolvedItems = this.resolveSchema(schema.items as OpenAPIV3.SchemaObject);
      schema = { ...schema, items: resolvedItems };
    }
    const keysToResolve: (keyof OpenAPIV3.SchemaObject)[] = ['allOf', 'oneOf', 'anyOf'];

    // Handle allOf, oneOf, anyOf, and not
    keysToResolve.forEach((key: string) => {
      const s = schema as any;
      if (s[key]) {
        s[key] = (s[key] as OpenAPIV3.SchemaObject[]).map((subSchema) => this.resolveSchema(subSchema));
      }
    });

    if (schema.not) {
      schema.not = this.resolveSchema(schema.not as OpenAPIV3.SchemaObject);
    }

    return schema;
  }

  private getDataType(schema: OpenAPIV3.SchemaObject): DataType[] {
    // Return array of DataType
    if (schema.type) {
      return [schema.type as DataType];
    } else if ('$ref' in schema) {
      // @ts-ignore
      const resolvedSchema = this.resolveRef(schema.$ref) as OpenAPIV3.SchemaObject;
      return this.getDataType(resolvedSchema);
    } else if (schema.oneOf != null) {
      // Return all valid data types from the list
      return schema.oneOf.flatMap((innerSchema) => this.getDataType(innerSchema as OpenAPIV3.SchemaObject));
    } else if (schema.anyOf) {
      // Return all valid data types from the list
      return schema.anyOf.flatMap((innerSchema) => this.getDataType(innerSchema as OpenAPIV3.SchemaObject));
    } else if (schema.allOf) {
      // Return all valid data types from the list
      return schema.allOf.flatMap((innerSchema) => this.getDataType(innerSchema as OpenAPIV3.SchemaObject));
    } else {
      //console.log('Undefined schema data type, assuming object');
      return ['object'];
    }
  }



  private extractOmniIOsFromParameters(
    parameters: Array<ExtendedParameterObject | OpenAPIV3.ReferenceObject>
  ): Record<string, OmniIO> {
    const parameterObjects = parameters.filter((param): param is ExtendedParameterObject => !('$ref' in param));


    return parameterObjects.reduce<Record<string, OmniIO>>((acc, parameter) => {
      const dataTypes = this.getDataType(parameter.schema as OpenAPIV3.SchemaObject);
      // @ts-ignore
      const customSocket = parameter.schema?.['x-omni-socket'] ??  parameter.schema?.['format'] === 'binary' ? 'file' : undefined

      acc[parameter.name] = {
        name: parameter.name,
        type: Array.isArray(dataTypes) ? dataTypes[0] : (dataTypes as DataType),
        dataTypes: this.getDataType(parameter.schema as OpenAPIV3.SchemaObject),
        customSocket: customSocket,
        required: parameter.required ?? false,
        default: parameter.schema?.default, // Add the default value
        title: parameter.schema?.title ?? parameter.name.replace(/_/g, ' '),
        // @ts-ignore
        hidden: parameter.schema?.['x-omni-hidden'] === true ? true : undefined,
        // @ts-ignore
        choices: parameter.schema?.['x-omni-choices'] || parameter.schema?.enum || undefined,
        description: parameter.description ?? parameter.schema?.summary ?? parameter.name.replace(/_/g, ' '),
        source: { sourceType: 'parameter', in: parameter.in },
        minimum: parameter.schema?.minimum, // Add minimum
        maximum: parameter.schema?.maximum, // Add maximum
        format: parameter.schema?.format, // Add format
        step:
          parameter.schema?.minimum != null &&
          parameter.schema?.maximum != null &&
          parameter.schema?.minimum >= -1.0 &&
          parameter.schema?.maximum <= 1
            ? 0.01
            : undefined
      };
      return acc;
    }, {});
  }

  private extractOmniIOsFromSchema(
    schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | null,
    socketType: OmniIOType,
    mediaType: string
  ): Record<string, OmniIO> {
    if (
      mediaType.startsWith('audio/') ||
      mediaType === 'application/ogg' ||
      mediaType.startsWith('video/') ||
      mediaType.startsWith('image/') ||
      mediaType === 'application/octet-stream'
    ) {

      let customSocket  = 'file'
      // TODO: Use central logic for this
      if (mediaType.startsWith('audio/') || mediaType === 'application/ogg') customSocket = 'audio'
      if (mediaType.startsWith('video/')) customSocket = 'video'
      if (mediaType.startsWith('image/')) customSocket = 'image'

      return {
        result: {
          name: 'result',
          title: 'Result',
          description: 'Result',
          dataTypes: ['object'],
          source: socketType === 'input' ? { sourceType: 'requestBody' } : { sourceType: 'responseBody' },
          type: 'object',
          customSocket
        }
      };
    }

    if (schema === null) {
      return {};
    }

    const resolved_schema = this.resolveSchema(schema as OpenAPIV3.SchemaObject);

    const properties = resolved_schema.properties ?? {};

    if (!resolved_schema.properties) {
      return {
        _omni_result: {
          type: 'object',
          dataTypes: ['object'],
          source: { sourceType: 'responseBody' },
          name: '_omni_result',
          title: 'Result',
          description: 'The underlying API did not have top property, this is a single result object'
        }
      };
    }

    return Object.entries(properties).reduce<Record<string, OmniIO>>((acc, [key, propertySchema]) => {
      const resolvedPropertySchema = this.resolveSchema(propertySchema as OpenAPIV3.SchemaObject);
      const dataTypes = this.getDataType(resolvedPropertySchema);
      const customSocket =resolvedPropertySchema['x-omni-socket'] ?? resolvedPropertySchema['format'] === 'binary' ? 'file' : undefined
      acc[key] = {
        name: key,
        type: Array.isArray(dataTypes) ? dataTypes[0] : (dataTypes as DataType),
        dataTypes,
        customSocket: customSocket,
        required: resolved_schema.required?.includes(key) ?? resolvedPropertySchema['x-omni-required'] ?? false,
        default: resolvedPropertySchema.default,
        title: this.getOmniValue(
          resolvedPropertySchema,
          'title',
          resolvedPropertySchema.title ?? key.replace(/_/g, ' ')
        ),
        hidden: resolvedPropertySchema['x-omni-hidden'] === true ? true : undefined,
        choices: resolvedPropertySchema['x-omni-choices'] || resolvedPropertySchema.enum || undefined,
        description: resolvedPropertySchema.description ?? key.replace(/_/g, ' '),
        source: socketType === 'input' ? { sourceType: 'requestBody' } : { sourceType: 'responseBody' },
        format: resolvedPropertySchema.format,
        minimum: resolvedPropertySchema.minimum,
        maximum: resolvedPropertySchema.maximum,
        step:
          resolvedPropertySchema.minimum != null &&
          resolvedPropertySchema.maximum != null &&
          resolvedPropertySchema.minimum >= -1.0 &&
          resolvedPropertySchema.maximum <= 1
            ? 0.01
            : undefined
      };
      return acc;
    }, {});
  }

  private extractOmniIOsFromRequestBody(requestBody: OpenAPIV3.RequestBodyObject): Record<string, OmniIO> {
    const { content } = requestBody;

    if (!content) return {};

    // eslint-disable-next-line no-unreachable-loop
    for (const mediaTypeKey of Object.keys(content)) {
      const mediaType = content[mediaTypeKey];
      return this.extractOmniIOsFromSchema(mediaType.schema ?? null, 'input', mediaTypeKey);
    }

    return {};
  }

  private extractOmniIOsFromResponse(response: OpenAPIV3.ResponseObject): Record<string, OmniIO> {
    const { content } = response;

    if (!content) {
      //omnilog.info('No content found in response, creating a single result object');
      return {
        _omni_result: {
          type: 'object',
          dataTypes: ['object'],
          source: { sourceType: 'responseBody' },
          name: '_omni_result',
          title: '_omni_result',
          description: 'The underlying API did not describe the return value, this is a single result object'
        }
      };
    }

    // eslint-disable-next-line no-unreachable-loop
    for (const mediaTypeKey of Object.keys(content)) {
      const mediaType = content[mediaTypeKey];
      return this.extractOmniIOsFromSchema(mediaType.schema ?? null, 'output', mediaTypeKey);
    }

    omnilog.warn('No schema found in response');
    return {};
  }

  private resolveReference<T>(ref: OpenAPIV3.ReferenceObject): T | undefined {
    const referencePath = ref.$ref.split('/').slice(1);
    let resolvedObject: any = this.openApiDocument;

    for (const pathPart of referencePath) {
      resolvedObject = resolvedObject[pathPart];
    }

    return resolvedObject as T;
  }

  public mangleTitle(title?: string): string | undefined {
    if (title == null) {
      return undefined;
    }

    // replace _ with space
    title = title.replace(/_/g, ' ');

    //Add spaces between camelCase text
    title = title.replace(/([a-z])([A-Z])/g, '$1 $2');

    // Upper case every word
    title = title.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());

    //remove non alphanumeric characters
    title = title.replace(/[^a-zA-Z0-9 ]/g, '');

    return title;
  }

  public getReteComponentDef(operationId: string): OmniComponentFormat {
    let operation: OpenAPIV3.OperationObject | undefined;
    let urlPath: string | undefined;
    let operationMethod: string | undefined;

    for (const pathItemKey in this.openApiDocument.paths) {
      const pathItem: OpenAPIV3.PathItemObject = this.openApiDocument.paths[pathItemKey];

      const methods: Array<[string, any]> = Object.entries(pathItem).filter(([method, _]): boolean =>
        ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].includes(method)
      );

      for (const [method, op] of methods) {
        if (op) {
          // Create a pseudo operationId if not provided
          const pseudoOperationId = `${method}_${pathItemKey.replace(/\//g, '_')}`;
          op.operationId = op.operationId || pseudoOperationId;

          if (op.operationId === operationId) {
            operation = op;
            operationMethod = method;
            urlPath = pathItemKey;
            break;
          }
        }
      }

      if (operation != null) {
        break;
      }
    }

    if (operation == null) {
      throw new Error(`Operation with operationId '${operationId}' not found.`);
    }

    const inputOmniIOsFromParameters = this.extractOmniIOsFromParameters(
      (operation.parameters ?? []) as Array<OpenAPIV3.ReferenceObject | ExtendedParameterObject>
    );
    const inputOmniIOsFromRequestBody =
      operation.requestBody != null
        ? this.extractOmniIOsFromRequestBody(operation.requestBody as OpenAPIV3.RequestBodyObject)
        : [];

    const requestBodyObject: OpenAPIV3.RequestBodyObject | undefined =
      operation.requestBody != null
        ? 'content' in operation.requestBody
          ? operation.requestBody
          : this.resolveReference<OpenAPIV3.RequestBodyObject>(operation.requestBody)
        : undefined;

    // TODO: We just take the first content types here, technically we should probably generate multiple components (with the first component retaining the current OperationId)
    const requestContentType: string | undefined =
      requestBodyObject?.content != null ? Object.keys(requestBodyObject.content)[0] : undefined;

    // TODO: add detection for clowny APIS that have parameters and request body fields  with the same name
    const inputOmniIOs = Object.assign({}, inputOmniIOsFromParameters, inputOmniIOsFromRequestBody);

    const response = operation.responses['200'] || operation.responses['201'] || operation.responses.default;
    const responseContentType: string | undefined = response?.content ? Object.keys(response.content)[0] : undefined;

    const outputOmniIOs = response ? this.extractOmniIOsFromResponse(response as OpenAPIV3.ResponseObject) : {};
    const tags = operation.tags ?? [];

    // const outputSchema: OpenAPIV3.SchemaObject = this.constructOutputSchema(operation);

    tags.push('base-api');

    const ret: OmniComponentFormat = {
      type: 'OAIComponent31',
      title: this.getOmniValue(operation, 'title', this.mangleTitle(operation.operationId) ?? 'Unnamed Component'),
      category: this.namespace,
      xOmniEnabled: true,
      //ersion: '1.0.0',
      errors: [],
      flags: 0,
      tags,
      origin: 'omnitool:OpenAPIReteAdapter',
      method: operationMethod ?? 'get', // use the determined method or fallback to 'get'
      security: this.getAuthenticationScheme(operation.security ?? []),
      requestContentType,
      validator: undefined /* inputValidator, */, // TODO: Consider reenabling when OpenAPI incompatibilities on major APIs are not as painful anymore
      credentials: this.credentials,
      description: this.getOmniValue(
        operation,
        'description',
        operation.description ?? operation.summary ?? 'No Description'
      ),
      apiNamespace: this.namespace,
      apiOperationId: operationId,
      displayNamespace: this.namespace,
      displayOperationId: operationId,
      responseContentType: responseContentType ?? 'application/json',
      urlPath: urlPath ?? '', // Include the urlPath property
      inputs: inputOmniIOs,
      outputs: outputOmniIOs,
      customData: {},
      controls: {}
    };
    return ret;
  }

  private getAuthenticationScheme(
    securityRequirements: OpenAPIV3.SecurityRequirementObject[]
  ): OmniAPIAuthenticationScheme[] {
    const schemes: OmniAPIAuthenticationScheme[] = [];

    if (this.securitySpecs === 'disable') return [];

    if (this.securitySpecs) {
      // Authentication scheme override in the namespace API patch
      schemes.push(this.securitySpecs);
      return schemes;
    }

    // If there is no override, translate the authentication scheme defined in the OpenAPI document
    if (this.openApiDocument.components?.securitySchemes && this.securitySpecs !== 'disable') {
      const isOptional = securityRequirements.reduce((acc, requirement) => {
        Object.keys(requirement).length > 0 ? (acc = false) : (acc = true);
        return acc;
      }, false);

      securityRequirements.forEach((requirement) => {
        Object.keys(requirement).forEach((key) => {
          const scheme = this.openApiDocument.components?.securitySchemes?.[key];
          if (scheme) {
            if ('$ref' in scheme) {
              // We don't support reference in security scheme as it is not commonly used
              omnilog.info(`Security scheme ${key} is a reference, skipping...`);
            } else if (scheme.type === 'http') {
              if (scheme.scheme === 'basic') {
                schemes.push({
                  type: 'http_basic',
                  isOptional,
                  requireKeys: [
                    {
                      id: 'username',
                      displayName: 'User name',
                      type: 'string'
                    },
                    {
                      id: 'password',
                      displayName: 'Password',
                      type: 'string'
                    }
                  ]
                });
              } else if (scheme.scheme === 'bearer') {
                schemes.push({
                  type: 'http_bearer',
                  isOptional,
                  requireKeys: [
                    {
                      id: 'Bearer',
                      displayName: 'Bearer',
                      type: 'string'
                    }
                  ]
                });
              } else {
                omnilog.verbose(`Unsupported http security scheme ${key} with scheme ${scheme.scheme}`);
              }
            } else if (scheme.type === 'apiKey') {
              schemes.push({
                type: 'apiKey',
                isOptional,
                requireKeys: [
                  {
                    id: scheme.name ?? 'api_key',
                    in: scheme.in ?? 'header',
                    displayName: scheme.name ?? 'api_key',
                    type: 'string'
                  }
                ]
              });
            } else if (scheme.type === 'oauth2') {
              if (scheme.flows?.authorizationCode) {
                schemes.push({
                  type: 'oauth2',
                  isOptional,
                  requireKeys: [
                    {
                      id: 'accessToken',
                      displayName: 'Access Token',
                      type: 'oauth2'
                    }
                  ],
                  oauth: {
                    authorizationCode: {
                      authorizationUrl: scheme.flows.authorizationCode.authorizationUrl ?? '',
                      tokenUrl: scheme.flows.authorizationCode.tokenUrl ?? '',
                      refreshUrl: scheme.flows.authorizationCode.refreshUrl,
                      scopes: Object.keys(scheme.flows.authorizationCode.scopes)
                    }
                  }
                });
              } else {
                omnilog.verbose('Unsupported oauth2 security scheme');
              }
            } else {
              omnilog.verbose(`Unsupported security scheme ${key} with type ${scheme.type}`);
            }
          }
        });
      });
    } else {
      omnilog.verbose('No authentication method defined in the OpenAPI document');
    }
    return schemes;
  }

  // See if a x-omni-<name> property is defined on the operation, otherwise return the default value
  public getOmniValue(
    parent: OpenAPIV3.OperationObject | ExtendedParameterObject | OpenAPIV3.SchemaObject,
    name: string,
    defaultValue: any
  ) {
    return parent[`x-omni-${name}`] ?? defaultValue;
  }

  public getOperationIds(filter?: string[]): string[] {
    const apiOperationIds: string[] = [];

    for (const pathItemKey in this.openApiDocument.paths) {
      const pathItem: OpenAPIV3.PathItemObject = this.openApiDocument.paths[pathItemKey];

      const operations = Object.values(pathItem).filter(
        (value): value is OpenAPIV3.OperationObject => value !== undefined
      );

      for (const op of operations.filter((op) => op)) {
        if (op.operationId) {
          if (filter?.includes(op.operationId)) {
            apiOperationIds.push(op.operationId);
          } else {
            if (filter == null /* || !filter.includes('!' + op.operationId) */) {
              apiOperationIds.push(op.operationId);
            }
          }
        }
      }
    }

    return apiOperationIds;
  }

  public getReteComponentDefs(filter?: string[]): OmniComponentFormat[] {
    const apiOperationIds = this.getOperationIds(filter);
    return apiOperationIds.map((apiOperationId) => this.getReteComponentDef(apiOperationId));
  }
}

export { OpenAPIReteAdapter };
