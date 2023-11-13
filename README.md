# Omnitool.ai - Your Open Source AI Desktop

*Discover, Learn, Evaluate and Build with thousands of Generative AI Models.*

Omnitool.ai is an open-source, downloadable "AI Lab in a box" built for learners, enthusiasts and anyone with interest in the current wave of AI innovation. It provides an extensible browser based desktop environment for streamlined, hands-on interacting with the latest AI models from OpenAI, replicate.com, Stable Diffusion, Google, or other leading providers through a single, unified interface.

![Alt text](assets/screenshot_desktop_03.png)

Watch the [demo](https://tinyurl.com/omnitool-demo)! and see more [videos](https://www.youtube.com/@OmnitoolAI/videos) on our Youtube channel.

## Why Omnitool?

With thousands of preprints and countless "AI tools" released each week, it is incredibly challenging to stay on top of the rapidly evolving AI ecosystem, to separate hype and facts and to extract durable long term skills and learning. PapersWithCode and Github repositories attached to ArxIV papers provide ability to hands-on validate and apply the latest discoveries, but the fragile nature of the Python ecosystem and often steep hardware requirments dramatically limits accessibility. Likewise implementing and testing cloud based models requires delving deep into API documentation and wrestling with connecting code.

We believe that is a serious problem. AI may represent the first large scale technological disruption unbounded by logistical challenges, scaling along existing wires, API infastructure and app delivery platforms. Meanwhile, market pressure to adopt AI is felt by many   businesses and teams. 

Without educated decision makers and technical experts,  businesses and public organisations alike are at high risk of falling for hype and magical narratives and expensive misadventures.      

Omnitool is our attempt to improve this situation: A **single, unified interface** capable of connecting with as many AI models as possible and to **reduce the "time to hands on AI" to an absolute minimum**. 

Omnitool is **highly extensible and interoperable**. Most OpenAPI3 based services can be connected and turned into "blocks" without writing code. It's extension framework enables deeper integrations of anything from custom UIs (Like Stability Dream Studio) to Game Engines (like BabyonJS or Phaser) to [Image manipulation libraries](https://github.com/georgzoeller/omni-extension-sharp/blob/master/README.md).


## What Omnitool is NOT

- Omnitool is **not a multi-user cloud SaaS product**. It's a downloadable, locally installed product. 
- Omnitool is **NOT a no-code solution** meant to replace coding or enable non engineers to code. It's focused on interacting with AI use cases, not writing general purpose software.
- Omnitool is **not production/enterprise software**. (Yet.) It's a lab optimizing for access to the latest technologies over stability and, as with any lab, things may blow up from time to time.  
   

## Table of Contents

- [Key Features](#key-features)
- [Quickstart](#quickstart-guide)
- [Manual Install](#manual-install)
- [PocketBase DB Admin (ADVANCED)](#pocketbase-db-admin-advanced)
- [Next Steps](#next-steps)
- [Changelist](#changelist)

## Key Features

### Self-hosted and Open Source

* Omnitool is local self-hosted software that turns your machine into a powerful AI Lab.

  * You install Omnitool and it runs on your Mac, Windows or Linux notebook, desktop or server, not cloud servers. 
  * Data stores it's data locally on your machine and is only transmitted to the third party provider APIs you choose to access. Updates are managed via github.
  * A Docker Image is forthcoming.
  * If you are interested in running Omnitool in the cloud, please get in touch with us at contact@omnitool.ai

* Open Source and Open Standards
   * Omnitool is licensed as open source software and heavily leverages open standards, such as OpenAPI, making it interoperable and extensible.

### Rapid Access to the world of generative AI without GPU, Managing Python installations and learning dozens of APIs and interfaces

* Minimal Time-to-AI: It allows you to try out models and services in minutes without having to study API docs, write boilerplate code, manage python venvs or figuring out new user interfaces. Because of it's integration of many leading AI platforms, the lag time between "paper with code" to hands on experimentation often is cut down to days. 

* It presents the vast world of generative AI - image, video, audio, text, and classification APIS - through a single, unified user interface without oversimplifying or hiding the power of the APIs.
  
### Comprehensive AI Provider Support
* Seamlessly provides access to 1000s of AI model and utility APIs from an rapidly growing list leading AI providers and aggregators, exposing them all via interoperable blocks.
  
Currently supported (v. 0.5.3) :
   * [Civitai.com](https://civitai.com) (Model metadata access)
   * [Deepl.com](https://deepl.com) (Document translation)
   * [ElevenLabs.io](https://elevenlabs.io) (Multilingual voice generation)
   * Getimg.ai (Image generation and manipulation APIs)
   * Github.com (Various)
   * Google.com
      * Gmail
      * Vertex (AI)
      * Google Translate
      * Google TTS (Text to Speech)
      * Google Vision (Computer Vision)
   * [Huggingface.com](https://huggingface.com) (1000's of models, including free inference models)
   * [OpenAI.com](https://openai.com) (Image/Text/Audio Generation including GPT3/4/Visual, Whisper, Dall-e 2, Dall-e 3, Moderation APIs and more)
   * [OpenRouter.ai](https://OpenRouter.ai) (100s of LLM APIs)
   * [Perplexity.ai](https://perplexity.ai) (Text Generation)
   * [Stability.ai](https://stability.ai) (Image Generation and Manipulation APIs)
   * [TextSynth.com](https://textsynth.com) (LLM, translation, and classification APIs)
   * [Replicate.com](https://replicate.com/explore) (1000s of models across all modalities)
   * [Uberduck.com](https://uberduck.com) (Voice Generation, Music centric offerings)
   * [Unsplash.com](https://unsplash.com) (Stock imagery)
   * with many more APIs in testing...

* Support for the following Open Source APIs is in the final stages of testing:
  * Automatic1111/SDNext API
  * Oobabooga Text Generation API
  * Ollama API

* Omnitool is able to generate blocks from any openapi.json definitions via URL or directly supplied file. We support a number of custom x- annotations that can be added to openapi definitions to allow omnitool to guide the block generation. It also supports creating "patches" on top of existing APIs to create customized blocks. With integrated JSONATA support, it is possible to build powerful data processing blocks using pure data.


### Extensible Architecture

* Inspired by the common modding architecture found in video game toolsets, Omnitool is built, from the ground up, to be extensible via multiple mechanisms:  
  * Simple **Client and Server scripts** allowing addition of /commands that are hot-reloaded, so editing and building is a breeze.
  * **Client Extensions** - any web-app/webpage can be turned into an extension and integrated directly on Omnitool's desktop via it's window system. Omnitool's client SDK exposes the full range of platform functionality to extensions, allowing you to write apps or tools using every API or recipe enabled in Omnitool. 
  * **Server Extensions** - Server extensions written in javascript that can add new blocks, API and core functionality.

* Some examples of currently available extensions:
  * omni-core-replicate, a core extensions that allows import of any AI model on [replicate.com](https://replicate.com) into a ready to use block in Omnitool 
  * [omni-extension-sharp](https://github.com/omnitool-community/omni-extension-sharp), an extension adding an array of Image Manipulation blocks such as format conversion, masking, composition and more based on the powerful [sharp](https://github.com/lovell/sharp) image processing library.
  * omni-extension-minipaint, a powerful [photo editing tool](https://github.com/viliusle/miniPaint) useful for quickly creating and editing images without switching out of the app.
  * omni-extension-openpose, a [OpenPose based](https://github.com/CMU-Perceptual-Computing-Lab/openpose) pose estimation and generation toolkit useful for creating guidance images for controlnet/diffusion models.
  * omni-extension-tldraw, a whiteboarding/sketching extension built on [TLDraw](https://github.com/tldraw/tldraw), useful for generating input for visual transformers and diffusion models
  * omni-extension-wavacity, a [full wasm implementation](https://wavacity.com/) of Audacity, a state of the art audio recorder/editor useful for generating and editing audio content.
    
* Visit the Extension tab in app or see our [Omnitool Community Github](https://github.com/orgs/omnitool-community/repositories) for a list of currently available extensions

  
## Quickstart Guide

We are currently testing installers for Windows and macOS. Until those are publicly available, please follow the manual installation steps.

## Manual Install

This guide will help you download the Omnitool software, and then build and start the Omnitool server in a directory running from your local machine.

You can then access the Omnitool software from a web browser on your local machine.

1. **Prerequisites**

  Ensure you have the latest versions of the following sofware installed:

 * [Node.js](https://nodejs.org/en)
 * [Yarn](https://yarnpkg.com)
 * [Git](https://en.wikipedia.org/wiki/Git)


2. **Get the Source Code**
 - Open a terminal
 - Navigate to where you want Omnitool to be installed 
 - Use the following command:
  ```
    git clone https://github.com/omnitool-ai/omnitool
  ```

  This will create the `omnitool` folder.  

  - Now navigate inside Omnitool's folder. By default:
  ```
    cd omnitool
  ```

3. **Install Source Dependencies**

  Run the following command in the root of the repository to install the necessary dependencies:
  ```
    yarn install
  ```

4. **Build and Start the Server**

  Now we will use `yarn` and `Node.js` to build the server software locally on your machine and then start it running.

  Windows:
  ```
    start.bat
  ```

  MacOS/Linux:
  ```
   ./start.sh
  ```

  When successful, you will see the following message:

  ```
◐ Booting Server
✔ Server has started and is ready to accept connections on http://127.0.0.1:1688.
✔ Ctrl-C to quit.
```

5. **Open Omnitool in a Web Browser**

  Omnitool.ai can now be accessed from:
  [127.0.0.1:1688](http://127.0.0.1:1688)  

---
6. **Explore the Sample Recipes**
  Use the "Load Recipe" button in the menu to explore different functionality of the platform.

---
7. **Explore the Code**
  For a list of scripts we use internally, try running:
  ```
    yarn run
  ```

## PocketBase DB Admin (ADVANCED)
Recipes and various cache data are stored in a [PocketBase](https://pocketbase.io) database.

If the database is currently running, you can access the default PocketBase admin interface by navigating to [127.0.0.1:8090/_](http://127.0.0.1:8090/_)

Alternatively, the admin interface can be accessed directly within omnitool. From the main menu, choose the `Database Admin` option and the same interface will open inside the omnitool browser window.

o log in to the database, use the credentials
 * Email: **admin@local.host**
 * Password: **admin@local.host**

Once logged in, you can directly modify records using the PocketBase admin interface. This is particularly useful for advanced configurations and troubleshooting.

### Reset Local PocketBase Storage (ADVANCED)

There may be occasions when you need to reset your local database, either to recover from an invalid state or to start with a fresh install.

For Linux:
   ```bash
   rm -rf ./local.bin
   yarn start
   ```
For Windows:
  ```cmd
  rmdir /s /q .\local.bin
  yarn start
  ```

- **Warning**:
  - **ALL YOUR LOCAL RECIPES, GENERATED IMAGES, DOCUMENTS, AUDIO ETC, WILL BE PERMANENTLY ERASED**

## Generating a JWT Token

Our service allows you to generate a JWT by running a specific script designed for this purpose. The script's signature is as follows:

```
/generateJwtToken <action> <subject> <expires_in>
```

**Parameters**

- `<action>`: This is a string parameter identifying the intended action to be performed. In the context of running recipes, this should be set to exec.
- `<subject>`: This is a string parameter that specifies the subject of the JWT. This could be the recipe that you intend to execute.
- `<expires_in>`: This is an integer parameter that determines the token's validity period in milliseconds.

**Example**

To generate a JWT for executing a recipe with a validity of 30,000 milliseconds (or 30 seconds), you would run the following script:

```
/generateJwtToken exec Workflow 30000
```

**Output**

The script will output a JWT, which is a token string to be used in the authorization header for your API requests.

### Executing a recipe with JWT Authentication

Once you have your JWT, you can execute a recipe by making a POST request to the recipe execution API. This request must include the JWT in the Authorization header.

**Endpoint**

```
POST http://127.0.0.1:1688/api/v1/workflow/exec
```

**Header**

```
Authorization: Bearer <token>
```

`<token>` is the JWT acquired from the /generateJwtToken script.

**Curl Example**

To make the request using curl, you would use the following command, replacing <token> with your actual JWT:

```
curl -X POST http://127.0.0.1:1688/api/v1/workflow/exec -H "Authorization: Bearer <token>"
```

**Response**

Upon success, the API will initiate the specified recipe. You will receive a JSON response containing details about the recipe's execution status, including any outputs or errors.

**Security Considerations**

- Keep your JWT secure to prevent unauthorized access to your recipes.
- Always use a secure connection to interact with the APIs.
- Regularly rotate your tokens and use a short expiration time to minimize the impact of potential leaks.

**Troubleshooting**

If you encounter authorization errors, ensure the JWT has not expired, is correctly set in the header, and was generated with the proper parameters.

## Next Steps

1. Join the Omnitool.ai Discord Community

Interact with fellow users, share your experiences, ask questions, and be a part of our active and growing community on [Discord](https://tinyurl.com/omnitool-discord).

2. Contribute to Omnitool.ai

As an open-source platform, we welcome contributions from users like you. Whether it's improving documentation, adding new features, or simply sharing your unique use cases, your input is invaluable to us. Simply send us a pull-request and we'll be in contact.

3. Feedback and Suggestions

Your feedback helps shape the future of Omnitool.ai. Send your feedback and suggestions to [support@omnitool.ai](mailto:support@omnitool.ai), or share them directly in our [Discord #feedback channel](https://tinyurl.com/omnitool-feedback). 
