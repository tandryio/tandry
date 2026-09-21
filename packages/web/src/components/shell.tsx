import { useWebOptions } from "../options";
import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { m } from "../paraglide/messages";
import { SiteHeader, REPO_URL } from "./layout/site-header";
import { Icon, SiteLink } from "./ui";

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
              <Link
                to="/account"
                aria-current={path === "/account" ? "page" : undefined}
              >
                <Icon name="user" />
                {m.account_title()}
              </Link>
              <Link
                to="/rooms"
                aria-current={path === "/rooms" ? "page" : undefined}
              >
                <Icon name="rooms" />
                {m.nav_my_rooms()}
              </Link>
              {links.map((item) => (
                <Link
                  key={item.href}
                  to={item.href}
                  aria-current={path === item.href ? "page" : undefined}
                >
                  {item.icon && <Icon name={item.icon} />}
                  {item.label()}
                </Link>
              ))}
            </nav>
            <div className="sidebar-help">
              <Icon name="link" />
              <strong>{m.nav_connect_agents()}</strong>
              <p>{m.nav_connect_agents_hint()}</p>
              <Link to="/install">
                {m.nav_install_plugin()} <Icon name="arrow" />
              </Link>
            </div>
            <SiteLink className="sidebar-docs" href="/docs">
              <Icon name="book" />
              {m.landing_read_docs()}
            </SiteLink>
          </aside>
        )}
        <main id="main" className="account-page">
          {children}
        </main>
      </div>
    </>
  );
}
