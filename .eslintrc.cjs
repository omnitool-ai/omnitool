const path = require('path')

const project = [
  path.join(__dirname, 'packages/omni-shared/tsconfig.json'),
  path.join(__dirname, 'packages/omni-ui/omni-client-services/tsconfig.json'),
  path.join(__dirname, 'packages/omni-sockets/tsconfig.json'),
  path.join(__dirname, 'packages/omni-server/tsconfig.json'),
  path.join(__dirname, 'packages/omni-server/tsconfig.eslint.json'),
  path.join(__dirname, 'packages/omni-ui/omni-web/tsconfig.json'),
  path.join(__dirname, 'packages/omni-sdk/tsconfig.json'),
]

module.exports = {
  env: {
    browser: true,
    es2021: true
  },
  extends: ['standard-with-typescript', 'eslint-config-prettier'],
  plugins: ['@typescript-eslint', 'prettier'],
  overrides: [
    {
      env: {
        node: true
      },
      files: ['.eslintrc.{js,cjs}'],
      parserOptions: {
        sourceType: 'script',
        project
      }
    }
  ],
  ignorePatterns: ['setup/**', 'vite.config.js', '*.cjs', '*.d.ts', '*/omni-server/extensions/**'],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project
  },
  rules: {
    'no-debugger': 'warn',
    'prettier/prettier': 'off',
    'no-prototype-builtins': 'off',
    'eslint-disable-next-line': 'off',
    "no-lone-blocks" : 'off',
    'no-trailing-spaces': 'off',
    'no-multi-spaces': 'off',
    'padded-blocks': 'off',
    'no-debugger': 'off',
    'object-property-newline': 'off',
    'object-curly-newline': 'off',
    'arrow-spacing': 'off',
    'no-multiple-empty-lines': 'off',
    'eol-last': 'off',
    'space-in-parens':'off',
    'block-spacing':'off',
    'spaced-comment': 'off',
    'new-cap': 'off',
    '@typescript-eslint/quotes': 'off',
    'promise/param-names': 'off',
    '@typescript-eslint/array-type': 'off', // candidate for code quality pass
    '@typescript-eslint/space-before-blocks': 'off',
    '@typescript-eslint/keyword-spacing': 'off',
    '@typescript-eslint/member-delimiter-style': 'off',
    '@typescript-eslint/brace-style': 'off',
    '@typescript-eslint/lines-between-class-members': 'off',
    '@typescript-eslint/comma-dangle': 'off',
    '@typescript-eslint/comma-spacing': 'off',
    'generator-star-spacing': 'off',
    'no-unexpected-multiline': 'off',
    '@typescript-eslint/space-infix-ops': 'off',
    '@typescript-eslint/object-curly-spacing' : 'off',
    '@typescript-eslint/key-spacing': 'off',
    '@typescript-eslint/type-annotation-spacing': 'off',
    '@typescript-eslint/naming-convention': 'off',
    '@typescript-eslint/space-before-function-paren': 'off',
    '@typescript-eslint/indent': ['off', 4],
    '@typescript-eslint/strict-boolean-expressions': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/semi': 'off',
    '@typescript-eslint/no-unused-vars': 'warn',
    '@typescript-eslint/no-unused-expressions': 'warn',
    '@typescript-eslint/prefer-ts-expect-error': 'off',
    '@typescript-eslint/restrict-template-expressions': 'off',
    '@typescript-eslint/naming': 'off',
    '@typescript-eslint/prefer-optional-chain': 'off',
    '@typescript-eslint/no-floating-promises': 'warn',
    '@typescript-eslint/prefer-nullish-coalescing': 'warn',
    '@typescript-eslint/ban-types': ['warn', {
      'types': {
        'Function': false
      }
    }],
    '@typescript-eslint/restrict-plus-operands': 'warn',
    '@typescript-eslint/no-dynamic-delete': 'warn',
    '@typescript-eslint/no-misused-promises': 'warn',
    '@typescript-eslint/no-useless-constructor': 'off',
    '@typescript-eslint/await-thenable': 'warn',
    '@typescript-eslint/restrict-plus-operands': 'off',
    '@typescript-eslint/no-non-null-assertion': 'warn',
    '@typescript-eslint/return-await': 'warn',
    '@typescript-eslint/no-this-alias': 'off',
    '@typescript-eslint/no-extraneous-class': 'warn',
    'no-eval': 'warn',
    'eqeqeq': 'warn'
  }
}
