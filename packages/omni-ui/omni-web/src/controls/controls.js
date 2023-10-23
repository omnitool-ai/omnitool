/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// See https://rete.readthedocs.io/en/latest/Controls/
import Tagify from '@yaireo/tagify';
const controls = import.meta.glob('./*.hbs', { as: 'raw', eager: true });

function controlsShared(initialValue, control, inputTemplate, formatter) {
  return {
    value: initialValue,
    previousValue: initialValue,
    key: '',
    title: '',
    opts: {
      readonly: false,
      placeholder: initialValue,
      default: initialValue,
      choices: ['(default)']
    },
    control: null,
    error: null,
    controlUid: '',
    required: false,
    tooltip: '',

    change(e) {
      let newValue = e.target.value;

      if (typeof this.value === 'number') {
        newValue = +e.target.value;
        console.log('changeNumber', Date.now(), e, newValue);
      }

      if (formatter && this.value != null) {
        try {
          newValue = formatter(newValue);
        } catch (ex) {
          this.error = 'Error: ' + ex.message;
          console.warn('Formatter failed to parse value', newValue, this.value);
          return;
        }
      }
      this.error = null;
      this.value = newValue;
    },
    updateConstraints() {
      if (this.value === '(Default)') {
        this.value = this.opts.default ?? initialValue;
      }
      if (typeof initialValue === 'number') {
        if (this.opts.minimum !== undefined) {
          if (this.value < this.opts.minimum) {
            this.value = this.opts.minimum;
          }
        }
        if (this.opts.maximum !== undefined) {
          if (this.value > this.opts.maximum) {
            this.value = this.opts.maximum;
          }
        }
      }

      if (typeof initialValue === 'string') {
        this.value = typeof this.value === 'string' ? this.value.trim() : '';
      }
    },
    update() {
      this.updateConstraints();
      if (this.key) {
        this.control.putData(this.key, this.value);
        if (this.previousValue !== this.value) {
          this.previousValue = this.value;
          this.emitter.trigger('nodeupdated', this);
        }
      }
    },
    async getInputTemplate() {
      // Compile the template
      const source = controls[inputTemplate];
      if (source === undefined) {
        return inputTemplate;
        // throw new Error(`Template ${inputTemplate} not found`)
      } else {
        return source;
      }
    },
    hasValue() {
      // Caution `this.value` can be 0, 0.0, `0` etc, all of which are "falsey" but valid values.
      return this.value !== null && this.value !== undefined && this.value !== '' && this.value?.length !== 0;
    },

    custom(key) {
      return this.control.custom(key);
    },

    init() {
      this.control = control;
      this.required = this.control.required;

      this.key = this.control.key;
      this.title = this.control.title;

      this.description = this.control.description ?? this.control.summary;
      this.tooltip =
        this.title !== this.description ? (this.title ?? '') + ': ' + (this.description ?? '') : this.title ?? '';

      // See also: https://alpinejs.dev/directives/id
      this.controlUid = this.key + Date.now(); // Must be second-last thing in init()
      this.opts = this.control.opts;
      this.opts.readonly = this.control.opts.readonly || !client.workbench.canEdit;
      this.value = this.control.getData(this.key) ?? this.control.opts.default ?? initialValue;
      this.previousValue = this.value;
      this.emitter = this.control.emitter;
      this.error = null;
      this._customInit?.();
      this.update(); // Must be last thing in init()
    }
  };
}

const AlpineNumComponent = (control) => {
  return {
    ...controlsShared(
      control.opts.default === 'inf' ? Infinity : control.opts.default,
      control,
      './NumControl.hbs',
      parseFloat
    )
  };
};

const AlpineTextComponent = (control) => {
  return {
    ...controlsShared(control.opts.default || '', control, './TextControl.hbs')
  };
};

const AlpineButtonComponent = (control) => {
  return {
    ...controlsShared(control.opts.default || '', control, './ButtonControl.hbs'),

    runButtonAction(value, args) {
      if (this.custom('buttonAction') === 'script') {
        window.client.runScript(value, args);
      } else {
        alert('Button action ' + this.custom('buttonAction') + 'not implemented');
      }
    }
  };
};

const AlpineColorComponent = (control) => {
  return {
    ...controlsShared('', control, './ColorControl.hbs')
  };
};

const AlpineSelectComponent = (control) => {
  return {
    _customInit() {
      this.choices ??= [];
    },

    ...controlsShared('', control, './SelectControl.hbs'),
    selectedChoice() {
      return this.choices
        ? this.choices.find?.((e) => e.toString() === this.value.toString())
        : {
            value: this.default,
            title: '(default)',
            description: null
          };
    }
  };
};

const AlpineSelect2TagComponent = (control) => {
  return {
    ...controlsShared([], control, './Select2TagControl.hbs'),
    ...{
      tagify(element) {
        element.value = this.value;
        // eslint-disable-next-line no-unused-vars
        void new Tagify(element, {
          // enforceWhitelist: true,
          // whitelist: this.opts.choices.map((e) => e.value),
          callbacks: {
            add: (e) => {
              this.updateTag(e);
            },
            remove: (e) => {
              this.updateTag(e);
            }
          }
        });
      },
      updateTag(e) {
        const tags = e.detail.tagify.value.map((e) => {return e.value[0] === '#' ? e.value : '#' + e.value;});
        this.value = tags;
        console.log('updateTag', tags, this.value);
      }
    }
  };
};

const AlpineBoolComponent = (control) => {
  return controlsShared(false, control, './BoolControl.hbs', (v) => !!v);
};

const AlpineToggleComponent = (control) => {
  // Unlike other input types, with `<input type="checkbox" />`, the state is stored in `this.checked`
  // this.value == "on"; // Always
  // (this.checked == true) || (this.checked == false); // State of checkbox
  return {
    ...controlsShared(false, control, './ToggleControl.hbs'),
    ...{
      change(e) {
        this.value = e.target.checked; // Different from `e.target.value` ! See above...
      }
    }
  };
};

const AlpineNumWithSliderComponent = (control) => {
  return {
    ...controlsShared(0, control, './NumWithSliderControl.hbs', parseFloat)
  };
};

const AlpineLabelComponent = (control) => {
  return controlsShared('', control, './LabelControl.hbs');
};

const AlpineCodeMirrorComponent = (control) => {
  return {
    ...controlsShared(null, control, './CodeMirrorControl.hbs', (o) => {
      if (o != null) {
        let result;
        if (typeof o === 'string') {
          result = JSON.parse(o);
        } else if (typeof o === 'object') {
          result = window.Alpine.raw(o);
        } else {
          result = null;
        }
        return result;
      }
    })
  };
};

const AlpineDynamicInputComponent = (control) => {
  return {
    ...{
      doChange(e) {
        const self = this;
        const nodeId = self.control.parent.id;

        this.change(e);
        window.Alpine.nextTick(() => {
          self.emitter.trigger('node_dynamic_update', { nodeId, key: self.key, value: self.value });
        });
      }
    },

    ...controlsShared(null, control, './DynamicInputControl.hbs', (o) => {
      if (o != null) {
        let result;
        if (typeof o === 'string') {
          result = JSON.parse(o);
        } else if (typeof o === 'object') {
          result = window.Alpine.raw(o);
        } else {
          result = null;
        }
        return result;
      }
    })
  };
};

const AlpineImageGalleryComponent = (control) => {
  return {
    ...controlsShared([], control, './ImageGalleryControl.hbs'),
    ...{
      hasValidImage() {},
      update() {
        if (this.key) {
          this.value = this.control.getData(this.key);
        }
      }
    }
  };
};

export {
  AlpineBoolComponent,
  AlpineButtonComponent,
  AlpineCodeMirrorComponent,
  AlpineColorComponent,
  AlpineDynamicInputComponent,
  AlpineImageGalleryComponent,
  AlpineLabelComponent,
  AlpineNumComponent,
  AlpineNumWithSliderComponent,
  AlpineSelect2TagComponent,
  AlpineSelectComponent,
  AlpineTextComponent,
  AlpineToggleComponent
};
