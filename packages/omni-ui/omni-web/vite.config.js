/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// vite.config.js
import handlebars from 'vite-plugin-handlebars'
import ConditionalCompile from 'vite-plugin-conditional-compiler'
import path from 'path'
import { visualizer } from "rollup-plugin-visualizer";

function handlebarsOverride (options) {
  const plugin = handlebars(options)
  // Currently handleHotUpdate skips further processing, which bypasses
  // postcss and in turn tailwind doesn't pick up file changes
  delete plugin.handleHotUpdate
  return plugin
}

const removeViteSpaFallbackMiddleware = (middlewares) => {
  const { stack } = middlewares
  // const index = stack.findIndex(({ handle }) => console.log(handle.name))
  const index = stack.findIndex(({ handle }) => handle.name === 'viteHtmlFallbackMiddleware')
  if (index > -1) {
    stack.splice(index, 1)
  } else {
    throw Error('viteHtmlFallbackMiddleware() not found in server middleware')
  }
}

const removeHistoryFallback = () => {
  return {
    name: 'remove-history-fallback',
    apply: 'serve',
    enforce: 'post',
    configureServer(server) {
      // rewrite / as index.html
      server.middlewares.use('/', (req, _, next) => {
        if (req.url === '/') {
          req.url = '/index.html'
        }
        next()
      })

      return () => removeViteSpaFallbackMiddleware(server.middlewares)
    },
  }
}

const config = {
  // appType: 'mpa',
  plugins: [ConditionalCompile(), handlebarsOverride({
    reloadOnPartialChange: true,
    partialDirectory: [path.resolve('./src/components/'), path.resolve('./src/controls/'), path.resolve('./src/plugins/nodes/')]
  }),

  removeHistoryFallback(),
  // visualizer({
  //   template: "treemap", // or sunburst
  //   open: true,
  //   gzipSize: true,
  //   brotliSize: true,
  //   filename: "stats.html", // will be saved in project's root
  // })
  ],

  build: {
    outDir: '../../omni-server/public',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        login: path.resolve(__dirname, 'login.html')
      }
    }
  },

  resolve: {
    alias: {
      "monaco-editor": path.resolve(__dirname, '../../../node_modules/monaco-editor'),
      "@winbox": path.resolve(__dirname, '../../../node_modules/winbox'),
      "omni-shared": path.resolve(__dirname, '../../omni-shared/src/index.ts'),
      "omni-sockets": path.resolve(__dirname, '../../omni-sockets/src/index.ts'),
      "omni-client-services": path.resolve(__dirname, '../omni-client-services/src/index.ts')
    }
  },

  test: {
    include: ['src/**/__tests__/*.test.js']
  }
}

export default config
