/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import axios from 'axios';
import { marked } from 'marked';
import { ChatMessageStorageTypes, ChatUtils } from 'omni-client-services';
import '../styles/markdown.scss';
import DOMPurify from 'dompurify';

const chatComponent = function (workbench) {
  const client = window.client;

  const state = window.client.chat.state;

  const getCurrentLocalTime = () =>
    new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(
      new Date()
    );

  const renderMarkdown = async (markdownText) => {
    const escapedContent = escapeHtmlSpecialChars(markdownText);
    const sanitizedHtml = DOMPurify.sanitize(escapedContent);
    const rawHtml = marked.parse(sanitizedHtml, { mangle: false, headerIds: false });
    return rawHtml;
  };
  const parseCommandLine = (line) => {
    const commandRegex = /(?:[^\s"]+|"[^"]*")+/g;
    const splitLine = line.match(commandRegex);
    const [command, ...args] = splitLine.map((arg) => arg.replace(/^"(.+(?="$))"$/, '$1'));

    return [command, args];
  };

  const formatChatMessageAndPush = ({ message, sender, embeds, workflowId }) => {
    embeds ??= {};
    embeds.audio ??= [];
    embeds.commands ??= [];
    embeds.images ??= [];
    embeds.object ??= [];
    embeds.videos ??= [];

    if (
      message ||
      embeds?.images?.length > 0 ||
      embeds?.audio?.length > 0 ||
      embeds?.videos?.length > 0 ||
      embeds.object
    ) {
      message ??= '';

      const rawText = typeof message === 'object' ? '```  \n' + JSON.stringify(message, null, 2) + '  \n```' : message;
      const text = marked.parse(rawText, { mangle: false, headerIds: false });

      const msg = {
        sender: sender || 'omni',
        text,
        whenText: getCurrentLocalTime(),
        attachments: 0,
        workflowId: workflowId ?? workbench.activeWorkflow?.id
      };
      let attachments = 0;

      if (embeds) {
        embeds.audio = embeds.audio.filter((e) => e.expires === Number.MAX_SAFE_INTEGER || e.expires > Date.now());
        embeds.images = embeds.images.map((e) => {
          if (e.expires === Number.MAX_SAFE_INTEGER || e.expires > Date.now()) {
            return e;
          }
          e.url = '/expired.png';
          return e;
        });

        if (embeds.audio && embeds.audio.length > 0) {
          msg.audio = embeds.audio;
          attachments += embeds.audio.length;
        }
        if (embeds.images && embeds.images.length > 0) {
          msg.images = embeds.images;
          attachments += embeds.images.length;
        }
        if (embeds.videos && embeds.videos.length > 0) {
          msg.videos = embeds.videos;
          attachments += embeds.videos.length;
        }
        if (embeds.commands && embeds.commands.length > 0) {
          msg.commands = embeds.commands;
          attachments += embeds.commands.length;
        }
        if (embeds.object && embeds.object.length > 0) {
          msg.objects = embeds.object;
          attachments += embeds.object.length;
        }
      }
      msg.attachments = attachments;

      state.messages.push(msg); // TODO: Move to caller
      return msg;
    } else {
      console.warn('empty message', { message, sender });
      return null;
    }
  };

  const onAsyncJobStatusEffectHandler = (element, job) => {
    // Still called by UI. Don't remove without full testing of job status.
  };

  const onChatMessage = async ({ message, sender, embeds }) => {
    const formattedMsg = formatChatMessageAndPush({ message, sender, embeds });
    if (formattedMsg !== null && workbench !== null && workbench.activeWorkflow !== null) {
      await client.chat.updateChatServer({ message, sender, embeds }, Date.now());
    }
  };

  const sendMessage = async () => {
    let inputText = state.inputText.trim();
    state.inputText = '';

    if (inputText?.length > 0) {
      await onChatMessage({ message: inputText, sender: 'me' });

      if (inputText === '?') {
        inputText = '/help';
      }

      try {
        if (inputText[0] !== '/' && inputText[0] !== '@') {
          if (!client.workbench.canExecute) {
            window.client.sendSystemMessage('Please load a recipe first.', 'text/plain');
            return;
          }

          inputText = '@omni ' + inputText;
        }

        let script = 'console';
        let args = { input: inputText };
        let isMention = false;
        if (inputText[0] === '/' || inputText[0] === '@') {
          if (inputText.length <= 1) {
            inputText = '/help';
          }

          const [l1, l2] = parseCommandLine(inputText);
          script = l1.substring(1).replace(/[\W_]+/g, '');
          args = l2 || [];

          if (inputText[0] === '@') {
            const omniscript = script;
            script = 'run';
            args = args.join(' ');
            args = [omniscript, args];
            isMention = true;
          }
        }

        console.log('script', script, 'args', args);
        let response;
        // TODO: rewrite
        if (script === 'run') {
          const [target, xargs] = args;
          let payload = xargs.length ? { text: xargs } : undefined;
          if (!isMention) {
            const targetJson = JSON.parse(target);
            response = await workbench.executeById(targetJson.id, payload);
          } else {
            if (xargs.length > 0) {
              response = await workbench.executeByName(target, payload);
            } else {
              if (state.messages.length > 2) {
                payload = {};
                const lastMessage = state.messages[state.messages.length - 2];
                payload = {
                  text: lastMessage.text || lastMessage.html,
                  images: lastMessage.images,
                  audio: lastMessage.audio
                };
              }
              response = await workbench.executeByName(target, payload);
            }
          }
        } else {
          response = await window.client.runScript(script, args, { fromChatWindow: true });
        }
        console.log(JSON.stringify(response));
        if (!response) {
          return;
        }
        if (response?.error) {
          throw response.error;
        }
        if (response.response && !response.hide) {
          await onChatMessage({
            message: response.response,
            sender: response.sender || 'omni',
            embeds: response.embeds
          });
        }
      } catch (error) {
        if (typeof error === 'object') {
          // eslint-disable-next-line no-ex-assign
          error = error.message ?? JSON.stringify(error, null, 2);
        } else {
          console.error('Failed to send message:' + error);
        }
        await onChatMessage({
          message: '<div class="w-full text-red-500font-semibold">❌ Error</div><div>' + error + '</div>',
          sender: 'omni'
        });
      }
    }
  };

  // Fix issue #143
  let isComposing = false;

  const handleCompositionStart = () => {
    isComposing = true;
  };

  const handleCompositionEnd = () => {
    isComposing = false;
  };

  const restoreChat = async (workflowId) => {
    state.messages.length = 0; // flush
    const url = `/api/v1/chat/${client.chat.activeContextId}`;
    const res = await axios.get(url, {
      withCredentials: true
    });
    const chatHistory = res.data.result.result;
    for (let i = 0; i < chatHistory.length; ++i) {
      const chatStorage = chatHistory[i];
      if (chatStorage.version !== 0) {
        continue;
      }
      switch (ChatUtils.GetMessageStorageType(chatStorage.msgstore)) {
        case ChatMessageStorageTypes.User:
          formatChatMessageAndPush(chatStorage.msgstore);
          break;
        case ChatMessageStorageTypes.Omni:
          client.chat._onChatMessage(chatStorage.msgstore);
          break;
        case ChatMessageStorageTypes.AsyncJob: {
          const msg = {
            sender: 'omni',
            text: chatStorage.msgstore.message,
            whenText: chatStorage.msgstore.ts,
            attachments: 0,
            flags: new Set(),
            workflowId: chatStorage.msgstore.workflowId
          };
          state.messages.push(msg);
          break;
        }
      }
    }
    // restore startup messages
    if (workbench !== null && !workbench.canEdit && workbench.activeWorkflow) {
      client.sendSystemMessage(
        'ℹ️  This recipe is a **read-only** template. Use the remix button below to create a copy you can edit freely.',
        undefined,
        {
          commands: [
            {
              title: 'Remix Recipe',
              id: 'clone',
              args: [],
              classes: ['btn btn-secondary']
            }
          ]
        }
      );
    }
  };

  client.subscribeToGlobalEvent('workbench_workflow_loaded', async (workflowId) => {
    await restoreChat(workflowId);
  });

  client.registerClientScript('clear', async function (args) {
    state.messages.length = 0;
    await client.chat.clearChat();
    return { response: 'Chat history cleared.' };
  });

  client.subscribeToGlobalEvent('sse_message', async (data) => {
    if (data.type === 'chat_message') {
      await onChatMessage(data);
      return;
    }

    if (data.type === 'error') {
      await onChatMessage({
        message:
          "<div class='w-full'><span class='text-red-500 font-bold'>Error!</span> " +
          (data.componentKey
            ? "A block returned an error with <span class='font-mono'>componentKey:&nbsp;\"" +
              data.componentKey +
              '"</span>'
            : 'A block with a missing componentKey returned an error.') +
          "</div><div>Details: <pre class='font-mono' style='white-space: pre-wrap;'>" +
          getErrorDetails(data.error) +
          '</pre></div>'
      });
    }
  });

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    state.recognition = new SpeechRecognition();
    state.recognition.continuous = true;
    state.recognition.interimResults = true;
    state.recognition.lang = 'en-US';

    state.recognition.onresult = (event) => {
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (!event.results[i].isFinal) {
          interimTranscript += event.results[i][0].transcript;
        }
      }
      if (interimTranscript) {
        state.inputText = interimTranscript;
      }
    };
    state.recognitionAvailable = true;
  } else {
    console.log('Speech recognition is not supported in this browser. Please try using Google Chrome.');
  }

  const stripHtml = function (html) {
    const txt = document.createElement('div');
    txt.innerHTML = html;
    return txt.innerText.trim();
  };

  const getErrorDetails = function (error) {
    let errorObj = error;
    if (typeof error === 'string') {
      try {
        errorObj = JSON.parse(error);
      } catch (e) {}
    } else if (typeof error === 'object') {
      errorObj = error;
    }

    return JSON.stringify(errorObj, null, 2);
  };

  return {
    isDraggingOver: false,
    openCameraModal: false,
    loadCameraModal: false,
    streaming: false,
    state,
    workbench,
    onChatMessage,
    onAsyncJobStatusEffectHandler,
    sendMessage,
    handleCompositionStart,
    handleCompositionEnd,
    renderMarkdown,
    ChatUtils,
    onClickCopy(node) {
      const s = DOMPurify.sanitize(stripHtml(node.text));
      navigator.clipboard.writeText(s).then(
        function () {
          // console.log('Copying to clipboard was successful!');
        },
        function (err) {
          console.error('Could not copy text: ', err);
        }
      );
      this.copyNotification = true;
      const that = this;
      setTimeout(function () {
        that.copyNotification = false;
      }, 3000);
    },
    async startMicrophoneInput() {
      if (state.recognition) {
        state.recognition.start();
        state.recognitionRecording = true;
      }
    },
    async stopMicrophoneInput() {
      if (state.recognition) {
        state.recognitionRecording = false;
        state.recognition.stop();
      }
    },

    showViewerExtension(file) {
      // redundant check for backwards compatibility
      // TODO: remove redundant checks
      if (file.fileType === 'document' || file.mimeType === 'application/pdf' || file.mimeType?.startsWith('text/')) {
        if (file.mimeType === 'application/pdf') {
          workbench.showExtension('omni-core-viewers', { file }, 'pdf', { winbox: { title: file.fileName } });
        } else {
          workbench.showExtension('omni-core-viewers', { file }, 'markdown', { winbox: { title: file.fileName } });
        }
      } else if (file.fileType === 'image' || file.mimeType.startsWith('image')) {
        workbench.showExtension('omni-core-filemanager', { focusedObject: file }, undefined, {
          winbox: { title: file.fileName }
        });
      } else if (
        file.fileType === 'audio' ||
        file.mimeType.startsWith('audio') ||
        file.mimeType === 'application/ogg'
      ) {
        workbench.showExtension('omni-core-filemanager', { focusedObject: file }, undefined, {
          winbox: { title: file.fileName }
        });
      }
    },
    async startCamera() {
      console.log('startCamera');
      this.loadCameraModal = true;
      const video = document.getElementById('video');
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = stream;
      await new Promise((resolve) => {
        video.onloadedmetadata = resolve;
      });
      video.play();
      this.loadCameraModal = false;
      this.openCameraModal = true;
      this.streaming = true;
    },
    takePhoto() {
      const video = document.getElementById('video');
      const canvas = document.getElementById('canvas');
      const context = canvas.getContext('2d');

      // Assuming the video is wider than it is tall, capture a square section from the center.
      const size = Math.min(video.videoWidth, video.videoHeight);
      const startX = (video.videoWidth - size) / 2;
      const startY = (video.videoHeight - size) / 2;

      context.drawImage(video, startX, startY, size, size, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(async (blob) => {
        const file = new File([blob], 'photo.jpg', { type: 'image/jpeg', lastModified: Date.now() });
        const uploadedImages = await this.uploadFiles([file]);

        // Assuming the uploadedImages contain only image file.
        client.clipboard ??= {};
        client.clipboard.images ??= [];
        client.clipboard.images = client.clipboard.images.concat(uploadedImages);

        await onChatMessage({
          message: 'Files uploaded: ' + uploadedImages.length,
          sender: 'me',
          embeds: { images: uploadedImages }
        });

        this.stopCamera();
      }, 'image/jpeg');
    },
    stopCamera() {
      const video = document.getElementById('video');
      video?.srcObject.getTracks().forEach((track) => track.stop());
      this.streaming = false;
      this.openCameraModal = false;
    },
    async resendMessage(message) {
      state.inputText = stripHtml(message.text);
      await this.sendMessage();
    },
    chatDragOver() {
      this.isDraggingOver = true;
    },
    chatDragLeave() {
      this.isDraggingOver = false;
    },
    async chatHandlePaste(event) {
      const items = (event.clipboardData || event.originalEvent.clipboardData).items;

      // if text
      if (items[0].kind === 'string' || items[0].kind === 'number') {
        return;
      }

      await this.genericFileUpload(
        Array.from(items)
          .filter((item) => item.kind === 'file')
          .map((item) => item.getAsFile())
      );
    },
    async chatEnterKeydown(event) {
      // Enter (return) key was pressed.
      if (event.shiftKey) {
        return;
      } // If shift key is also down, do nothing.
      if (!event.shiftKey && !isComposing) {
        event.preventDefault();
        if (event.target.value.trim() !== '') {
          event.target.blur(); // Temporarily blur the textarea to capture the completed input.
          await sendMessage();
          event.target.focus(); // Refocus the textarea.
        } else {
          // Do something
        }
      }
    },
    async chatDrop(event) {
      // Deprecated.
      this.isDraggingOver = false;
      // Deprecated, unreliable across different browsers and requires too much testing.
      await this.genericFileUpload(event?.dataTransfer?.files || event?.target?.files, event);
    },
    async onUploadFileChange(event) {
      await this.genericFileUpload(event?.dataTransfer?.files || event?.target?.files, event);
    },
    async genericFileUpload(files, event) {
      await onChatMessage({ message: 'Uploading files...', sender: 'omni' });
      const uploaded = await this.uploadFiles(files);
      const audio = uploaded.filter((f) => f.mimeType.startsWith('audio') || f.mimeType === 'application/ogg');
      const images = uploaded.filter((f) => f.mimeType.startsWith('image'));
      const documents = uploaded.filter((f) => f.mimeType.startsWith('text/plain') || f.mimeType === 'application/pdf');
      client.clipboard ??= {};
      client.clipboard.images ??= [];
      client.clipboard.audio ??= [];
      client.clipboard.documents ??= [];
      client.clipboard.audio = client.clipboard.audio.concat(audio);
      client.clipboard.images = client.clipboard.images.concat(images);
      client.clipboard.documents = client.clipboard.documents.concat(documents);
      let message = 'Files uploaded: ' + uploaded.length;
      if (uploaded.length > 0) {
        for (let i = 0; i < uploaded.length; i++) {
          message += '\n' + uploaded[i].url;
        }
      }
      await onChatMessage({ message, sender: 'me', embeds: { audio, images, documents } });
      if (event.target) {
        event.target.value = ''; // Allow same file to be uploaded multiple times.
      }
    },

    async fileToDataUrl(file) {
      /* Encode content of file as https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URLs */
      return await new Promise(function (resolve, reject) {
        /* Load file into javascript. */
        const reader = new FileReader();
        reader.onload = (e) => {
          resolve(e.target.result);
        };
        reader.readAsDataURL(file);
      });
    },

    async uploadFiles(files) {
      if (files?.length > 0) {
        let result = await Promise.all(
          Array.from(files).map(async (file) => {
            const form = new FormData();
            form.append('file', file, file.name || Date.now().toString());
            this.imageUrl = await this.fileToDataUrl(file);
            /* Send file to CDN. */
            const result = await axios.post('/fid', form, {
              responseType: 'json',
              headers: { 'content-type': 'multipart/form-data' }
            });
            if (result.data && result.data.length > 0 && result.data[0].ticket && result.data[0].fid) {
              return result.data[0];
            } else {
              console.warn('Failed to upload file', { result, file });
              return null;
            }
            /* break; */
          })
        );
        result = result.filter((r) => r);
        return result;
      }
      return [];
    }
  };
};

export { chatComponent };
