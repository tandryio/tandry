import { Link } from "@tanstack/react-router";
import { m } from "../../paraglide/messages";
import { Marquee } from "../motion/marquee";
import { HOSTS } from "./hosts";

export function HostMarquee() {
  return (
    <section
      className="border-y border-white/6 py-8"
      aria-label={m.landing_hosts_label()}
    >
      <p className="m-0 mb-5 text-center font-mono text-[10px] tracking-[0.24em] text-ink/35 uppercase">
        {m.landing_hosts_label()}
      </p>
      <Marquee duration={38}>
        {(copy) =>
          HOSTS.map((host) => (
            <Link
              key={host.id}
              to="/install"
              hash={host.id}
              tabIndex={copy ? -1 : undefined}
              className="inline-flex items-center gap-3 text-xl font-medium tracking-tight whitespace-nowrap text-ink/45 no-underline transition-colors duration-300 hover:text-ink"
            >
              <span
                className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/5"
                aria-hidden="true"
              >
                <img src={host.logo} alt="" className="size-5" />
              </span>
              {host.name}
            </Link>
          ))
        }
      </Marquee>
    </section>
  );
}
