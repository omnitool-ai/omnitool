# Omni SDK


## Omni SDK Client (Use for extensions in the browser)

To use the client within an extension, add the following to the start of the

```javascript
const extensionId = "my-extension-id"
const sdk = new OmniSDKClient(extensionId).init();
```


### Running Scripts

Run an extension server script (`located in extensions\<extension-id>\scripts\server`), use `sdk.runExtensionScript`


```javascript
const scriptName = "myScript"
const result = await sdk.runExtensionScript(scriptName, {a: 1, b: "2"});
```


## Sending Chat Messages

To trigger a chat message to the user, use `sdk.sendChat`

```javascript

// Add a button that executes the /help command when pressed
const attachments =
{
  commands: [
    'title': 'Help'
    'id': 'help'
  ],
  images:
  [
    { ...image object... }
  ]
}

const result = await sdk.sendChat('Message', 'text/markdown', attachments)
```



