import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { webConfig } from "@tandryio/web/vite";
import tailwindcss from "@tailwindcss/vite";
import { fumadocsMdx } from "fumadocs-mdx/vite";

export default defineConfig({
  ...webConfig(),
  plugins: [
    fumadocsMdx(),
    tailwindcss(),
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
