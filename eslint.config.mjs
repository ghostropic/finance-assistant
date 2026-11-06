import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"
import prettier from "eslint-config-prettier/flat"
import betterTailwind from "eslint-plugin-better-tailwindcss"

// The checkable parts of the style guide in docs/code-style.md.
// Layout is Prettier's job (docs/decisions/0015-prettier.md).
const styleGuide = [
  {
    files: ["**/*.tsx"],
    rules: {
      "react/function-component-definition": [
        "error",
        {
          namedComponents: "arrow-function",
          unnamedComponents: "arrow-function",
        },
      ],
      "react/jsx-max-depth": ["error", { max: 4 }],
    },
  },
  {
    files: ["**/*.tsx"],
    plugins: betterTailwind.configs["recommended-error"].plugins,
    settings: { "better-tailwindcss": { entryPoint: "src/app/globals.css" } },
    rules: {
      ...betterTailwind.configs["recommended-error"].rules,
      // Line wrapping is left to Prettier; class order and correctness are enforced.
      "better-tailwindcss/enforce-consistent-line-wrapping": "off",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    settings: { "import/internal-regex": "^@/" },
    rules: {
      "import/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling", "index"],
            "type",
          ],
          pathGroups: [
            { pattern: "react", group: "external", position: "before" },
            { pattern: "next{,/**}", group: "external", position: "before" },
            {
              pattern: "**/*.css",
              group: "index",
              position: "after",
              patternOptions: { dot: true, matchBase: true },
            },
          ],
          pathGroupsExcludedImportTypes: ["react", "type"],
          distinctGroup: false,
          "newlines-between": "never",
        },
      ],
    },
  },
]

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...styleGuide,
  // Last, so it turns off any rule above that would fight Prettier's layout.
  prettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated Prisma client.
    "src/generated/**",
  ]),
])

export default eslintConfig
