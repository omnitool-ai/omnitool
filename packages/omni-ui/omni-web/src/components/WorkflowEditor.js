/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import axios from 'axios';
import { Utils } from 'omni-shared';
import { WorkflowComponentRegistry } from 'omni-sockets';
import { Engine, NodeEditor } from 'rete';
import ConnectionPathPlugin from 'rete-connection-path-plugin';
import ConnectionPlugin from 'rete-connection-plugin';
import * as ClientControls from '../controls/controls.js';
import { AlpineRenderPlugin } from '../plugins/alpine-render-plugin.js';

const workflowEditorComponent = function (refName = 'editor', workbench) {
  const comp = {
    loaded: false,
    editor: null, // NodeEditor
    engine: null, // Engine from "rete"
    isDraggingOver: false,
    addOffsetX: 0,
    addOffsetY: 0,

    async start() {
      this.engine = new Engine('mercs@0.1.1');

      this.initEditor();
      this.registerClientControls();

      // Auto load remote workflow via rx parameter
      const urlParams = new URLSearchParams(window.location.search);
      const rx = urlParams.get('rx');

      if (rx && Utils.isValidUrl(rx)) {
        window.history.replaceState({}, document.title, '/');
        const json = await Utils.fetchJSON(rx);
        // TODO: isValidWorkflow()
        await workbench.loadFromJSON(json);
      }

      if (workbench.isBlank) {
        await workbench.loadFromCache();
      }
      
      const hasKey = await window.client?.runScript('hasKey', {});
      if (!hasKey) {
        workbench.showExtension('omni-core-collectionmanager', {type:'api'}, undefined, {winbox: {title: 'API Management', modal: true}, singletonHash: 'omni-core-collectionmanager-api'})
      }
      
      if (!this.reviewedNUX()) {
        workbench.showTutorial(true);
        this.setReviewedNUX(true);
      }
    },

    async stopWorkflow(args) {
      const jobId = args.length > 0 ? args[0] : undefined;
      const result = await axios.post('/api/v1/workflow/stop', { jobId }, { withCredentials: true });
      return result.data;
    },

    async loadWorkflowToEditor() {
      if (!this.editor) {
        throw new Error('Attempt to call loadWorkflowToEditor before editor is initialized!');
      }
      const wasLoaded = this.loaded;
      this.loaded = false; // Prevent editor from triggering events while loading

      const workflow = workbench?.activeWorkflow;
      if (workflow) {
        await this.editor.clear();
        const reteJSON = workbench.activeWorkflow.rete;

        if (reteJSON?.nodes) {
          // Extract the blockNames from the recipe and turn them into instances that can be fed to the Rete engine.
          const blockNames = Array.from(new Set(Object.values(reteJSON.nodes).map((n) => n.name)));

          const components = await window.client.blocks.getInstances(blockNames);
          const check = new Set(components.map((c) => c.name));
          Object.values(reteJSON.nodes).forEach((n) => {
            if (!check.has(n.name)) {
              n.data[
                'x-omni-summary'
              ] = `The block named <b>"${n.name}"</b> is currently not installed on your system. Please find and install this extension via <b><u>Extensions Manager</u></b>. After installation, restart the server if required, and reload the recipe.`;
              n.missingBlockName = n.name;
              n.name = 'omnitool._block_missing';
            }
          });

          components.forEach((c) => {
            try {
              this.editor.getComponent(c.name);
            } catch (e) {
              // If the comp has not been registered, this is to prevent duplicate registration
              this.editor.register(c);
              this.engine.register(c);
              c.editor = this.editor;
              c.engine = this.engine;
            }
          });

          try {
            await this.editor.fromJSON(reteJSON);
          } catch (e) {
            console.error('Error loading workflow', e);
          }
        }
        workbench.activeWorkflow.rete = this.editor;
        this.loaded = true;
      } else {
        console.log('No workflow loaded');
        this.loaded = wasLoaded;
      }
    },

    onEditorchange(event) {
      if (!this.loaded) {
        return;
      }

      if (workbench.isBlank) {
        return;
      }

      if (
        [
          'connectionremoved',
          'connectioncreated',
          'nodecreated',
          'noderemoved',
          'nodeupdated',
          'nodetranslated'
        ].includes(event)
      ) {
        if (workbench.canEdit) {
          workbench.activeWorkflow.setDirty();
        }
      } else {
        console.log('Unhandled event', event);
      }

      return true;
    },

    async createNodeByBlockName(blockName, data = {}) {
      const block = await window.client.blocks.getInstance(blockName);
      if (!block) {
        return {
          error: `Can't find a block named <b>${blockName}</b>.`
        };
      }

      try {
        if (!comp.editor.components.get(block.name)) {
          comp.editor.register(block);
        }
      } catch (e) {
        console.error(e);
        return { error: e.message };
      }

      const node = await block.createNode();
      if (!node) {
        return {
          error: `Couldn't create a node for <b>${blockName}</b>.`
        };
      }

      Object.keys(data).forEach((key) => {
        if (key in data) {
          node.data[key] = data[key];
        }
      });

      await comp.editor.addNode(node); // Have to add to editor before we can get el.clientWidth
      node.update();

      // TODO: If the "Add Blocks" modal is visible, defer placement, otherwise comp.editor.view.container.clientWidth == 0
      const area = comp.editor.view.area;
      const viewNodes = comp.editor.view.nodes;
      const nodeWidth = viewNodes.get(node).el.clientWidth;
      const nodeHeight = viewNodes.get(node).el.clientHeight;

      let containerClientWidth = comp.editor.view.container.clientWidth;
      let containerClientHeight = comp.editor.view.container.clientHeight;
      if (containerClientWidth < 10 && containerClientHeight < 10) {
        // Hack, see TODO above for proper fix.
        // Probably hidden by a modal, so use the window size instead
        containerClientWidth = window.innerWidth * 0.5;
        containerClientHeight = window.innerHeight * 0.5;
      }

      const centerX =
        (containerClientWidth / 2 - area.transform.x) / area.transform.k - nodeWidth / 2 + comp.addOffsetX;
      const centerY =
        (containerClientHeight / 2 - area.transform.y) / area.transform.k - nodeHeight / 2 + comp.addOffsetY;
      comp.addOffsetX += 20;
      comp.addOffsetY += 20;
      if (comp.addOffsetX > 250) {
        comp.addOffsetX -= 261; // Prime
      }
      if (comp.addOffsetY > 200) {
        comp.addOffsetY -= 211; // Prime
      }

      viewNodes.get(node).translate(centerX, centerY);

      return { node, block };
    },

    async handlePaste(event) {
      if (workbench.readOnly) {
        console.log('Workbench is read-only, unable to paste');
        return;
      }
      const text = event?.clipboardData?.getData('text');
      if (!text) {
        console.log('Clipboard data not found, nothing to paste');
        return;
      }

      let pasteData;
      try {
        pasteData = JSON.parse(text);
      } catch (error) {
        console.error('Invalid JSON string:', text);
        return;
      }

      if (typeof pasteData !== 'object' || !('data' in pasteData) || !('name' in pasteData)) {
        console.log('Invalid paste data', pasteData);
        return;
      }

      const result = await this.createNodeByBlockName(pasteData.name, pasteData.data);
      if (result?.error) {
        console.log(result.error);
      }
    },

    onNavigateZoomToWindow() {
      editorFitHandler();
    },
    onNavigateZoomRelative(direction) {
      const area = comp.editor.view.area;

      // get center of view
      const centerX = comp.editor.view.container.clientWidth / 2;
      const centerY = comp.editor.view.container.clientHeight / 2;

      if (direction > 0) {
        // Don't infinitely zoom in.
        direction = direction / (1 + area.transform.k / 4);
      } else {
        // Don't infinitely zoom out.
        direction = direction / (1 + 0.1 / area.transform.k);
      }
      const scaleFactor = area.transform.k * Math.exp(direction * 0.3);

      // Calculate the new targetX and targetY to keep the center of the view in the same place after scaling
      const targetX = centerX - ((centerX - area.transform.x) * scaleFactor) / area.transform.k;
      const targetY = centerY - ((centerY - area.transform.y) * scaleFactor) / area.transform.k;

      animateTransform(area, targetX, targetY, scaleFactor, 250);
    },
    wfDragOver(e) {
      comp.isDraggingOver = true;
      e.preventDefault();
      e.target.classList.add('dragover');
    },
    wfDragLeave(e) {
      comp.isDraggingOver = false;
      e.target.classList.remove('dragover');
    },

    async wfDrop(event) {
      comp.isDraggingOver = false;
      event.preventDefault();
      event.target.classList.remove('dragover');
      const files = event?.dataTransfer?.files || event?.target?.files;

      if (files.length > 0) {
        const wfDef = files[0];
        if (wfDef.name.endsWith('.json') && wfDef.type === 'application/json') {
          const workflow = await comp.handleWorkflowDrop(wfDef);
          if (workflow) {
            if (workflow.id && workflow.meta?.name && workflow.rete?.id?.startsWith('mercs@')) {
              window.client.sendSystemMessage(
                `Importing recipe named **${workflow.meta.name}** from *${wfDef.name}*.`,
                'text/markdown',
                undefined
              );
              window.Alpine.nextTick(async () => {
                workflow.id = ''; // Imported recipes are assigned a new id.
                await workbench.loadFromJSON(workflow);
                workbench.activeWorkflow?.setDirty();
                workbench.showRecipeHelp();
              });
            } else {
              window.client.sendSystemMessage(
                'The imported file is not a compatible omnitool recipe.',
                'text/plain',
                undefined,
                ['error']
              );
            }
          }
        }
      }

      if (event.target) {
        event.target.value = ''; // Allow same file to be uploaded multiple times.
      }
    },

    reviewedNUX() {
      return window.localStorage.getItem('omnitool.nux');
    },

    setReviewedNUX(v) {
      window.localStorage.setItem('omnitool.nux', v);
    },

    async handleWorkflowDrop(file) {
      return await new Promise((resolve, reject) => {
        const fileReader = new FileReader();
        fileReader.onload = (event) => {
          resolve(JSON.parse(event.target.result));
        };
        fileReader.onerror = (error) => {
          reject(error);
        };
        fileReader.readAsText(file);
      });
    },

    registerClientControls() {
      const clientControlRegistry = WorkflowComponentRegistry.getSingleton().getControlRegistry();

      Object.entries(ClientControls).forEach(([key, value]) => {
        clientControlRegistry.add(key, value);
      });
      console.log('Registered client controls', clientControlRegistry);
    },

    async getComponentDefinition() {
      const comp = await axios.get('/api/v1/mercenaries/components?includeDefinitions=true', {
        withCredentials: true
      });
      return comp.data.map((c) => c[1]);
    },

    initEditor() {
      const container = this.$refs[refName];
      if (!container) {
        throw new Error(
          `No container found for workflow editor container: '${refName}',  Please provide a valid ref to the container element.`
        );
      }

      class OmniEditor extends NodeEditor {
        connect(output, input) {
          if (!comp.loaded || !workbench.readOnly) {
            super.connect(output, input);
          }
        }

        removeConnection(connection) {
          if (!comp.loaded || !workbench.readOnly) {
            super.removeConnection(connection);
          }
        }
      }

      this.editor = new OmniEditor('mercs@0.1.1', container);

      // Monkeypatching retejs resize to work with flexbox
      this.editor.view.resize = function () {
        container.style.width = '100%';
        container.style.height = '100%';
      };

      this.editor.bind('nodeupdated'); // declare custom update event
      this.editor.bind('control_updated'); // declare custom update event
      this.editor.bind('node_dynamic_update'); // declare custom update event

      const alpineRenderPlugin = new AlpineRenderPlugin();
      this.editor.use(alpineRenderPlugin);
      this.editor.use(ConnectionPlugin);

      this.editor.use(ConnectionPathPlugin, {
        type: ConnectionPathPlugin.DEFAULT,
        // transformer: () => ([x1, y1, x2, y2]) => [[x1, y1], [x2, y2]], // optional, custom transformer
        curve: ConnectionPathPlugin[window.client.reteSettings.curve],
        options: { vertical: false, curvature: 0.3 },

        arrow: !!window.client.reteSettings.arrow

        // { color: 'steelblue', marker: 'M0,-10 a10,10 0 1,0 0,20 a10,10 0 1,0 0,-20' }
      });

      this.editor.on('nodecreated', () => this.onEditorchange('nodecreated'));
      this.editor.on('noderemoved', () => this.onEditorchange('noderemoved'));
      this.editor.on('nodeselected', async (node) =>
        this.$dispatch('nodeselected', {
          node,
          component: await window.client.blocks.getInstance(node.name),
          editor: this.editor
        })
      );
      this.editor.on('nodetranslated', (node) => this.onEditorchange('nodetranslated'));
      this.editor.on('connectioncreated', () => this.onEditorchange('connectioncreated'));
      this.editor.on('connectionremoved', () => this.onEditorchange('connectionremoved'));
      this.editor.on('process', () => this.onEditorchange('process'));
      this.editor.on('nodeupdated', () => this.onEditorchange('nodeupdated'));

      this.editor.on('node_dynamic_update', async function ({ nodeId, key, value }) {
        console.log('node_dynamic_update' + nodeId, key, value);

        const node = editor.nodes.find((n) => n.id === nodeId);

        console.log('node_dynamic_update', node, value);

        if (key === '_dynamicPatch' && value != null && typeof value === 'string') {
          /* try {
            node.inputs.forEach(i => {
              node.removeInput(i)
            })

            node.outputs.forEach(i => {
              node.removeOutput(i)
            })

            node.controls.forEach(i => {
              node.removeControl(i)
            })

            const component = componentRegistry.get(node.name)
            await component.builder(node)

            node.update(false)
            window.Alpine.$nextTick(() => {
              editor.view.updateConnections({ node })
            })
          } catch (ex) {
            console.warn('invalid dynamic patch', ex)
            return
          } */
        }

        this.onEditorchange('nodeupdated');
      });
    }
  };

  window.client.subscribeToGlobalEvent('workbench_workflow_loaded', async (data) => {
    await comp.loadWorkflowToEditor();
  });

  window.client.subscribeToGlobalEvent('request_editor_resize', (data) => {
    setTimeout(() => {
      comp.editor?.view.resize();
      window.Alpine.nextTick(() => {
        comp.onNavigateZoomToWindow();
      });
    }, 1);
  });

  window.client.subscribeToGlobalEvent('sse_message', (data) => {
    if (data.type === 'job_state') {
      if (data.event === 'node_started') {
        const node = comp.editor.nodes.find((n) => n.id === data.args.node_id);
        if (node != null) {
          node.active = true;
          node.update();
        }
      } else if (data.event === 'node_finished') {
        const node = comp.editor.nodes.find((n) => n.id === data.args.node_id);
        if (node != null) {
          setTimeout(() => {
            node.active = false;
            node.update();
          }, 300);
        }
      }
    }
    if (data.type === 'control:setvalue') {
      if (data.controlId != null) {
        // TODO: fix inconsistency (i.g. data.node_id, data.args.node_id)
        const node = comp.editor.nodes.find((n) => n.id === data.node_id);
        if (node?.controls) {
          const control = node.controls.get(data.controlId);
          if (control != null) {
            control._alpine.change({ target: { value: data.value } });
          }
        }
      }
    }
  });

  function animateTransform(area, targetX, targetY, targetScale, duration) {
    comp.startTime = Date.now() - 16 / duration;
    comp.startX = area.transform.x;
    comp.startY = area.transform.y;
    comp.startScale = area.transform.k;
    comp.deltaX = targetX - comp.startX;
    comp.deltaY = targetY - comp.startY;
    comp.deltaScale = targetScale - comp.startScale;

    const easeInOutCubic = function (t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    };

    const step = () => {
      const elapsed = Date.now() - comp.startTime;
      const t = Math.min(1, elapsed / duration);
      const easedT = easeInOutCubic(t);
      area.transform.x = comp.startX + comp.deltaX * easedT;
      area.transform.y = comp.startY + comp.deltaY * easedT;
      area.transform.k = comp.startScale + comp.deltaScale * easedT;
      area.zoom(area.transform.k, 0, 0);
      area.update();
      if (t < 1) setTimeout(step, 16);
    };

    step();
  }

  const editorFitHandler = () => {
    const editor = comp.editor;
    if (!editor) return;
    const nodes = editor.nodes;
    const viewNodes = editor.view.nodes;
    const minX = Math.min(...nodes.map((n) => n.position[0]));
    const minY = Math.min(...nodes.map((n) => n.position[1]));
    const maxX = Math.max(...nodes.map((n) => n.position[0] + viewNodes.get(n).el.clientWidth));
    const maxY = Math.max(...nodes.map((n) => n.position[1] + viewNodes.get(n).el.clientHeight));

    const containerWidth = editor.view.container.clientWidth;
    const containerHeight = editor.view.container.clientHeight;

    const scaleFactorX = (containerWidth / (maxX - minX)) * 0.8;
    const scaleFactorY = (containerHeight / (maxY - minY)) * 0.85;
    const scaleFactor = Math.min(scaleFactorX, scaleFactorY);

    if (!isFinite(scaleFactor) || scaleFactor <= 0.0) {
      return;
    }

    const area = editor.view.area;

    const targetX = (containerWidth - (maxX - minX) * scaleFactor) / 2 - minX * scaleFactor;
    const targetY = (containerHeight - (maxY - minY) * scaleFactor) / 2 - minY * scaleFactor;

    animateTransform(area, targetX, targetY, scaleFactor, 500);
  };

  window.client.registerClientScript('fit', async function (args) {
    editorFitHandler();
    return true;
  });

  window.client.registerClientScript('zoom', async function (args) {
    comp.onNavigateZoomRelative(parseInt(args[0] || '1'));
    return true;
  });

  window.client.registerClientScript('clone', async function (args) {
    const result = workbench
      .remixRecipe()
      .then((workflow) => {
        if (workflow) {
          return { response: "Recipe duplicated. It's now ready to edit." };
        } else {
          return { response: '' };
        }
      })
      .catch((error) => {
        return { response: 'Recipe duplication failed: ' + error };
      });
    return result;
  });

  window.client.registerClientScript('set', async function (args) {
    let result;
    if (args.length > 1) {
      window.localStorage.setItem(`settings.${args[0]}`, args[1]);
      result = `Set ${args[0]} to ${args[1]}. Press F5 to update UI`;
    } else if (args.length > 0) {
      window.localStorage.removeItem(`settings.${args[0]}`);
      result = `Reset ${args[0]}. Press F5 to update UI`;
    } else {
      result = 'Usage: /set <key> <value>';
    }

    return { response: result };
  });

  window.client.registerClientScript('run', async function (args) {
    if (!Array.isArray(args) && typeof args === 'object') {
      const payload = JSON.parse(JSON.stringify(args));
      await workbench.execute(payload);
      return;
    }
    if (args.length > 0) {
      let images = [];
      let audio = [];
      let documents = [];

      if (args[1]) {
        if (!Array.isArray(args[1])) {
          args[1] = [args[1]];
        }
        args[1]
          .filter((i) => !!i)
          .forEach((item) => {
            if (typeof item === 'object' && item.mimeType?.startsWith('image/')) {
              images.push(item);
            } else if (
              typeof item === 'object' &&
              (item.mimeType?.startsWith('audio/') || item.mimeType?.startsWith('application/ogg'))
            ) {
              audio.push(item);
            } else if (
              typeof item === 'object' &&
              (item.mimeType?.startsWith('text/plain') || item.mimeType?.startsWith('application/pdf'))
            ) {
              documents.push(item);
            }
          });
      }
      audio = images.concat(client.clipboard?.audio || []);
      images = images.concat(client.clipboard?.images || []);
      documents = images.concat(client.clipboard?.documents || []);

      const payload = JSON.parse(JSON.stringify({ text: args[0] || undefined, images, audio, documents }));
      client.clipboard = {};

      await workbench.execute(payload);
    } else {
      await workbench.execute();
    }
    return { response: 'Job started.', hide: true };
  });

  window.client.registerClientScript('stop', async function (args) {
    await comp.stopWorkflow(args);
    return { response: 'Stop running recipe.', hide: true };
  });

  window.client.registerClientScript('new', async function (args) {
    workbench.newRecipe();
  });

  function getSocketDict(node) {
    if (!node) {
      return null;
    }
    if (node.socketDict) {
      return node.socketDict;
    }
    if (node.children) {
      for (const i in node.children) {
        const socketDict = getSocketDict(node.children[i]);
        if (socketDict) {
          return socketDict;
        }
      }
    }
    return null;
  }
  function arrange() {
    function getSocketPosition(node, offsets, key) {
      const socketElement = getSocketDict(node?._alpine)?.[key];
      if (socketElement) {
        const bcr = socketElement.getBoundingClientRect();
        const offset = offsets[node.id] || [0, 0];
        return [bcr.left + offset[0], bcr.top + offset[1]];
      }
      return node.position; // Use the node position as a fallback.
    }

    function getPosition(node, offsets) {
      const offset = offsets[node.id] || [0, 0];
      return [node.position[0] + offset[0], node.position[1] + offset[1]];
    }

    function calculateNodeEnergy(node, offsets, nodes, gap, viewScale) {
      const nodeRect = node._alpine.getBoundingClientRect();
      const nodeWidth = nodeRect.width / viewScale;
      const nodeHeight = nodeRect.height / viewScale;

      const nodePosition = getPosition(node, offsets);
      let energy = 0;

      // Add the distance from the origin to the energy
      energy +=
        (0.01 * (nodePosition[0] * nodePosition[0] + nodePosition[1] * nodePosition[1])) / (viewScale * viewScale);

      // Add the overlaps with other nodes to the energy
      for (const otherNode of nodes) {
        if (otherNode === node) continue;
        const otherNodePosition = getPosition(otherNode, offsets);
        const otherNodeRect = otherNode._alpine.getBoundingClientRect();
        const otherNodeWidth = otherNodeRect.width / viewScale;
        const otherNodeHeight = otherNodeRect.height / viewScale;
        const dx = nodePosition[0] + nodeWidth / 2 - otherNodePosition[0] - otherNodeWidth / 2;
        const dy = nodePosition[1] + nodeHeight / 2 - otherNodePosition[1] - otherNodeHeight / 2;
        const overlapX = (nodeWidth + otherNodeWidth) / 2 - Math.abs(dx) + gap;
        const overlapY = (nodeHeight + otherNodeHeight) / 2 - Math.abs(dy) + gap;
        if (overlapX > 0 && overlapY > 0) {
          const overlapArea = overlapX * overlapY;
          energy += overlapArea * overlapArea; // Square the overlap area
        }
      }

      const connections = [...node.inputs.values(), ...node.outputs.values()];
      for (const connection of connections) {
        for (const link of connection.connections) {
          const inputSocketPosition = getSocketPosition(link.input.node, offsets, 'i_' + link.input.key);
          const outputSocketPosition = getSocketPosition(link.output.node, offsets, 'o_' + link.output.key);
          const dx = (outputSocketPosition[0] - inputSocketPosition[0]) / viewScale + 120;
          const dy = (outputSocketPosition[1] - inputSocketPosition[1]) / viewScale;
          energy += dx * dx * 0.25 + dy * dy * 2;
          // Add a penalty for right-to-left connections
          if (dx > 0) {
            energy += gap * gap;
            energy += Math.abs(dx * dx) * 50;
          }
        }
      }

      return energy;
    }

    const area = comp.editor.view.area;
    const viewNodes = comp.editor.view.nodes;
    const viewScale = area.transform.k;
    const iterations = 500;
    const gap = 50; // The gap between nodes
    const maxRunTime = Date.now() + 1000 * 2; // Run for a maximum of 2 seconds

    const offsets = {};

    for (let i = 0; i < iterations; i++) {
      for (const node of comp.editor.nodes) {
        if (Date.now() > maxRunTime) {
          break;
        }
        let nodeOffset = offsets[node.id] || [0, 0];
        let oldEnergy = calculateNodeEnergy(node, offsets, comp.editor.nodes, gap, viewScale);
        let direction = [(Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10];
        let j = 0;
        while (1) {
          const probe = [nodeOffset[0] + direction[0], nodeOffset[1] + direction[1]];
          offsets[node.id] = probe;

          const newEnergy = calculateNodeEnergy(node, offsets, comp.editor.nodes, gap, viewScale);

          if (oldEnergy > newEnergy) {
            oldEnergy = newEnergy;
            nodeOffset = probe;
            direction[0] *= 1.3;
            direction[1] *= 1.3;
            continue;
          }
          offsets[node.id] = nodeOffset;
          const shrink = 0.5;
          direction = [-direction[1] * shrink, direction[0] * shrink]; // Rotate and shrink the direction
          if (j++ > 80 || direction[0] * direction[0] + direction[1] * direction[1] < 0.00002) {
            break;
          }
        }
      }
    }
    for (const node of comp.editor.nodes) {
      const newPosition = getPosition(node, offsets);
      viewNodes.get(node).translate(...newPosition);
    }

    for (const node of comp.editor.nodes) {
      comp.editor.view.updateConnections({ node });
    }
  }

  window.client.registerClientScript('arrange', async function (args) {
    arrange();
    editorFitHandler();
  });

  window.client.registerClientScript('jobs', async function (args) {
    const result = await axios.get('/api/v1/workflow/jobs', {
      withCredentials: true
    });
    let text = result.data;
    if (text.jobs && text.jobs.length === 0) {
      text = 'No jobs are running.';
    }
    console.log(text);

    return { response: text };
  });

  window.client.registerClientScript('add', async function (args) {
    console.info(`client script "add" called with args: ${args}`);
    const blockName = args?.[0];
    const data = args?.[1];
    if (!blockName) {
      return {
        error: 'No block name provided. Usage: <b>/add <block_name></b>'
      };
    }

    if (workbench.readOnly) {
      return { error: 'Workbench is read-only, unable to add block' };
    }

    const result = await comp.createNodeByBlockName(blockName, data);
    if (result.error) {
      sdk.showToast('Adding ' + blockName + ' failed!', {
        description: result.error,
        type: 'danger',
        position: 'bottom-right'
      });
      return result;
    }
    window.client.showToast(`${result.block.title} block added!`, {
      description: result.block.summary,
      type: 'success',
      position: 'bottom-right'
    });

    return { response: `Added <b>${result.block.title} (${blockName})</b>.`, hide: true };
  });

  window.client.registerClientScript('logout', async () => {
    const authService = client.services.get('auth');
    await authService?.logout();

    // Reload the page after 3 seconds !!!
    setTimeout(function () {
      location.reload();
    }, 3000);

    return { response: 'Bye!' };
  });

  return comp;
};

export { workflowEditorComponent };
