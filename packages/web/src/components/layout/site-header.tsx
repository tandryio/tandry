import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useWebOptions } from "../../options";
import { m } from "../../paraglide/messages";
import { AccountNav } from "../account-nav";
import { Brand } from "./brand";
export const REPO_URL = "https://github.com/tandryio/tandry";
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
      <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.14.68-3.8-1.34-3.8-1.34-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.73 1.16 1.73 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.51-.29-5.15-1.26-5.15-5.57 0-1.23.44-2.23 1.16-3.02-.12-.29-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.15a10.8 10.8 0 0 1 5.64 0c2.15-1.45 3.1-1.15 3.1-1.15.61 1.55.23 2.69.11 2.98.72.79 1.16 1.79 1.16 3.02 0 4.32-2.64 5.28-5.16 5.56.41.35.77 1.04.77 2.09v3.11c0 .3.21.65.78.54A11.25 11.25 0 0 0 12 .75Z" />
        </svg>
        GitHub
      </a>
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
