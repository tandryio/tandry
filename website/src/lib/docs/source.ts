import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/plugins/lucide-icons";
import { defineDocs } from "fumadocs-mdx/macro";
import { docsI18n } from "./i18n";

/** MDX collection compiled by the Fumadocs Vite plugin; bodies load lazily. */
export const docs = defineDocs({
  dir: "content/docs",
  docs: { async: true },
});

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: "/docs",
  i18n: docsI18n,
  plugins: [lucideIconsPlugin()],
});
