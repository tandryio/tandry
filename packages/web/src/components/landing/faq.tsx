import { ArrowUpRight } from "lucide-react";
import { m } from "../../paraglide/messages";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { Kicker } from "../ui/kicker";
import { SiteLink } from "../ui/site-link";
import { Container } from "../layout/section";
import { REPO_URL } from "../layout/site-header";
import { Reveal, Stagger, StaggerItem } from "../motion/reveal";

const FAQS = [
  [m.faq_one_computer_q, m.faq_one_computer_a],
  [m.faq_permissions_q, m.faq_permissions_a],
  [m.faq_rooms_q, m.faq_rooms_a],
  [m.faq_hosts_q, m.faq_hosts_a],
  [m.faq_self_host_q, m.faq_self_host_a],
] as const;

export function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 py-20 md:py-28">
      <Container className="grid gap-12 md:grid-cols-[0.8fr_1.2fr]">
        <Reveal>
          <Kicker className="mb-4">{m.landing_faq_kicker()}</Kicker>
          <h2 className="m-0 font-display text-[2.6rem] leading-[1.04] font-normal text-ink md:text-[3.4rem]">
            {m.faq_title()}
          </h2>
          <p className="mt-5 mb-6 max-w-xs text-[15px] leading-relaxed text-ink/55">
            {m.landing_faq_lead()}
          </p>
          <SiteLink
            href="/docs"
            className="inline-flex items-center gap-1 text-sm text-accent underline-offset-4 hover:underline"
          >
            {m.landing_read_docs()}
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </SiteLink>
        </Reveal>
        <Stagger stagger={0.07}>
          <Accordion
            type="single"
            collapsible
            defaultValue="faq-0"
            className="space-y-3"
          >
            {FAQS.map(([question, answer], index) => (
              <StaggerItem key={index}>
                <AccordionItem value={`faq-${index}`}>
                  <AccordionTrigger>{question()}</AccordionTrigger>
                  <AccordionContent>{answer()}</AccordionContent>
                </AccordionItem>
              </StaggerItem>
            ))}
          </Accordion>
        </Stagger>
      </Container>
    </section>
  );
}
