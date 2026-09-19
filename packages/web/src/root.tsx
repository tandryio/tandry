import { m } from "./paraglide/messages";
import { htmlLang } from "./lib/i18n";
import { HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { Shell } from "./components/shell";
import { Button } from "./components/ui/button";
import globalsCss from "./styles/globals.css?url";

export const rootOptions = {
  head: () => {
    const title = m.meta_title();
    const description = m.meta_description();
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title },
        { name: "description", content: description },
        { name: "theme-color", content: "#070a12" },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "Tandry" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { name: "twitter:card", content: "summary" },
      ],
      links: [
        { rel: "icon", href: "/favicon.svg" },
        { rel: "stylesheet", href: globalsCss },
      ],
    };
  },
  component: () => (
    <html lang={htmlLang()} className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
  notFoundComponent: () => (
    <Shell>
      <h1>{m.error_not_found()}</h1>
      <Button asChild>
        <a href="/">{m.error_back_home()}</a>
      </Button>
    </Shell>
  ),
  errorComponent: ({ reset }: { reset: () => void }) => (
    <Shell>
      <h1>{m.error_page_failed()}</h1>
      <div className="actions">
        <Button variant="primary" onClick={reset}>
          {m.common_retry()}
        </Button>
        <Button asChild>
          <a href="/">{m.error_back_home()}</a>
        </Button>
      </div>
    </Shell>
  ),
};
