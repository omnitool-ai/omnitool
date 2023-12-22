// src/index.ts
import insane2 from "insane";

// src/core/App.ts
import EventEmitter from "emittery";

// src/core/OmniLog.ts
import consola from "consola";
var OmniLogLevels = ((OmniLogLevels2) => {
  OmniLogLevels2[OmniLogLevels2["silent"] = Number.NEGATIVE_INFINITY] = "silent";
  OmniLogLevels2[OmniLogLevels2["always"] = 0] = "always";
  OmniLogLevels2[OmniLogLevels2["fatal"] = 0] = "fatal";
  OmniLogLevels2[OmniLogLevels2["warning"] = 1] = "warning";
  OmniLogLevels2[OmniLogLevels2["normal"] = 2] = "normal";
  OmniLogLevels2[OmniLogLevels2["info"] = 3] = "info";
  OmniLogLevels2[OmniLogLevels2["debug"] = 4] = "debug";
  OmniLogLevels2[OmniLogLevels2["trace"] = 5] = "trace";
  OmniLogLevels2[OmniLogLevels2["verbose"] = Number.POSITIVE_INFINITY] = "verbose";
  return OmniLogLevels2;
})(OmniLogLevels || {});
var DEFAULT_LOG_LEVEL = 2 /* normal */;
var _OmniLog = class _OmniLog {
  constructor() {
    // PRIORITY MESSAGES
    // only time we override priority/always logger is OmniLogLevels.silent
    // these are for messages we want to show regardless of logging levels
    this._status_priority = consola.create({ level: OmniLogLevels.verbose });
    this._void = (_msg) => {
    };
    this.__log = (msg) => {
      consola.log(msg);
    };
    this._log = DEFAULT_LOG_LEVEL >= 3 /* info */ ? this.__log : this._void;
    if (_OmniLog._instance !== void 0) {
      throw new Error("Log instance duplicate error");
    }
    consola.level = DEFAULT_LOG_LEVEL;
    this._customLevel = /* @__PURE__ */ new Map();
    _OmniLog._instance = this;
  }
  get level() {
    return consola.level;
  }
  set level(value) {
    this._status_priority.level = value < 0 ? value : OmniLogLevels.verbose;
    this._log = value >= 3 /* info */ ? this.__log : this._void;
    consola.level = value;
    if (value < 0) {
      this._customLevel.forEach((e) => {
        e = OmniLogLevels.silent;
      });
    }
  }
  get warn() {
    return consola.warn;
  }
  get error() {
    return consola.error;
  }
  get info() {
    return consola.info;
  }
  get debug() {
    return consola.debug;
  }
  get verbose() {
    return consola.verbose;
  }
  get ready() {
    return consola.ready;
  }
  get success() {
    return consola.success;
  }
  get trace() {
    return consola.trace;
  }
  get log() {
    return this._log;
  }
  get assert() {
    return console.assert;
  }
  status_start(msg) {
    this._status_priority.start(msg);
  }
  status_success(msg) {
    this._status_priority.success(msg);
  }
  status_fail(msg) {
    this._status_priority.fail(msg);
  }
  access(msg) {
    this._status_priority.trace(msg);
  }
  createWithTag(id) {
    return consola.withTag(id);
  }
  wrapConsoleLogger() {
    consola.wrapConsole();
  }
  restoreConsoleLogger() {
    consola.restoreConsole();
  }
  setCustomLevel(id, level) {
    this._customLevel.set(id, level);
  }
  getCustomLevel(id) {
    return this._customLevel.get(id) ?? DEFAULT_LOG_LEVEL;
  }
  addConsolaReporter(reporter) {
    consola.addReporter(reporter);
    this._status_priority.addReporter(reporter);
  }
  removeConsolaReporter(reporter) {
    consola.removeReporter(reporter);
    this._status_priority.removeReporter(reporter);
  }
};
_OmniLog._instance = new _OmniLog();
var OmniLog = _OmniLog;
var omnilog = OmniLog._instance;
function registerOmnilogGlobal() {
  if (globalThis) {
    globalThis.omnilog = omnilog;
  }
}

// src/core/Manager.ts
var Manager = class {
  constructor(app) {
    this.app = app;
    this.children = /* @__PURE__ */ new Map();
    const logInstance = omnilog.createWithTag("Services");
    this.info = logInstance.info;
    this.success = logInstance.success;
    this.debug = logInstance.debug;
    this.verbose = logInstance.verbose;
    this.warn = logInstance.warn;
    this.error = logInstance.error;
  }
  register(Ctor, config, wrapper) {
    throw new Error("Manager register method not implemented");
  }
  async load() {
    const success = true;
    for (const [id, child] of this.children) {
      this.verbose(`${id} load`);
      await child.load?.();
    }
    return success;
  }
  async start() {
    for (const [id, child] of this.children) {
      omnilog.log(`child ${id} start`);
      await child.start?.();
    }
    omnilog.log("All children started");
    return true;
  }
  async stop() {
    this.debug("stopping children...");
    for (const child of Array.from(this.children.values()).reverse()) {
      this.verbose(`${child.id} stop`);
      await child.stop?.();
    }
    this.success("children stopped");
    return true;
  }
  get(id) {
    return this.children.get(id);
  }
  has(id) {
    return this.children.has(id);
  }
};
var Managed = class {
  constructor(id, manager, config) {
    this.id = id;
    this.manager = manager;
    this.app = manager.app;
    this.config = config;
    const logInstance = omnilog.createWithTag(id);
    this.info = logInstance.info;
    this.success = logInstance.success;
    this.debug = logInstance.debug;
    this.verbose = logInstance.verbose;
    this.warn = logInstance.warn;
    this.error = logInstance.error;
    this.trace = logInstance.trace;
  }
  async emitGlobalEvent(event, data) {
    this.verbose(`[Global.EMIT] ${this.id} emits event '${event}'`);
    await this.app.events.emit(event, data);
  }
  async emit(event, data) {
    this.verbose(`[SERVICE.EMIT] ${this.id} emits event '${event}'`);
    await this.app.events.emit(`${this.id}.${event}`, data);
  }
  subscribeToServiceEvent(serviceOrId, event, handler) {
    const id = serviceOrId.id ?? serviceOrId;
    if (id === this.id) {
      this.error(`[SERVICE.SUB] ${this.id} subscribed to self event '${event}'`);
    }
    if (!this.app.services.has(id)) {
      this.error(`[SERVICE.SUB] ${this.id} subscribed to non-existent service event '${event}' on ${id}`);
    }
    this.info(`[SERVICE.SUB Service] ${this.id} subscribed to service event '${event}' on ${id}.`);
    this.app.events.on(`${id}.${event}`, handler);
  }
  subscribeToGlobalEvent(event, handler) {
    this.debug(`[GLOBAL.SUB] ${this.id} subscribed to GlobalEvent ${event}`);
    this.app.events.on(event, handler);
  }
  unsubscribeFromGlobalEvent(event, handler) {
    this.verbose(`[GLOBAL.UNSUBSUB] ${this.id} unsubscribed from GlobalEvent ${event}`);
    this.app.events.off(event, handler);
  }
  async registerAPI({ method, url, handler, insecure, authStrategy, schema, websocket }) {
    this.debug("registerAPI", method, url);
    if (!url) {
      this.error("registerAPI: url is required");
      return false;
    }
    if (handler == null || typeof handler !== "function") {
      this.error("registerAPI: handler is required and must be a function", method, url);
      return false;
    }
    await this.emitGlobalEvent("registerAPI", { method, url, handler, insecure, authStrategy, schema, websocket });
  }
};

// src/core/Integrations.ts
var IntegrationsManager = class extends Manager {
  constructor(app) {
    super(app);
    Object.defineProperty(this, "integrations", { get: () => this.children });
    this._integrations = [];
  }
  // Unlike services, we want to delay the creation until all the services have loaded, so we
  // just store an array here which we process for the actual registration step in load()
  register(Ctor, config) {
    this.verbose(`pre-registering ${config.id} integration`);
    this._integrations.push([Ctor, config]);
  }
  async load() {
    for (const [Ctor, config] of this._integrations) {
      this.verbose(`registering integration ${config.id}...`);
      const integration = new Ctor(config.id, this, config);
      this.children.set(config.id, integration);
      integration.create?.();
    }
    this.debug("loading integrations...");
    const result = await super.load();
    this.success("integrations loaded");
    return result;
  }
  async start() {
    this.debug("starting integrations...");
    await super.start();
    this.success("integrations started");
    return true;
  }
};
var Integration = class extends Managed {
  constructor(id, manager, config) {
    super(id, manager, config);
  }
};

// src/core/ServiceManager.ts
var ServiceManager = class extends Manager {
  constructor(app) {
    super(app);
    Object.defineProperty(this, "services", { get: () => this.children });
  }
  register(Ctor, config, wrapper) {
    this.debug(`registering ${config.id} service`);
    let service = new Ctor(config.id, this, config);
    if (wrapper && typeof wrapper === "function") {
      service = wrapper(service);
    }
    this.children.set(config.id, service);
    service.create?.();
    return service;
  }
  async load() {
    this.debug("loading services...");
    const success = await super.load();
    if (!success) {
      this.error("failed to load services");
      return false;
    }
    this.success("services loaded");
    return true;
  }
  async start() {
    this.debug("starting services...");
    await super.start();
    this.success("services started");
    return true;
  }
};

// src/core/App.ts
import { parse, stringify } from "@ungap/structured-clone/json";

// src/core/Settings.ts
var Settings = class {
  constructor(scope) {
    this.settings = /* @__PURE__ */ new Map();
    this.scope = scope;
  }
  bindStorage(storage) {
    this.settings = storage;
  }
  // Adds a setting to this system.
  add(setting) {
    if (this.settings.has(setting.key)) {
      omnilog.debug(`Setting ${setting.key} already exists, doing nothing...`);
      return this;
    }
    this.settings.set(setting.key, setting);
    return this;
  }
  // Retrieves a setting by its key.
  get(key) {
    return this.settings.get(key);
  }
  // Updates a setting's value and validates it.
  update(key, newValue) {
    const setting = this.get(key);
    if (setting) {
      setting.value = newValue;
      this.settings.set(key, setting);
    }
  }
  // Resets a specific setting to its default value.
  reset(key) {
    const setting = this.get(key);
    if (setting) {
      setting.value = setting.defaultValue;
      this.settings.set(key, setting);
    }
  }
  // Resets all settings to their default values.
  resetAll() {
    if (this.settings) {
      for (const s of this.settings.values()) {
        s.value = s.defaultValue;
        this.settings.set(s.key, s);
      }
    }
  }
  // Retrieves all settings in this system.
  getAll() {
    return Array.from(this.settings.values());
  }
  //Deletes a setting from the server
  delete(key) {
    this.settings.delete(key);
  }
};

// src/core/App.ts
var STATE = /* @__PURE__ */ ((STATE2) => {
  STATE2[STATE2["CREATED"] = 0] = "CREATED";
  STATE2[STATE2["CONFIGURED"] = 1] = "CONFIGURED";
  STATE2[STATE2["LOADED"] = 2] = "LOADED";
  STATE2[STATE2["STARTED"] = 3] = "STARTED";
  STATE2[STATE2["STOPPED"] = 4] = "STOPPED";
  return STATE2;
})(STATE || {});
var App = class {
  constructor(id, config, opts) {
    this.state = 0 /* CREATED */;
    this.id = id;
    opts ?? (opts = {
      integrationsManagerType: IntegrationsManager
    });
    this.config = config;
    this.version = config.version;
    this.logger = omnilog;
    this.services = new ServiceManager(this);
    this.integrations = new (opts.integrationsManagerType || IntegrationsManager)(this);
    const loginstance = this.logger.createWithTag(id);
    this.settings = new Settings();
    this.info = loginstance.info;
    this.success = loginstance.success;
    this.debug = loginstance.debug;
    this.error = loginstance.error;
    this.verbose = loginstance.verbose;
    this.warn = loginstance.warn;
    this.events = new EventEmitter(
      omnilog.getCustomLevel("emittery") > OmniLogLevels.silent ? { debug: { name: "app.events", enabled: true } } : void 0
    );
  }
  // registers a service or integration
  use(middleware, config, middlewareType, wrapper) {
    this.verbose("[APP.USE] use", middleware.name);
    if (middlewareType === "service" || middleware.name.endsWith("Service")) {
      const service = middleware;
      this.services.register(service, config, wrapper);
    } else if (middlewareType === "integration" || middleware.name.endsWith("Integration")) {
      const integration = middleware;
      this.integrations.register(integration, config);
    } else {
      this.warn(`[APP.USE] Unknown middleware type ${middleware.name}`);
    }
    return this;
  }
  // ----- messaging
  async emit(event, data) {
    this.debug("[APP.EMIT Global] emit", event);
    await this.events.emit(event, data);
  }
  // ----- app state control
  async load() {
    if (this.state >= 2 /* LOADED */) {
      omnilog.warn("Cannot load more than once, ignoring call");
      return true;
    }
    const owner = this;
    if (owner.onConfigure != null) {
      await owner.onConfigure();
    }
    this.state = 1 /* CONFIGURED */;
    if (!await this.services.load()) {
      throw new Error("Failed to load services, see console for details");
    }
    await this.integrations.load();
    if (owner.onLoad != null) {
      await owner.onLoad();
    }
    await this.emit("loaded", {});
    this.success("app loaded");
    this.state = 2 /* LOADED */;
    return true;
  }
  async start() {
    if (this.state === 3 /* STARTED */) {
      omnilog.warn("Cannot start more than once, ignoring call");
      return true;
    }
    const owner = this;
    await this.services.start();
    await this.integrations.start();
    if (owner.onStart != null) {
      await owner.onStart();
    }
    this.success("app started");
    this.state = 3 /* STARTED */;
    await this.emit("started", {});
    return true;
  }
  async stop() {
    this.info("app stopping");
    await this.integrations.stop();
    await this.services.stop();
    await this.emit("stopped", {});
    this.success("app stopped");
    this.state = 4 /* STOPPED */;
    return true;
  }
  subscribeToGlobalEvent(event, handler) {
    this.info(`[APP.SUB Global] ${this.id} subscribed to GlobalEvent ${event}`);
    this.events.on(event, handler);
  }
  subscribeToServiceEvent(serviceOrId, event, handler) {
    const id = serviceOrId.id ?? serviceOrId;
    if (!this.services.has(id)) {
      this.warn(
        `[SERVICE.SUB Service] ${this.id} subscribed to unknown service '${id}'. This can be ok in some cases, but usually indicates a bug.`
      );
    }
    this.info(`[SERVICE.SUB App] ${this.id} subscribed to service event '${event}' on ${id}`);
    this.events.on(`${id}.${event}`, handler);
  }
  stringify(obj) {
    return stringify(obj, null, 2);
  }
  parse(str) {
    return parse(str);
  }
};
App.STATES = STATE;

// src/core/Service.ts
var Service = class extends Managed {
  constructor(id, manager, config) {
    super(id, manager, config);
  }
};

// src/core/Extensions.ts
var AppExtension = class extends Managed {
  constructor(id, manager, config) {
    super(id, manager, config);
  }
  async emit(event, ...data) {
    this.verbose(`[Extension.EMIT] ${this.id} emits event '${event}'`);
    await this.app.emit(`${this.id}.${event}`, data);
  }
  get extensionConfig() {
    return this.config;
  }
};
var ExtensionManager = class extends Manager {
  constructor(app) {
    super(app);
  }
};

// src/core/Workflow.ts
import insane from "insane";
var EWorkflowVisibility = /* @__PURE__ */ ((EWorkflowVisibility2) => {
  EWorkflowVisibility2["PUBLIC"] = "public";
  return EWorkflowVisibility2;
})(EWorkflowVisibility || {});
var BaseWorkflow = class _BaseWorkflow {
  get blockIds() {
    return Array.from(new Set(
      Object.values(this?.rete?.nodes ?? {}).map((node) => node.name)
    )).sort();
  }
  constructor(id, meta) {
    this.id = id ?? "";
    this.setMeta(meta);
    this.setRete(null);
    this.setAPI(null);
    this.setUI(null);
  }
  setMeta(meta) {
    var _a, _b, _c, _d, _e;
    meta = JSON.parse(JSON.stringify(meta ?? {}));
    meta = meta ?? { name: "New Recipe", description: "No description.", pictureUrl: "omni.png", author: "Anonymous" };
    this.meta = meta;
    (_a = this.meta).updated ?? (_a.updated = Date.now());
    (_b = this.meta).created ?? (_b.created = Date.now());
    (_c = this.meta).tags ?? (_c.tags = []);
    (_d = this.meta).author || (_d.author = "Anonymous");
    (_e = this.meta).help || (_e.help = "");
    this.meta.name = insane(this.meta.name, { allowedTags: [], allowedAttributes: {} });
    this.meta.description = insane(this.meta.description, { allowedTags: [], allowedAttributes: {} });
    this.meta.author = insane(this.meta.author, { allowedTags: [], allowedAttributes: {} });
    this.meta.help = insane(this.meta.help, { allowedTags: [], allowedAttributes: {} });
    return this;
  }
  setRete(rete) {
    this.rete = rete;
    return this;
  }
  setAPI(api) {
    this.api = api ?? { fields: {} };
    return this;
  }
  setUI(ui) {
    this.ui = ui ?? {};
    return this;
  }
  get isBlank() {
    return (this?.rete?.nodes ?? []).length === 0;
  }
  toJSON() {
    return {
      id: this.id,
      meta: this.meta,
      rete: this.rete,
      api: this.api,
      ui: this.ui,
      blockIds: this.blockIds
    };
  }
  static fromJSON(json) {
    const result = new _BaseWorkflow(json.id);
    result.setMeta(json.meta);
    json.rete.nodes = JSON.parse(JSON.stringify(json.rete.nodes).replace(/omni-extension-replicate:/g, "omni-core-replicate:"));
    json.rete.nodes = JSON.parse(JSON.stringify(json.rete.nodes).replace(/omni-extension-formio:/g, "omni-core-formio:"));
    result.setRete(json.rete);
    result.setAPI(json.api);
    result.setUI(json.ui);
    return result;
  }
};
var _Workflow = class _Workflow extends BaseWorkflow {
  // publishedTo: string[] // Either 'public', organisation IDs, group IDs, or user IDs
  constructor(id, data, meta) {
    super(id, meta);
    this._id = `wf:${id}`;
    this.owner = data.owner;
    this.org = data.org;
  }
  toJSON() {
    return {
      ...super.toJSON(),
      _id: this._id,
      _rev: this._rev,
      owner: this.owner,
      org: this.org
      // publishedTo: this.publishedTo
    };
  }
  static fromJSON(json) {
    let id = json._id?.replace("wf:", "") || json.id;
    if (json.id && json.id.length > 16 && id.startsWith(json.id)) {
      id = json.id;
    }
    const result = new _Workflow(id, { owner: json.owner || json.meta.owner, org: json.org });
    json.rete = JSON.parse(JSON.stringify(json.rete).replace(/omni-extension-replicate:/g, "omni-core-replicate:"));
    json.rete = JSON.parse(JSON.stringify(json.rete).replace(/omni-extension-formio:/g, "omni-core-formio:"));
    result.setMeta(json.meta);
    result.setRete(json.rete);
    result.setAPI(json.api);
    result.setUI(json.ui);
    if (json._rev) {
      result._rev = json._rev;
    }
    return result;
  }
};
_Workflow.modelName = "Workflow";
var Workflow = _Workflow;

// src/services/APIService.ts
import axios from "axios";
var APIService = class extends Service {
  constructor(id, manager, config) {
    super(id, manager, config || { id });
  }
  create() {
    this.info(`${this.id} create`);
    Object.defineProperty(this.app, "api", { value: this, writable: false, enumerable: false });
    return true;
  }
  _clampValues(remoteAPI, args) {
    const service = this;
    for (const key in args) {
      const rp = remoteAPI.params[key];
      if (rp != null && rp.type === "number") {
        if (rp.min != null && args[key] < rp.min) {
          service.warn(
            `Invalid parameter value for ${key} for ${remoteAPI.namespace}.${remoteAPI.name}, clamping to min value ${rp.min}`,
            args
          );
          args[key] = rp.min;
        }
        if (rp.max != null && args[key] > rp.max) {
          service.warn(
            `Invalid parameter value for ${key} for ${remoteAPI.namespace}.${remoteAPI.name}, clamping to max value ${rp.max}`
          );
          args[key] = rp.max;
        }
      }
    }
  }
  _validateArgs(remoteAPI, args) {
    const service = this;
    for (const param of remoteAPI.params) {
      if (param.required === true && args[param.name] == null) {
        service.error(`Missing parameter ${param.name} for ${remoteAPI.namespace}.${remoteAPI.name}`, args);
        throw new Error(`Missing parameter ${param.name} for ${remoteAPI.namespace}.${remoteAPI.name}`);
      } else if (args[param.name] == null && param.default != null) {
        args[param.name] = param.default;
      }
      let isArray = false;
      if (args[param.name] != null && param.type != null) {
        isArray = param.type.includes("[]");
        let type = param.type;
        const value = args[param.name];
        if (isArray) {
          type = type.replace("[]", "");
          if (!Array.isArray(value)) {
            const err = `Invalid parameter type ${typeof value} for ${param.name} for ${remoteAPI.namespace}.${remoteAPI.name}. Expected an Array`;
            service.error(err);
            throw new Error(err);
          }
        }
        if (type !== "") {
          if (isArray) {
            if (!value.every((v) => type === "image" && v.ticket || typeof v === type)) {
              const err = `Invalid parameter value type ${typeof value[0]} for ${param.name} for ${remoteAPI.namespace}.${remoteAPI.name}. Expected an Array of ${type}`;
              service.error(err);
              throw new Error(err);
            }
          } else if (type === "image" && !value.ticket || typeof value !== type) {
            const err = `Invalid parameter type ${typeof value} for ${param.name} for ${remoteAPI.namespace}.${remoteAPI.name}. Expected ${type}`;
            service.error(err);
            throw new Error(err);
          }
        }
      }
    }
  }
  // Function to convert artifacts to the right representation required for this service
  async _convertValues(remoteAPI, args) {
  }
  wrappedAxiosCall(remoteAPI) {
    const service = this;
    return async function(args, opts, responseOpts) {
      for (const key in args) {
        if (args[key] == null) {
          delete args[key];
        }
      }
      service.verbose(`Validating ${remoteAPI.namespace}.${remoteAPI.name}`);
      service._validateArgs(remoteAPI, args);
      service._clampValues(remoteAPI, args);
      await service._convertValues(remoteAPI, args);
      const serviceConfig = service.config;
      let axiosConfig = {
        // @ts-ignore
        method: remoteAPI.method.toLowerCase(),
        // @ts-ignore
        url: serviceConfig.host + remoteAPI.endpoint,
        withCredentials: true,
        data: args
      };
      if (axiosConfig.method === "get") {
        axiosConfig.params = args;
      }
      if (opts != null && typeof opts === "object") {
        axiosConfig = { ...axiosConfig, ...opts };
      }
      service.info(`Invoking ${remoteAPI.namespace}.${remoteAPI.name}`);
      try {
        const result = await axios(axiosConfig);
        service.verbose("Remote function result received");
        if (responseOpts?.raw) {
          return result;
        } else {
          if (remoteAPI.results != null && typeof remoteAPI.results === "object" && Object.keys(remoteAPI.results).length > 0) {
            const ret = {};
            for (const key in remoteAPI.results) {
              ret[key] = result.data[remoteAPI.results[key].prop];
            }
            return ret;
          } else {
            return result.data;
          }
        }
      } catch (ex) {
        service.error(
          `Error invoking ${remoteAPI.namespace}.${remoteAPI.name}`,
          axiosConfig,
          ex?.response?.data?.error,
          ex
        );
        return { error: ex?.response?.data?.error || ex?.message || ex };
      }
    };
  }
  async getRemoteAPIsfromServer() {
    const serviceConfig = this.config;
    try {
      this.verbose("Registering remote functions from", serviceConfig.host, serviceConfig.integrationsUrl);
      const result = await axios.get(serviceConfig.host + serviceConfig.integrationsUrl);
      this.success("Received remoteAPIs from server");
      return result.data;
    } catch (ex) {
      this.error("Failed to load remoteAPIs from server", ex);
      return [];
    }
  }
  async start() {
    this.info(`${this.id} start`);
    return true;
  }
  async stop() {
    this.info(`${this.id} stop`);
    return true;
  }
};

// src/objects/DBObject.ts
var DBObject = class {
  constructor(id) {
    this._rev = void 0;
    this.id = id;
    this.createdAt = Date.now();
    this.lastUpdated = Date.now();
  }
  processAPIResponse(response) {
    if (response.ok) {
      this._id = response.id;
      this._rev = response.rev;
    }
  }
};

// src/objects/Group.ts
var EObjectName = /* @__PURE__ */ ((EObjectName2) => {
  EObjectName2["USER"] = "User";
  EObjectName2["GROUP"] = "Group";
  EObjectName2["ORGANISATION"] = "Organisation";
  EObjectName2["WORKFLOW"] = "Workflow";
  return EObjectName2;
})(EObjectName || {});
var EObjectAction = /* @__PURE__ */ ((EObjectAction2) => {
  EObjectAction2["CREATE"] = "create";
  EObjectAction2["READ"] = "read";
  EObjectAction2["UPDATE"] = "update";
  EObjectAction2["DELETE"] = "delete";
  EObjectAction2["EXECUTE"] = "exec";
  return EObjectAction2;
})(EObjectAction || {});
var _Group = class _Group extends DBObject {
  constructor(id, name) {
    super(id);
    this._id = `${_Group.modelName}:${this.id}`;
    this.name = name;
    this.credit = 0;
    this.organisation = null;
    this.members = [];
    this.permission = [];
  }
};
_Group.modelName = "Group";
var Group = _Group;

// src/objects/Organisation.ts
var _Organisation = class _Organisation extends DBObject {
  constructor(id, name) {
    super(id);
    this._id = `${_Organisation.modelName}:${this.id}`;
    this.name = name;
    this.members = [];
    this.groups = [];
  }
};
_Organisation.modelName = "Organisation";
var Organisation = _Organisation;

// src/objects/User.ts
var EUserStatus = /* @__PURE__ */ ((EUserStatus2) => {
  EUserStatus2["ACTIVE"] = "active";
  EUserStatus2["INACTIVE"] = "inactive";
  return EUserStatus2;
})(EUserStatus || {});
var _User = class _User extends DBObject {
  constructor(id, username) {
    super(id);
    this._id = `user:${this.id}`;
    this.email = null;
    this.username = username;
    this.status = "active" /* ACTIVE */;
    this.credit = 0;
    this.organisation = null;
    this.tier = null;
    this.password = null;
    this.salt = null;
    this.tags = [];
    this.settings = new Settings(this.id);
    this.tosAccepted = 0;
  }
  // @deprecated
  isAdmin() {
    omnilog.warn("User.isAdmin() is deprecated. Use AuthIntegration.isAdmin() instead");
    return this.tags.some((tag) => tag === "admin");
  }
  static fromJSON(json) {
    const result = new _User(json.id, json.username);
    result._id = json._id;
    result._rev = json._rev;
    result.id = json.id;
    result.createdAt = json.createdAt;
    result.lastUpdated = json.lastUpdated;
    result.email = json.email;
    result.username = json.username;
    result.status = json.status;
    result.externalId = json.externalId;
    result.authType = json.authType;
    result.credit = json.credit;
    result.organisation = json.organisation;
    result.tier = json.tier;
    result.password = json.password;
    result.salt = json.salt;
    result.tags = json.tags;
    result.tosAccepted = json.tosAccepted;
    return result;
  }
};
_User.modelName = "User";
var User = _User;

// src/objects/Tier.ts
var ETierLimitKey = /* @__PURE__ */ ((ETierLimitKey2) => {
  ETierLimitKey2["CREDIT"] = "Credit";
  ETierLimitKey2["CONCURRENT_WORKFLOW"] = "Concurrent Workflow";
  return ETierLimitKey2;
})(ETierLimitKey || {});
var ETierLimitOp = /* @__PURE__ */ ((ETierLimitOp2) => {
  ETierLimitOp2["MAX"] = "Max";
  ETierLimitOp2["MIN"] = "Min";
  ETierLimitOp2["EQUAL"] = "==";
  return ETierLimitOp2;
})(ETierLimitOp || {});
var ETierLimitValue = /* @__PURE__ */ ((ETierLimitValue2) => {
  ETierLimitValue2["UNLIMITED"] = "Unlimited";
  return ETierLimitValue2;
})(ETierLimitValue || {});
var _Tier = class _Tier extends DBObject {
  constructor(id, name) {
    super(id);
    this._id = `${_Tier.modelName}:${this.id}`;
    this.name = name;
    this.limits = [];
  }
};
_Tier.modelName = "Tier";
var Tier = _Tier;

// src/objects/Pagination.ts
function CreatePaginatedObject() {
  return { data: [], page: void 0, docsPerPage: void 0, totalDocs: void 0, totalPages: void 0 };
}

// src/objects/Key.ts
var _APIKey = class _APIKey extends DBObject {
  // _id of the owner
  constructor(id) {
    super(id);
    this._id = `${_APIKey.modelName}:${this.id}`;
    this.meta = {
      name: "",
      description: "",
      owner: {
        id: "",
        type: "",
        name: ""
      },
      revoked: false
    };
    this.key = "";
    this.vaultType = "local";
    this.owner = "";
    this.apiNamespace = "";
    this.variableName = "";
  }
};
_APIKey.modelName = "APIKey";
var APIKey = _APIKey;

// src/core/Collection.ts
import { v4 as uuidv4 } from "uuid";
var Collection = class _Collection {
  // Creation
  constructor(creator, owner, org, meta) {
    this._id = uuidv4();
    this.items = [];
    this.creator = creator;
    this.owner = owner;
    this.org = org;
    this.meta = meta;
  }
  // Size of the collection
  getSize() {
    return this.items.length;
  }
  // Convert the Collection object to a JSON string
  toJSON() {
    return JSON.stringify(this);
  }
  // Convert a JSON string to a Collection object
  static fromJSON(json) {
    try {
      const data = JSON.parse(json);
      if (!Array.isArray(data.items)) {
        omnilog.error("Invalid items data");
        return null;
      }
      const collection = new _Collection(data.creator, data.owner, data.org, data.meta);
      collection.items = data.items;
      collection._id = data._id;
      return collection;
    } catch (e) {
      omnilog.error("Error parsing JSON", e);
      return null;
    }
  }
  add(item) {
    if (!Array.isArray(item)) {
      item = [item];
    }
    this.remove(item.map((i) => i.id));
    this.items.push(...item);
  }
  remove(id) {
    if (!Array.isArray(id)) {
      id = [id];
    }
    this.items = this.items.filter((item) => !id.includes(item.id));
  }
  // Database access, save
  async saveToDB(db) {
    try {
      const response = await db.insert(this);
      omnilog.log("Saved to DB", response);
    } catch (err) {
      omnilog.error("Error saving to DB", err);
    }
  }
  // Database access, load
  static async loadFromDB(db, id) {
    try {
      const doc = await db.get(id);
      const collection = _Collection.fromJSON(JSON.stringify(doc));
      if (!collection) {
        return null;
      }
      return collection;
    } catch (err) {
      return null;
    }
  }
  //Pagination
  getPage(pageSize, bookmark) {
    let startIndex = 0;
    if (bookmark) {
      const bookmarkIndex = this.items.findIndex((item) => item.id === bookmark);
      if (bookmarkIndex === -1) {
        throw new Error(`Bookmark id not found: ${bookmark}`);
      }
      startIndex = bookmarkIndex;
    }
    const page = this.items.slice(startIndex, startIndex + pageSize);
    const prevBookmark = startIndex > pageSize ? this.items[startIndex - pageSize]?.id : "";
    const nextBookmark = startIndex + pageSize < this.items.length ? this.items[startIndex + pageSize]?.id : "";
    const currBookmark = this.items[startIndex]?.id || "";
    const skipped = startIndex;
    const remaining = Math.max(this.items.length - (startIndex + pageSize), 0);
    return {
      page,
      skipped,
      remaining,
      currBookmark,
      nextBookmark,
      prevBookmark
    };
  }
};

// src/services/MessagingBaseService.ts
var MessagingServiceBase = class extends Service {
  constructor(id, manager, config) {
    super(id, manager, config || { id: "messaging" });
    this.config = config;
  }
};
var OmniSSEMessages = /* @__PURE__ */ ((OmniSSEMessages2) => {
  OmniSSEMessages2["CLIENT_TOAST"] = "client:toast";
  OmniSSEMessages2["CUSTOM_EXTENSION_EVENT"] = "custom_extension_event";
  OmniSSEMessages2["SHOW_EXTENSION"] = "extension:show";
  return OmniSSEMessages2;
})(OmniSSEMessages || {});

// src/objects/Job.ts
var JOBSTATE = /* @__PURE__ */ ((JOBSTATE2) => {
  JOBSTATE2["READY"] = "ready";
  JOBSTATE2["RUNNING"] = "running";
  JOBSTATE2["SUCCESS"] = "success";
  JOBSTATE2["STOPPED"] = "stopped";
  JOBSTATE2["FORCESTOP"] = "forceStop";
  JOBSTATE2["ERROR"] = "error";
  return JOBSTATE2;
})(JOBSTATE || {});
var Job = class {
  constructor(opts) {
    this._activeNode = [];
    this._activeNodeName = "";
    this.errors = [];
    this._nodeNameMap = {};
    this.id = opts.id;
    this._state = "ready" /* READY */;
    this._meta = opts?.meta;
    this._activity = "";
  }
  get meta() {
    return this._meta;
  }
  get activity() {
    return this._activity;
  }
  get workflowId() {
    return this._workflowId;
  }
  set workflowId(workflowId) {
    this._workflowId = workflowId;
  }
  get state() {
    return this._state;
  }
  set state(state) {
    this._state = state;
  }
  get activeNode() {
    return this._activeNode;
  }
  nodeDescriptionFromId(nodeId) {
    return this._nodeNameMap[nodeId] ?? `node_${nodeId}`;
  }
  setNodeName(nodeId, nodeName) {
    this._nodeNameMap[nodeId] = nodeName;
  }
};

// src/enums/system.ts
var NodeProcessEnv = /* @__PURE__ */ ((NodeProcessEnv2) => {
  NodeProcessEnv2["development"] = "development";
  NodeProcessEnv2["staging"] = "staging";
  NodeProcessEnv2["production"] = "production";
  return NodeProcessEnv2;
})(NodeProcessEnv || {});

// src/core/Utils.ts
var Utils = class {
  static isValidUrl(str) {
    let url;
    try {
      url = new URL(str);
    } catch (e) {
      return false;
    }
    return url.protocol === "http:" || url.protocol === "https:";
  }
  static async fetchJSON(url, proxyViaServer = true) {
    return await new Promise((resolve, reject) => {
      if (!this.isValidUrl(url)) {
        reject(new Error(`Invalid URL: ${url}`));
      }
      if (proxyViaServer) {
        url = `/api/v1/mercenaries/fetch?url=${encodeURIComponent(url)}`;
      }
      fetch(url).then((response) => {
        if (response.ok) {
          resolve(response.json());
        } else {
          reject(new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`));
        }
      }).catch((error) => {
        reject(new Error(`Failed to fetch ${url}: ${error}`));
      });
    });
  }
};
export {
  APIKey,
  APIService,
  App,
  AppExtension,
  BaseWorkflow,
  Collection,
  CreatePaginatedObject,
  DBObject,
  EObjectAction,
  EObjectName,
  ETierLimitKey,
  ETierLimitOp,
  ETierLimitValue,
  EUserStatus,
  EWorkflowVisibility,
  ExtensionManager,
  Group,
  Integration,
  IntegrationsManager,
  JOBSTATE,
  Job,
  Managed,
  Manager,
  MessagingServiceBase,
  NodeProcessEnv,
  OmniLogLevels,
  OmniSSEMessages,
  Organisation,
  Service,
  ServiceManager,
  Settings,
  Tier,
  User,
  Utils,
  Workflow,
  insane2 as insane,
  omnilog,
  registerOmnilogGlobal
};
//# sourceMappingURL=index.js.map
