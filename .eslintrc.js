module.exports = {
  parser: "@typescript-eslint/parser",
  plugins: [
    "jsdoc",
    "@typescript-eslint",
    "react",
    "react-hooks"
  ],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "plugin:jsdoc/recommended",
    "prettier"
  ],
  overrides: [
    {
      files: ["*.ts", "*.tsx"],
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.main.json"],
        tsconfigRootDir: __dirname
      }
    }
  ],
  settings: {
    react: {
      version: "detect"
    },
    "import/parsers": {
      "@typescript-eslint/parser": [".ts", ".tsx"]
    },
    "import/resolver": {
      typescript: {
        alwaysTryTypes: true
      }
    }
  },
  rules: {
    "react/react-in-jsx-scope": "off",
    "react/jsx-filename-extension": ["error", { extensions: [".tsx"] }],
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/prefer-optional-chain": "error",
    "object-curly-spacing": ["error", "always"],
    "no-constant-condition": "warn",
    "jsdoc/require-jsdoc": "off",
    "@typescript-eslint/no-extra-semi": "off",
    "no-extra-semi": "off",
    "semi": "off",
    "@typescript-eslint/semi": "off"
  },
  env: {
    browser: true,
    node: true,
    es2022: true
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: {
      jsx: true
    }
  }
}
