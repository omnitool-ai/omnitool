/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIComponent31, type OmniComponentFormat, type OmniIO, type OperationRecord } from 'omni-sockets';

import { type oas31 as OpenAPIV3 } from 'openapi3-ts';

function resolveSchema(ref: string, openapi: OpenAPIV3.OpenAPIObject): OpenAPIV3.SchemaObject | null {
  const refPath = ref.replace(/^#\//, '').split('/');

  let currentObject: any = openapi;

  for (const part of refPath) {
    currentObject = currentObject[part];
    if (!currentObject) {
      return null;
    }
  }

  return currentObject as OpenAPIV3.SchemaObject;
}

// Helper function to extract the schema from a content object
function extractSchema(
  content: OpenAPIV3.MediaTypeObject | undefined,
  openapi: OpenAPIV3.OpenAPIObject
): OpenAPIV3.SchemaObject | null {
  if (content?.schema != null) {
    if ('$ref' in content.schema) {
      return resolveSchema(content.schema.$ref, openapi);
    }
    return content.schema;
  }

  return null;
}
function resolveParameter(ref: string, openapi: OpenAPIV3.OpenAPIObject): OpenAPIV3.ParameterObject | null {
  const refPath = ref.replace(/^#\//, '').split('/');

  let currentObject: any = openapi;

  for (const part of refPath) {
    currentObject = currentObject[part];
    if (!currentObject) {
      return null;
    }
  }

  return currentObject as OpenAPIV3.ParameterObject;
}

function processParameters(
  parameters: Array<OpenAPIV3.ReferenceObject | OpenAPIV3.ParameterObject> | undefined,
  openapi: OpenAPIV3.OpenAPIObject
): OpenAPIV3.ParameterObject[] | null {
  if (parameters == null) {
    return null;
  }

  return parameters
    .map((param) => {
      if ('$ref' in param) {
        return resolveParameter(param.$ref, openapi);
      }
      return param;
    })
    .filter((param): param is OpenAPIV3.ParameterObject => param !== null);
}
class OpenAPIImporter {
  // Main function
  static componentsFromJson(
    openapiJson: string,
    patchJson?: string,
    filter?: { methods?: string[]; operationIds?: string[] }
  ): OperationRecord[] {
    const openapi: OpenAPIV3.OpenAPIObject = (typeof openapiJson === 'string' ? JSON.parse(openapiJson) : openapiJson)
      .spec;
    const patch: OpenAPIV3.OpenAPIObject = typeof patchJson === 'string' ? JSON.parse(patchJson) : patchJson;

    const operations: Map<string, OperationRecord> = new Map<string, OperationRecord>();
    const security = patch?.security ?? openapi.security;

    // Iterate through all paths in the OpenAPI document
    for (const path in openapi.paths) {
      const pathItem = openapi.paths[path];
      // Check if the method is a valid HTTP method
      for (const method in pathItem) {
        if (['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].includes(method)) {
          const operation = pathItem[method as keyof OpenAPIV3.PathItemObject] as OpenAPIV3.OperationObject;
          const operationId = (operation.operationId ?? path)?.replace(/[^a-zA-Z0-9]/g, '_');
          const summary = operation.summary ?? '';
          // @ts-ignore
          const category = operation.category ?? '';
          let requestContentType;
          const url = path;
          const requestBody = operation.requestBody as OpenAPIV3.RequestBodyObject;
          // @ts-ignore
          const tags = operation['x-tags'] || [];
          let schema: OpenAPIV3.SchemaObject | null = null;
          if (requestBody) {
            const content = requestBody.content;
            if (content['application/json']) {
              schema = extractSchema(content['application/json'], openapi);
              requestContentType = 'application/json';
            } else if (content['application/x-www-form-urlencoded']) {
              requestContentType = 'x-www-form-urlencoded';
              schema = extractSchema(content['application/x-www-form-urlencoded'], openapi);
            } else if (content['multipart/form-data']) {
              requestContentType = 'multipart/form-data';
              schema = extractSchema(content['multipart/form-data'], openapi);
            } else {
              // omnilog.warn('Unsupported content type in request body', content)
            }
          }
          const parameters = processParameters(operation.parameters, openapi);

          const responseTypes: Record<string, { schema: OpenAPIV3.SchemaObject | null; contentType: string }> = {};
          for (const statusCode in operation.responses) {
            const response = operation.responses[statusCode] as OpenAPIV3.ResponseObject;
            const content = response.content;
            if (content != null) {
              for (const contentType in content) {
                if (responseTypes[statusCode] == null) {
                  responseTypes[statusCode] = {
                    schema: extractSchema(content[contentType], openapi),
                    contentType
                  };
                } else {
                  // omnilog.debug(`Multiple content types for response code ${statusCode} in operation ${operationId}, this is not supported`)
                  // TODO: // See if this is actually an issue...
                  // responseTypes[`${statusCode}_${contentType}`] = extractSchema(content[contentType], openapi); //
                }
              }
            }
          }

          // Security requirements
          const operationSecurityRequirement = operation.security ?? security;
          const operationSecurity: Array<{ spec: OpenAPIV3.SecuritySchemeObject; scopes: string[] }> = [];
          if (operationSecurityRequirement != null) {
            // Get the security schema from OpenAPI components.securitySchemes
            operationSecurity.push(
              ...OpenAPIImporter.getSecuritySchemes(
                operationSecurityRequirement,
                openapi.components?.securitySchemes ?? {}
              )
            );
            if (patch) {
              // Get the security schema from ns definition patch
              operationSecurity.push(
                ...OpenAPIImporter.getSecuritySchemes(
                  operationSecurityRequirement,
                  patch.components?.securitySchemes ?? {}
                )
              );
            }
          }

          operations.set(operationId, {
            operationId,
            url,
            tags,
            schema,
            category,
            parameters,
            responseTypes,
            requestContentType,
            method: method.toUpperCase(),
            summary,
            meta: operation['x-omni-meta'],
            // @ts-ignore
            patch: operation['x-patch'] ?? operation['x-omni-patch'],
            security: operationSecurity
          });
        }
      }
    }

    // Iterate through all the paths on the patch
    if (patch) {
      for (const path in patch.paths) {
        const pathItem = patch.paths[path];
        // Check if the method is a valid HTTP method
        for (const method in pathItem) {
          if (['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].includes(method)) {
            const operation = pathItem[method as keyof OpenAPIV3.PathItemObject] as OpenAPIV3.OperationObject;
            const operationId = (operation.operationId ?? path)?.replace(/[^a-zA-Z0-9]/g, '_');

            const op = operations.get(operationId);
            if (op != null) {
              const meta = operation['x-omni-meta'];

              // Security requirements
              const operationSecurityRequirement = operation.security || security;
              const operationSecurity: Array<{ spec: OpenAPIV3.SecuritySchemeObject; scopes: string[] }> = [];
              if (operationSecurityRequirement != null) {
                // Get the security schema from OpenAPI components.securitySchemes
                operationSecurity.push(
                  ...OpenAPIImporter.getSecuritySchemes(
                    operationSecurityRequirement,
                    patch.components?.securitySchemes ?? {}
                  )
                );
              }

              op.security = operationSecurity;
              op.meta = meta;
              operations.set(operationId, op);
            }
          }
        }
      }
    }

    return Array.from(operations.values());
  }

  private static getSecuritySchemes(
    operationSecurityRequirement: OpenAPIV3.SecurityRequirementObject[],
    securitySchemes: Record<string, OpenAPIV3.SecuritySchemeObject | OpenAPIV3.ReferenceObject>
  ): Array<{ spec: OpenAPIV3.SecuritySchemeObject; scopes: string[] }> {
    const schemes: Array<{ spec: OpenAPIV3.SecuritySchemeObject; scopes: string[] }> = [];
    operationSecurityRequirement.forEach((requirement) => {
      Object.keys(requirement).forEach((key) => {
        const scheme = securitySchemes[key];
        if (scheme) {
          if ('$ref' in scheme) {
            // We don't support reference in security scheme as it is not commonly used
            omnilog.info(`Security scheme ${key} is a reference, skipping...`);
          } else {
            schemes.push({ spec: scheme, scopes: requirement.key ?? [] });
          }
        }
      });
    });
    return schemes;
  }

  private static oldIOtoNewIo(io: any): OmniIO {
    return {
      name: io.name,
      title: io.title,
      description: io.description,
      customSocket: io['x-type'],
      required: io.required,
      default: io.default,
      minimum: io.minimum,
      maximum: io.maximum,
      choices: io.choices,
      hidden: io.hidden,
      dataTypes: io.dataTypes, // TODO: handle the real value
      type: io.type, // TODO: handle the real value
      source: io.source // TODO: handle the real value
    };
  }

  private static componentFormatFromAPIOperations(comp: any): OmniComponentFormat {
    const format: OmniComponentFormat = {
      type: 'OAIComponent31',
      apiOperationId: comp.operation.operationId,
      apiNamespace: comp.namespace,
      category: comp.category,
      displayNamespace: comp.patch?.namespace ?? comp.namespace,
      displayOperationId: comp.operation.operationId,
      title: comp.title,
      method: comp.operation.method ?? 'get',
      description: comp.summary,
      customData: {},
      xOmniEnabled: comp.xOmniEnabled,
      errors: comp.errors,
      flags: 0,
      origin: 'omnitool:OpenAPIImporter',
      urlPath: comp.operation.url,
      controls: comp.controls ?? {}, // TODO: load controls
      inputs: comp.patch?.inputs
        ? Object.entries(comp.patch.inputs).reduce<Record<string, OmniIO>>((acc, [key, value]) => {
            acc[key] = OpenAPIImporter.oldIOtoNewIo(value);
            return acc;
          }, {})
        : {},
      outputs: comp.patch?.outputs
        ? Object.entries(comp.patch.outputs).reduce<Record<string, OmniIO>>((acc, [key, value]) => {
            acc[key] = OpenAPIImporter.oldIOtoNewIo(value);
            return acc;
          }, {})
        : {},
      meta: comp.meta,
      tags: comp.tags,
      requestContentType: '',
      responseContentType: ''
      // security: comp.operation.security ? OpenAPIImporter.omniAPIAuthenticationSchemeFromSecurityScheme(comp.operation.security) : undefined
    };

    return format;
  }

  public static componentFormatsFromAPIOperations(comps: any[]): OmniComponentFormat[] {
    return comps.map((comp) => OpenAPIImporter.componentFormatFromAPIOperations(comp));
  }

  private static componentFromAPIOperations(comp: any): OAIComponent31 {
    const format: OmniComponentFormat = OpenAPIImporter.componentFormatFromAPIOperations(comp);

    return new OAIComponent31(format, undefined, {});
  }

  public static componentsFromAPIOperations(comps: any[]): OAIComponent31[] {
    return comps.map((comp) => OpenAPIImporter.componentFromAPIOperations(comp));
  }
}

export { OpenAPIImporter };
