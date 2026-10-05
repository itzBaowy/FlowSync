import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default [
  { settings: { next: { rootDir: 'apps/web/' } } },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/src/generated/**',
      '.npm-cache/**',
      '.local/**',
      '**/next-env.d.ts',
    ],
  },
  { ...js.configs.recommended, files: ['**/*.ts', '**/*.tsx'] },
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: ['**/*.ts', '**/*.tsx'] })),
  ...[...nextVitals, ...nextTs].map((config) => ({
    ...config,
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
  })),
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];
