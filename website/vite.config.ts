import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { fumadocsMdx } from "fumadocs-mdx/vite";

export default defineConfig({
  plugins: [
    fumadocsMdx(),
    tailwindcss(),
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/paraglide",
      outputStructure: "message-modules",
      emitTsDeclarations: true,
      cookieName: "tandry-locale",
      strategy: ["cookie", "baseLocale"],
    }),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
    {
      name: "tandry-portable-manifest",
      apply: "build",
      enforce: "post",
      transform(code, id) {
        if (!id.includes("tanstack-start-manifest")) return;
        // TanStack has already matched routes to chunks. The emitted diagnostic
        // file paths should be relative, not contain the builder's home directory.
        const root = fileURLToPath(new URL("./", import.meta.url)).replaceAll(
          "\\",
          "/",
        );
        return {
          code: code.replaceAll(JSON.stringify(root).slice(1, -1), ""),
          map: null,
        };
      },
    },
    react(),
  ],
});
