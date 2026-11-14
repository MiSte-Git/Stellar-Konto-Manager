import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

// Optional: Fallback for Vitest globals
const vitestGlobals = {
  ...(globals?.vitest || {}),
  vi: 'readonly',
}

export default [
  { ignores: ['dist'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      'react/jsx-uses-vars': 'error',
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          allowExportNames: ['useStory', 'friendbotFund', 'sendPayment', 'changeTrust'],
        },
      ],
    },
  },
  // ADR 0012 (Plan Signer-Buendelung 8.2, Teilschritt 6): Signieren und Schluesselmaterial nur in
  // src/utils/signers/. Lern- und Demo-Bereiche (Story, Scam-Simulator) signieren nur im Testnet mit
  // zufaelligen Keys und sind ausgenommen, ebenso Tests.
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: [
      'src/utils/signers/**',
      'src/components/story/**',
      'src/components/scam-simulator/**',
      '**/__tests__/**',
      '**/*.{test,spec}.{js,jsx}',
      'src/test/**',
    ],
    rules: {
      'no-restricted-syntax': ['error',
        {
          selector: "CallExpression[callee.property.name=/^(sign|addSignature|addDecoratedSignature|signDecorated|signPayloadDecorated)$/]:not([callee.object.name='Math'])",
          message: 'Signieren nur ueber utils/signers/ (attachSignatures, signChallengeMessage), ADR 0012.',
        },
        {
          selector: "MemberExpression[property.name='fromSecret']",
          message: 'Schluesselmaterial nur ueber utils/signers/keyMaterial.js (keypairFromSecret), ADR 0012.',
        },
      ],
    },
  },
  // Tests: Vitest globals (describe, it, expect, vi, ...)
  {
    files: [
      '**/__tests__/**/*.{js,jsx,ts,tsx}',
      '**/*.{test,spec}.{js,jsx,ts,tsx}',
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...vitestGlobals,
      },
    },
  },
]
