import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Documentation } from "@tandryio/web/pages/docs";
import { m } from "@tandryio/web/messages";
import { getLocale } from "@tandryio/web/runtime";
import { docs, source } from "../lib/docs/source";

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

function DocsRoute() {
  return <Documentation data={Route.useLoaderData()} docs={docs} />;
}
