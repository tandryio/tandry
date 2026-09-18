import { useState } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useScroll,
} from "motion/react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { m } from "../../paraglide/messages";
import { cn } from "../../lib/cn";
import { AccountNav } from "../account-nav";
import { Brand } from "./brand";

export const REPO_URL = "https://github.com/tandryio/tandry";

type NavLink = { href: string; label: string; external?: boolean };

/**
 * Floating glass header shared by every page. It tightens and darkens once
 * the page scrolls, and folds its links into a panel on small screens.
 */
export function SiteHeader({ landing = false }: { landing?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 24));

  const links: NavLink[] = landing
    ? [
        { href: "#story", label: m.nav_how_it_works() },
        { href: "#install", label: m.nav_get_started() },
        { href: "/docs", label: m.nav_docs() },
        { href: "/rooms", label: m.nav_my_rooms() },
      ]
    : [
        { href: "/rooms", label: m.nav_my_rooms() },
        { href: "/docs", label: m.nav_docs() },
        { href: "/#install", label: m.nav_install_plugin() },
        { href: "/privacy", label: m.nav_privacy() },
      ];

  return (
    <>
      <a className="skip" href="#main">
        {m.nav_skip()}
      </a>
      <header className="sticky top-0 z-40 px-3 pt-3 md:px-4 md:pt-4">
        <div
          className={cn(
            "glass mx-auto flex max-w-6xl items-center justify-between gap-4 rounded-2xl px-4 transition-[padding,background-color,box-shadow] duration-300 md:px-5",
            scrolled ? "bg-paper/75 py-2 shadow-lg" : "py-2.5 md:py-3",
          )}
        >
          <a
            href="/"
            aria-label={m.nav_home_label()}
            className="brand shrink-0 rounded-md"
          >
            <Brand />
          </a>

          <nav
            aria-label={landing ? m.nav_main_label() : m.nav_account_label()}
            className="hidden items-center gap-7 md:flex"
          >
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-[13px] text-ink/60 transition-colors duration-200 hover:text-ink"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2 md:gap-3">
            <AccountNav />
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-1.5 rounded-full border border-white/12 bg-white/5 px-3.5 py-2 text-xs text-ink transition-colors duration-200 hover:bg-white/10 md:inline-flex"
            >
              GitHub
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </a>
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls="site-menu"
              aria-label={open ? m.nav_menu_close() : m.nav_menu_open()}
              className="grid size-9 cursor-pointer place-items-center rounded-lg border border-white/10 bg-white/5 text-ink md:hidden"
            >
              {open ? (
                <X className="size-4" aria-hidden="true" />
              ) : (
                <Menu className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {open && (
            <motion.div
              id="site-menu"
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="glass mx-auto mt-2 max-w-6xl rounded-2xl p-3 md:hidden"
            >
              {links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-sm text-ink/80 transition-colors hover:bg-white/5 hover:text-ink"
                >
                  {link.label}
                </a>
              ))}
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm text-ink/80 transition-colors hover:bg-white/5 hover:text-ink"
              >
                GitHub
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </a>
            </motion.div>
          )}
        </AnimatePresence>
      </header>
    </>
  );
}
