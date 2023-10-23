/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type oas31 as OpenAPIV3 } from 'openapi3-ts';
import { type NodeData, type WorkerInputs, type WorkerOutputs } from 'rete/types/core/data';

interface OperationRecord {
  operationId: string;
  url: string;
  summary: string;
  category?: string;
  schema: OpenAPIV3.SchemaObject | { title: string | undefined; required?: string[]; properties?: any } | null;
  parameters: Array<OpenAPIV3.ReferenceObject | OpenAPIV3.ParameterObject> | undefined | null;
  responseTypes: Record<string, { schema: OpenAPIV3.SchemaObject | null; contentType: string }>;
  requestContentType?: string;
  method: string;
  meta: OmniComponentMeta;
  patch?: string;
  tags?: string[];
  security?: Array<{ spec: OpenAPIV3.SecuritySchemeObject; scopes: string[] }>;
}

type OmniIOType = 'input' | 'output';
type DataType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'boolean';

type DefaultValue = string | number | boolean | object | null | undefined;

type OmniIOSource =
  | { sourceType: 'parameter'; in: OpenAPIV3.ParameterLocation }
  | { sourceType: 'requestBody' }
  | { sourceType: 'responseBody' };

type ExtendedParameterObject = OpenAPIV3.ParameterObject & {
  schema: (OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject) & {
    default?: DefaultValue;
    title?: string;
    summary?: string;
    minimum?: number;
    maximum?: number;
  };
};

interface OmniComponentMeta {
  source?: {
    title?: string;
    website?: string;
    links?: Record<string, string>;
    citation?: string;
    authors?: string[];
    summary?: string;
  };
}

interface OmniIOBase {
  name: string;
  title: string;
  hidden?: boolean;
  minimum?: number;
  maximum?: number;
  step?: number;
  required?: boolean;
  readonly?: boolean;
  choices?:
    | Array<{ value: any; title: string; description?: string }>
    | string[]
    | { block: any; map: any; cache?: 'global' | 'user' };
  description: string;
  default?: any;
  customData?: any;
  conditions?: {
    show: string;
  };
}

interface ICustomSocketOpts {
  array?: boolean;
  format?: string;
  customSettings?: Record<string, any>;
  customAction?: { action: string; args: any };
}

interface OmniIO extends OmniIOBase {
  type: string;
  dataTypes: DataType[]; // Change from singular dataType to array dataTypes
  source: OmniIOSource; // Add the source property
  customSocket?: string;
  socketOpts?: ICustomSocketOpts;
  scripts?: Record<string, any>;
  control?: Partial<OmniControl>;
  allowMultiple?: boolean;
}

interface OmniControl extends OmniIOBase {
  controlType: string;
  dataType?: string;
  placeholder?: string;
  displays?: string;
}

enum OmniComponentMacroTypes {
  EXEC = 'exec',
  BUILDER = 'builder',
  ON_SAVE = 'save'
}

enum OmniComponentFlags {
  NO_EXECUTE = 1, // Does not execute code as part of a workflow run
  HAS_NATIVE_CODE = 2, // Has native code blocks
  UNIQUE_PER_WORKFLOW = 3 // Only one instance of this component is allowed per workflow
}

enum OmniExecutionFlags {
  TRACE = 2
}

interface OmniAPIKey {
  id: string;
  displayName: string;
  type: 'string' | 'oauth2';
  in?: string;
}

interface OmniAPIAuthenticationScheme {
  type: 'http_basic' | 'http_bearer' | 'apiKey' | 'oauth2';
  isOptional?: boolean;
  requireKeys?: OmniAPIKey[];
  oauth?: {
    authorizationCode?: {
      authorizationUrl: string;
      tokenUrl: string;
      refreshUrl?: string;
      scopes: string[];
    };
  };
}
interface OmniComponentPatch {
  origin?: string;
  hash?: string;
  apiOperationId: string;
  apiNamespace: string;
  displayNamespace: string;
  displayOperationId: string;
  macros?: Record<string, any[]>;
  scripts?: {
    'hideExcept:inputs'?: string[];
    'hideExcept:outputs'?: string[];
    'transform:input'?: string[];
    'transform:output'?: string[];
  };
  title?: string;
  category?: string;
  tags?: string[];
  customData?: Record<string, any>;
  description?: string;
  meta?: OmniComponentMeta;
  inputs?: Record<string, OmniIO>; // Change from array to object
  controls?: Record<string, OmniControl>; // Change from array to object
  outputs?: Record<string, OmniIO>; // Change from array to object
}

interface OmniComponentFormat {
  type: string;
  hash?: string;
  dependsOn?: string[];
  origin?: string;
  apiOperationId: string;
  apiNamespace: string;
  displayNamespace: string;
  displayOperationId: string;
  xOmniEnabled?: boolean;
  errors: string[];
  title: string;
  method: string;
  description: string;
  urlPath: string;
  meta?: OmniComponentMeta;
  inputs: Record<string, OmniIO>; // Change from array to object
  controls: Record<string, OmniControl>; // Change from array to object
  outputs: Record<string, OmniIO>; // Change from array to object
  tags: string[];
  category?: string;
  requestContentType?: string;
  responseContentType: string;
  credentials?: string;
  validator?: string;
  security?: OmniAPIAuthenticationScheme[];
  renderTemplate?: string;
  flags: number; //OmniComponentFlags
  customData: Record<string, any>;
  scripts?: {
    'hideExcept:inputs'?: string[];
    'hideExcept:outputs'?: string[];
    'transform:input'?: string[];
    'transform:output'?: string[];
  };
  /*apiDefaults:
  {
    timeout?: number
  }*/
  macros?: {
    [OmniComponentMacroTypes.EXEC]?: Function | string;
    [OmniComponentMacroTypes.BUILDER]?: Function | string;
    [OmniComponentMacroTypes.ON_SAVE]?: Function | string;
  };
}

interface OmniNamespaceDefinitionBase {
  namespace: string;
  title: string;
  version?: string;
  info?: OmniNSInfo;
}

interface OmniNSInfo {
  websiteUrl?: string;
  description?: string;
  license?: string;
  email?: string;
  signUpUrl?: string;
}

/**
 * Defines the structure of an Omni namespace definition.
 */
interface OmniNamespaceDefinition extends OmniNamespaceDefinitionBase {
  api?: {
    url?: string;
    spec?: string;
    json?: string;
    credentials?: any;
    basePath: string;
    allowCustomUrl?: boolean;
    patch?: any;
    auth?: OmniAPIAuthenticationScheme;
    componentType?: string;
  };
  filter?: { operationIds: string[]; methods: string[] };
}

interface IJobContext {
  session?: Partial<{ sessionId: string }>;
  sessionId: string;
  user?: any;
  userId: string;
  jobId: string;
  workflowId: string;
  args: any;
  flags?: number;
}

class JobContext implements IJobContext {
  _app: any;
  //session?: Partial<{ sessionId: string }>
  data: {
    sessionId: string;
    userId: string;
    jobId: string;
    workflowId: string;
    args: any;
    flags?: number;
  };

  constructor(app: any, config: IJobContext) {
    this._app = app;
    //this.session = config.session
    this.data = config;
  }

  get app(): any {
    return this._app;
  }

  get sessionId(): string {
    return this.data.sessionId;
  }

  get userId(): string {
    return this.data.userId;
  }

  get jobId(): string {
    return this.data.jobId;
  }

  get workflowId(): string {
    return this.data.workflowId;
  }

  get args(): any {
    return this.data.args;
  }

  get flags(): number {
    return this.data.flags ?? 0;
  }

  setJobId(jobId: string) {
    this.data.jobId = jobId;
  }

  setFlags(flags: OmniExecutionFlags[]) {
    this.data.flags = FlagTool.create<OmniExecutionFlags>(this.data.flags).setFlags(flags);
  }

  setFlag(flag: OmniExecutionFlags, value: boolean = true) {
    this.data.flags = FlagTool.create<OmniExecutionFlags>(this.data.flags).setFlag(flag, value);
  }

  static create(app: any, config: IJobContext) {
    return new JobContext(app, config);
  }

  toJSON(): IJobContext {
    const clone = JobContext.create(this.app, JSON.parse(JSON.stringify({ data: this.data })));
    return clone;
  }

  getData() {
    return JSON.parse(JSON.stringify(this.data));
  }
}

interface WorkerNodeData {
  id: number;
  data: any;
  inputs: WorkerInputs;
  outputs: WorkerOutputs;
}

interface IWorkerContext {
  node: NodeData;
  app: any;
  engine: any;
  args: any;
  flags?: OmniExecutionFlags;
}

class WorkerContext implements IWorkerContext {
  _app: any;
  _engine: any;

  //session?: Partial<{ sessionId: string }>
  jobData: IJobContext;
  _node: WorkerNodeData;

  constructor(app: any, engine: any, node: WorkerNodeData, jobContext: IJobContext) {
    this._app = app;
    this._engine = engine;
    //this.session = config.session
    this.jobData = jobContext;
    this._node = node;
    this._node.inputs = JSON.parse(JSON.stringify(node.inputs)); // deref inputs to avoid upstream pollution
  }

  get app(): any {
    return this._app;
  }

  get engine(): any {
    return this._engine;
  }

  getData() {
    return JSON.parse(JSON.stringify(this.jobData));
  }

  get node(): any {
    return this._node;
  }

  get sessionId(): string {
    return this.jobData.sessionId;
  }

  get userId(): string {
    return this.jobData.userId;
  }

  get jobId(): string {
    return this.jobData.jobId;
  }

  get workflowId(): string {
    return this.jobData.workflowId;
  }

  get args(): any {
    return this.jobData.args;
  }

  set args(value: string) {
    this.jobData.args = value;
  }

  get inputs(): WorkerInputs {
    return this?.node?.inputs || [];
  }

  get outputs(): WorkerOutputs {
    return this.node.outputs;
  }

  setOutputs(outputs: WorkerOutputs) {
    this.node.outputs = outputs;
  }

  static create(app: any, engine: any, node: WorkerNodeData, jobContext: IJobContext) {
    return new WorkerContext(app, engine, node, jobContext);
  }

  dispose() {
    delete this._app;
  }
}

class FlagTool<T> {
  private data: number;

  constructor(val: number = 0) {
    this.data = val;
  }

  static create<T>(val: number = 0) {
    return new FlagTool<T>(val);
  }

  setFlags(flags: T[]): number {
    flags.map((flag) => this.setFlag(flag));
    return this.data;
  }

  setFlag(flag: T, value: boolean = true): number {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const mask = 1 << (<number>flag);

    if (value) {
      // Set the bit using bitwise OR
      this.data = this.data | mask;
      return this.data;
    } else {
      // Unset the bit using bitwise AND with the inverted mask
      this.data = this.data & ~mask;
      return this.data;
    }
  }
}

export type {
  DataType,
  ICustomSocketOpts,
  DefaultValue,
  ExtendedParameterObject,
  OmniComponentFormat,
  OmniComponentMeta,
  OmniComponentPatch,
  OmniControl,
  OmniIO,
  OmniIOType,
  OmniNSInfo,
  OmniNamespaceDefinition,
  OmniNamespaceDefinitionBase,
  OperationRecord,
  IWorkerContext,
  IJobContext,
  OmniIOSource,
  OmniAPIAuthenticationScheme,
  OmniAPIKey
};

export { OmniComponentMacroTypes, OmniComponentFlags, OmniExecutionFlags, JobContext, WorkerContext, FlagTool };
