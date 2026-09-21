import { Suspense, use } from "react";
import {
  useFumadocsLoader,
  type SerializedPageTree,
} from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import type {
  MacroAsyncDocsCollection,
  MacroAsyncDocEntry,
} from "fumadocs-mdx/runtime/macro";
import { baseOptions, docsProviderProps } from "../lib/docs/layout";
import { getMDXComponents } from "../components/docs/mdx";
import { SiteHeader } from "../components/layout/site-header";
import { SiteLink } from "../components/ui/site-link";
import { m } from "../paraglide/messages";

type Page = MacroAsyncDocEntry<{ title?: string; description?: string }>;
export type DocsData = {
  path: string;
  locale: string;
  pageTree: SerializedPageTree;
};

export function Documentation({
  data,
  docs,
}: {
  data: DocsData;
  docs: MacroAsyncDocsCollection;
}) {
  const { path, pageTree, locale } = useFumadocsLoader(data);
  const page = docs.getPage(path);
  if (!page) throw new Error(`Unknown docs page: ${path}`);
  return (
    <RootProvider
      theme={{ enabled: false }}
      search={{ options: { api: "/docs/search" } }}
      i18n={docsProviderProps(locale)}
    >
      <div className="kernal-site docs-site">
        <SiteHeader />
        <DocsLayout
          {...baseOptions()}
          tree={pageTree}
          i18n={false}
          slots={{ navTitle: DocsNavTitle }}
        >
          <Suspense>
            <Content page={page} />
          </Suspense>
        </DocsLayout>
      </div>
    </RootProvider>
  );
}
/** The site header carries the brand, links and language; the sidebar only names the section. */
function DocsNavTitle() {
  return (
    <SiteLink href="/docs" className="docs-nav-title">
      {m.nav_docs()}
    </SiteLink>
  );
}

function Content({ page }: { page: Page }) {
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
