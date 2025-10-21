module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true,
  },
  extends: ['eslint:recommended', 'prettier'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['jest'],
  rules: {
    // Errores
    'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-var': 'error',
    'prefer-const': 'error',

    // Warnings
    'no-debugger': 'warn',

    // Estilo (manejado por Prettier)
    'quotes': 'off',
    'semi': 'off',
    'indent': 'off',
    'comma-dangle': 'off',
  },
};
