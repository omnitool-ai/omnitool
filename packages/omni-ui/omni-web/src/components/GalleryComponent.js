/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

const galleryComponent = function () {
  return {
    skip: 1,
    atBeginning: false,
    atEnd: false,
    next() {
      this.to((current, offset) => current + offset * this.skip);
    },
    prev() {
      this.to((current, offset) => current - offset * this.skip);
    },
    to(strategy) {
      const slider = this.$refs.slider;
      const current = slider.scrollLeft;
      const offset = slider.getBoundingClientRect().width;
      slider.scrollTo({ left: strategy(current, offset), behavior: 'smooth' });
    },
    focusableWhenVisible: {
      'x-intersect:enter'() {
        this.$el.removeAttribute('tabindex');
      },
      'x-intersect:leave'() {
        this.$el.setAttribute('tabindex', '-1');
      }
    },
    disableNextAndPreviousButtons: {
      'x-intersect:enter.threshold.05'() {
        const slideEls = this.$el.parentElement.children;

        // If this is the first slide.
        if (slideEls[0] === this.$el) {
          this.atBeginning = true;
          // If this is the last slide.
        } else if (slideEls[slideEls.length - 1] === this.$el) {
          this.atEnd = true;
        }
      },
      'x-intersect:leave.threshold.05'() {
        const slideEls = this.$el.parentElement.children;

        // If this is the first slide.
        if (slideEls[0] === this.$el) {
          this.atBeginning = false;
          // If this is the last slide.
        } else if (slideEls[slideEls.length - 1] === this.$el) {
          this.atEnd = false;
        }
      }
    }
  };
};

export { galleryComponent };
