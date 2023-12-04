/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import Alpine from 'alpinejs';
import { getRenderTemplate } from './nodes/nodes.js';

import '../styles/rete.scss';
import { omnilog } from 'omni-shared';
window.Alpine = Alpine;
export function kebab(str) {
  const replace = (s) => s.toLowerCase().replace(/ /g, '-');
  return Array.isArray(str) ? str.map(replace) : replace(str);
}

export class AlpineRenderPlugin {
  constructor(options = {}) {
    this.name = 'alpine-render';
    this.options = options;
    this.editor = null;
  }

  setupAlpineNode(el, reteNode, bindSocket, bindControl) {
    if (reteNode == null) {
      throw new Error('Invalid Rete Node (null)');
    }
    reteNode._alpine = el;
    const name = 'retenode' + reteNode.id;
    el.setAttribute('x-data', name);
    el.setAttribute('id', name);

    // TODO: Is this possibly leaking when nodes are deleted?
    new ResizeObserver(() => {
      this.onNodeResize(reteNode);
    }).observe(el);

    reteNode.update = async (skipRedraw) => await this.update(reteNode, skipRedraw);
    const reteEditor = this.editor;
    Alpine.data(name, () => ({
      node: null,
      editor: null,
      bindSocket: null,
      bindControl: null,
      showEditor: false,
      classNameString: '',
      //blockClassString: '',
      tabButtonsClassString: '',
      showHelp: true,
      copyNotification: false,
      getTitle(){
        return this.node.title  || this.node.name
      },
      selected(node) {
        return this.editor?.selected.contains(node) ? 'selected' : '';
      },
      className(node) {
        return kebab([
          'rete-block', // Required for rete.scss to apply error and selected styles to blocks.
          this.selected(node),
          node.name,
          node.errors.length ? 'error' : '',
          node.active ? 'active' : ''
        ]);
      },

      async rename() {
        const newName = prompt('New Name', this.node.title) || '';
        if (newName === this.title) {
          delete this.node.data['x-omni-title']
          return;
        }
        const prevName = this.node.data['x-omni-title'] || '';
        this.node.data['x-omni-title'] = newName || undefined;
        this.node.title = this.node.data['x-omni-title'] || this.title;
        return prevName !== newName
      },
      async startEditComment(el) {
        const commentEl = document.getElementById(`comment_${this.node.id}`);
        commentEl.innerText = this.node.data['x-omni-comment'] || this.node.summary;
      },
      async getHelpText(node) {
        return window.client.markdownEngine.render(this.node.data['x-omni-comment'] || this.node.summary);
      },
      async setComment(el) {
        const commentEl = document.getElementById(`comment_${this.node.id}`);
        const newText = commentEl.innerText.trim();
        const prevText = this.node.data['x-omni-comment'] || '';
        if (newText) {
          this.node.data['x-omni-comment'] = newText;
        } else {
          delete this.node.data['x-omni-comment'];
        }
        commentEl.innerHTML = await window.client.markdownEngine.render(
          this.node.data['x-omni-comment'] || this.node.summary
        );
        return prevText !== newText;
      },
      outputs(node) {
        if (!node || !node.outputs) {
          return [];
        }
        return Array.from(node?.outputs?.values?.() || []);
      },
      inputs(node) {
        if (!node || !node.inputs) {
          return [];
        }
        return Array.from(node?.inputs?.values?.() || []).filter((x) => x != null);
      },
      controls(node) {
        return Array.from(node?.controls?.values?.() || []).filter((x) => {
          if (x == null) {
            console.warn('Null control for node - skipping render', node);
            return false;
          }
          if (x.component == null) {
            console.warn('Invalid component for control - skipping render', Alpine.raw(node), Alpine.raw(x));
            return false;
          }
          return true;
        });
      },
      onClickClose(node) {
        // Delete the node and the component (!)
        this.editor.removeNode(node);
      },

      toggleInfo(node) {
        this.showHelp = !this.showHelp;

        if (!this.showHelp) {
          window.localStorage.setItem('omni/workbench/help_seen_' + node.name, 1);
        } else {
          window.localStorage.removeItem('omni/workbench/help_seen_' + node.name);
        }

        window.client.sendSystemMessage(
          Object.assign({ name: node.name, title: node.title }, node.meta || {}, node.patch?.meta || {}),
          'omni/component-meta',
          {
            commands: [
              {
                title: 'Add to Workbench',
                id: 'add',
                args: [node.name]
              }
            ]
          },
          ['no-picture']
        );
      },
      onClickCopy(node) {
        const copyNode = {
          data: node.data,
          name: node.name
        };
        const s = JSON.stringify(copyNode);
        navigator.clipboard.writeText(s).then(
          function () {
            // console.log('Copying to clipboard was successful!');
          },
          function (err) {
            console.error('Could not copy node: ', err);
          }
        );
        this.copyNotification = true;
        const that = this;
        setTimeout(function () {
          that.copyNotification = false;
        }, 3000);
      },
      getContentHeight() {},
      init() {
        if (!reteNode) {
          throw new Error('reteNode is not defined');
        }
        this.node = reteNode;
        this.node.namespace ??= '';
        this.node.category ??= '';
        this.node.title ??= '';
        this.node.summary ??= '';
        this.node.meta ??= {};
        this.node.data.xOmniEnabled ??= true;
        this.showHelp = window.localStorage.getItem('omni/workbench/help_seen_' + this.node.name) == null;

        this.editor = reteEditor;
        this.bindSocket = bindSocket;
        this.bindControl = bindControl;
        //this.classNameString = this.blockClassString = this.tabButtonsClassString = this.className(reteNode)
      }
    }));
  }

  // eslint-disable-next-line no-unused-vars
  createControl(el, control) {
    const data = Alpine.$data(el);
    return data;
  }

  setInnerHTML(node) {
    //node._alpine.setAttribute('class', 'block')
    //node._alpine.setAttribute(':class', 'blockClassString')
    // POC: This will bec
    if (!node) {
      throw new Error('Invalid node passed into setInnerHtml');
    }
    node._alpine.innerHTML = node.renderTemplate
      ? getRenderTemplate(node.renderTemplate)
      : getRenderTemplate('default');
  }

  updateConnections(reteNode) {
    reteNode.outputs.forEach((x) => {
      x.connections.forEach((connection) => {
        this.editor.view.connections.get(connection)?.update();
      });
    });
    reteNode.inputs.forEach((x) => {
      x.connections.forEach((connection) => {
        this.editor.view.connections.get(connection)?.update();
      });
    });
  }

  onNodeResize(reteNode) {
    if (!reteNode) {
      throw new Error('Invalid reteNode passed to onNodeResize');
    }
    this.updateConnections(reteNode);
  }

  async update(reteNode, skipRedraw = false) {
    if (!reteNode) {
      throw new Error('Invalid reteNode passed to update');
    }
    const ref = Alpine.$data(reteNode._alpine);
    if (ref?.className) {
      ref.classNameString = ref.className(reteNode);
      //ref.blockClassString = ref.classNameString
      ref.tabButtonsClassString = ref.classNameString;
    }
    if (!skipRedraw) {
      this.setInnerHTML(reteNode);
    }

    return await new Promise((res) => {
      // update() is often called with .reduce(...)
      // This Promise attempts to minimize excessive updates by only updating one node per frame.
      // TODO: Measure difference in battery usage.

      if (!reteNode._alpine) {
        res();
        return;
      }
      Alpine.effect(() => {
        requestAnimationFrame(res);
      });
    });
  }

  install(editor) {
    this.editor = editor;
    this.editor.on('rendernode', ({ el, node, component, bindSocket, bindControl }) => {
      if (!component.render || component.render === 'alpine') {
        // Create Alpine component for the node and update it
        this.setupAlpineNode(el, node, bindSocket, bindControl);
        this.setInnerHTML(node);

        node.update();
      }
    });

    this.editor.on('rendercontrol', ({ el, control }) => {
      if (control.render && control.render !== 'alpine') return;
      // Create Alpine component for the control and update it
      control._alpine = this.createControl(el, control);

      control.update = () => control._alpine.update();
    });

    this.editor.on('connectioncreated connectionremoved', (connection) => {
      connection.input.node.update();
      connection.output.node.update();
    });

    this.editor.on('nodeselected', (node) => {
      if (node._alpine !== editor.previousSelectedNode?._alpine) {
        editor.previousSelectedNode?.update(true); // Redraw previously selected node
        editor.previousSelectedNode = node;
        node.update(true);
      }
    });
  }
}

document.addEventListener('alpine:init', () => {
  omnilog.status_start('Renderer Alpine Init');

  Alpine.directive('socket', (el, { expression, value }, { evaluate, effect }) => {
    const foundEl = el.closest('[x-data]');
    const data = Alpine.$data(foundEl);
    // Alpine directive x-socket:value=expression
    const io = evaluate(expression);
    const currentClass = el.getAttribute('class');
    el.setAttribute('class', currentClass + ' ' + io.socket.name);

    const prefix = value === 'output' ? 'o_' : 'i_';
    foundEl.socketDict = {
      ...(foundEl.socketDict || {}),
      [prefix + io.key]: el
    };

    effect(() => {
      data.bindSocket(el, value, Alpine.raw(io));
    });
  });
  Alpine.directive('control', (el, { expression, value }, { evaluate, effect }) => {
    // Alpine directive x-control:value=expression
    const foundEl = el.closest('[x-data]');
    const data = Alpine.$data(foundEl);
    const control = evaluate(expression);
    effect(() => {
      data.bindControl(el, Alpine.raw(control));
    });
  });
});
