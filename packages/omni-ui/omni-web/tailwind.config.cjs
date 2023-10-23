/** @type {import('tailwindcss').Config} */
const defaultTheme = require('tailwindcss/defaultTheme')

export default {
  mode: 'jit',
  content: [
    "./index.html",
    "./login.html",
    "./src/**/*.{js,ts,jsx,tsx,hbs}",
  ],
  safelist:[
    'border-2'
  ],
  theme: {
    extend: {
      blur:
      {
        'xs': '2px',
        'xxs': '1px',
      },
      fontSize:
      {
        'xxs': '0.65rem'
      },
      screens: {
        'xs': '375px',
        ...defaultTheme.screens,
      },
      minHeight:
      {
        '6': '24px',
        '7': '28px',
        '8': 2 + 'rem',
      },
      minWidth: {
        '2': '2px',
        '32': '32px',
        '64': '64px',
        '128': '128px',
        '250': '250px',

      },
    },
  },
  plugins: ['@tailwindcss/forms'],
}