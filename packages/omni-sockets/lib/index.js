// src/components/WorkflowClientControlManager.ts
var WorkflowClientControlManager = class _WorkflowClientControlManager {
  constructor() {
    this.controls = /* @__PURE__ */ new Map();
  }
  add(key, clientControlType) {
    this.controls.set(key, clientControlType);
  }
  get(id) {
    return this.controls.get(id);
  }
  has(id) {
    return this.controls.has(id);
  }
  static getInstance() {
    if (_WorkflowClientControlManager.instance == null) {
      _WorkflowClientControlManager.instance = new _WorkflowClientControlManager();
    }
    return _WorkflowClientControlManager.instance;
  }
};

// src/components/openapi/OAIComponent31.ts
import merge from "deepmerge";
import Exp from "jsonata";
import * as Rete2 from "rete";

// src/components/Sockets/CustomSocket.ts
import { Socket } from "rete";
var CustomSocket = class extends Socket {
  constructor(name, type, opts) {
    super(name, opts);
    this.customActions = /* @__PURE__ */ new Map();
    this.opts = opts || {};
    this.type = type;
  }
  get format() {
    return this.opts.format;
  }
  get array() {
    return this.opts.array || false;
  }
  get customAction() {
    return this.opts.customAction;
  }
  get customSettings() {
    return this.opts.customSettings;
  }
  compatibleWith(socket, noReverse = false) {
    if (noReverse)
      return super.compatibleWith(socket);
    return socket.compatibleWith(this, true);
  }
  isValidUrl(str) {
    let url;
    if (!(typeof str === "string" && str.length > 0)) {
      return false;
    }
    try {
      url = new URL(str);
    } catch (e) {
      return false;
    }
    return url.protocol === "http:" || url.protocol === "https:";
  }
};
var CustomSocket_default = CustomSocket;

// src/components/Sockets/FileObjectSocket.ts
var FileObjectSocket = class _FileObjectSocket extends CustomSocket_default {
  compatibleWith(socket, noReverse) {
    const cs = this;
    if (cs.type) {
      return ["string", "image", "audio", "document", "file"].includes(cs.type);
    } else {
      return socket instanceof _FileObjectSocket;
    }
  }
  detectMimeType(ctx, value) {
    return void 0;
  }
  async persistObject(ctx, value, opts) {
    if ((value.ticket || value.fid) && value.url && !value.data) {
      return await Promise.resolve(value);
    }
    opts ?? (opts = {});
    opts.mimeType ?? (opts.mimeType = this.detectMimeType?.(ctx, value));
    const finalOpts = { userId: ctx.userId, jobId: ctx.jobId, ...opts };
    return ctx.app.cdn.putTemp(value, finalOpts);
  }
  async persistObjects(ctx, value, opts) {
    return await Promise.all(
      value.map(async (v) => {
        return await this.persistObject(ctx, v, opts);
      })
    );
  }
  async _inputFromString(ctx, value) {
    if (typeof value !== "string") {
      return value;
    }
    const objects = value.split("\n");
    const ret = objects.map((x) => x.trim()).filter((x) => x.length);
    return await Promise.all(
      ret.map(async (v) => {
        return await this.persistObject(ctx, v);
      })
    );
  }
  async _handleSingleObject(ctx, value, getValue = false) {
    if (!value) {
      return null;
    }
    let cdnResource = null;
    const format = this.format?.includes("base64") ? "base64" : void 0;
    const addHeader = format && this.format?.includes("withHeader");
    if (value.fid) {
      if (!getValue && format !== "base64") {
        cdnResource = await ctx.app.cdn.find(value.fid);
      } else {
        cdnResource = await ctx.app.cdn.get(value, null, format);
      }
    } else if (value instanceof Buffer) {
      cdnResource = await this.persistObject(ctx, value);
    } else if (typeof value === "string") {
      if (this.isValidUrl(value)) {
        cdnResource = await this.persistObject(ctx, value.trim());
      } else if (value?.startsWith?.("fid://")) {
        const [fid, extension] = value.split("://")[1].split(".");
        cdnResource = await ctx.app.cdn.get({ fid }, null, format);
      } else
        value.length > 0;
      {
        cdnResource = await this.persistObject(ctx, value);
      }
    }
    let socketValue = null;
    if (cdnResource && cdnResource.fid) {
      if (format === "base64") {
        socketValue = cdnResource.asBase64(addHeader);
      } else {
        socketValue = cdnResource;
      }
    } else {
      console.error("File socket: Failure to process value", value);
    }
    if (socketValue !== null && this.customSettings?.do_no_return_data && format !== "base64") {
      delete socketValue.data;
    }
    return socketValue;
  }
  async _handleObjectArray(ctx, value, getValue = false) {
    if (!value) {
      return null;
    }
    if (!Array.isArray(value)) {
      value = [value];
    }
    value = value.filter((x) => x !== null);
    return await Promise.all(
      value.map(async (v) => {
        return await this._handleSingleObject(ctx, v, getValue);
      })
    );
  }
  async _handlePort(ctx, value, getValue) {
    value = await this._inputFromString(ctx, value);
    if (!Array.isArray(value)) {
      value = [value];
    }
    if (this.array) {
      return await this._handleObjectArray(ctx, value, getValue);
    }
    return await this._handleSingleObject(ctx, value[0], getValue);
  }
  async handleInput(ctx, value) {
    return await this._handlePort(ctx, value, true);
  }
  async handleOutput(ctx, value) {
    return await this._handlePort(ctx, value, false);
  }
};
var FileObjectSocket_default = FileObjectSocket;

// src/components/Sockets/DocumentSocket.ts
var DocumentSocket = class _DocumentSocket extends FileObjectSocket_default {
  // Try to guess if we have a plain text
  mightBeUtf8PlainText(text) {
    const thresholdPercentage = 0.05;
    const maxControlChars = text.length * thresholdPercentage;
    let controlCharCount = 0;
    for (const char of text) {
      const charCode = char.charCodeAt(0);
      if (charCode >= 0 && charCode <= 31 || charCode >= 127 && charCode <= 159) {
        controlCharCount++;
        if (controlCharCount > maxControlChars) {
          return false;
        }
      }
    }
    return true;
  }
  detectMimeType(ctx, value) {
    if (value && typeof value === "string") {
      if (this.mightBeUtf8PlainText(value)) {
        return "text/plain";
      }
    }
    return void 0;
  }
  compatibleWith(socket, noReverse) {
    const cs = this;
    if (cs.type) {
      return ["string", "text", "document"].includes(cs.type);
    }
    return socket instanceof _DocumentSocket;
  }
};
var DocumentSocket_default = DocumentSocket;

// src/components/Sockets/PrimitiveSocket.ts
var PrimitiveSocket = class extends CustomSocket_default {
  async handleInput(ctx, value) {
    if (Array.isArray(value)) {
      value = value[0];
    }
    return value;
  }
  async handleOutput(ctx, value) {
    return await this.handleInput(ctx, value);
  }
};
var PrimitiveSocket_default = PrimitiveSocket;

// src/components/Sockets/JsonSocket.ts
var JSONSocket = class extends CustomSocket_default {
  async handleSingleValue(ctx, value) {
    if (value === null || value === void 0) {
      return null;
    }
    if (typeof value === "object") {
      return value;
    } else if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch (e) {
        console.error("Error parsing object socket", e);
        return null;
      }
    }
    return value;
  }
  async _handlePort(ctx, value) {
    const isArray = Array.isArray(value);
    let ret = value;
    if (isArray && !this.array) {
      ret = value.length > 0 ? value[0] : [];
    } else if (!isArray && this.array) {
      ret = [value];
    }
    if (Array.isArray(ret)) {
      let result = await Promise.all(ret.map(async (v) => {
        return await this.handleSingleValue(ctx, v);
      }));
      result = result.filter((x) => x != null);
      return result.length > 0 ? result : null;
    } else {
      const result = await this.handleSingleValue(ctx, ret);
      return result != null ? result : null;
    }
  }
  async handleInput(ctx, value) {
    return await this._handlePort(ctx, value);
  }
  async handleOutput(ctx, value) {
    return await this._handlePort(ctx, value);
  }
};
var JsonSocket_default = JSONSocket;

// src/components/Sockets/ImageSocket.ts
var ImageSocket = class _ImageSocket extends FileObjectSocket_default {
  compatibleWith(socket, noReverse) {
    const cs = this;
    if (cs.type) {
      return ["string", "file", "image"].includes(cs.type);
    }
    return socket instanceof _ImageSocket;
  }
};
var ImageSocket_default = ImageSocket;

// src/components/Sockets/VideoSocket.ts
var VideoSocket = class _VideoSocket extends FileObjectSocket_default {
  compatibleWith(socket, noReverse) {
    const cs = this;
    if (cs.type) {
      return ["string", "file", "video"].includes(cs.type);
    }
    return socket instanceof _VideoSocket;
  }
};
var VideoSocket_default = VideoSocket;

// src/components/Sockets/AudioSocket.ts
var AudioSocket = class _AudioSocket extends FileObjectSocket_default {
  compatibleWith(socket, noReverse) {
    const cs = this;
    if (cs.type) {
      return ["string", "file", "audio"].includes(cs.type);
    }
    return socket instanceof _AudioSocket;
  }
};
var AudioSocket_default = AudioSocket;

// src/components/Sockets/NumberSocket.ts
var NumberSocket = class extends CustomSocket_default {
  compatibleWith(socket, noReverse) {
    const cs = this;
    if (cs.type) {
      return ["integer", "number", "float"].includes(cs.type);
    }
    return socket instanceof CustomSocket_default;
  }
  async handleInput(ctx, value) {
    if (Array.isArray(value)) {
      value = value[0];
    }
    if (!value) {
      return 0;
    }
    if (value === "inf") {
      return Infinity;
    }
    if (value === "-inf") {
      return -Infinity;
    }
    if (value === "nan") {
      return NaN;
    }
    if (typeof value !== "number") {
      return Number(value);
    }
    return value;
  }
  async handleOutput(ctx, value) {
    return await this.handleInput(ctx, value);
  }
};
var NumberSocket_default = NumberSocket;

// src/components/Sockets/TextSocket.ts
var TextSocket = class _TextSocket extends CustomSocket_default {
  compatibleWith(socket, noReverse) {
    const cs = this;
    if (cs.type) {
      return ["string", "object", "number", "integer", "float", "file", "image", "audio", "document", "text"].includes(
        cs.type
      );
    } else {
      return socket instanceof _TextSocket;
    }
  }
  convertSingleValue(value) {
    if (value == null || value === void 0) {
      return this.customSettings?.null_value || "";
    }
    if (typeof value === "object") {
      if (value instanceof Date) {
        return value.toISOString();
      } else if (value.fid && value.furl) {
        return value.furl;
      } else {
        return JSON.stringify(value, null, 2);
      }
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number") {
      return value.toString();
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    return JSON.stringify(value, null, 2);
  }
  async handleInput(ctx, value) {
    const arraySeparator = this.customSettings?.array_separator ?? "\n";
    if (this.array && typeof value === "string") {
      value = value.split(arraySeparator);
    }
    if (!Array.isArray(value)) {
      value = [value];
    }
    value = value.map(this.convertSingleValue.bind(this));
    if (this.customSettings?.filter_empty) {
      value = value.filter((v) => v);
    }
    return this.array ? value : value.join(arraySeparator);
  }
  async handleOutput(ctx, value) {
    return await this.handleInput(ctx, value);
  }
};
var TextSocket_default = TextSocket;

// src/components/Sockets/BooleanSocket.ts
var BooleanSocket = class extends CustomSocket_default {
  async handleInput(ctx, value) {
    if (Array.isArray(value)) {
      value = value[0];
    }
    return Boolean(value);
  }
  async handleOutput(ctx, value) {
    return await this.handleInput(ctx, value);
  }
};
var BooleanSocket_default = BooleanSocket;

// src/components/Sockets/AnySocket.ts
var AnySocket = class extends CustomSocket_default {
  compatibleWith(socket, noReverse) {
    return true;
  }
  async handleInput(ctx, value) {
    return value;
  }
  async handleOutput(ctx, value) {
    return value;
  }
};
var AnySocket_default = AnySocket;

// src/components/SocketManager.ts
var socketTypeMap = /* @__PURE__ */ new Map();
socketTypeMap.set("boolean", BooleanSocket_default);
socketTypeMap.set("number", NumberSocket_default);
socketTypeMap.set("integer", NumberSocket_default);
socketTypeMap.set("float", NumberSocket_default);
socketTypeMap.set("string", TextSocket_default);
socketTypeMap.set("text", TextSocket_default);
socketTypeMap.set("json", JsonSocket_default);
socketTypeMap.set("file", FileObjectSocket_default);
socketTypeMap.set("image", ImageSocket_default);
socketTypeMap.set("audio", AudioSocket_default);
socketTypeMap.set("document", DocumentSocket_default);
socketTypeMap.set("video", VideoSocket_default);
socketTypeMap.set("any", AnySocket_default);
var generateSocketName = function(type, opts) {
  let name = type;
  if (opts.array == true) {
    name += "Array";
  }
  if (opts.format !== void 0) {
    name += `_${opts.format}`;
  }
  return name;
};
var SocketManager = class _SocketManager {
  constructor() {
    this.isSchemaObject = (obj) => {
      return "type" in obj || "$ref" in obj;
    };
    this.sockets = /* @__PURE__ */ new Map();
  }
  static getSingleton() {
    _SocketManager.instance ?? (_SocketManager.instance = new _SocketManager());
    return _SocketManager.instance;
  }
  constructSocket(type, opts) {
    let SocketType = socketTypeMap.get(type);
    if (SocketType === void 0) {
      console.warn(`Unknown socketType: ${type}, creating primimtive`);
      SocketType = PrimitiveSocket_default;
    }
    const name = generateSocketName(type, opts);
    const socket = new SocketType(name, type, { ...opts });
    this.sockets.forEach((s) => {
      if (s.type === type) {
        s.combineWith(socket);
        socket.combineWith(s);
      }
    });
    this.sockets.set(socket.name, socket);
    return socket;
  }
  getOrCreateSocket(type, opts) {
    ["image", "audio", "document", "cdnObject", "object", "video", "file"].forEach((t) => {
      if (type.startsWith(t)) {
        type = t;
      }
    });
    if (type === "object") {
      type = "json";
    }
    if (type.startsWith("cdnObject")) {
      type = "file";
    }
    if (type.includes("Array")) {
      opts.array = true;
    }
    if (type.includes("B64")) {
      opts.format = "base64";
    }
    const key = generateSocketName(type, opts);
    if (this.has(key)) {
      return this.get(key);
    }
    const socket = this.constructSocket(type, opts);
    return socket;
  }
  add(key, socket) {
    this.sockets.set(key, socket);
  }
  get(key) {
    return this.sockets.get(key);
  }
  has(id) {
    return this.sockets.has(id);
  }
};
var SocketManager_default = SocketManager;

// src/components/openapi/types.ts
var OmniComponentMacroTypes = /* @__PURE__ */ ((OmniComponentMacroTypes2) => {
  OmniComponentMacroTypes2["EXEC"] = "exec";
  OmniComponentMacroTypes2["BUILDER"] = "builder";
  OmniComponentMacroTypes2["ON_SAVE"] = "save";
  return OmniComponentMacroTypes2;
})(OmniComponentMacroTypes || {});
var OmniComponentFlags = /* @__PURE__ */ ((OmniComponentFlags2) => {
  OmniComponentFlags2[OmniComponentFlags2["NO_EXECUTE"] = 1] = "NO_EXECUTE";
  OmniComponentFlags2[OmniComponentFlags2["HAS_NATIVE_CODE"] = 2] = "HAS_NATIVE_CODE";
  OmniComponentFlags2[OmniComponentFlags2["UNIQUE_PER_WORKFLOW"] = 3] = "UNIQUE_PER_WORKFLOW";
  return OmniComponentFlags2;
})(OmniComponentFlags || {});
var OmniExecutionFlags = /* @__PURE__ */ ((OmniExecutionFlags2) => {
  OmniExecutionFlags2[OmniExecutionFlags2["TRACE"] = 2] = "TRACE";
  return OmniExecutionFlags2;
})(OmniExecutionFlags || {});
var JobContext = class _JobContext {
  constructor(app, config) {
    this._app = app;
    this.data = config;
  }
  get app() {
    return this._app;
  }
  get sessionId() {
    return this.data.sessionId;
  }
  get userId() {
    return this.data.userId;
  }
  get jobId() {
    return this.data.jobId;
  }
  get workflowId() {
    return this.data.workflowId;
  }
  get args() {
    return this.data.args;
  }
  get flags() {
    return this.data.flags ?? 0;
  }
  setJobId(jobId) {
    this.data.jobId = jobId;
  }
  setFlags(flags) {
    this.data.flags = FlagTool.create(this.data.flags).setFlags(flags);
  }
  setFlag(flag, value = true) {
    this.data.flags = FlagTool.create(this.data.flags).setFlag(flag, value);
  }
  static create(app, config) {
    return new _JobContext(app, config);
  }
  toJSON() {
    const clone = _JobContext.create(this.app, JSON.parse(JSON.stringify({ data: this.data })));
    return clone;
  }
  getData() {
    return JSON.parse(JSON.stringify(this.data));
  }
};
var WorkerContext = class _WorkerContext {
  constructor(app, engine, node, jobContext) {
    this._app = app;
    this._engine = engine;
    this.jobData = jobContext;
    this._node = node;
    this._node.inputs = JSON.parse(JSON.stringify(node.inputs));
  }
  get app() {
    return this._app;
  }
  get engine() {
    return this._engine;
  }
  getData() {
    return JSON.parse(JSON.stringify(this.jobData));
  }
  get node() {
    return this._node;
  }
  get sessionId() {
    return this.jobData.sessionId;
  }
  get userId() {
    return this.jobData.userId;
  }
  get jobId() {
    return this.jobData.jobId;
  }
  get workflowId() {
    return this.jobData.workflowId;
  }
  get args() {
    return this.jobData.args;
  }
  set args(value) {
    this.jobData.args = value;
  }
  get inputs() {
    return this?.node?.inputs || [];
  }
  get outputs() {
    return this.node.outputs;
  }
  setOutputs(outputs) {
    this.node.outputs = outputs;
  }
  static create(app, engine, node, jobContext) {
    return new _WorkerContext(app, engine, node, jobContext);
  }
  dispose() {
    delete this._app;
  }
};
var FlagTool = class _FlagTool {
  constructor(val = 0) {
    this.data = val;
  }
  static create(val = 0) {
    return new _FlagTool(val);
  }
  setFlags(flags) {
    flags.map((flag) => this.setFlag(flag));
    return this.data;
  }
  setFlag(flag, value = true) {
    const mask = 1 << flag;
    if (value) {
      this.data = this.data | mask;
      return this.data;
    } else {
      this.data = this.data & ~mask;
      return this.data;
    }
  }
};

// src/components/openapi/Composers.ts
function SimplifyChoices(choices) {
  if (Array.isArray(choices)) {
    if (choices.length === 0) {
      return [];
    }
    if (typeof choices[0] === "string") {
      return choices.map((v) => ({ title: v, value: v }));
    }
    if (typeof choices[0] === "object" && "title" in choices[0] && "value" in choices[0]) {
      return choices;
    }
  }
  if (typeof choices === "object" && "block" in choices && "map" in choices) {
    return choices;
  }
  return choices;
}
var IOComposer = class {
  constructor() {
    this.data = {};
  }
  create(name, ioType, type, customSocket, socketOpts) {
    this.data.name = name;
    this.data.customSocket = customSocket;
    this.data.socketOpts = { ...socketOpts };
    if (type === "array") {
      type = "object";
      this.data.socketOpts.array = true;
    }
    this.data.type = type;
    this.data.dataTypes = [type];
    this.data.customData = {};
    this.data.title = name;
    this.data.source = { sourceType: ioType === "input" ? "requestBody" : "responseBody" };
    return this;
  }
  setRequired(required) {
    this.data.required = required;
    return this;
  }
  setHidden(hidden) {
    this.data.hidden = hidden;
    return this;
  }
  set(key, value) {
    this.data[key] = value;
    return this;
  }
  setFormat(format) {
    this.data.format = format;
    return this;
  }
  setDefault(defaultValue) {
    this.data.default = defaultValue;
    return this;
  }
  setControl(ctl) {
    ctl.dataType = this.data.type;
    this.data.control = ctl;
    return this;
  }
  allowMultiple(enable = true) {
    this.data.allowMultiple = enable;
    this.data.socketOpts.array = true;
    return this;
  }
  setConstraints(minimum, maximum, step) {
    this.data.minimum = minimum;
    this.data.maximum = maximum;
    this.data.step = step;
    return this;
  }
  setChoices(choices, defaultValue) {
    if (defaultValue != null) {
      this.data.default = defaultValue;
    }
    if (choices != null) {
      this.data.choices = SimplifyChoices(choices);
      if (!this.data.choices) {
        this.data.choices = [{ title: "(default)", value: defaultValue ?? "" }];
      }
    }
    return this;
  }
  setCustom(key, value) {
    this.data.customData[key] = value;
    return this;
  }
  toOmniIO() {
    var _a;
    (_a = this.data).title ?? (_a.title = this.data.name);
    return this.data;
  }
};
var ControlComposer = class {
  constructor(name) {
    this.data = { name };
    this.data.customData = {};
  }
  create(name, dataType) {
    this.data.name = name;
    this.data.dataType = dataType;
    return this;
  }
  setRequired(required) {
    this.data.required = required;
    return this;
  }
  setHidden(hidden) {
    this.data.hidden = hidden;
    return this;
  }
  setCustom(key, value) {
    this.data.customData[key] = value;
    return this;
  }
  setControlType(controlType) {
    this.data.controlType = controlType;
    return this;
  }
  set(key, value) {
    this.data[key] = value;
    return this;
  }
  setChoices(choices, defaultValue) {
    this.data.default = defaultValue;
    this.data.choices = SimplifyChoices(choices);
    if (!this.data.choices) {
      this.data.choices = [{ title: "(default)", value: defaultValue ?? "" }];
    }
    return this;
  }
  setReadonly(readonly) {
    this.data.readonly = readonly;
    return this;
  }
  setConstraints(minimum, maximum, step) {
    if (minimum != null)
      this.data.minimum = minimum;
    if (maximum != null)
      this.data.maximum = maximum;
    if (step != null)
      this.data.step = step;
    return this;
  }
  setDefault(defaultValue) {
    this.data.default = defaultValue;
    return this;
  }
  toOmniControl() {
    var _a;
    (_a = this.data).title ?? (_a.title = this.data.name);
    return this.data;
  }
};
var BaseComposer = class {
  constructor() {
    this.data = {};
  }
  fromJSON(config) {
    this.data = JSON.parse(JSON.stringify(config));
    return this;
  }
};
var ComponentComposer = class extends BaseComposer {
  constructor() {
    super();
    this.data.type = "OAIComponent31";
    this.data.flags = 0;
    this.data.macros = {};
    this.data.origin = "omnitool:Composer";
    this.data.customData = {};
  }
  dependsOn(dependsOn) {
    this.data.dependsOn = dependsOn;
    return this;
  }
  fromScratch() {
    this.data.apiNamespace = this.data.displayNamespace;
    this.data.apiOperationId = this.data.displayOperationId;
    this.data.responseContentType = "application/json";
    this.data.category = "Utilities";
    this.data.tags = ["default"];
    return this;
  }
  createInput(name, type, customSocket, socketOpts) {
    const ret = new IOComposer().create(name, "input", type, customSocket, socketOpts || {});
    return ret;
  }
  addInput(input) {
    this.data.inputs = this.data.inputs ?? {};
    this.data.inputs[input.name] = input;
    return this;
  }
  createOutput(name, type, customSocket, socketOpts) {
    const ret = new IOComposer().create(name, "output", type, customSocket, socketOpts || {});
    return ret;
  }
  addOutput(output) {
    this.data.outputs = this.data.outputs ?? {};
    this.data.outputs[output.name] = output;
    return this;
  }
  setTags(tags) {
    this.data.tags = tags;
    return this;
  }
  setRenderTemplate(template) {
    this.data.renderTemplate = template;
    return this;
  }
  create(displayNamespace, displayOperationId) {
    this.data.displayNamespace = displayNamespace;
    this.data.displayOperationId = displayOperationId;
    return this;
  }
  set(key, value) {
    this.data[key] = value;
    return this;
  }
  setMethod(method) {
    this.data.method = method;
    return this;
  }
  useAPI(apiNamespace, apiOperationId) {
    this.data.apiNamespace = apiNamespace;
    this.data.apiOperationId = apiOperationId;
    return this;
  }
  setMeta(meta) {
    this.data.meta = meta;
    return this;
  }
  setFlags(flags) {
    this.data.flags = flags;
    return this;
  }
  setFlag(flag, value = true) {
    const mask = 1 << flag;
    if (value) {
      this.data.flags = this.data.flags | mask;
    } else {
      this.data.flags = this.data.flags & ~mask;
    }
    return this;
  }
  setMacro(macro, fn) {
    this.data.macros[macro] = fn;
    if (fn instanceof Function) {
      this.setFlag(2 /* HAS_NATIVE_CODE */);
    }
    return this;
  }
  createControl(name, dataType) {
    const ret = new ControlComposer(name).create(name, dataType);
    return ret;
  }
  setCustom(key, value) {
    var _a;
    (_a = this.data).customData ?? (_a.customData = {});
    this.data.customData[key] = value;
    return this;
  }
  addControl(control) {
    this.data.controls = this.data.controls ?? {};
    this.data.controls[control.name] = control;
    return this;
  }
  toJSON() {
    return this.data;
  }
};
var PatchComposer = class extends BaseComposer {
  constructor() {
    super();
    this.data.macros = {};
    this.data.origin = "omnitool:Composer";
    this.data.customData = {};
  }
  fromComponent(apiNamespace, apiOperationId) {
    this.data.apiNamespace = apiNamespace;
    this.data.apiOperationId = apiOperationId;
    return this;
  }
  createInput(name, type, customSocket) {
    const ret = new IOComposer().create(name, "input", type, customSocket);
    return ret;
  }
  addInput(input) {
    this.data.inputs = this.data.inputs ?? {};
    this.data.inputs[input.name] = input;
    return this;
  }
  createOutput(name, type, customSocket) {
    const ret = new IOComposer().create(name, "output", type, customSocket);
    return ret;
  }
  addOutput(output) {
    this.data.outputs = this.data.outputs ?? {};
    this.data.outputs[output.name] = output;
    return this;
  }
  create(displayNamespace, displayOperationId) {
    this.data.displayNamespace = displayNamespace;
    this.data.displayOperationId = displayOperationId;
    return this;
  }
  set(key, value) {
    this.data[key] = value;
    return this;
  }
  useAPI(apiNamespace, apiOperationId) {
    this.data.apiNamespace = apiNamespace;
    this.data.apiOperationId = apiOperationId;
    return this;
  }
  setMeta(meta) {
    this.data.meta = meta;
    return this;
  }
  setCustom(key, value) {
    var _a;
    (_a = this.data).customData ?? (_a.customData = {});
    this.data.customData[key] = value;
    return this;
  }
  createControl(name) {
    const ret = new ControlComposer(name).create(name);
    return ret;
  }
  addControl(control) {
    this.data.controls = this.data.controls ?? {};
    this.data.controls[control.name] = control;
    return this;
  }
  hideExcept(input, output) {
    if (input?.length > 0) {
      this.data.scripts = this.data.scripts ?? {};
      this.data.scripts["hideExcept:inputs"] = input;
    }
    if (output?.length > 0) {
      this.data.scripts = this.data.scripts ?? {};
      this.data.scripts["hideExcept:outputs"] = output;
    }
  }
  toJSON() {
    return this.data;
  }
};

// src/components/openapi/OAIControl.ts
import Rete from "rete";
var OAIControl31 = class _OAIControl31 extends Rete.Control {
  constructor(config, control, emitter) {
    super(config.name);
    this.data = JSON.parse(JSON.stringify(config));
    this.emitter = emitter;
    this.props = { ikey: config.name };
    this.component = control;
    if (!control) {
      console.error("Could not find component for " + config.controlType);
    }
  }
  async initChoices() {
    if (this.data.choices) {
      const choices = this.data.choices;
      if (Array.isArray(choices)) {
        this.data.choices = choices.map(function(v) {
          if (typeof v === "object") {
            return v;
          } else {
            return { value: v, title: v };
          }
        });
      }
      if (typeof this.data.choices === "object") {
        const choices2 = this.data.choices;
        if (choices2.block) {
          let list = ["Internal Error Fetching choices"];
          try {
            list = await globalThis.client.runBlock({
              block: choices2.block,
              args: choices2.args || {},
              cache: choices2.cache ?? choices2.map.cache ?? "none"
            });
          } catch (ex) {
            console.error("Could not load choices for " + this.data.name + ": " + ex.message);
            list = ["ERROR: " + ex.message, this.data.default];
          }
          if (list.error) {
            console.error("Could not load choices for " + this.data.name + ": " + list.error.message);
            list = ["ERROR: " + list.error, this.data.default];
          }
          const root = choices2.map?.root;
          if (root && list[root] != null) {
            list = Array.isArray(list[root]) ? list[root] : Array.from(Object.values(list[root]));
          }
          if (!Array.isArray(list)) {
            list = Array.from(Object.values(list));
          }
          const filterRegex = new RegExp(choices2.map?.filter?.value);
          this.data.choices = list.map((v) => {
            let e = { value: v, title: v, description: "" };
            if (choices2.map?.value && choices2.map?.title) {
              e = {
                value: v[choices2.map.value],
                title: v[choices2.map.title],
                description: v[choices2.map.description] || ""
              };
            }
            return e;
          }).filter((e) => e.value && filterRegex.test(e.title)).sort((a, b) => b.title.localeCompare(a.title));
        }
        if (this.data.required && this.data.default == null && Array.isArray(this.data.choices) && this.data.choices.length > 0) {
          this.data.default = this.data.choices[0].value;
        }
      }
    }
  }
  get dataType() {
    return this.data.dataType ?? "string";
  }
  get controlType() {
    console.log("Access to field controlType on control");
    return this.data.controlType;
  }
  get type() {
    console.trace();
    console.log("Access to deprecated field type on control");
    return this.data.dataType;
  }
  get opts() {
    return this.data;
  }
  get displays() {
    return this.data.displays ?? null;
  }
  get minimum() {
    return this.data.minimum;
  }
  get description() {
    return this.data.description;
  }
  get title() {
    return this.data.title ?? this.data.name;
  }
  get maximum() {
    return this.data.maximum;
  }
  get customData() {
    return this.data.customData ?? {};
  }
  custom(key) {
    return this.data.customData?.[key] ?? null;
  }
  get choices() {
    return this.data.choices ?? ["(default)"];
  }
  get readonly() {
    return this.data.readonly ?? false;
  }
  _formatValue(val) {
    if (val) {
      if ((this.dataType === "number" || this.dataType == "float") && typeof val === "string") {
        val = parseFloat(val);
      } else if (this.dataType === "integer" && typeof val === "string") {
        val = parseFloat(val);
      } else if (this.dataType === "boolean" && typeof val === "number") {
        val = val != 0;
      } else if (this.dataType === "boolean" && typeof val === "string") {
        val = [true, "true", "1", "on", "active"].includes(val.toLowerCase());
      }
    }
    return val;
  }
  setValue(val) {
    if (this.displays || this.readonly) {
      return;
    }
    val = this._formatValue(val);
    this.putData(this.props.ikey, val);
    this.update();
  }
  static async fromControl(ctl, emitter) {
    const control = WorkflowClientControlManager.getInstance().get(ctl.controlType);
    const ret = new _OAIControl31(ctl, control, emitter);
    await ret.initChoices();
    return ret;
  }
  static async fromIO(ctlType, io, emitter) {
    const control = {
      dataType: io.type,
      controlType: ctlType,
      name: io.name,
      title: io.title,
      choices: io.choices,
      description: io.description,
      step: io.step,
      default: io.default,
      minimum: io.minimum,
      maximum: io.maximum,
      required: io.required,
      ...io.control || {}
    };
    const ctl = WorkflowClientControlManager.getInstance().get(ctlType);
    const ret = new _OAIControl31(control, ctl, emitter);
    await ret.initChoices();
    return ret;
  }
};
var OAIControl_default = OAIControl31;

// src/components/openapi/OAIComponent31.ts
var deserializeValidator = function(jsString) {
  const eval2 = eval;
  return eval2("(" + jsString + ")");
};
var OAIBaseComponent = class extends Rete2.Component {
  // #v-endif
  constructor(config, patch) {
    var _a, _b, _c, _d, _e, _f;
    const data = merge(config, patch ?? {});
    super(`${data.displayNamespace}.${data.displayOperationId}`);
    this.data = data;
    (_a = this.data).macros ?? (_a.macros = {});
    (_b = this.data).flags ?? (_b.flags = 0);
    (_c = this.data).errors ?? (_c.errors = []);
    (_d = this.data).xOmniEnabled ?? (_d.xOmniEnabled = true);
    for (const key in this.data.inputs) {
      (_e = this.data.inputs[key]).source ?? (_e.source = { sourceType: "requestBody" });
    }
    for (const key in this.data.outputs) {
      (_f = this.data.outputs[key]).source ?? (_f.source = { sourceType: "responseBody" });
    }
    this._validator = config.validator != null ? deserializeValidator(config.validator) : void 0;
  }
  static create(displayNamespace, displayOperationId) {
    const composer = new ComponentComposer();
    return composer.create(displayNamespace, displayOperationId);
  }
  static createPatch(displayNamespace, displayOperationId) {
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
    return this.data.category ?? "Base API";
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
    return this.data.renderTemplate || "default";
  }
  get type() {
    return this.data.type ?? "OAIComponent31";
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
  get hash() {
    return this.data.hash;
  }
  get controls() {
    return this.data.controls;
  }
  get xOmniEnabled() {
    return this.data.xOmniEnabled ?? true;
  }
  set xOmniEnabled(enabled) {
    this.data.xOmniEnabled = enabled;
  }
  setType(type) {
    this.data.type = type;
    return this;
  }
  setApiOperationId(apiOperationId) {
    this.data.apiOperationId = apiOperationId;
    return this;
  }
  setApiNamespace(apiNamespace) {
    this.data.apiNamespace = apiNamespace;
    return this;
  }
  setDisplayNamespace(displayNamespace) {
    this.data.displayNamespace = displayNamespace;
    return this;
  }
  setDisplayOperationId(displayOperationId) {
    this.data.displayOperationId = displayOperationId;
    return this;
  }
  setTitle(title) {
    this.data.title = title;
    return this;
  }
  setMethod(method) {
    this.data.method = method;
    return this;
  }
  setDescription(description) {
    this.data.description = description;
    return this;
  }
  setUrlPath(urlPath) {
    this.data.urlPath = urlPath;
    return this;
  }
  setMeta(meta) {
    this.data.meta = meta;
    return this;
  }
  addInput(name, input) {
    this.data.inputs[name] = input;
    return this;
  }
  addControl(name, control) {
    this.data.controls[name] = control;
    return this;
  }
  addOutput(name, output) {
    this.data.outputs[name] = output;
    return this;
  }
  addTag(tag) {
    this.data.tags.push(tag);
    return this;
  }
  setCategory(category) {
    this.data.category = category;
    return this;
  }
  setRequestContentType(requestContentType) {
    this.data.requestContentType = requestContentType;
    return this;
  }
  setResponseContentType(responseContentType) {
    this.data.responseContentType = responseContentType;
    return this;
  }
  setCredentials(credentials) {
    this.data.credentials = credentials;
    return this;
  }
  setValidator(validator) {
    this.data.validator = validator;
    return this;
  }
  addSecurity(spec) {
    this.data.security = this.data.security ?? [];
    this.data.security.push(spec);
    return this;
  }
  setMacro(macro, fn) {
    this.data.macros[macro] = fn;
    return this;
  }
  pickDefaultControlFromDataType(dataType, ioBase) {
    if (dataType === "number" || dataType === "integer" || dataType === "float") {
      if (ioBase.format?.includes("int")) {
        dataType = "integer";
      } else if (ioBase.format === "float" || ioBase.format === "double") {
        dataType = "float";
      }
      if (ioBase.step != null || ioBase.minimum != null && ioBase.maximum != null && Math.abs(ioBase.maximum - ioBase.minimum) <= 100) {
        if (dataType === "float") {
          ioBase.step ?? (ioBase.step = 0.1);
        }
        return "AlpineNumWithSliderComponent";
      }
      return "AlpineNumComponent";
    } else if (dataType === "boolean") {
      return "AlpineToggleComponent";
    } else if (dataType === "object") {
      return "AlpineCodeMirrorComponent";
    } else if (dataType === "string") {
      return ioBase.format === "password" ? "AlpinePasswordComponent" : "AlpineTextComponent";
    }
    return null;
  }
  pickDefaultControlFromControl(ctl) {
    const controlType = ctl.controlType;
    if (controlType != null) {
      return controlType;
    }
    if (ctl.choices != null) {
      return "AlpineSelectComponent";
    }
    const dataType = ctl.dataType;
    if (dataType != null) {
      const fromDataType = this.pickDefaultControlFromDataType(dataType, ctl);
      if (fromDataType != null) {
        return fromDataType;
      }
    }
    return "AlpineLabelComponent";
  }
  pickDefaultControlFromIO(io) {
    const controlType = io.control?.controlType;
    if (controlType != null) {
      return controlType;
    }
    if (io.choices != null) {
      return "AlpineSelectComponent";
    }
    const customSocket = io.customSocket;
    if (customSocket && ["imageArray", "image", "document", "documentArray", "audio", "file", "video", "audioArray", "fileArray"].includes(
      customSocket
    )) {
      return "AlpineLabelComponent";
    }
    const dataType = io.type;
    const fromDataType = this.pickDefaultControlFromDataType(dataType, io);
    if (fromDataType != null) {
      return fromDataType;
    }
    return "AlpineLabelComponent";
  }
  async builder(node) {
    node.title = this.title;
    node.description = this.description;
    await this._builder?.(node);
  }
  async workerStart(inputData, ctx) {
    try {
      await this._workerStart?.(inputData, ctx);
    } catch (error) {
      omnilog.error("Error in component worker", error);
      const payload = {
        type: "error",
        node_id: ctx.node.id,
        error: error?.message || "Error",
        componentKey: this.name,
        sessionId: ctx.sessionId
      };
      await ctx.app.emit("sse_message", payload);
      ctx.outputs.error = error;
      return ctx.outputs;
    }
    return ctx.outputs;
  }
  async setControlValue(controlId, value, ctx) {
    if (this.data.controls[controlId] == null) {
      omnilog.warn(
        this.name,
        "tried to update non existing control",
        controlId,
        " - suppressed.\nPlease check your component for a setComponentValue call that passes in a non existing control key."
      );
      return;
    }
    if (this.editor != null) {
      const ctl = this.editor?.nodes.find((n) => n.id === ctx.node.id).controls.get(controlId) ?? null;
      if (ctl != null) {
        ctl.setValue(value);
      }
    } else {
      if (ctx?.app && ctx.node && ctx.sessionId) {
        const payload = {
          type: "control:setvalue",
          node_id: ctx.node.id,
          controlId,
          value,
          componentKey: this.name,
          sessionId: ctx.sessionId
        };
        await ctx.app.emit("sse_message", payload);
      }
    }
  }
  async sendStatusUpdate(message, scope, ctx) {
    const payload = { node_id: ctx.node.id, block: this.name, message, scope };
    const msg = ctx.app.io.composeMessage("block:status").from("server").to(ctx.sessionId).body(payload).toMessage();
    await ctx.app.io.send(ctx.sessionId, msg);
  }
};
var OAIComponent31 = class _OAIComponent31 extends OAIBaseComponent {
  constructor(config, patch, fns) {
    if (fns) {
      omnilog.warn("fns not implemented");
    }
    super(config, patch);
  }
  getSocketForIO(io) {
    let socket = "object";
    if (io.customSocket) {
      socket = io.customSocket;
    } else if (io.type != null && typeof io.type === "string") {
      socket = io.type;
    } else if (io.dataTypes?.length > 0) {
      socket = io.dataTypes[0];
    } else if (io.step != null || io.maximum != null || io.minimum != null) {
      socket = "number";
    }
    return SocketManager_default.getSingleton().getOrCreateSocket(socket, io.socketOpts || {});
  }
  async _redraw(node) {
  }
  enumerateInputs(node) {
    return Object.assign({}, node.data["x-omni-dynamicInputs"] || {}, this.data.inputs);
  }
  enumerateOutputs(node) {
    return Object.assign({}, node.data["x-omni-dynamicOutputs"] || {}, this.data.outputs);
  }
  async _builder(node) {
    node.category = this.category;
    node.renderTemplate = this.renderTemplate;
    node.title = node.data["x-omni-title"] || this.title;
    node.summary = node.data["x-omni-summary"] || this.summary;
    node.namespace = this.data.displayNamespace ?? this.data.apiNamespace;
    node.meta = this.meta;
    node.meta.title = this.title ?? this.summary;
    node.errors = this.data.errors;
    const inputs = this.enumerateInputs(node);
    for (const key in inputs) {
      const io = inputs[key];
      io.name ?? (io.name = key);
      io.title ?? (io.title = key);
      const ctlType = this.pickDefaultControlFromIO(io);
      if (node.data[key] != null && io.default != null) {
        if (typeof node.data[key] != typeof io.default) {
          delete node.data[key];
        } else if (io.type === "number" && typeof node.data[key] === "string") {
          delete node.data[key];
        }
      }
      if (io.choices != null) {
        if (io.choices.block && io.choices.block.indexOf?.(".") === -1) {
          io.choices.block = `${this.data.apiNamespace}.${io.choices.block}`;
        }
      }
      const control = await OAIControl_default.fromIO(ctlType, io, this.editor);
      if (!io.hidden) {
        if (io.readonly) {
          node.addControl(control);
        } else {
          const input = new Rete2.Input(key, io.title || io.name, this.getSocketForIO(io), io.allowMultiple);
          input.name ?? (input.name = key);
          input.addControl(control);
          node.addInput(input);
        }
      }
    }
    for (const key in this.controls) {
      const ctl = this.controls[key];
      if (!ctl.hidden) {
        ctl.name ?? (ctl.name = key);
        ctl.controlType ?? (ctl.controlType = this.pickDefaultControlFromControl(ctl));
        const control = await OAIControl_default.fromControl(ctl, this.editor);
        node.addControl(control);
      }
    }
    const outputs = this.enumerateOutputs(node);
    for (const key in outputs) {
      const io = { ...outputs[key], name: key, title: outputs[key].title ?? key };
      if (!io.hidden) {
        const output = new Rete2.Output(key, io.title || io.name, this.getSocketForIO(io));
        output.name ?? (output.name = key);
        node.addOutput(output);
      }
    }
  }
  async runXFunction(ctx, method, payload) {
    let response = null;
    if (method === "X-CUSTOM") {
      const exec = ctx.app.blocks.getMacro(this, "exec" /* EXEC */);
      if (!exec) {
        throw new Error("Block Error: X-CUSTOM macro is not defined for block" + this.name);
      }
      try {
        response = exec != null ? await exec.apply(this, [payload, ctx, this]) : null;
      } catch (ex) {
        if (ex.message.includes("Free time limit reached")) {
          throw ex;
        }
        throw new Error(`Error executing X-CUSTOM for block ${this.name}: ${ex.message}`);
      }
    } else if (this.method === "X-NOOP") {
      response = {};
    } else if (this.method === "X-PASSTHROUGH") {
      response = JSON.parse(JSON.stringify(payload));
    }
    return response;
  }
  async _workerStart(inputData, ctx) {
    let payload = await this.getPayload(ctx);
    payload = await this.runInputScripts(payload, ctx);
    const { requestBody, parameters } = this.getRequestComponents(payload, ctx);
    omnilog.log(this.name, "requestBody", requestBody);
    omnilog.log(this.name, "parameters", parameters);
    if (this.validator != null) {
      const isValid = this._validator?.(payload);
      const errors = this._validator?.errors ?? [];
      return { isValid, errors };
    }
    let response;
    if (this.method.startsWith("X-")) {
      response = await this.runXFunction(ctx, this.method, payload);
      if (response === void 0) {
        response = { error: "Internal error, `runXFunction` did not return a valid response object." };
      }
    } else {
      response = await ctx.app.api2.execute(
        this.apiKey,
        requestBody,
        { params: parameters, responseContentType: this.data.responseContentType },
        { user: ctx.userId, sessionId: ctx.sessionId, jobId: ctx.jobId }
      );
      if (response === void 0) {
        response = { error: "Internal error, `api2.execute` did not return a valid response object." };
      }
    }
    if (typeof response === "string") {
      response = { result: response };
    }
    response = await this.runOutputScripts(response, ctx);
    ctx.setOutputs(response);
    return response;
  }
  async runInputScripts(payload, ctx) {
    for (const key in this.controls) {
      const control = this.controls[key];
      if (control.displays?.startsWith("input:")) {
        const content = control.displays.replace("input:", "");
        await this.setControlValue(key, payload[content], ctx);
      }
    }
    const inputs = this.enumerateInputs(ctx.node);
    for (const key in inputs) {
      const input = inputs[key];
      if (input.scripts) {
        if (input.scripts.jsonata) {
          const expression = Exp(input.scripts.jsonata);
          try {
            payload[key] = await expression.evaluate(payload);
          } catch (ex) {
            throw new Error(`Error evaluating jsonata expression: ${input.scripts.jsonata} - ${ex.message}`);
          }
        }
        if (input.scripts.delete) {
          for (const field of input.scripts.delete) {
            delete payload[field];
          }
        }
      }
    }
    const transforms = this.scripts?.["transform:input"];
    if (transforms) {
      if (Array.isArray(transforms) && transforms.length > 0) {
        transforms.forEach((script) => {
          omnilog.log("global jsonata");
          const expression = Exp(script);
          payload = expression.evaluate(payload);
        });
      }
    }
    return payload;
  }
  async runOutputScripts(payload, ctx) {
    const socketManager = SocketManager_default.getSingleton();
    if (this.outputs?._omni_result) {
      payload = { _omni_result: payload };
    }
    const outputs = this.enumerateOutputs(ctx.node);
    for (const key in outputs) {
      const output = outputs[key];
      if (output.scripts) {
        if (output.scripts.jsonata) {
          omnilog.log("running jsonata", output.scripts.jsonata);
          const expression = Exp(output.scripts.jsonata);
          try {
            payload[key] = await expression.evaluate(payload);
          } catch (ex) {
            throw new Error(`Error evaluating jsonata expression: ${output.scripts.jsonata} - ${ex.message}`);
          }
        }
        if (output.scripts.delete) {
          omnilog.log("running delete", output.scripts.jsonata);
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
    for (const key in this.controls) {
      const control = this.controls[key];
      if (control.displays?.startsWith("output:")) {
        const content = control.displays.replace("output:", "");
        await this.setControlValue(key, payload[content], ctx);
      }
    }
    return payload;
  }
  getRequestComponents(payload, ctx) {
    let requestBody = {};
    const parameters = [];
    const inputs = this.enumerateInputs(ctx.node);
    for (const key in payload) {
      const value = payload[key];
      const source = inputs[key]?.source;
      if (!source || source.sourceType === "requestBody") {
        if (this.scripts?.["hoist:input"]?.includes(key)) {
          requestBody = { ...requestBody, ...value };
        } else {
          requestBody[key] = value;
        }
      } else {
        if (source.sourceType === "parameter") {
          const param = {
            name: key,
            in: source.in,
            value
          };
          parameters.push(param);
        }
      }
    }
    return { requestBody, parameters };
  }
  prunePayload(input, payload, key) {
    const value = payload[key];
    if (value === void 0 || value === null) {
      delete payload[key];
      return;
    }
    if (input.type === "string" && value.length === 0 && input.required !== true) {
      delete payload[key];
    } else if (input.type === "array" && value.length === 0 && input.required !== true) {
      delete payload[key];
    } else if (input.type === "object" && Object.keys(value).length === 0 && input.required !== true) {
      delete payload[key];
    } else if ((input.type === "number" || input.type === "integer") && value === "inf") {
      payload[key] = Infinity;
    }
  }
  async getPayload(ctx) {
    const payload = {};
    const inputs = this.enumerateInputs(ctx.node);
    for (const key in inputs) {
      const input = inputs[key];
      const inputValue = ctx.inputs[key];
      let value;
      if (input.allowMultiple) {
        value = inputValue?.flat?.() ?? ctx.node.data[key] ?? input.default;
      } else {
        value = inputValue?.[0] ?? ctx.node.data[key] ?? input.default;
        if (["integer", "float", "number"].includes(input.type) && value === "") {
          value = input.default;
        }
      }
      const socketManager = SocketManager_default.getSingleton();
      payload[key] = value;
      this.prunePayload(input, payload, key);
      if (payload[key] !== null && payload[key] !== void 0) {
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
    return JSON.parse(JSON.stringify(payload));
  }
  worker() {
    throw new Error("This should never be called");
  }
  static fromJSON(json, patch) {
    const comp = new _OAIComponent31(json, patch);
    if (!comp.name) {
      throw new Error();
    }
    return comp;
  }
  toJSON() {
    return JSON.parse(JSON.stringify({ ...this.data, name: this.name }));
  }
};

// src/components/WorkflowComponentRegistry.ts
var WorkflowComponentRegistry = class _WorkflowComponentRegistry {
  // May not be fully functional yet, use at own risk!!
  constructor() {
    this.loaded = false;
    this.components = /* @__PURE__ */ new Map();
    this.clientComponents = /* @__PURE__ */ new Map();
    this.ctors = /* @__PURE__ */ new Map();
  }
  registerCtor(type, Ctor) {
    this.ctors.set(type, Ctor);
  }
  create(definitions, namespace) {
    let components = [];
    components = definitions.map((definition) => {
      if (definition instanceof OAIBaseComponent) {
        return definition;
      }
      definition.type ?? (definition.type = "OAIBaseComponent");
      if (this.ctors.has(definition.type)) {
        const Ctor = this.ctors.get(definition.type);
        return Ctor.fromJSON(definition);
      }
      return null;
    }).filter((c) => c !== null);
    return components;
  }
  add(definitions) {
    this.create(definitions).forEach((component) => {
      this.components.set(component.name, component);
    });
    return this;
  }
  registerClientComponent(key, clientComponent) {
    this.clientComponents.set(key, clientComponent);
  }
  hasClientComponent(key) {
    return this.clientComponents.has(key);
  }
  getClientComponent(key) {
    return this.clientComponents.get(key);
  }
  get(name) {
    return this.components.get(name);
  }
  has(name) {
    return this.components.has(name);
  }
  getComponents(all) {
    let ret = Array.from(this.components.values());
    if (!all) {
      ret = ret.filter((c) => c.tags.includes("default"));
    }
    return ret;
  }
  getControlRegistry() {
    return WorkflowClientControlManager.getInstance();
  }
  static getSingleton() {
    _WorkflowComponentRegistry.instance ?? (_WorkflowComponentRegistry.instance = new _WorkflowComponentRegistry());
    return _WorkflowComponentRegistry.instance;
  }
};

// src/components/BlockCategory.ts
var BlockCategory = /* @__PURE__ */ ((BlockCategory2) => {
  BlockCategory2["INPUT_OUTPUT"] = "Input/Output";
  BlockCategory2["UTILITIES"] = "Utilities";
  BlockCategory2["RECIPE_OPERATIONS"] = "Recipe Operations";
  BlockCategory2["FILE_OPERATIONS"] = "File Operations";
  BlockCategory2["MODEL_OPERATIONS"] = "Model Operations";
  BlockCategory2["IMAGE_OPERATIONS"] = "Image Operations";
  BlockCategory2["SYSTEM"] = "System";
  BlockCategory2["USER_INTERFACE"] = "UI";
  BlockCategory2["TESTING"] = "Testing";
  BlockCategory2["TEXT_GENERATION"] = "Text Generation";
  BlockCategory2["TEXT_ANALYSIS"] = "Text Analysis";
  BlockCategory2["TEXT_MANIPULATION"] = "Text Manipulation";
  BlockCategory2["TEXT_CLASSIFICATION"] = "Text Classification";
  BlockCategory2["TEXT_EMBEDDING"] = "Text Embedding";
  BlockCategory2["TRANSLATION"] = "Translation";
  BlockCategory2["SUMMARIZATION"] = "Summarization";
  BlockCategory2["CONVERSATIONAL_AGENTS"] = "Conversational Agents";
  BlockCategory2["QUESTION_ANSWERING"] = "Question Answering";
  BlockCategory2["SPEECH_TO_TEXT"] = "Speech-to-Text";
  BlockCategory2["TEXT_TO_SPEECH"] = "Text-to-Speech";
  BlockCategory2["DOCUMENT_PROCESSING"] = "Document Processing";
  BlockCategory2["IMAGE_GENERATION"] = "Image Generation";
  BlockCategory2["IMAGE_ANALYSIS"] = "Image Analysis";
  BlockCategory2["IMAGE_MANIPULATION"] = "Image Manipulation";
  BlockCategory2["IMAGE_CLASSIFICATION"] = "Image Classification";
  BlockCategory2["IMAGE_SEGMENTATION"] = "Image Segmentation";
  BlockCategory2["IMAGE_RECOGNITION"] = "Image Recognition";
  BlockCategory2["OPTICAL_CHARACTER_RECOGNITION"] = "OCR";
  BlockCategory2["VIDEO_GENERATION"] = "Video Generation";
  BlockCategory2["VIDEO_ANALYSIS"] = "Video Analysis";
  BlockCategory2["VIDEO_CLASSIFICATION"] = "Video Classification";
  BlockCategory2["AUDIO_GENERATION"] = "Audio Generation";
  BlockCategory2["AUDIO_ANALYSIS"] = "Audio Analysis";
  BlockCategory2["SPEECH_RECOGNITION"] = "Speech Recognition";
  BlockCategory2["DATA_TRANSFORMATION"] = "Data Transformation";
  BlockCategory2["DATA_EXTRACTION"] = "Data Extraction";
  BlockCategory2["DATABASE_INTERACTIONS"] = "Database Interactions";
  BlockCategory2["DATA_STORAGE"] = "Data Storage";
  BlockCategory2["DATA_ANALYTICS"] = "Data Analytics";
  BlockCategory2["COMMUNICATION"] = "Communication";
  BlockCategory2["AUTHENTICATION"] = "Authentication";
  BlockCategory2["GEOLOCATION"] = "Geolocation";
  BlockCategory2["IoT_INTERACTIONS"] = "IoT Interactions";
  BlockCategory2["DATA_MINING"] = "Data Mining";
  BlockCategory2["DATA_VISUALIZATION"] = "Data Visualization";
  BlockCategory2["PREDICTIVE_ANALYTICS"] = "Predictive Analytics";
  BlockCategory2["BUSINESS_INTELLIGENCE"] = "Business Intelligence";
  BlockCategory2["SECURITY_PRIVACY"] = "Security & Privacy";
  BlockCategory2["CONTENT_MODERATION"] = "Content Moderation";
  return BlockCategory2;
})(BlockCategory || {});
export {
  BlockCategory,
  ComponentComposer,
  FlagTool,
  IOComposer,
  JobContext,
  OAIBaseComponent,
  OAIComponent31,
  OmniComponentFlags,
  OmniComponentMacroTypes,
  OmniExecutionFlags,
  PatchComposer,
  WorkerContext,
  WorkflowClientControlManager,
  WorkflowComponentRegistry
};
//# sourceMappingURL=index.js.map
