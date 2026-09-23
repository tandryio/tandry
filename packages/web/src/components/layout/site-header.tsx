import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useWebOptions } from "../../options";
import { m } from "../../paraglide/messages";
import { AccountNav } from "../account-nav";
import { Brand } from "./brand";
export const REPO_URL = "https://github.com/tandryio/tandry";
export const DISCORD_URL = "https://discord.gg/wbAX4mEqAQ";
export function SiteHeader({ landing = false }: { landing?: boolean }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  const options = useWebOptions();
  const links = [
    { href: "/install", label: m.nav_get_started() },
    { href: "/docs", label: m.nav_docs() },
    ...(options.mainNavigation ?? []).map((item) => ({
      href: item.href,
      label: item.label(),
    })),
  ];
  const navigation = (
    <>
      {links.map((link) => (
        <Link key={link.href} to={link.href} onClick={() => setOpen(false)}>
          {link.label}
        </Link>
      ))}
      <div className="flex items-center gap-1">
        <a
          href={DISCORD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="size-9 justify-center"
          aria-label={m.nav_discord()}
          title={m.nav_discord()}
          onClick={() => setOpen(false)}
        >
          {/* Discord mark from Simple Icons (CC0). */}
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
          </svg>
        </a>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="size-9 justify-center"
          aria-label="GitHub"
          title="GitHub"
          onClick={() => setOpen(false)}
        >
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.14.68-3.8-1.34-3.8-1.34-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.73 1.16 1.73 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.51-.29-5.15-1.26-5.15-5.57 0-1.23.44-2.23 1.16-3.02-.12-.29-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.15a10.8 10.8 0 0 1 5.64 0c2.15-1.45 3.1-1.15 3.1-1.15.61 1.55.23 2.69.11 2.98.72.79 1.16 1.79 1.16 3.02 0 4.32-2.64 5.28-5.16 5.56.41.35.77 1.04.77 2.09v3.11c0 .3.21.65.78.54A11.25 11.25 0 0 0 12 .75Z" />
          </svg>
        </a>
      </div>
    </>
  );
  return (
    <>
      <a className="skip" href="#main">
        {m.nav_skip()}
      </a>
      <header className="site-header" data-scrolled={scrolled || undefined}>
        <div className="header-inner">
          <Link to="/" aria-label={m.nav_home_label()} className="brand">
            <Brand />
          </Link>
          <nav className="header-nav" aria-label={m.nav_main_label()}>
            {navigation}
          </nav>
          <div className="header-actions">
            <AccountNav />
            <button
              className="header-toggle"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-controls="site-menu"
              aria-label={open ? m.nav_menu_close() : m.nav_menu_open()}
            >
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        {open && (
          <nav
            id="site-menu"
            className="header-mobile"
            aria-label={m.nav_main_label()}
          >
            {navigation}
          </nav>
        )}
      </header>
    </>
  );
}
