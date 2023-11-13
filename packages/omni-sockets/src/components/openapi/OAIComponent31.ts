/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type ValidateFunction } from 'ajv';
import merge from 'deepmerge';
// #v-ifdef MERCENARIES_SERVER=1
// ------------------------------------ SERVER ------------------------------------
import Exp from 'jsonata';
// #v-endif
import * as Rete from 'rete';
import { type WorkerContext } from '../BaseComponent.js';
import SocketManager from '../SocketManager.js';
import {
  OmniComponentMacroTypes,
  type OmniComponentFormat,
  type OmniComponentMeta,
  type OmniComponentPatch,
  type OmniControl,
  type OmniIO,
  type OmniAPIAuthenticationScheme
} from './types.js';
import { ComponentComposer, PatchComposer } from './Composers.js';
import OAIControl31 from './OAIControl.js';

// #v-ifdef MERCENARIES_SERVER=1
// ------------------------------------ SERVER ------------------------------------
const deserializeValidator = function (jsString: string): ValidateFunction {
  const eval2 = eval; // https://esbuild.github.io/content-types/#direct-eval
  return eval2('(' + jsString + ')');
};
// #v-endif
// ------------------------------------ SERVER ------------------------------------

abstract class OAIBaseComponent extends Rete.Component {
  data: OmniComponentFormat;

  // #v-ifdef MERCENARIES_SERVER=1
  _validator?: ValidateFunction;
  // #v-endif

  constructor(config: OmniComponentFormat, patch?: OmniComponentPatch) {
    const data = merge(config, patch ?? {});
    super(`${data.displayNamespace}.${data.displayOperationId}`);
    this.data = data;
    this.data.macros ??= {};
    this.data.flags ??= 0;
    this.data.errors ??= [];
    this.data.xOmniEnabled ??= true;

    for (const key in this.data.inputs) {
      this.data.inputs[key].source ??= { sourceType: 'requestBody' };
    }

    for (const key in this.data.outputs) {
      this.data.outputs[key].source ??= { sourceType: 'responseBody' };
    }

    // #v-ifdef MERCENARIES_SERVER=1
    this._validator = config.validator != null ? deserializeValidator(config.validator) : undefined;
    // #v-endif
  }

  static create(displayNamespace: string, displayOperationId: string) {
    const composer = new ComponentComposer();
    return composer.create(displayNamespace, displayOperationId);
  }

  static createPatch(displayNamespace: string, displayOperationId: string) {
    const composer = new PatchComposer();
    return composer.create(displayNamespace, displayOperationId);
  }

  get validator() {
    return this._validator ?? null;
  }

  get title() {
    return this.data.title;
  }

  get description() {
    return this.data.description;
  }

  get scripts() {
    return this.data.scripts;
  }

  get flags() {
    return this.data.flags ?? 0;
  }

  get summary() {
    return this.data.description ?? this.meta.source?.summary;
  }

  get category() {
    return this.data.category ?? 'Base API';
  }

  get custom() {
    return this.data.customData || {};
  }

  get tags() {
    return this.data.tags;
  }

  get apiKey() {
    return `${this.data.apiNamespace}.${this.data.apiOperationId}`;
  }

  get apiNamespace() {
    return this.data.apiNamespace;
  }

  get renderTemplate() {
    return this.data.renderTemplate || 'default';
  }

  get type() {
    return this.data.type ?? 'OAIComponent31';
  }

  get method() {
    return this.data.method;
  }

  get inputs() {
    return this.data.inputs;
  }

  get meta() {
    return this.data.meta ?? {};
  }

  get outputs() {
    return this.data.outputs;
  }

  get macros() {
    return this.data.macros;
  }

  get hash(): string | undefined {
    return this.data.hash;
  }

  get controls() {
    return this.data.controls;
  }

  get xOmniEnabled() {
    return this.data.xOmniEnabled ?? true;
  }

  set xOmniEnabled(enabled: boolean) {
    this.data.xOmniEnabled = enabled;
  }

  setType(type: string): this {
    this.data.type = type;
    return this;
  }

  setApiOperationId(apiOperationId: string): this {
    this.data.apiOperationId = apiOperationId;
    return this;
  }

  setApiNamespace(apiNamespace: string): this {
    this.data.apiNamespace = apiNamespace;
    return this;
  }

  setDisplayNamespace(displayNamespace: string): this {
    this.data.displayNamespace = displayNamespace;
    return this;
  }

  setDisplayOperationId(displayOperationId: string): this {
    this.data.displayOperationId = displayOperationId;
    return this;
  }

  setTitle(title: string): this {
    this.data.title = title;
    return this;
  }

  setMethod(method: string): this {
    this.data.method = method;
    return this;
  }

  setDescription(description: string): this {
    this.data.description = description;
    return this;
  }

  setUrlPath(urlPath: string): this {
    this.data.urlPath = urlPath;
    return this;
  }

  setMeta(meta: OmniComponentMeta): this {
    this.data.meta = meta;
    return this;
  }

  addInput(name: string, input: OmniIO): this {
    this.data.inputs[name] = input;
    return this;
  }

  addControl(name: string, control: OmniControl): this {
    this.data.controls[name] = control;
    return this;
  }

  addOutput(name: string, output: OmniIO): this {
    this.data.outputs[name] = output;
    return this;
  }

  addTag(tag: string): this {
    this.data.tags.push(tag);
    return this;
  }

  setCategory(category: string): this {
    this.data.category = category;
    return this;
  }

  setRequestContentType(requestContentType: string): this {
    this.data.requestContentType = requestContentType;
    return this;
  }

  setResponseContentType(responseContentType: string): this {
    this.data.responseContentType = responseContentType;
    return this;
  }

  setCredentials(credentials: string): this {
    this.data.credentials = credentials;
    return this;
  }

  setValidator(validator: string): this {
    this.data.validator = validator;
    return this;
  }

  addSecurity(spec: OmniAPIAuthenticationScheme): this {
    this.data.security = this.data.security ?? [];
    this.data.security.push(spec);
    return this;
  }

  setMacro(macro: OmniComponentMacroTypes, fn: Function): this {
    this.data.macros![macro] = fn;
    return this;
  }

  pickDefaultControl(obj: {
    control?: { controlType?: string };
    controlType?: string;
    choices?: any;
    step?: number;
    type?: string;
    minimum?: number;
    maximum?: number;
    customSocket?: string;
  }): string {
    if (obj.choices != null) {
      return 'AlpineSelectComponent';
    }

    if (obj.control?.controlType != null) {
      return obj.control?.controlType;
    }
    if (obj.controlType != null) {
      return obj.controlType;
    }

    if (
      obj.step != null ||
      (obj.minimum != null && obj.maximum != null && Math.abs(obj.maximum - obj.minimum) <= 100)
    ) {
      if (obj.type === 'float') {
        obj.step ??= 0.1;
      }
      return 'AlpineNumWithSliderComponent';
    }

    const objType = obj.type;
    if (objType === null) {
      omnilog.warn('Null Object Type');
    }

    const customSocket = obj.customSocket;

    if (
      customSocket &&
      ['imageArray', 'image', 'document', 'documentArray', 'audio', 'file', 'audioArray', 'fileArray'].includes(
        customSocket
      )
    ) {
      return 'AlpineLabelComponent';
    }

    if (objType === 'number' || objType === 'integer' || objType === 'float') {
      return 'AlpineNumComponent';
    } else if (objType === 'boolean') {
      return 'AlpineToggleComponent';
    } else if (objType === 'error') {
      return 'AlpineTextComponent';
    } else if (objType === 'object') {
      return 'AlpineCodeMirrorComponent';
    }

    if (objType === 'string' || customSocket === 'text') {
      return 'AlpineTextComponent';
    }

    return 'AlpineLabelComponent';
  }

  abstract toJSON(): any;

  abstract _builder(node: CustomReteNode): Promise<void>;

  async builder(node: CustomReteNode): Promise<void> {
    node.title = this.title;
    node.description = this.description;

    await this._builder?.(node);
  }

  abstract _workerStart(inputData: any, ctx: WorkerContext): Promise<void>;

  async workerStart(inputData: any, ctx: WorkerContext) {
    // #v-ifdef MERCENARIES_SERVER=1
    // ------------------------------------ SERVER ------------------------------------
    try {
      await this._workerStart?.(inputData, ctx);
    } catch (error: any) {
      omnilog.error('Error in component worker', error);
      // @ts-ignore
      const payload = {
        type: 'error',
        node_id: ctx.node.id,
        error: error?.message || 'Error',
        componentKey: this.name,
        sessionId: ctx.sessionId
      };
      // ctx.app.verbose('SSE:control:setValue', payload)
      await ctx.app.emit('sse_message', payload);

      ctx.outputs.error = error;
      return ctx.outputs;
    }
    return ctx.outputs;
    // ------------------------------------ SERVER ------------------------------------
    // #v-endif
  }

  async setControlValue(controlId: string, value: any, ctx: any) {
    if (this.data.controls[controlId] == null) {
      omnilog.warn(
        this.name,
        'tried to update non existing control',
        controlId,
        ' - suppressed.\nPlease check your component for a setComponentValue call that passes in a non existing control key.'
      );
      return;
    }

    // On the client, we update the display (editor does not exist on server context)
    if (this.editor != null) {
      // @ts-ignore
      const ctl = this.editor?.nodes.find((n) => n.id === ctx.node.id).controls.get(controlId) ?? null;
      if (ctl != null) {
        (ctl as OAIControl31).setValue(value);
      }
    }
    // #v-ifdef MERCENARIES_SERVER=1
    // ------------------------------------ SERVER ------------------------------------
    // On the server, we trigger a message to the client.
    /* server */
    else {
      // TODO:  [session-management] Raise this as an event.
      if (ctx?.app && ctx.node && ctx.sessionId) {
        const payload = {
          type: 'control:setvalue',
          node_id: ctx.node.id,
          controlId,
          value,
          componentKey: this.name,
          sessionId: ctx.sessionId
        };
        // ctx.app.verbose('SSE:control:setValue', payload)
        await ctx.app.emit('sse_message', payload);
      }
    }
    // ------------------------------------ SERVER ------------------------------------
    // #v-endif
  }

  async sendStatusUpdate(message: string, scope: string, ctx: any) {
    // #v-ifdef MERCENARIES_SERVER=1
    // ------------------------------------ SERVER ------------------------------------
    const payload = { node_id: ctx.node.id, block: this.name, message, scope };
    const msg = ctx.app.io.composeMessage('block:status').from('server').to(ctx.sessionId).body(payload).toMessage();

    await ctx.app.io.send(ctx.sessionId, msg);
    // ------------------------------------ SERVER ------------------------------------
    // #v-endif
  }
}

class CustomReteNode extends Rete.Node {
  public title?: string;
  public description?: string;
  public renderTemplate?: string;
  public category?: string;
  public namespace?: string;
  public summary?: string;
  public enabled?: boolean;
  public xOmniEnabled?: boolean;
  public errors?: string[];

  constructor(name: string) {
    super(name);
  }
}

class OAIComponent31 extends OAIBaseComponent {
  constructor(config: OmniComponentFormat, patch?: OmniComponentPatch, fns?: any) {
    if (fns) {
      omnilog.warn('fns not implemented');
    }
    super(config, patch);
  }

  getSocketForIO(io: OmniIO): Rete.Socket {
    let socket = 'object';
    if (io.customSocket) {
      socket = io.customSocket;
    } else if (io.type != null && typeof io.type === 'string') {
      socket = io.type;
    } else if (io.dataTypes?.length > 0) {
      socket = io.dataTypes[0];
    } else if (io.step != null || io.maximum != null || io.minimum != null) {
      socket = 'number';
    }

    //    return SocketManager.getSingleton().getSocketFromString(socket)
    return SocketManager.getSingleton().getOrCreateSocket(socket, io.socketOpts || {});
  }

  async _redraw(node: CustomReteNode): Promise<void> {}

  enumerateInputs(node: CustomReteNode): Record<string, OmniIO> {
    return Object.assign({}, node.data['x-omni-dynamicInputs'] || {}, this.data.inputs);
  }

  enumerateOutputs(node: CustomReteNode): Record<string, OmniIO> {
    return Object.assign({}, node.data['x-omni-dynamicOutputs'] || {}, this.data.outputs);
  }

  async _builder(node: CustomReteNode): Promise<void> {
    node.category = this.category;
    node.renderTemplate = this.renderTemplate;

    node.title = (node.data['x-omni-title'] as string) || this.title;
    node.summary = (node.data['x-omni-summary'] as string) || this.summary;

    node.namespace = this.data.displayNamespace ?? this.data.apiNamespace;

    node.meta = this.meta as Record<string, unknown>;
    node.meta.title = this.title ?? this.summary;
    node.errors = this.data.errors;

    const inputs = this.enumerateInputs(node);
    // create all inputs
    for (const key in inputs) {
      const io: OmniIO = inputs[key];
      io.name ??= key;
      io.title ??= key;

      const ctlType = this.pickDefaultControl(io);

      const control = await OAIControl31.fromIO(ctlType, io, this.editor);

      if (!io.hidden) {
        if (io.readonly) {
          // ReadOnly nodes get changed to controls
          node.addControl(control);
        } else {
          const input: Rete.Input = new Rete.Input(key, io.title || io.name, this.getSocketForIO(io), io.allowMultiple);
          input.name ??= key;
          input.addControl(control);
          node.addInput(input);
        }
      }
    }

    // create all controls
    for (const key in this.controls) {
      const ctl: OmniControl = this.controls[key];
      if (!ctl.hidden) {
        ctl.name ??= key;

        ctl.controlType ??= this.pickDefaultControl(ctl);
        const control = await OAIControl31.fromControl(ctl, this.editor);

        node.addControl(control);
      }
    }

    const outputs = this.enumerateOutputs(node);
    // create all outputs
    for (const key in outputs) {
      const io: OmniIO = { ...outputs[key], name: key, title: outputs[key].title ?? key };

      if (!io.hidden) {
        const output: Rete.Output = new Rete.Output(key, io.title || io.name, this.getSocketForIO(io));
        output.name ??= key;
        node.addOutput(output);
      }
    }
  }

  async runXFunction(ctx: WorkerContext, method: string, payload: any): Promise<any> {
    let response: any = null;
    // #v-ifdef MERCENARIES_SERVER=1
    // ------------------------------------ SERVER ------------------------------------
    if (method === 'X-CUSTOM') {
      const exec = ctx.app.blocks.getMacro(this, OmniComponentMacroTypes.EXEC);
      if (!exec) {
        throw new Error('Block Error: X-CUSTOM macro is not defined for block' + this.name);
      }

      try {
        response = exec != null ? await exec.apply(this, [payload, ctx, this]) : null;
      } catch (ex: any) {
        if (ex.message.includes('Free time limit reached')) {
          // replicate.com, 2023-10
          throw ex;
        }
        throw new Error(`Error executing X-CUSTOM for block ${this.name}: ${ex.message}`);
      }
    }
    // X-NOOP: Do nothing
    else if (this.method === 'X-NOOP') {
      response = {};
    }
    // X-PASSTHROUGH: Pass the payload through
    else if (this.method === 'X-PASSTHROUGH') {
      response = JSON.parse(JSON.stringify(payload));
    }
    // #v-endif
    return response;
  }

  async _workerStart(inputData: any, ctx: WorkerContext): Promise<any> {
    // #v-ifdef MERCENARIES_SERVER=1
    // ------------------------------------ SERVER ------------------------------------
    let payload: any = await this.getPayload(ctx);
    payload = await this.runInputScripts(payload, ctx);
    const { requestBody, parameters } = this.getRequestComponents(payload, ctx);

    omnilog.log(this.name, 'requestBody', requestBody);
    omnilog.log(this.name, 'parameters', parameters);

    // Input Validation: If a validator function exists, execute it
    if (this.validator != null) {
      const isValid = this._validator?.(payload);
      const errors = this._validator?.errors ?? [];
      return { isValid, errors };
    }

    let response;

    // Custom Functions
    if (this.method.startsWith('X-')) {
      response = await this.runXFunction(ctx, this.method, payload);

      if (response === undefined) {
        response = { error: 'Internal error, `runXFunction` did not return a valid response object.' };
      }
    }
    // Everything Else is a standard API call
    else {
      response = await ctx.app.api2.execute(
        this.apiKey,
        requestBody,
        { params: parameters, responseContentType: this.data.responseContentType },
        { user: ctx.userId, sessionId: ctx.sessionId, jobId: ctx.jobId }
      );

      if (response === undefined) {
        response = { error: 'Internal error, `api2.execute` did not return a valid response object.' };
      }
    }

    if (typeof response === 'string') {
      response = { result: response };
    }

    //TODO: If there were errors, should we still run output scripts?
    response = await this.runOutputScripts(response, ctx);

    ctx.setOutputs(response);

    return response;

    // #v-endif
  }

  async runInputScripts(payload: any, ctx: WorkerContext): Promise<any> {
    // #v-ifdef MERCENARIES_SERVER=1
    // ------------------------------------ SERVER ------------------------------------

    // Controls that are macro'd with a .display property
    for (const key in this.controls) {
      const control = this.controls[key];
      if (control.displays?.startsWith('input:')) {
        const content = control.displays.replace('input:', '');
        await this.setControlValue(key, payload[content], ctx);
      }
    }
    const inputs = this.enumerateInputs(ctx.node);
    for (const key in inputs) {
      const input = inputs[key];

      // run jsonata script
      if (input.scripts) {
        if (input.scripts.jsonata) {
          const expression = Exp(input.scripts.jsonata);
          try {
            payload[key] = await expression.evaluate(payload);
          } catch (ex: any) {
            throw new Error(`Error evaluating jsonata expression: ${input.scripts.jsonata} - ${ex.message}`);
          }
        }

        // delete script - remove fields from payload
        if (input.scripts.delete) {
          for (const field of input.scripts.delete) {
            delete payload[field];
          }
        }
      }
    }

    //  JSONATA global transform
    const transforms = this.scripts?.['transform:input'];
    if (transforms) {
      if (Array.isArray(transforms) && transforms.length > 0) {
        transforms.forEach((script: string) => {
          omnilog.log('global jsonata');
          const expression = Exp(script);
          payload = expression.evaluate(payload);
        });
      }
    }
    //#v-endif
    // --------------------------------------------------------------------------------------------

    return payload;
  }

  async runOutputScripts(payload: any, ctx: WorkerContext): Promise<any> {
    // --------------------------------------------------------------------------------------------
    // #v-ifdef MERCENARIES_SERVER=1

    const socketManager = SocketManager.getSingleton();

    // TODO: Custom Socket Processing

    if (this.outputs?._omni_result) {
      payload = { _omni_result: payload };
    }
    const outputs = this.enumerateOutputs(ctx.node);
    for (const key in outputs) {
      const output = outputs[key];

      // run jsonata script
      if (output.scripts) {
        if (output.scripts.jsonata) {
          omnilog.log('running jsonata', output.scripts.jsonata);
          const expression = Exp(output.scripts.jsonata);
          try {
            payload[key] = await expression.evaluate(payload);
          } catch (ex: any) {
            throw new Error(`Error evaluating jsonata expression: ${output.scripts.jsonata} - ${ex.message}`);
          }
        }

        // delete script - remove fields from payload
        if (output.scripts.delete) {
          omnilog.log('running delete', output.scripts.jsonata);
          for (const field of output.scripts.delete) {
            delete payload[field];
          }
        }
      }

      if (payload[key]) {
        if (output.customSocket) {
          const sock = socketManager.getOrCreateSocket(output.customSocket, output.socketOpts || {});
          payload[key] = sock ? await sock?.handleOutput?.(ctx, payload[key]) : payload[key];
        }
      }
    }

    // Controls that are macro'd with a .display property
    for (const key in this.controls) {
      const control = this.controls[key];
      if (control.displays?.startsWith('output:')) {
        const content = control.displays.replace('output:', '');
        await this.setControlValue(key, payload[content], ctx);
      }
    }
    //#v-endif
    // --------------------------------------------------------------------------------------------
    return payload;
  }

  getRequestComponents(payload: any, ctx: WorkerContext): { requestBody: any; parameters: any[] } {
    const requestBody: any = {};
    const parameters = [];

    // #v-ifdef MERCENARIES_SERVER=1
    // ------------------------------------ SERVER ------------------------------------
    const inputs = this.enumerateInputs(ctx.node);
    for (const key in payload) {
      const value = payload[key];
      const source = inputs[key]?.source;

      if (!source || source.sourceType === 'requestBody') {
        requestBody[key] = value;
      } else {
        if (source.sourceType === 'parameter') {
          const param = {
            name: key,
            in: source.in,
            value
          };
          parameters.push(param);
        }
      }
    }
    // ------------------------------------ SERVER ------------------------------------
    // #v-endif
    return { requestBody, parameters };
  }

  prunePayload(input: OmniIO, payload: any, key: string) {
    // #v-ifdef MERCENARIES_SERVER=1
    // ------------------------------------ SERVER ------------------------------------

    const value = payload[key];

    if (value === undefined || value === null) {
      delete payload[key];
      return;
    }

    if (input.type === 'string' && value.length === 0 && input.required !== true) {
      delete payload[key];
    } else if (input.type === 'array' && value.length === 0 && input.required !== true) {
      delete payload[key];
    } else if (input.type === 'object' && Object.keys(value).length === 0 && input.required !== true) {
      delete payload[key];
    } else if ((input.type === 'number' || input.type === 'integer') && value === 'inf') {
      payload[key] = Infinity;
    }

    // ------------------------------------ SERVER ------------------------------------
    // #v-endif
  }

  async getPayload(ctx: WorkerContext): Promise<any> {
    const payload: any = {};

    // #v-ifdef MERCENARIES_SERVER=1
    // ------------------------------------ SERVER ------------------------------------
    const inputs = this.enumerateInputs(ctx.node);
    for (const key in inputs) {
      const input = inputs[key];
      const inputValue = ctx.inputs[key] as any[];
      let value;
      if (input.allowMultiple) {
        value = inputValue?.flat?.() ?? ctx.node.data[key] ?? input.default;
      } else {
        value = inputValue?.[0] ?? ctx.node.data[key] ?? input.default;
        if (input.dataTypes?.[0] === 'integer' && value === '') {
          value = input.default; // replicate.com, 2023-10
        }
      }
      const socketManager = SocketManager.getSingleton();

      payload[key] = value;

      this.prunePayload(input, payload, key);

      if (payload[key] !== null && payload[key] !== undefined) {
        if (input.customSocket) {
          const sock = socketManager.getOrCreateSocket(input.customSocket, input.socketOpts || {});
          payload[key] = sock ? await sock?.handleInput?.(ctx, payload[key]) : payload[key];
        }
      }
    }
    for (const key in this.controls) {
      const value = ctx.node.data[key] ?? this.controls[key].default;
      if (value != null && !this.controls[key].displays) {
        payload[key] = value;
      }
    }

    // ------------------------------------ SERVER ------------------------------------
    // #v-endif
    return JSON.parse(JSON.stringify(payload));
  }

  worker() {
    throw new Error('This should never be called');
  }

  static fromJSON(json: any, patch?: any): OAIComponent31 {
    const comp = new OAIComponent31(json, patch);
    if (!comp.name) {
      throw new Error();
    }
    return comp;
  }

  toJSON() {
    return JSON.parse(JSON.stringify({ ...this.data, name: this.name }));
  }
}

export { OAIBaseComponent, OAIComponent31, OAIControl31 };
