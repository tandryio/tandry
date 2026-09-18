import { ArrowRight } from "lucide-react";
import { m } from "../../paraglide/messages";
import { Button } from "../ui/button";
import { Kicker } from "../ui/kicker";
import { BrandMark } from "../layout/brand";
import { Container } from "../layout/section";
import { Reveal } from "../motion/reveal";

export function ClosingCta() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 60% 80% at 50% 120%, rgba(143,196,255,0.28), transparent 62%)," +
            "radial-gradient(ellipse 50% 60% at 20% 0%, rgba(179,157,255,0.14), transparent 60%)",
        }}
      />
      <Container className="relative max-w-4xl py-24 text-center md:py-32">
        <Reveal>
          <div className="mx-auto mb-8 grid size-16 animate-float place-items-center rounded-[20px] border border-white/15 bg-linear-to-br from-white/12 to-white/2 shadow-[0_0_50px_rgba(143,196,255,0.2)]">
            <BrandMark className="size-11" />
          </div>
          <Kicker className="mb-6 justify-center">
            {m.landing_closing_kicker()}
          </Kicker>
          <h2 className="m-0 mx-auto max-w-3xl font-display text-[2.6rem] leading-[1.04] font-normal text-ink md:text-[4rem]">
            {m.landing_closing_1()}
            <br />
            <em className="text-gradient">{m.landing_closing_2()}</em>
          </h2>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-5">
            <Button asChild variant="primary" size="lg" className="px-7">
              <a href="#install">
                {m.landing_hero_cta()}
                <ArrowRight
                  className="size-4 transition-transform duration-200 group-hover/button:translate-x-0.5"
                  aria-hidden="true"
                />
              </a>
            </Button>
            <span className="font-mono text-[11px] tracking-wide text-ink/40">
              {m.landing_closing_note()}
            </span>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
