import { Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { m } from "../../paraglide/messages";
import { Container } from "../layout/section";
import { REPO_URL } from "../layout/site-header";
import { Reveal } from "../motion/reveal";
import { CopyButton, MARKETPLACE, PLUGIN } from "./installation";

const COMMANDS = [
  `/plugin marketplace add ${MARKETPLACE}`,
  `/plugin install ${PLUGIN}`,
];

export function ClosingCta() {
  return (
    <section className="landing-next">
      <Container>
        <Reveal className="next-panel">
          <div>
            <h2>{m.landing_next_title()}</h2>
            <p>{m.landing_next_note()}</p>
            <div className="next-actions">
              <Link to="/install">
                {m.landing_hero_cta()}
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
              <a href={REPO_URL} target="_blank" rel="noreferrer">
                GitHub
                <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            </div>
          </div>
          <div>
            <div className="install-block">
              <div className="install-block-bar">Claude Code</div>
              {COMMANDS.map((line) => (
                <div key={line} className="install-line">
                  <code>{line}</code>
                  <CopyButton value={line} />
                </div>
              ))}
            </div>
            <Link to="/install" className="next-more">
              {m.landing_next_other_hosts()}
              <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
