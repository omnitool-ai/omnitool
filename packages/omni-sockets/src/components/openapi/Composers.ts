/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { Control } from 'rete';
import {
  type OmniComponentFormat,
  type OmniComponentPatch,
  type OmniComponentMeta,
  type OmniComponentMacroTypes,
  type OmniControl,
  type OmniIO,
  type OmniIOType,
  OmniComponentFlags,
  type ICustomSocketOpts
} from './types';

type ChoicesType =
  | { block: any; map: any; cache?: any }
  | string[]
  | Array<{ title: string; value: string | number; description?: string }>;

function SimplifyChoices(choices: ChoicesType): ChoicesType {
  if (Array.isArray(choices)) {
    if (choices.length === 0) {
      return [];
    }

    if (typeof choices[0] === 'string') {
      return (choices as string[]).map((v) => ({ title: v, value: v }));
    }

    if (typeof choices[0] === 'object' && 'title' in choices[0] && 'value' in choices[0]) {
      return choices; // Already correct format.
    }
  }

  if (typeof choices === 'object' && 'block' in choices && 'map' in choices) {
    // choices.cache is optional.
    return choices;
  }

  // throw new Error('Invalid choices format')

  return choices;
}

class IOComposer {
  data: Partial<OmniIO>;
  constructor() {
    this.data = {};
  }

  create(
    name: string,
    ioType: OmniIOType,
    type: string,
    customSocket?: string,
    socketOpts?: ICustomSocketOpts
  ): IOComposer {
    this.data.name = name;

    this.data.customSocket = customSocket;
    this.data.socketOpts = { ...socketOpts };
    if (type === 'array') {
      type = 'object';
      this.data.socketOpts.array = true;
    }
    this.data.type = type;

    this.data.dataTypes = [type as any];
    this.data.customData = {};
    this.data.title = name;
    this.data.source = { sourceType: ioType === 'input' ? 'requestBody' : 'responseBody' };
    return this;
  }

  setRequired(required: boolean): IOComposer {
    this.data.required = required;
    return this;
  }

  setHidden(hidden: boolean): IOComposer {
    this.data.hidden = hidden;
    return this;
  }

  set(key: 'title' | 'description', value: string): IOComposer {
    this.data[key] = value;
    return this;
  }

  setFormat(format: string): IOComposer {
    this.data.format = format;
    return this;
  }

  setDefault(defaultValue: any): IOComposer {
    this.data.default = defaultValue;
    return this;
  }

  setControl(ctl: Partial<OmniControl>): IOComposer {
    ctl.dataType = this.data.type;
    this.data.control = ctl;
    return this;
  }

  allowMultiple(enable: boolean = true): IOComposer {
    this.data.allowMultiple = enable;
    this.data.socketOpts!.array = true;
    return this;
  }

  setConstraints(minimum?: number, maximum?: number, step?: number): IOComposer {
    this.data.minimum = minimum;
    this.data.maximum = maximum;
    this.data.step = step;
    return this;
  }

  setChoices(choices: ChoicesType, defaultValue?: string | number): IOComposer {
    if (defaultValue != null) {
      this.data.default = defaultValue;
    }

    if (choices != null) {
      this.data.choices = SimplifyChoices(choices);
      if (!this.data.choices) {
        this.data.choices = [{ title: '(default)', value: defaultValue ?? '' }];
      }
    }
    return this;
  }

  setCustom(key: string, value: any) {
    this.data.customData[key] = value;
    return this;
  }

  toOmniIO(): OmniIO {
    this.data.title ??= this.data.name;
    return this.data as OmniIO;
  }
}

class ControlComposer {
  data: Partial<OmniControl>;
  constructor(name: string) {
    this.data = { name };
    this.data.customData = {};
  }

  create(name: string, dataType?: string): ControlComposer {
    this.data.name = name;
    this.data.dataType = dataType;
    return this;
  }

  setRequired(required: boolean): ControlComposer {
    this.data.required = required;
    return this;
  }

  setHidden(hidden: boolean): ControlComposer {
    this.data.hidden = hidden;
    return this;
  }

  setCustom(key: string, value: any) {
    this.data.customData[key] = value;
    return this;
  }

  setControlType(controlType: string): ControlComposer {
    this.data.controlType = controlType;
    return this;
  }

  set(key: 'title' | 'description' | 'placeholder' | 'displays', value: string): ControlComposer {
    this.data[key] = value;
    return this;
  }

  setChoices(choices: ChoicesType, defaultValue?: string | number): ControlComposer {
    this.data.default = defaultValue;
    this.data.choices = SimplifyChoices(choices);

    if (!this.data.choices) {
      this.data.choices = [{ title: '(default)', value: defaultValue ?? '' }];
    }
    return this;
  }

  setReadonly(readonly: boolean): ControlComposer {
    this.data.readonly = readonly;
    return this;
  }

  setConstraints(minimum?: number, maximum?: number, step?: number): ControlComposer {
    if (minimum != null) this.data.minimum = minimum;
    if (maximum != null) this.data.maximum = maximum;
    if (step != null) this.data.step = step;
    return this;
  }

  setDefault(defaultValue: any): ControlComposer {
    this.data.default = defaultValue;
    return this;
  }

  toOmniControl(): OmniControl {
    this.data.title ??= this.data.name;
    return this.data as OmniControl;
  }
}

class BaseComposer<T> {
  data: Partial<T>;

  constructor() {
    this.data = {};
  }

  fromJSON(config: T): BaseComposer<T> {
    this.data = JSON.parse(JSON.stringify(config));
    return this;
  }
}

class ComponentComposer extends BaseComposer<OmniComponentFormat> {
  constructor() {
    super();

    this.data.type = 'OAIComponent31';
    this.data.flags = 0;
    this.data.macros = {};
    this.data.origin = 'omnitool:Composer';
    this.data.customData = {};
  }

  dependsOn(dependsOn: string[]): ComponentComposer {
    this.data.dependsOn = dependsOn;
    return this;
  }

  fromScratch(): ComponentComposer {
    this.data.apiNamespace = this.data.displayNamespace;
    this.data.apiOperationId = this.data.displayOperationId;
    this.data.responseContentType = 'application/json';
    this.data.category = 'Utilities';
    this.data.tags = ['default'];
    return this;
  }

  createInput(name: string, type: string, customSocket?: string, socketOpts?: ICustomSocketOpts): IOComposer {
    const ret = new IOComposer().create(name, 'input', type, customSocket, socketOpts || {});
    return ret;
  }

  addInput(input: OmniIO): ComponentComposer {
    this.data.inputs = this.data.inputs ?? {};
    this.data.inputs[input.name] = input;
    return this;
  }

  createOutput(name: string, type: string, customSocket?: string, socketOpts?: ICustomSocketOpts): IOComposer {
    const ret = new IOComposer().create(name, 'output', type, customSocket, socketOpts || {});
    return ret;
  }

  addOutput(output: OmniIO): ComponentComposer {
    this.data.outputs = this.data.outputs ?? {};
    this.data.outputs[output.name] = output;
    return this;
  }

  setTags(tags: string[]): ComponentComposer {
    this.data.tags = tags;
    return this;
  }

  setRenderTemplate(template: string): ComponentComposer {
    this.data.renderTemplate = template;
    return this;
  }

  create(displayNamespace: string, displayOperationId: string): ComponentComposer {
    this.data.displayNamespace = displayNamespace;
    this.data.displayOperationId = displayOperationId;
    return this;
  }

  set(key: 'title' | 'description' | 'category', value: string): ComponentComposer {
    this.data[key] = value;
    return this;
  }

  setMethod(method: string): ComponentComposer {
    this.data.method = method;
    return this;
  }

  useAPI(apiNamespace: string, apiOperationId: string) {
    this.data.apiNamespace = apiNamespace;
    this.data.apiOperationId = apiOperationId;
    return this;
  }

  setMeta(meta: OmniComponentMeta): ComponentComposer {
    this.data.meta = meta;
    return this;
  }

  setFlags(flags: number): ComponentComposer {
    this.data.flags = flags;
    return this;
  }

  setFlag(flag: OmniComponentFlags, value: boolean = true): ComponentComposer {
    const mask = 1 << flag;

    if (value) {
      // Set the bit using bitwise OR
      this.data.flags = this.data.flags! | mask;
    } else {
      // Unset the bit using bitwise AND with the inverted mask
      this.data.flags = this.data.flags! & ~mask;
    }
    return this;
  }

  setMacro(macro: OmniComponentMacroTypes, fn: Function): ComponentComposer {
    this.data.macros![macro] = fn;
    if (fn instanceof Function) {
      this.setFlag(OmniComponentFlags.HAS_NATIVE_CODE);
    }

    return this;
  }

  createControl(name: string, dataType?: string): ControlComposer {
    const ret = new ControlComposer(name).create(name, dataType);
    return ret;
  }

  setCustom(key: string, value: any) {
    this.data.customData ??= {};
    this.data.customData[key] = value;
    return this;
  }

  addControl(control: OmniControl): ComponentComposer {
    this.data.controls = this.data.controls ?? {};
    this.data.controls[control.name] = control;
    return this;
  }

  toJSON(): OmniComponentFormat {
    return this.data as OmniComponentFormat;
  }
}

class PatchComposer extends BaseComposer<OmniComponentPatch> {
  constructor() {
    super();

    this.data.macros = {};
    this.data.origin = 'omnitool:Composer';
    this.data.customData = {};
  }

  fromComponent(apiNamespace: string, apiOperationId: string): PatchComposer {
    this.data.apiNamespace = apiNamespace;
    this.data.apiOperationId = apiOperationId;

    return this;
  }

  createInput(name: string, type: string, customSocket?: string): IOComposer {
    const ret = new IOComposer().create(name, 'input', type, customSocket);
    return ret;
  }

  addInput(input: OmniIO): PatchComposer {
    this.data.inputs = this.data.inputs ?? {};
    this.data.inputs[input.name] = input;
    return this;
  }

  createOutput(name: string, type: string, customSocket?: string): IOComposer {
    const ret = new IOComposer().create(name, 'output', type, customSocket);
    return ret;
  }

  addOutput(output: OmniIO): PatchComposer {
    this.data.outputs = this.data.outputs ?? {};
    this.data.outputs[output.name] = output;
    return this;
  }

  create(displayNamespace: string, displayOperationId: string): PatchComposer {
    this.data.displayNamespace = displayNamespace;
    this.data.displayOperationId = displayOperationId;
    return this;
  }

  set(key: 'title' | 'description' | 'category', value: string): PatchComposer {
    this.data[key] = value;
    return this;
  }

  useAPI(apiNamespace: string, apiOperationId: string) {
    this.data.apiNamespace = apiNamespace;
    this.data.apiOperationId = apiOperationId;
    return this;
  }

  setMeta(meta: OmniComponentMeta): PatchComposer {
    this.data.meta = meta;
    return this;
  }

  setCustom(key: string, value: any) {
    this.data.customData ??= {};
    this.data.customData[key] = value;
    return this;
  }

  createControl(name: string): ControlComposer {
    const ret = new ControlComposer(name).create(name);
    return ret;
  }

  addControl(control: OmniControl): PatchComposer {
    this.data.controls = this.data.controls ?? {};
    this.data.controls[control.name] = control;
    return this;
  }

  hideExcept(input: string[], output: string[]) {
    if (input?.length > 0) {
      this.data.scripts = this.data.scripts ?? {};
      this.data.scripts['hideExcept:inputs'] = input;
    }
    if (output?.length > 0) {
      this.data.scripts = this.data.scripts ?? {};
      this.data.scripts['hideExcept:outputs'] = output;
    }
  }

  toJSON(): OmniComponentPatch {
    return this.data as OmniComponentPatch;
  }
}

export { ComponentComposer, IOComposer, PatchComposer };
