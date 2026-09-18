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
        {HOSTS.map((host) => (
          <span
            key={host.name}
            className="inline-flex items-center gap-3 text-xl font-medium tracking-tight whitespace-nowrap text-ink/45 transition-colors duration-300 hover:text-ink"
          >
            <span
              className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-lg text-ink/70"
              aria-hidden="true"
            >
              {host.glyph}
            </span>
            {host.name}
          </span>
        ))}
      </Marquee>
    </section>
  );
}
