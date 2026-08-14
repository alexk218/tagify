import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import cssModulesPlugin from "eslint-plugin-css-modules";
import { defineConfig } from "eslint/config";

const LEGACY_HOOKS_DATA_PATTERNS = [
  {
    group: ["@/hooks/data/*", "./hooks/data/*", "../hooks/data/*"],
    message:
      "Import from feature modules (src/features/*). The hooks/data compatibility layer has been removed.",
  },
];

const FEATURE_MODULES = [
  "discovery-survey",
  "filter-state",
  "metadata-backfill",
  "multi-track-tagging",
  "playlist-state",
  "power-user",
  "smart-playlists",
  "tag-data",
  "track-session",
  "update-check",
];

function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const featureBoundaryOverrides = FEATURE_MODULES.map((featureName) => {
  const otherFeaturePattern = FEATURE_MODULES.filter(
    (candidate) => candidate !== featureName,
  )
    .map(escapeForRegex)
    .join("|");

  return {
    files: [`src/features/${featureName}/**/*.{ts,tsx}`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: `^@/features/(?:${otherFeaturePattern})/.+`,
              message:
                "Cross-feature deep imports are not allowed. Import from the feature public API (`@/features/<feature>`) or move shared code to `src/services`, `src/utils`, or `src/types`.",
            },
            ...LEGACY_HOOKS_DATA_PATTERNS,
          ],
        },
      ],
    },
  };
});

export default defineConfig([
  // Base JS config
  {
    files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"],
    plugins: { js, "css-modules": cssModulesPlugin },
    extends: ["js/recommended"],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      react: pluginReact,
      "css-modules": cssModulesPlugin,
    },
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        Spicetify: "readonly",
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      "react/react-in-jsx-scope": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    ignores: ["dist/", "node_modules/", "*.cjs"],
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

  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: LEGACY_HOOKS_DATA_PATTERNS,
        },
      ],
    },
  },
  ...featureBoundaryOverrides,

  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["**/__tests__/**/*.js", "**/*.test.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
]);
