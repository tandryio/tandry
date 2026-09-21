import { Link } from "@tanstack/react-router";
import { SiteHeader } from "../components/layout/site-header";
import { SiteFooter } from "../components/layout/site-footer";
import { Hero } from "../components/landing/hero";
import { m } from "../paraglide/messages";
import { HostMarquee } from "../components/landing/host-marquee";
import { Workflow } from "../components/landing/workflow";
import { Faq } from "../components/landing/faq";
import { Reveal } from "../components/motion/reveal";
export function Landing() {
  const facts = [
    [m.landing_fact_one_title(), m.landing_fact_one_body()],
    [m.landing_fact_two_title(), m.landing_fact_two_body()],
    [m.landing_fact_three_title(), m.landing_fact_three_body()],
  ];
  return (
    <div className="editorial-site kernal-site">
      <SiteHeader landing />
      <main id="main">
        <Hero />
        <HostMarquee />
        <section
          className="product-facts"
          aria-label={m.landing_details_label()}
        >
          {facts.map(([title, body], i) => (
            <Reveal key={title} delay={i * 0.1}>
              <article>
                <div
                  className={`fact-pattern fact-pattern-${i}`}
                  aria-hidden="true"
                >
                  <span>
                    <img src="/hosts/claude-code.svg" alt="" />
                  </span>
                  <span>
                    <img src="/hosts/codex.svg" alt="" />
                  </span>
                </div>
                <span className="editorial-label">0{i + 1}</span>
                <h2>{title}</h2>
                <p>{body}</p>
              </article>
            </Reveal>
          ))}
        </section>
        <Workflow />
        <Faq />
        <section className="product-next">
          <h2>{m.landing_next_title()}</h2>
          <Link to="/install" className="text-link">
            {m.nav_get_started()} →
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
