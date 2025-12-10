import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
    ...obsidianmd.configs.recommended,
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: tsparser,
            parserOptions: { project: "./tsconfig.json" },
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        rules: {
            // Allow Supernote-specific proper nouns
            "obsidianmd/ui/sentence-case": ["error", {
                brands: ["Supernote", "Supernote Companion", "Browse", "Access", "WiFi", "PDFs", "Companion"],
                acronyms: ["IP", "PDF", "CLI", "KB", "OK", "API"]
            }]
        }
    },
    {
        ignores: ["node_modules/**", "main.js"],
    },
]);
