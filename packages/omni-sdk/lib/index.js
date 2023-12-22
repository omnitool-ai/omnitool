// src/Resources/OmniResource.ts
var OmniResource = class _OmniResource {
  static isPlaceholder(obj) {
    return obj?.onclick != null;
  }
  static isAudio(obj) {
    return obj && !_OmniResource.isPlaceholder(obj) && obj?.mimeType?.startsWith("audio/") || obj.mimeType == "application/ogg";
  }
  static isImage(obj) {
    return obj && !_OmniResource.isPlaceholder(obj) && obj?.mimeType?.startsWith("image/");
  }
  static isDocument(obj) {
    return obj && !_OmniResource.isPlaceholder(obj) && (obj?.mimeType?.startsWith("text/") || obj?.mimeType?.startsWith("application/pdf"));
  }
};

// src/types.ts
var OMNI_SDK_VERSION = "0.9.5";
var OmniSDKClientMessages = /* @__PURE__ */ ((OmniSDKClientMessages2) => {
  OmniSDKClientMessages2["REGISTRATION"] = "client_registration";
  OmniSDKClientMessages2["DEREGISTRATION"] = "client_deregistration";
  OmniSDKClientMessages2["SEND_CHAT_MESSAGE"] = "client_send_chat";
  OmniSDKClientMessages2["RUN_CLIENT_SCRIPT"] = "client_run_cscript";
  OmniSDKClientMessages2["SIGNAL_INTENT"] = "client_signal_intent";
  OmniSDKClientMessages2["WINDOW_MESSAGE"] = "client_window_message";
  OmniSDKClientMessages2["SHOW_TOAST"] = "client_show_toast";
  OmniSDKClientMessages2["SHOW_EXTENSION"] = "client_show_extension";
  OmniSDKClientMessages2["LOAD_RECIPE"] = "client_load_recipe";
  OmniSDKClientMessages2["SHOW_TOP_BANNER"] = "client_show_top_banner";
  return OmniSDKClientMessages2;
})(OmniSDKClientMessages || {});
var OmniSDKStorageKeys = /* @__PURE__ */ ((OmniSDKStorageKeys2) => {
  OmniSDKStorageKeys2["INTENT_MAP"] = "omni-intentMap";
  return OmniSDKStorageKeys2;
})(OmniSDKStorageKeys || {});
var OmniSDKClientEvents = /* @__PURE__ */ ((OmniSDKClientEvents2) => {
  OmniSDKClientEvents2["DATA_UPDATED"] = "data_updated";
  OmniSDKClientEvents2["CUSTOM_EVENT"] = "custom_event";
  OmniSDKClientEvents2["CHAT_MESSAGE_RECEIVED"] = "chat_message_received";
  return OmniSDKClientEvents2;
})(OmniSDKClientEvents || {});
var OmniSDKHostMessages = /* @__PURE__ */ ((OmniSDKHostMessages2) => {
  OmniSDKHostMessages2["ACKNOWLEDGE"] = "host_acknowledge";
  OmniSDKHostMessages2["CLIENT_SCRIPT_RESPONSE"] = "host_cscript_response";
  OmniSDKHostMessages2["SYNC_DATA"] = "host_sync_data";
  OmniSDKHostMessages2["CHAT_COMMAND"] = "host_chat_command";
  OmniSDKHostMessages2["CHAT_MESSAGE_RECEIVED"] = "host_chat_message_received";
  OmniSDKHostMessages2["CUSTOM_EVENT"] = "custom_extension_event";
  return OmniSDKHostMessages2;
})(OmniSDKHostMessages || {});
var EOmniFileTypes = /* @__PURE__ */ ((EOmniFileTypes2) => {
  EOmniFileTypes2["image"] = "image";
  EOmniFileTypes2["audio"] = "audio";
  EOmniFileTypes2["document"] = "document";
  EOmniFileTypes2["video"] = "video";
  EOmniFileTypes2["file"] = "file";
  return EOmniFileTypes2;
})(EOmniFileTypes || {});

// src/Resources/OmniBaseResource.ts
var OmniBaseResource = class _OmniBaseResource {
  constructor(resource) {
    this.fid = resource.fid || resource.ticket?.fid;
    if (!this.fid)
      throw new Error("Invalid resource, fid missing");
    this.ticket = resource.ticket;
    this.fileName = resource.fileName;
    this.size = resource.size;
    this.data = resource.data;
    this.url = resource.url;
    this.mimeType = resource.mimeType;
    this.expires = resource.expires;
    this.meta = resource.meta || {};
    this.meta.created = this.meta.created || Date.now();
    let ext = this.fileName.split(".").pop();
    this.furl = `fid://${this.fid}.${ext}`;
    this.fileType = _OmniBaseResource.determineFileTypeFromMimeType(this.mimeType) || resource.fileType || "file" /* file */;
  }
  static determineFileTypeFromMimeType(mimeType) {
    const validFileTypes = [
      "audio" /* audio */,
      "document" /* document */,
      "image" /* image */,
      "video" /* video */,
      "file" /* file */
    ];
    if (mimeType) {
      let ft = mimeType.split("/")[0];
      if (validFileTypes.includes(ft)) {
        return ft;
      }
      if (ft.startsWith("text/")) {
        return "document" /* document */;
      }
      if (ft === "application/ogg") {
        return "audio" /* audio */;
      }
      if (ft === "application/pdf") {
        return "document" /* document */;
      }
      if (ft === "video/") {
        return "video" /* video */;
      }
    }
    return void 0;
  }
  isAudio() {
    if (this.fileType === "audio" /* audio */) {
      return true;
    }
    if (this.mimeType) {
      return this.mimeType?.startsWith("audio/") || this.mimeType?.startsWith("application/ogg");
    }
    return false;
  }
  isVideo() {
    if (this.fileType === "video" /* video */) {
      return true;
    }
    if (this.mimeType) {
      return this.mimeType?.startsWith("video/");
    }
    return false;
  }
  isImage() {
    if (this.fileType === "image" /* image */) {
      return true;
    }
    if (this.mimeType) {
      return this.mimeType?.startsWith("image/");
    }
    return false;
  }
  isDocument() {
    if (this.fileType === "document" /* document */) {
      return true;
    }
    if (this.mimeType) {
      return this.mimeType?.startsWith("text/") || this.mimeType?.startsWith("application/pdf");
    }
    return false;
  }
  asBase64(addHeader) {
    if (this.data instanceof Buffer) {
      if (addHeader) {
        return `data:${this.mimeType};base64,${this.data.toString("base64")}`;
      } else {
        return this.data.toString("base64");
      }
    } else if (typeof this.data === "string") {
      return this.data;
    }
  }
};

// src/Utils/HttpClient.ts
var HTTPClient = class {
  constructor(fetchFn = (input, init) => window.fetch(input, init)) {
    this.fetch = fetchFn;
  }
  async executeRequest(input, init) {
    return await this.fetch(input, init);
  }
};

// src/OmniSDKShared.ts
import EventEmitter from "emittery";
var OmniSDKShared = class {
  constructor() {
    this.messageHandlers = {};
    this._isClient = false;
    this.Resource = OmniResource;
    this.events = new EventEmitter();
    this.intentMap = /* @__PURE__ */ new Map();
    this._messageListenerHandler = (event) => {
      if (event.origin !== window.location.origin) {
        console.warn(`Dropping Message received from an unknown origin: ${event.origin}`);
        return;
      }
      try {
        const data = event.data;
        const handler = this.messageHandlers[data.type];
        if (handler) {
          handler.call(this, data, event.source);
        } else {
          console.warn(`No handler found for message type: ${data.type}`);
        }
      } catch (error) {
        console.error("Error processing the message:", error);
      }
    };
    this._initMessageListener();
    this._httpClient = new HTTPClient();
  }
  unload() {
    window.removeEventListener("message", this._messageListenerHandler);
    console.log("Message listener removed.");
  }
  _initMessageListener() {
    window.addEventListener("message", this._messageListenerHandler, false);
    console.log("Message listener initialized.");
  }
  addMessageHandler(type, handler) {
    this.messageHandlers[type] = handler;
  }
  getLocalValue(key, value) {
    let finalKey = key;
    if (this._isClient) {
      finalKey = "omni/" + this._extensionId + "/" + key;
    } else {
      finalKey = "omni/host/" + key;
    }
    let stored = globalThis.localStorage.getItem(finalKey);
    if (stored !== null) {
      let record = JSON.parse(stored);
      let value2 = record.value;
      switch (record.type) {
        case "boolean":
          value2 = value2 === "true" ? true : false;
          break;
        case "object":
        case "number":
        case "string":
          break;
        default:
          console.warn("Unsupported value type", record.type, "on", key);
          return null;
      }
      return value2;
    }
    return null;
  }
  setLocalValue(key, value) {
    if (key == null || key.length == 0) {
      throw new Error("Invalid null Key passed into setLocalValue");
    }
    let finalKey = key;
    if (this._isClient) {
      finalKey = "omni/" + this._extensionId + "/" + key;
    } else {
      finalKey = "omni/host/" + key;
    }
    if (value === null || value === void 0) {
      globalThis.localStorage.removeItem(finalKey);
      return;
    }
    const valueType = typeof value;
    let finalValue = value;
    switch (valueType) {
      case "number":
      case "string":
      case "object":
        break;
      case "boolean":
        finalValue = value ? "true" : "false";
        break;
      default:
        console.warn("Unsupported value type", valueType, "on", key);
        return;
    }
    globalThis.localStorage.setItem(finalKey, JSON.stringify({
      type: valueType,
      value
    }));
  }
  send(message, token) {
    if (this._isClient) {
      console.log("Sending message from client:", message);
      message.token = this.token;
      message = JSON.parse(JSON.stringify(message));
      window.parent.postMessage(message, "*");
    } else {
      console.warn("Attempted to send a message from the host without specifying a target.");
    }
  }
  async runServerScript(scriptName, payload) {
    const response = await this._httpClient.executeRequest("/api/v1/mercenaries/runscript/" + scriptName, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    return data;
  }
  canEditFile(file) {
    if (!file) {
      return false;
    }
    return this.intentMap.has(`file:edit:${file.mimeType}`);
  }
  canViewFile(file) {
    if (!file) {
      return false;
    }
    return this.intentMap.has(`file:show:${file.mimeType}`);
  }
  async getFileObject(fid) {
    try {
      const response = await this._httpClient.executeRequest("/fid/" + fid + "?obj=true", {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        }
      });
      const data = await response.json();
      if (data) {
        console.log("getFileObject", data);
        return new OmniBaseResource(data);
      } else {
        console.warn(`No valid file object found for fid ${fid}`);
        return null;
      }
    } catch (ex) {
      console.error(ex);
      return null;
    }
  }
  async getFileBlob(fid) {
    try {
      const response = await this._httpClient.executeRequest("/fid/" + fid + "?download=true");
      const blob = await response.blob();
      return blob;
    } catch (ex) {
      console.error(ex);
      return null;
    }
  }
  async uploadFiles(files, storageType = "temporary") {
    if (files?.length > 0) {
      let result = await Promise.all(
        Array.from(files).map(async (file) => {
          this.uploadSingleFile(file, storageType);
        })
      );
      result = result.filter((r) => r);
      return result;
    } else {
      return [];
    }
  }
  async uploadSingleFile(file, storageType = "temporary") {
    const form = new FormData();
    form.append("storageType", storageType);
    form.append("file", file, file.name || Date.now().toString());
    try {
      const response = await fetch("/fid", {
        method: "POST",
        body: form
      });
      if (response.ok) {
        const data = await response.json();
        if (data.length > 0 && data[0].ticket && data[0].fid) {
          return data[0];
        } else {
          console.warn("Failed to upload file", { data, file });
          return null;
        }
      } else {
        console.warn("Failed to upload file", { response, file });
        return null;
      }
    } catch (error) {
      console.error("Failed to upload file", { error, file });
      return null;
    }
  }
  async startRecipe(id, args) {
    const response = await fetch("/api/v1/workflow/exec", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ workflow: id, args })
    });
    const data = await response.json();
    if (data.status === "JOB_STARTED") {
      return { ...data };
    }
  }
  async downloadFile(fileObject, fileName) {
    const fid = fileObject.fid;
    const filename = fileName || fileObject.fileName;
    fetch("/fid/" + fid + "?download=true").then((response) => response.blob()).then((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }).catch((error) => console.error(error));
  }
};
// Default to false, meaning it's considered as host by default
OmniSDKShared.Resource = OmniResource;

// src/OmniSDKClient.ts
var OmniSDKClient = class extends OmniSDKShared {
  constructor(extensionId) {
    super();
    this._isClient = true;
    this._extensionId = extensionId;
    const args = new URLSearchParams(location.search);
    this.options = JSON.parse(args.get("o") || "{}");
    this.args = JSON.parse(args.get("q") || "{}");
    if (args.has("omniHash")) {
      this.token = args.get("omniHash");
    } else {
      console.warn("No omniHash found in the query string, this is not a window opened by OmniHost");
      this.token = extensionId + (/* @__PURE__ */ new Date()).getTime().toString();
    }
  }
  get extensionId() {
    return this._extensionId;
  }
  init({ subscriptions } = { subscriptions: [] }) {
    console.log("OmniSDKClient initialized for " + this.extensionId + ".");
    const intentMapString = window.localStorage.getItem("omni-intentMap" /* INTENT_MAP */);
    if (intentMapString) {
      const intentMap = JSON.parse(intentMapString);
      if (intentMap && intentMap.length > 0) {
        this.intentMap = new Map(intentMap);
      }
    }
    this.addMessageHandler("host_cscript_response" /* CLIENT_SCRIPT_RESPONSE */, this._handleClientScriptResponse);
    this.addMessageHandler("host_sync_data" /* SYNC_DATA */, this._handleSyncData);
    if (subscriptions.includes("custom_extension_event" /* CUSTOM_EVENT */))
      this.addMessageHandler("custom_extension_event" /* CUSTOM_EVENT */, this._handleCustomEvent);
    if (subscriptions.includes("host_chat_message_received" /* CHAT_MESSAGE_RECEIVED */))
      this.addMessageHandler("host_chat_message_received" /* CHAT_MESSAGE_RECEIVED */, this._handleChatMessageReceived);
    this.register();
    return this;
  }
  register() {
    if (this.token) {
      this.send({ type: "client_registration" /* REGISTRATION */, token: this.token });
    } else {
    }
  }
  deregister(token) {
    this.send({ type: "client_deregistration" /* DEREGISTRATION */, token });
  }
  sendChatMessage(content, type = "text/markdown", attachments, flags) {
    const message = {
      type: "client_send_chat" /* SEND_CHAT_MESSAGE */,
      message: {
        content,
        type,
        attachments,
        flags
      }
    };
    this.send(message);
  }
  // Runs a client script and responds with the result
  async runClientScript(scriptName, payload) {
    const message = {
      type: "client_run_cscript" /* RUN_CLIENT_SCRIPT */,
      script: scriptName,
      args: payload,
      invokeId: this.extensionId + (/* @__PURE__ */ new Date()).getTime().toString()
    };
    return new Promise((resolve, reject) => {
      this.send(message);
      this.events.once("host_cscript_response" /* CLIENT_SCRIPT_RESPONSE */ + ":" + message.invokeId).then((result) => {
        resolve(result);
      });
    });
  }
  async _handleCustomEvent(message) {
    if (message.type !== "custom_extension_event" /* CUSTOM_EVENT */)
      return;
    const msg = message;
    if (msg.extensionId !== this.extensionId)
      return;
    await this.events.emit("custom_event" /* CUSTOM_EVENT */, { eventId: msg.eventId, eventArgs: msg.eventArgs });
  }
  async _handleSyncData(message) {
    if (message.type !== "host_sync_data" /* SYNC_DATA */)
      return;
    const msg = message;
    this.intentMap = new Map(msg.frame);
    await this.events.emit("data_updated" /* DATA_UPDATED */, [{ property: "intentMap" }]);
  }
  async _handleChatMessageReceived(message) {
    if (message.type !== "host_chat_message_received" /* CHAT_MESSAGE_RECEIVED */)
      return;
    const msg = message;
    await this.events.emit("chat_message_received" /* CHAT_MESSAGE_RECEIVED */, [msg.message]);
  }
  async _handleClientScriptResponse(message) {
    if (message.type !== "host_cscript_response" /* CLIENT_SCRIPT_RESPONSE */)
      return;
    const msg = message;
    await this.events.emit("host_cscript_response" /* CLIENT_SCRIPT_RESPONSE */ + ":" + msg.invokeId, msg.result);
  }
  showExtension(extensionId, args, page = "", opts = {}, action = "open") {
    const msg = {
      type: "client_show_extension" /* SHOW_EXTENSION */,
      extensionId,
      action,
      args,
      page,
      opts
    };
    this.send(msg);
  }
  hide() {
    const msg = {
      type: "client_window_message" /* WINDOW_MESSAGE */,
      action: "hide",
      args: {}
    };
    this.send(msg);
  }
  show() {
    const msg = {
      type: "client_window_message" /* WINDOW_MESSAGE */,
      action: "show",
      args: {}
    };
    this.send(msg);
  }
  close() {
    const msg = {
      type: "client_window_message" /* WINDOW_MESSAGE */,
      action: "close",
      args: {}
    };
    this.send(msg);
  }
  signalIntent(intent, target, payload, opts = {}) {
    const message = {
      type: "client_signal_intent" /* SIGNAL_INTENT */,
      intent,
      target,
      opts: opts || {},
      payload
    };
    this.send(message);
  }
  showToast(message, options) {
    const msg = {
      type: "client_show_toast" /* SHOW_TOAST */,
      message,
      options
    };
    this.send(msg);
  }
  showTopBanner(bannerTitle, bannerDescription, options) {
    const msg = {
      type: "client_show_top_banner" /* SHOW_TOP_BANNER */,
      bannerTitle,
      bannerDescription,
      options
    };
    this.send(msg);
  }
  openRecipeInEditor(recipeId, recipeVersion) {
    const msg = {
      type: "client_load_recipe" /* LOAD_RECIPE */,
      recipeId,
      recipeVersion
    };
    this.send(msg);
  }
  async runExtensionScript(scriptName, payload) {
    payload ?? (payload = {});
    const response = await this._httpClient.executeRequest(
      `/api/v1/mercenaries/runscript/${this.extensionId}:` + scriptName,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );
    if (!response.ok) {
      throw new Error("Server error: HTTP status " + response.status);
    }
    const data = await response.json();
    return data;
  }
  // You can add more handlers if required for other types of messages that the ClientSDK might receive from OmniHost
};

// src/OmniSDKHost.ts
var OmniSDKHost = class extends OmniSDKShared {
  constructor(app) {
    super();
    this.registeredFrames = {};
    this._app = app;
  }
  get app() {
    return this._app;
  }
  init() {
    console.log("OmniSDKHost initialized.");
    this.addMessageHandler("client_registration" /* REGISTRATION */, this._handleRegistration);
    this.addMessageHandler("client_deregistration" /* DEREGISTRATION */, this._handleDeregistration);
    this.addMessageHandler("client_send_chat" /* SEND_CHAT_MESSAGE */, this._handleSendChatMessage);
    this.addMessageHandler("client_run_cscript" /* RUN_CLIENT_SCRIPT */, this._handleRunClientScript);
    this.addMessageHandler("client_signal_intent" /* SIGNAL_INTENT */, this._handleSignalIntent);
    this.addMessageHandler("client_window_message" /* WINDOW_MESSAGE */, this._handleWindowMessage);
    this.addMessageHandler("client_show_toast" /* SHOW_TOAST */, this._handleShowToast);
    this.addMessageHandler("client_show_extension" /* SHOW_EXTENSION */, this._handleShowExtension);
    this.addMessageHandler("client_load_recipe" /* LOAD_RECIPE */, this._handleLoadRecipe);
    this.addMessageHandler("client_show_top_banner" /* SHOW_TOP_BANNER */, this._handleShowTopBanner);
    return this;
  }
  registerFileIntent(intent, mimeType, handler) {
    const key = `file:${intent}:${mimeType}`;
    console.log(`Registering file intent ${key}, handler: `, handler);
    if (this.intentMap.has(key)) {
      this.intentMap.get(key).push(handler);
    } else {
      this.intentMap.set(key, [handler]);
    }
    window.localStorage.setItem("omni-intentMap" /* INTENT_MAP */, JSON.stringify(Array.from(this.intentMap.entries())));
  }
  signalFileIntent(intent, file, opts) {
    const mt = file.mimeType?.split(";")[0].trim();
    let handlers = this.intentMap.get(`file:${intent}:${mt}`) || [];
    if (handlers.length == 0) {
      handlers = Array.from(this.intentMap.entries()).map(([key, value]) => {
        const [type, action, mimeType] = key.split(":");
        if (type === "file" && action === intent && mimeType.endsWith("*") && mt?.startsWith(mimeType.substring(0, mimeType.length - 1))) {
          return value[0];
        } else {
          return void 0;
        }
      }).filter((v) => v !== void 0);
    }
    if (handlers.length > 0) {
      console.log(handlers[0]);
      const { extensionId, page, hOpts } = handlers[0];
      console.log(`Showing ${intent} intent for ${mt} with extension ${extensionId} and page ${page}`);
      this.app.workbench.showExtension(extensionId, { file }, page, Object.assign({}, opts, hOpts));
    } else {
      console.warn(`No handler found for intent ${intent} and mime type ${file.mimeType}`);
    }
  }
  signalCustomEvent(extensionId, eventId, eventArgs) {
    const message = {
      type: "custom_extension_event" /* CUSTOM_EVENT */,
      extensionId,
      eventId,
      eventArgs
    };
    this.send(message);
  }
  signalChatMessageReceived(message) {
    if (!message.workflowId) {
      message.workflowId = "System";
    }
    const packet = {
      type: "host_chat_message_received" /* CHAT_MESSAGE_RECEIVED */,
      message
    };
    this.send(packet, "*");
  }
  deregister(token) {
    if (token && this.registeredFrames[token]) {
      console.log(`Iframe with token ${token} deregistered!`);
      delete this.registeredFrames[token];
    } else {
      console.warn(`No registered frame with token ${token}`);
    }
  }
  async _handleRunClientScript(message) {
    if (message.type !== "client_run_cscript" /* RUN_CLIENT_SCRIPT */)
      return;
    const scriptMessage = message;
    const script = scriptMessage.script;
    const args = scriptMessage.args;
    const result = await this.app.runScript(script, args);
    const response = {
      type: "host_cscript_response" /* CLIENT_SCRIPT_RESPONSE */,
      invokeId: scriptMessage.invokeId,
      result
    };
    this.send(response, message.token);
  }
  _handleWindowMessage(message) {
    if (message.type !== "client_window_message" /* WINDOW_MESSAGE */)
      return;
    const windowMessage = message;
    const action = windowMessage.action;
    const args = windowMessage.args;
    const token = windowMessage.token;
    if (action === "close") {
      this.app.closeWindow(token);
    }
  }
  sendChatMessage(content, type = "text/markdown", attachments, flags) {
    const message = {
      type: "client_send_chat" /* SEND_CHAT_MESSAGE */,
      message: {
        content,
        type,
        attachments,
        flags
      }
    };
    this._handleSendChatMessage(message);
  }
  _handleSendChatMessage(message) {
    if (message.type !== "client_send_chat" /* SEND_CHAT_MESSAGE */)
      return;
    const body = message.message;
    this.app.sendSystemMessage(body.content, body.type, body.attachments, body.flags);
  }
  _handleShowExtension(message) {
    if (message.type !== "client_show_extension" /* SHOW_EXTENSION */)
      return;
    const showExtensionMessage = message;
    const { action, args, extensionId, page, opts } = showExtensionMessage;
    if (action === "open") {
      this.app.workbench.showExtension(extensionId, args, page, opts);
    } else if (action === "close") {
      alert("hideExtension Not implemented");
    }
  }
  _handleRegistration(message, source) {
    if (message.type !== "client_registration" /* REGISTRATION */)
      return;
    const regMessage = message;
    if (source && regMessage.token && "postMessage" in source && !this.registeredFrames[regMessage.token]) {
      this.registeredFrames[regMessage.token] = {
        contentWindow: source,
        registeredAt: /* @__PURE__ */ new Date()
      };
      console.log(`Iframe with token ${regMessage.token} registered!`);
      this.send(
        {
          type: "host_sync_data" /* SYNC_DATA */,
          packet: "intentMap",
          frame: Array.from(this.intentMap.entries())
        },
        regMessage.token
      );
    }
  }
  _handleShowToast(clientMessage) {
    if (clientMessage.type !== "client_show_toast" /* SHOW_TOAST */)
      return;
    const toastMessage = clientMessage;
    const { message, options } = toastMessage;
    this.app.showToast(message, options);
  }
  _handleSignalIntent(message) {
    if (message.type !== "client_signal_intent" /* SIGNAL_INTENT */)
      return;
    const intentMessage = message;
    if (intentMessage.payload?.fid || intentMessage.payload?.ticket?.fid) {
      this.signalFileIntent(intentMessage.intent, intentMessage.payload, intentMessage.opts);
      return;
    }
    if (intentMessage.intent === "show" || intentMessage.intent === "edit") {
      this.app.workbench.showExtension(intentMessage.target, intentMessage.payload, void 0, intentMessage.opts);
    } else if (intentMessage.intent === "hide") {
      this.app.workbench.hideExtension(intentMessage.target);
    } else {
      console.warn(`Invalid intent ${intentMessage.intent}`, intentMessage);
    }
  }
  _handleDeregistration(message) {
    if (message.type !== "client_deregistration" /* DEREGISTRATION */)
      return;
    const deRegMessage = message;
    if (deRegMessage.token && this.registeredFrames[deRegMessage.token]) {
      this.deregister(deRegMessage.token);
    }
  }
  _handleLoadRecipe(message) {
    if (message.type !== "client_load_recipe" /* LOAD_RECIPE */)
      return;
    const loadRecipeMessage = message;
    this.app.workbench.loadRecipe(loadRecipeMessage.recipeId, loadRecipeMessage.recipeVersion);
  }
  _handleShowTopBanner(message) {
    if (message.type !== "client_show_top_banner" /* SHOW_TOP_BANNER */)
      return;
    const showTopBannerMessage = message;
    const { bannerTitle, bannerDescription, options } = showTopBannerMessage;
    this.app.showTopBanner(bannerTitle, bannerDescription, options);
  }
  send(message, token = "*") {
    message.token = token;
    message = JSON.parse(JSON.stringify(message));
    if (token === "*") {
      for (const frameInfo of Object.values(this.registeredFrames)) {
        frameInfo.contentWindow.postMessage(message, "*");
      }
    } else {
      const frameInfo = this.registeredFrames[token];
      if (frameInfo) {
        frameInfo.contentWindow.postMessage(message, "*");
      } else {
        console.warn(`No registered frame with token ${token}`);
      }
    }
  }
};

// src/MarkdownEngine.ts
import Handlebars from "handlebars";
import { marked } from "marked";
var mdRenderer = new marked.Renderer();
mdRenderer.link = function(href, title, text) {
  const link = marked.Renderer.prototype.link.apply(this, arguments);
  return link.replace("<a", "<a target='_blank'");
};
var MarkdownEngine = class {
  constructor() {
    this.SafeString = Handlebars.SafeString;
    this.asyncResolvers = {};
    this.handlebars = Handlebars.create();
  }
  registerAsyncResolver(directive, resolverFunction) {
    this.asyncResolvers[directive] = resolverFunction;
  }
  registerToken(tokenName, resolver) {
    this.handlebars.registerHelper(tokenName, resolver);
  }
  async getAsyncDataForDirective(directive, token) {
    const resolver = await this.asyncResolvers[directive];
    if (!resolver) {
      throw new Error(`No resolver registered for directive: ${directive}`);
    }
    return await resolver(token);
  }
  extractDirectiveData(statement) {
    if (statement.type === "MustacheStatement" || statement.type === "BlockStatement") {
      const name = statement.path?.original;
      const param = statement.params?.[0]?.original;
      return {
        name,
        param
      };
    }
    return {};
  }
  async preprocessData(content, tokens) {
    let data = {};
    for (const [placeholder, originalDirective] of tokens.entries()) {
      const parsed = Handlebars.parse(originalDirective);
      const directiveData = this.extractDirectiveData(parsed.body[0]);
      const directive = directiveData?.name;
      const token = directiveData?.param;
      if (directive && token) {
        content = content.replace(placeholder, originalDirective);
      }
    }
    return { content, data };
  }
  extractTokens(content) {
    const tokenRegex = /{{\s*([a-zA-Z0-9_-]+)\s*([^}]*)\s*}}/g;
    const tokens = /* @__PURE__ */ new Map();
    let counter = 0;
    const modifiedContent = content.replace(tokenRegex, (match) => {
      const placeholder = `TOKEN_${++counter}`;
      tokens.set(placeholder, match);
      return placeholder;
    });
    return { modifiedContent, tokens };
  }
  injectTokens(content, tokens) {
    let processedContent = content;
    tokens.forEach((value, key) => {
      processedContent = processedContent.replace(key, value);
    });
    return processedContent;
  }
  async render(markdownContent, context = {}) {
    let { modifiedContent, tokens } = this.extractTokens(markdownContent);
    const md = marked.parse(modifiedContent, { renderer: mdRenderer });
    let { content, data } = await this.preprocessData(md, tokens);
    content = this.injectTokens(content, tokens);
    const replacedContent = this.handlebars.compile(content)(Object.assign({}, data, context));
    return replacedContent;
  }
};
export {
  EOmniFileTypes,
  MarkdownEngine,
  OMNI_SDK_VERSION,
  OmniBaseResource,
  OmniSDKClient,
  OmniSDKClientEvents,
  OmniSDKClientMessages,
  OmniSDKHost,
  OmniSDKHostMessages,
  OmniSDKStorageKeys
};
//# sourceMappingURL=index.js.map
