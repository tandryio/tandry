import { Suspense, use } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import { m } from "../paraglide/messages";
import { getLocale } from "../paraglide/runtime";
import { docs, source } from "../lib/docs/source";
import { baseOptions, docsProviderProps } from "../lib/docs/layout";
import { getMDXComponents } from "../components/docs/mdx";

/*
 * Documentation, rendered with Fumadocs. The server resolves the page for the
 * cookie locale and serialises the sidebar tree; the client loads the compiled
 * MDX body lazily.
 */

const loadPage = createServerFn({ method: "GET" })
  .validator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const locale = getLocale();
    const page = source.getPage(slugs, locale);
    if (!page) throw notFound();
    return {
      path: page.path,
      title: page.data.title,
      description: page.data.description,
      locale,
      pageTree: await source.serializePageTree(source.getPageTree(locale)),
    };
  });

export const Route = createFileRoute("/docs/$")({
  loader: async ({ params }) => {
    const slugs = params._splat?.split("/").filter(Boolean) ?? [];
    const data = await loadPage({ data: slugs });
    await docs.getPage(data.path)?.preload();
    return data;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: m.meta_page_title({ page: loaderData?.title ?? m.nav_docs() }) },
      ...(loaderData?.description
        ? [{ name: "description", content: loaderData.description }]
        : []),
    ],
  }),
  component: DocsRoute,
});

function Content({ path }: { path: string }) {
  const page = docs.getPage(path);
  if (!page) throw new Error(`unknown docs page: ${path}`);
  const { toc } = use(page.load());
  const MDX = page.body;
  return (
    <DocsPage toc={toc}>
      <DocsTitle>{page.title}</DocsTitle>
      <DocsDescription>{page.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

function DocsRoute() {
  const { path, pageTree, locale } = useFumadocsLoader(Route.useLoaderData());
  return (
    <RootProvider
      theme={{ enabled: false }}
      search={{ options: { api: "/docs/search" } }}
      i18n={docsProviderProps(locale)}
    >
      <DocsLayout {...baseOptions()} tree={pageTree}>
        <Suspense>
          <Content path={path} />
        </Suspense>
      </DocsLayout>
    </RootProvider>
  );
}
