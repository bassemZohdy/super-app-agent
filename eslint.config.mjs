import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.dart_tool/**', '**/.angular/**', '**/.turbo/**'] },
  { files: ['**/*.ts', '**/*.tsx'], languageOptions: { parser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } } },
    plugins: { '@typescript-eslint': plugin },
    rules: {
      'no-unreachable': 'error', 'no-dupe-args': 'error', 'no-dupe-keys': 'error', 'no-duplicate-case': 'error',
      'no-async-promise-executor': 'error', 'no-unsafe-finally': 'error', 'no-sparse-arrays': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      '@typescript-eslint/no-unsafe-declaration-merging': 'error',
      '@typescript-eslint/no-unnecessary-type-constraint': 'error',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
      '@typescript-eslint/no-wrapper-object-types': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
