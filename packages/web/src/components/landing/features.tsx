import type { ComponentType, ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  FolderGit2,
  LayoutGrid,
  Send,
  type LucideProps,
} from "lucide-react";
import { m } from "../../paraglide/messages";
import { Section, SectionHeading } from "../layout/section";
import { SiteLink } from "../ui/site-link";
import { Stagger, StaggerItem } from "../motion/reveal";
import { SpotlightCard } from "../motion/spotlight";

/* Small CSS-only illustrations, one per feature. */

function ContextArt() {
  return (
    <div className="flex h-32 items-center justify-center gap-3">
      {["~/frontend", "~/backend"].map((path, index) => (
        <span
          key={path}
          className="w-28 rounded-lg border border-accent/15 bg-[#0b0f18]/80 p-2.5 font-mono text-[9px] text-ink/60 transition-transform duration-500 group-hover/spot:-translate-y-1"
          style={{
            transform: index ? "translateY(12px)" : undefined,
            transitionDelay: `${index * 80}ms`,
          }}
        >
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-accent/60" />
            {path}
          </span>
          <span className="mt-2.5 block h-0.5 w-2/3 rounded bg-accent/25" />
          <span className="mt-1.5 block h-0.5 w-2/5 animate-shimmer rounded bg-[linear-gradient(90deg,rgba(143,196,255,0.25),rgba(143,196,255,0.7),rgba(143,196,255,0.25))] bg-[length:200%_100%]" />
        </span>
      ))}
    </div>
  );
}

function DeliveryArt() {
  return (
    <div className="flex h-32 items-center justify-center gap-2">
      {["01", "02"].map((label) => (
        <span key={label} className="contents">
          <span className="grid size-10 place-items-center rounded-full border border-accent/25 font-mono text-[11px] text-ink/70">
            {label}
          </span>
          <svg className="w-9" viewBox="0 0 36 2" aria-hidden="true">
            <line
              x1="0"
              y1="1"
              x2="36"
              y2="1"
              className="animate-dash stroke-accent/50"
              strokeDasharray="3 4"
            />
          </svg>
        </span>
      ))}
      <span className="grid size-10 place-items-center rounded-full border border-accent/30 bg-accent/12 text-accent shadow-[0_0_25px_rgba(143,196,255,0.25)] transition-transform duration-500 group-hover/spot:scale-110">
        <Check className="size-4" aria-hidden="true" />
      </span>
    </div>
  );
}

function RoomsArt() {
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-2">
      {[m.landing_room_example(), m.landing_room_example_two()].map(
        (name, index) => (
          <span
            key={name}
            className="flex w-[92%] items-center gap-2.5 rounded-lg border border-accent/15 bg-[#0b0f18]/80 px-3 py-2 text-[10px] text-ink/65 transition-[transform,border-color] duration-500 group-hover/spot:border-accent/35"
            style={{ transitionDelay: `${index * 90}ms` }}
          >
            <span className="size-1.5 animate-pulse-soft rounded-full bg-accent" />
            {name}
            <ArrowUpRight
              className="ml-auto size-3 text-ink/40"
              aria-hidden="true"
            />
          </span>
        ),
      )}
    </div>
  );
}

const FEATURES: {
  icon: ComponentType<LucideProps>;
  tag: () => string;
  title: () => string;
  body: () => string;
  art: ReactNode;
  link?: { href: string; label: () => string };
}[] = [
  {
    icon: FolderGit2,
    tag: m.landing_context_tag,
    title: m.landing_context_title,
    body: m.landing_context_body,
    art: <ContextArt />,
  },
  {
    icon: Send,
    tag: m.landing_delivery_tag,
    title: m.landing_delivery_title,
    body: m.landing_delivery_body,
    art: <DeliveryArt />,
  },
  {
    icon: LayoutGrid,
    tag: m.landing_rooms_tag,
    title: m.landing_rooms_title,
    body: m.landing_rooms_body,
    art: <RoomsArt />,
    link: { href: "/rooms", label: m.nav_my_rooms },
  },
];

export function Features() {
  return (
    <Section id="features">
      <SectionHeading
        kicker={m.landing_features_kicker()}
        title={
          <>
            {m.landing_features_title_1()}{" "}
            <em className="text-accent">{m.landing_features_title_2()}</em>
          </>
        }
        lead={m.landing_features_lead()}
      />
      <Stagger className="grid gap-4 md:grid-cols-3">
        {FEATURES.map((feature) => (
          <StaggerItem key={feature.tag()}>
            <SpotlightCard className="h-full p-6">
              <div className="flex items-center justify-between">
                <span className="grid size-11 place-items-center rounded-xl border border-white/10 bg-linear-to-br from-white/15 to-white/2 text-accent transition-transform duration-300 group-hover/spot:scale-110">
                  <feature.icon
                    className="size-5"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                </span>
                <span className="font-mono text-[10px] tracking-[0.18em] text-ink/35 uppercase">
                  {feature.tag()}
                </span>
              </div>
              <div aria-hidden="true">{feature.art}</div>
              <h3 className="m-0 mb-2 text-lg font-semibold text-ink">
                {feature.title()}
              </h3>
              <p className="m-0 text-sm leading-relaxed text-ink/55">
                {feature.body()}
              </p>
              {feature.link && (
                <SiteLink
                  href={feature.link.href}
                  className="mt-5 inline-flex items-center gap-1 text-sm text-accent/90 underline-offset-4 transition-colors hover:text-accent hover:underline"
                >
                  {feature.link.label()}
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </SiteLink>
              )}
            </SpotlightCard>
          </StaggerItem>
        ))}
      </Stagger>
    </Section>
  );
}
