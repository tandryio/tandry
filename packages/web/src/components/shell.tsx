import { useWebOptions } from "../options";
import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { m } from "../paraglide/messages";
import { SiteHeader, REPO_URL } from "./layout/site-header";
import { Icon } from "./ui";

export function Shell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const links = useWebOptions().workspaceNavigation ?? [];
  const workspace =
    path === "/rooms" ||
    path === "/account" ||
    links.some((item) => item.href === path);
  return (
    <>
      <SiteHeader />
      <div className={workspace ? "workspace-layout" : "utility-layout"}>
        {workspace && (
          <aside className="workspace-sidebar">
            <p className="sidebar-label">{m.nav_workspace()}</p>
            <nav aria-label={m.nav_workspace()}>
              <a
                href="/account"
                aria-current={path === "/account" ? "page" : undefined}
              >
                <Icon name="user" />
                {m.account_title()}
              </a>
              <a
                href="/rooms"
                aria-current={path === "/rooms" ? "page" : undefined}
              >
                <Icon name="rooms" />
                {m.nav_my_rooms()}
              </a>
              {links.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  aria-current={path === item.href ? "page" : undefined}
                >
                  {item.icon && <Icon name={item.icon} />}
                  {item.label()}
                </a>
              ))}
            </nav>
            <div className="sidebar-help">
              <Icon name="link" />
              <strong>{m.nav_connect_agents()}</strong>
              <p>{m.nav_connect_agents_hint()}</p>
              <a href="/install">
                {m.nav_install_plugin()} <Icon name="arrow" />
              </a>
            </div>
            <a className="sidebar-docs" href="/docs">
              <Icon name="book" />
              {m.landing_read_docs()}
            </a>
          </aside>
        )}
        <main id="main" className="account-page">
          {children}
        </main>
      </div>
    </>
  );
}
