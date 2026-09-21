import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { m } from "../../paraglide/messages";
import { Button } from "../ui/button";
import { SiteLink } from "../ui/site-link";
import { AsciiField } from "../motion/ascii-field";
import { Reveal } from "../motion/reveal";
import { TerminalConversation } from "./terminal-conversation";
export function Hero() {
  return (
    <section className="product-hero">
      <AsciiField />
      <Reveal className="hero-copy">
        <h1>{m.landing_hero_title()}</h1>
        <p className="hero-lead">{m.landing_hero_lead()}</p>
        <div className="hero-actions">
          <Button asChild variant="primary" size="lg">
            <Link to="/install">
              {m.landing_hero_cta()}
              <ArrowRight size={16} />
            </Link>
          </Button>
          <SiteLink className="text-link" href="/docs">
            {m.nav_docs()} <span aria-hidden="true">↗</span>
          </SiteLink>
        </div>
      </Reveal>
      <Reveal className="hero-demo" delay={0.15}>
        <TerminalConversation />
      </Reveal>
    </section>
  );
}
