import type { CSSProperties } from "react";
import { ArrowRight, ArrowDown, Sparkles } from "lucide-react";
import { m } from "../../paraglide/messages";
import { Button } from "../ui/button";
import { Eyebrow } from "../ui/kicker";
import { Container } from "../layout/section";
import { TiltCard } from "../motion/tilt";
import { RoomDemo } from "./room-demo";

/** Staggered CSS entrance so the first paint animates before hydration. */
const rise = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

export function Hero() {
  return (
    <Container className="grid items-center gap-14 pt-14 pb-20 md:grid-cols-[1.02fr_0.98fr] md:pt-20 md:pb-28">
      <div className="text-center md:text-left">
        <Eyebrow className="animate-rise" style={rise(0)}>
          {m.landing_eyebrow()}
        </Eyebrow>
        <h1
          className="mt-6 mb-0 animate-rise font-display text-[3.2rem] leading-[1] font-normal tracking-[-0.015em] text-ink md:text-[4.9rem]"
          style={rise(80)}
        >
          {m.landing_hero_title_1()}
          <br />
          <em className="text-gradient not-italic md:italic">
            {m.landing_hero_title_highlight()}
          </em>
          <br />
          {m.landing_hero_title_2()}
        </h1>
        <p
          className="mx-auto mt-7 mb-0 max-w-md animate-rise text-base leading-relaxed text-ink/60 md:mx-0 md:text-lg"
          style={rise(160)}
        >
          {m.landing_hero_lead()}
        </p>
        <div
          className="mt-9 flex animate-rise flex-wrap items-center justify-center gap-4 md:justify-start"
          style={rise(240)}
        >
          <Button asChild variant="primary" size="lg">
            <a href="#install">
              {m.landing_hero_cta()}
              <ArrowRight
                className="size-4 transition-transform duration-200 group-hover/button:translate-x-0.5"
                aria-hidden="true"
              />
            </a>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <a href="#story">
              {m.landing_hero_secondary()}
              <ArrowDown
                className="size-4 transition-transform duration-200 group-hover/button:translate-y-0.5"
                aria-hidden="true"
              />
            </a>
          </Button>
        </div>
        <p
          className="mt-8 mb-0 flex animate-rise items-center justify-center gap-2 font-mono text-[11px] tracking-wide text-ink/40 md:justify-start"
          style={rise(320)}
        >
          <Sparkles className="size-3.5 text-accent" aria-hidden="true" />
          {m.landing_hero_micro()}
        </p>
      </div>

      <div className="relative animate-rise" style={rise(200)}>
        <div
          aria-hidden="true"
          className="absolute -inset-8 rounded-[3rem] bg-accent/10 blur-3xl"
        />
        <TiltCard className="relative animate-float">
          <RoomDemo />
        </TiltCard>
      </div>
    </Container>
  );
}
