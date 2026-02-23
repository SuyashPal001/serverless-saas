/* eslint-env node */
module.exports = {
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:prettier/recommended",
  ],
  parser: "@typescript-eslint/parser",
  //plugins: ['@typescript-eslint'],
  rules: {
    "unicorn/consistent-function-scoping": "off",
    "prettier/prettier": "off",
    "linebreak-style": "off",
  },
  root: true,
};
