import { defineI18n } from "fumadocs-core/i18n";

/**
 * Docs follow the site-wide cookie locale, so URLs never carry a prefix.
 * Content files use the dot convention: `page.mdx` (en) and `page.zh.mdx`.
 */
export const docsI18n = defineI18n({
  defaultLanguage: "en",
  languages: ["en", "zh"],
  hideLocale: "always",
  parser: "dot",
});
