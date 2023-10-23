/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import DOMPurify from 'dompurify';

import { galleryComponent } from './GalleryComponent.js';
import { audioPlayerComponent } from './AudioPlayerComponent.js';

export function registerUtils(alpine) {
  alpine.data('inputUtils', () => ({
    textareaAutoResize(el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 400) + 'px';
    },
    scrollBottom(el) {
      el.scrollTop = el.scrollHeight;
    }
  }));

  alpine.data('gallery', () => galleryComponent());
  alpine.data('audioPlayer', () => audioPlayerComponent());
  alpine.magic('tooltip', (el) => (message) => {
    const instance = tippy(el, { content: message, trigger: 'manual' });

    instance.show();

    setTimeout(() => {
      instance.hide();

      setTimeout(() => instance.destroy(), 150);
    }, 2000);
  });

  // Directive: x-tooltip or x-tooltip:reactive
  alpine.directive('tooltip', (el, { value, expression }, { evaluate }) => {
    let text = expression;
    if (value === 'reactive') {
      text = evaluate(expression);
    }
    tippy(el, { content: DOMPurify.sanitize(text, { ALLOWED_TAGS: [] }) });
  });
}
