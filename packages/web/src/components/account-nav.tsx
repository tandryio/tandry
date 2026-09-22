import { useWebOptions } from "../options";
import { Link } from "@tanstack/react-router";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { authClient } from "../lib/auth-client";
import { useProfile } from "../lib/profile";
import { getLocale, setLocale } from "../paraglide/runtime";
import { m } from "../paraglide/messages";
import { useEffect, useState } from "react";
import { Button, Icon, Select } from "./ui";

export function AccountNav() {
  const links = useWebOptions().workspaceNavigation ?? [];
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const { data: session } = authClient.useSession();
  const profile = useProfile(session?.user.id);
  const label = profile.data?.handle
    ? `@${profile.data.handle}`
    : m.nav_profile();
  return (
    <div className="account-nav">
      <Select
        disabled={!ready}
        className="language-select"
        label={m.nav_language()}
        icon={<Icon name="globe" />}
        value={getLocale()}
        onValueChange={(value) => setLocale(value === "zh" ? "zh" : "en")}
        options={[
          { value: "en", label: "English" },
          { value: "zh", label: m.nav_language_chinese({}, { locale: "zh" }) },
        ]}
      />
      {session ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            className="account-trigger"
            aria-label={m.nav_account_menu()}
          >
            <span className="nav-avatar">
              {session.user.image ? (
                <img
                  src={session.user.image}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              ) : (
                (profile.data?.handle || session.user.name || "T")
                  .slice(0, 1)
                  .toUpperCase()
              )}
            </span>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="ui-menu"
              align="end"
              sideOffset={9}
              collisionPadding={12}
            >
              <DropdownMenu.Label className="ui-menu-label">
                {label}
              </DropdownMenu.Label>
              <DropdownMenu.Item asChild>
                <Link to="/account">
                  <Icon name="user" />
                  {m.account_title()}
                </Link>
              </DropdownMenu.Item>
              <DropdownMenu.Item asChild>
                <Link to="/rooms">
                  <Icon name="rooms" />
                  {m.nav_my_rooms()}
                </Link>
              </DropdownMenu.Item>

              {links.map((item) => (
                <DropdownMenu.Item asChild key={item.href}>
                  <Link to={item.href}>
                    {item.icon && <Icon name={item.icon} />}
                    {item.label()}
                  </Link>
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Separator className="ui-menu-separator" />
              <DropdownMenu.Item
                className="ui-menu-sign-out"
                onSelect={() => {
                  void authClient
                    .signOut()
                    .finally(() => window.location.assign("/login"));
                }}
              >
                <Icon name="logout" />
                {m.account_sign_out()}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : (
        <Button asChild variant="primary" size="sm" className="nav-sign-in">
          <a href="/login">
            {m.common_sign_in()}
            <Icon name="arrow" />
          </a>
        </Button>
      )}
    </div>
  );
}
