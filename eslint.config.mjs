import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import cssModulesPlugin from "eslint-plugin-css-modules";
import { defineConfig } from "eslint/config";

export default defineConfig([
  // Base JS config
  {
    files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"],
    plugins: { js, "css-modules": cssModulesPlugin },
    extends: ["js/recommended"],
  },

  // Apply browser globals
  {
    files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.vitest,
      },
    },
  },

  // Apply recommended TS and React configs
  tseslint.configs.recommended,
  pluginReact.configs.flat.recommended,

  // Override specific rules after those configs
  {
    files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"],
    rules: {
      "css-modules/no-unused-class": "warn",
      "css-modules/no-undef-class": "warn",
      "react/jsx-no-comment-textnodes": "warn",
      "react/no-unescaped-entities": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },

  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "react/prop-types": "off",
    },
  },
]);
