import type { ComponentProps } from "react";
import { Link } from "@tanstack/react-router";

/** A same-site "/path#hash" link that navigates without reloading the document. */
export function SiteLink({
  href,
  ...props
}: { href: string } & Omit<ComponentProps<"a">, "href">) {
  const [to, hash] = href.split("#");
  return <Link to={to} hash={hash} {...props} />;
}
