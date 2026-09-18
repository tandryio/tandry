import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import { m } from "../../paraglide/messages";
import { cn } from "../../lib/cn";
import { BrandMark } from "../layout/brand";
import { Glass } from "../ui/glass";

/*
 * Illustrative room: three agents orbit a hub, messages hop between them.
 * The scene advances by itself; hovering or focusing pauses it. Progress is a
 * CSS animation whose `animationend` event drives the next step, so pausing
 * simply pauses the animation.
 */

type Step = 0 | 1 | 2;
const STEPS: Step[] = [0, 1, 2];
const STEP_DURATION_MS = 5200;

type AgentId = "claude" | "codex" | "pi";
const AGENTS: {
  id: AgentId;
  name: string;
  glyph: string;
  role: () => string;
  className: string;
  anchor: [number, number];
}[] = [
  {
    id: "claude",
    name: "Claude Code",
    glyph: "✳",
    role: m.landing_demo_frontend,
    className: "top-[16%] left-[2%]",
    anchor: [112, 78],
  },
  {
    id: "codex",
    name: "Codex",
    glyph: "⌘",
    role: m.landing_demo_backend,
    className: "top-[10%] right-[2%]",
    anchor: [396, 64],
  },
  {
    id: "pi",
    name: "Pi",
    glyph: "π",
    role: m.landing_demo_review,
    className: "right-[10%] bottom-[8%]",
    anchor: [372, 244],
  },
];
const HUB: [number, number] = [250, 156];

const SCENES: {
  speaker: string;
  avatar: AgentId | "hub";
  target: () => string;
  time: string;
  message: () => string;
  receipt: () => string;
  /** Route the message packet travels, as an SVG path. */
  route: string;
  active: AgentId[];
}[] = [
  {
    speaker: "Tandry",
    avatar: "hub",
    target: m.landing_demo_room,
    time: "09:41",
    message: m.landing_demo_message_connect,
    receipt: m.landing_demo_connect,
    route: `M${HUB} L${AGENTS[0]!.anchor} M${HUB} L${AGENTS[1]!.anchor} M${HUB} L${AGENTS[2]!.anchor}`,
    active: ["claude", "codex", "pi"],
  },
  {
    speaker: "Claude Code",
    avatar: "claude",
    target: () => "→ @backend",
    time: "09:42",
    message: m.landing_demo_message_delegate,
    receipt: m.landing_demo_delegate,
    route: `M${AGENTS[0]!.anchor} L${HUB} L${AGENTS[1]!.anchor}`,
    active: ["claude", "codex"],
  },
  {
    speaker: "Codex",
    avatar: "codex",
    target: () => "→ @frontend",
    time: "09:43",
    message: m.landing_demo_message_return,
    receipt: m.landing_demo_return,
    route: `M${AGENTS[1]!.anchor} L${HUB} L${AGENTS[0]!.anchor}`,
    active: ["codex", "claude"],
  },
];

function Avatar({ id }: { id: AgentId | "hub" }) {
  const agent = AGENTS.find((entry) => entry.id === id);
  return (
    <span className="grid size-6 place-items-center rounded-md border border-white/10 bg-white/6 text-sm leading-none text-ink/80">
      {agent ? agent.glyph : <BrandMark className="size-5" />}
    </span>
  );
}

export function RoomDemo() {
  const [step, setStep] = useState<Step>(0);
  const [paused, setPaused] = useState(false);
  const scene = SCENES[step]!;
  const labels = [
    m.landing_demo_connect,
    m.landing_demo_delegate,
    m.landing_demo_return,
  ] as const;

  return (
    <Glass
      tone="strong"
      padding="sm"
      className="relative rounded-[1.75rem] p-4 md:p-5"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="flex items-center justify-between font-mono text-[10px] tracking-[0.16em] text-ink/60 uppercase">
        <span className="flex items-center gap-2">
          <span className="relative flex size-2 items-center justify-center">
            <span className="absolute size-2 animate-ping-soft rounded-full bg-accent/60" />
            <span className="size-1.5 rounded-full bg-accent" />
          </span>
          {m.landing_demo_label()}
        </span>
        <span className="text-ink/40">4BCD-2QQF</span>
      </div>

      {/* Orbit scene */}
      <div
        className="relative mt-3 h-[280px] overflow-hidden rounded-2xl border border-white/8 bg-black/20"
        aria-hidden="true"
      >
        <div className="absolute inset-0 grid place-items-center">
          <span className="absolute size-[330px] animate-orbit rounded-full border border-dashed border-white/10" />
          <span className="absolute size-[210px] animate-orbit-reverse rounded-full border border-dashed border-white/12" />
          <span className="absolute size-[92px] rounded-full bg-accent/15 blur-2xl" />
        </div>

        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 500 300"
          fill="none"
        >
          {AGENTS.map((agent) => (
            <line
              key={agent.id}
              x1={HUB[0]}
              y1={HUB[1]}
              x2={agent.anchor[0]}
              y2={agent.anchor[1]}
              className={cn(
                "animate-dash transition-[stroke] duration-500",
                scene.active.includes(agent.id)
                  ? "stroke-accent/60"
                  : "stroke-white/15",
              )}
              strokeWidth="1"
              strokeDasharray="3 5"
            />
          ))}
          <circle
            r="3.5"
            className="fill-accent drop-shadow-[0_0_6px_rgba(143,196,255,0.9)]"
          >
            <animateMotion
              key={step}
              dur="2.6s"
              repeatCount="indefinite"
              path={scene.route}
            />
          </circle>
        </svg>

        <div className="absolute top-1/2 left-1/2 grid size-[74px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[22px] border border-white/25 bg-linear-to-br from-[#2a4062] to-[#182740] shadow-[0_0_50px_rgba(143,196,255,0.16),inset_0_1px_0_rgba(255,255,255,0.18)]">
          <BrandMark className="size-12" />
        </div>

        {AGENTS.map((agent) => {
          const active = scene.active.includes(agent.id);
          return (
            <div
              key={agent.id}
              className={cn(
                "absolute flex items-center gap-2 rounded-xl border px-3 py-2 backdrop-blur-md transition-[border-color,box-shadow,transform] duration-500",
                active
                  ? "border-accent/35 bg-[#1c2739]/90 shadow-[0_8px_30px_rgba(0,0,0,0.35),0_0_0_1px_rgba(143,196,255,0.15)]"
                  : "border-white/12 bg-[#161d2a]/85 shadow-[0_8px_24px_rgba(0,0,0,0.25)]",
                agent.className,
              )}
            >
              <span className="text-xl leading-none text-[#d5d9e3]">
                {agent.glyph}
              </span>
              <span className="leading-tight">
                <strong className="block text-[11px] font-semibold text-ink">
                  {agent.name}
                </strong>
                <small className="block text-[9px] text-ink/50">
                  {agent.role()}
                </small>
              </span>
              <span
                className={cn(
                  "ml-1 size-1.5 rounded-full",
                  active ? "animate-pulse-soft bg-accent" : "bg-white/25",
                )}
              />
            </div>
          );
        })}
        <span className="absolute bottom-3 left-4 font-mono text-[9px] tracking-wider text-ink/40">
          {m.landing_demo_orbit_caption()}
        </span>
      </div>

      {/* Conversation */}
      <div
        className="mt-3 min-h-[150px] rounded-2xl border border-white/8 bg-[#0b0f18]/70 px-4 py-4"
        aria-live="polite"
        aria-atomic="true"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center gap-2 text-[11px]">
              <Avatar id={scene.avatar} />
              <strong className="font-semibold text-ink">
                {scene.speaker}
              </strong>
              <span className="text-[10px] text-ink/50">{scene.target()}</span>
              <span className="ml-auto font-mono text-[10px] text-ink/40">
                {scene.time}
              </span>
            </div>
            <p className="m-0 mt-2.5 pl-8 text-[13px] leading-relaxed text-ink/85">
              {scene.message()}
            </p>
            <p className="m-0 mt-2 flex items-center gap-1.5 pl-8 font-mono text-[10px] text-ink/45">
              <Check className="size-3 text-accent" aria-hidden="true" />
              {scene.receipt()}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Controls */}
      <div
        className="mt-3 grid grid-cols-3 gap-1.5"
        role="group"
        aria-label={m.landing_demo_controls()}
      >
        {STEPS.map((index) => {
          const active = index === step;
          return (
            <button
              key={index}
              type="button"
              aria-pressed={active}
              onClick={() => setStep(index)}
              className={cn(
                "relative cursor-pointer overflow-hidden rounded-lg border px-2.5 py-2.5 text-left text-[10px] transition-colors duration-300",
                active
                  ? "border-accent/25 bg-accent/8 text-accent"
                  : "border-transparent text-ink/50 hover:bg-white/5 hover:text-ink",
              )}
            >
              <span className="flex items-center gap-1.5">
                <span className="font-mono opacity-60">0{index + 1}</span>
                <span className="truncate">{labels[index]()}</span>
              </span>
              {active && (
                <span
                  key={step}
                  aria-hidden="true"
                  onAnimationEnd={() => setStep(((step + 1) % 3) as Step)}
                  className="absolute inset-x-0 bottom-0 h-0.5 origin-left animate-progress bg-accent/70"
                  style={{
                    animationDuration: `${STEP_DURATION_MS}ms`,
                    animationPlayState: paused ? "paused" : "running",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
      <p className="m-0 mt-3 text-center font-mono text-[9px] tracking-wide text-ink/35">
        {m.landing_demo_note()}
      </p>
    </Glass>
  );
}
