import { useRef } from "react";
import { motion, useScroll, useSpring } from "motion/react";
import { m } from "../../paraglide/messages";
import { Section, SectionHeading } from "../layout/section";
import { Stagger, StaggerItem } from "../motion/reveal";

const STEPS = [
  {
    title: m.common_create_room,
    body: m.landing_step_create_body,
    example: () => "/tandry:new-room my-team",
  },
  {
    title: m.landing_step_connect_title,
    body: m.landing_step_connect_body,
    example: () => "$tandry:join 4BCD-2QQF",
  },
  {
    title: m.landing_step_handoff_title,
    body: m.landing_step_handoff_body,
    example: m.landing_step_handoff_example,
  },
];

export function Workflow() {
  const ref = useRef<HTMLDivElement>(null);
  // The connecting line draws itself as the steps scroll into view.
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 85%", "end 55%"],
  });
  const scaleX = useSpring(scrollYProgress, { stiffness: 90, damping: 24 });

  return (
    <Section id="story" className="border-t border-white/6">
      <SectionHeading
        kicker={m.landing_workflow_kicker()}
        title={m.landing_workflow_title()}
        lead={m.landing_workflow_lead()}
      />
      <div ref={ref} className="relative">
        <div
          aria-hidden="true"
          className="absolute top-5 right-0 left-0 hidden h-px bg-white/8 md:block"
        >
          <motion.div
            style={{ scaleX }}
            className="h-full origin-left bg-linear-to-r from-accent via-accent to-glow shadow-[0_0_12px_rgba(143,196,255,0.6)]"
          />
        </div>
        <Stagger stagger={0.14} className="grid gap-8 md:grid-cols-3 md:gap-10">
          {STEPS.map((step, index) => (
            <StaggerItem key={index} className="relative md:pt-12">
              <span className="relative z-10 grid size-10 place-items-center rounded-full border border-accent/30 bg-paper font-mono text-[11px] text-accent shadow-[0_0_0_6px_rgba(7,10,18,1)] md:absolute md:top-0 md:left-0">
                0{index + 1}
              </span>
              <h3 className="m-0 mt-5 text-xl font-semibold text-ink md:mt-4">
                {step.title()}
              </h3>
              <p className="m-0 mt-3 text-sm leading-relaxed text-ink/55">
                {step.body()}
              </p>
              <code className="mt-5 block rounded-lg border border-white/8 bg-white/4 px-3.5 py-2.5 font-mono text-[11px] text-ink/70 [overflow-wrap:anywhere]">
                {step.example()}
              </code>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </Section>
  );
}
