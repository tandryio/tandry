import { Link } from "@tanstack/react-router";
import { m } from "../../paraglide/messages";
import { Brand } from "./brand";
import { Container } from "./section";
import { DISCORD_URL, REPO_URL } from "./site-header";
import { SiteLink } from "../ui/site-link";

export function SiteFooter() {
  const columns = [
    {
      title: m.landing_footer_product(),
      links: [
        { href: "/#example", label: m.nav_how_it_works() },
        { href: "/install", label: m.nav_get_started() },
        { href: "/rooms", label: m.nav_my_rooms() },
      ],
    },
    {
      title: m.landing_footer_resources(),
      links: [
        { href: "/docs", label: m.landing_read_docs() },
        { href: REPO_URL, label: m.nav_source_code(), external: true },
        { href: DISCORD_URL, label: m.nav_discord(), external: true },
        { href: "/privacy", label: m.privacy_title() },
      ],
    },
  ];
  return (
    <footer className="relative border-t border-white/6">
      <Container className="py-14 md:py-16">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(2,0.8fr)]">
          <div>
            <Link
              to="/"
              aria-label={m.nav_home_label()}
              className="inline-block rounded-md"
            >
              <Brand />
            </Link>
            <p className="mt-5 max-w-[17rem] text-sm leading-relaxed text-ink/45">
              {m.meta_description()}
            </p>
          </div>
          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <p className="mb-4 font-mono text-[11px] tracking-[0.18em] text-ink/35 uppercase">
                {column.title}
              </p>
              {column.links.map((link) => {
                const className =
                  "block py-1.5 text-sm text-ink/55 transition-colors duration-200 hover:text-ink";
                return link.external ? (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={className}
                  >
                    {link.label}
                  </a>
                ) : (
                  <SiteLink
                    key={link.href}
                    href={link.href}
                    className={className}
                  >
                    {link.label}
                  </SiteLink>
                );
              })}
            </nav>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-white/6 pt-6">
          <p className="m-0 font-mono text-[11px] text-ink/35">
            {m.landing_footer_copyright({
              year: String(new Date().getFullYear()),
            })}
          </p>
          <p className="m-0 flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-ink/35 uppercase">
            <span
              className="size-1.5 animate-pulse-soft rounded-full bg-accent"
              aria-hidden="true"
            />
            {m.landing_footer()}
          </p>
        </div>
      </Container>
    </footer>
  );
}
