import { useRef, type ReactNode } from "react";
import { motion, useScroll, useSpring } from "motion/react";
import { ArrowUpRight, Check, FileCode2, Lock } from "lucide-react";
import { m } from "../../paraglide/messages";
import { cn } from "../../lib/cn";
import { Section, SectionHeading } from "../layout/section";
import { SiteLink } from "../ui/site-link";
import { Reveal } from "../motion/reveal";

/* Small CSS-only illustrations, one per step. */

const WORKSPACES = [
  {
    host: "Claude Code",
    logo: "/hosts/claude-code.svg",
    path: "~/atlas/web",
    files: ["project-list.tsx", "api-client.ts"],
  },
  {
    host: "Codex",
    logo: "/hosts/codex.svg",
    path: "~/atlas/api",
    files: ["routes/projects.ts", "projects.test.ts"],
  },
];

function Workspace({ workspace }: { workspace: (typeof WORKSPACES)[number] }) {
  return (
    <div className="promise-window w-full max-w-[200px] min-w-0">
      <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2">
        <img src={workspace.logo} alt="" className="size-4" />
        <span className="text-[11px] font-medium whitespace-nowrap text-ink/85">
          {workspace.host}
        </span>
      </div>
      <ul className="m-0 list-none space-y-1.5 px-3 py-2.5">
        {workspace.files.map((file) => (
          <li
            key={file}
            className="flex items-center gap-2 truncate font-mono text-[10px] text-ink/55"
          >
            <FileCode2
              className="size-3 shrink-0 text-ink/30"
              aria-hidden="true"
            />
            {file}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-1.5 border-t border-white/6 px-3 py-1.5 font-mono text-[9px] tracking-wide whitespace-nowrap text-ink/35">
        <Lock className="size-2.5 shrink-0" aria-hidden="true" />
        {workspace.path} · {m.landing_promise_context_stays()}
      </div>
    </div>
  );
}

function ContextArt() {
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <span className="max-w-full truncate rounded-md border border-accent/30 bg-[#0d1216] px-3 py-1.5 text-[11px] text-accent">
        {m.landing_terminal_outbound()}
      </span>
      <div className="flex w-full items-center justify-center">
        <Workspace workspace={WORKSPACES[0]!} />
        <span className="relative h-px min-w-6 flex-1 self-center">
          <span className="promise-wire" />
        </span>
        <Workspace workspace={WORKSPACES[1]!} />
      </div>
    </div>
  );
}

function PermissionsArt() {
  return (
    <div className="promise-window w-full max-w-[250px]">
      <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2">
        <img src="/hosts/codex.svg" alt="" className="size-4" />
        <span className="text-[11px] font-medium text-ink/85">Codex</span>
        <span className="ml-auto font-mono text-[9px] tracking-wide text-ink/35">
          {m.landing_promise_permissions_owner()}
        </span>
      </div>
      <p className="m-0 px-3 pt-3 text-[12px] text-ink/80">
        {m.landing_promise_permissions_prompt()}
      </p>
      <div className="flex gap-2 px-3 pt-2.5 pb-3">
        <span className="rounded-[5px] bg-accent px-2.5 py-1 text-[10px] font-medium text-[#111]">
          {m.landing_promise_permissions_allow()}
        </span>
        <span className="rounded-[5px] border border-white/12 px-2.5 py-1 text-[10px] text-ink/60">
          {m.landing_promise_permissions_deny()}
        </span>
      </div>
    </div>
  );
}

function WaitsArt() {
  const rows: {
    time: string;
    label: string;
    state: "sent" | "idle" | "read";
  }[] = [
    { time: "09:42", label: m.landing_promise_waits_sent(), state: "sent" },
    { time: "", label: m.landing_promise_waits_offline(), state: "idle" },
    { time: "11:05", label: m.landing_promise_waits_read(), state: "read" },
  ];
  return (
    <ol className="promise-timeline m-0 w-full max-w-[250px] list-none p-0">
      {rows.map((row) => (
        <li
          key={row.label}
          className={cn(
            "relative flex items-center gap-3 py-2.5 pl-7 text-[11px]",
            row.state === "idle" ? "text-ink/35" : "text-ink/80",
          )}
        >
          <span
            className={cn(
              "absolute left-0 grid size-[15px] place-items-center rounded-full border bg-[#0c0c0c]",
              row.state === "sent" && "border-accent/60",
              row.state === "idle" && "border-dashed border-white/20",
              row.state === "read" && "border-accent bg-accent text-[#111]",
            )}
          >
            {row.state === "sent" && (
              <span className="size-1.5 rounded-full bg-accent" />
            )}
            {row.state === "read" && (
              <Check className="size-2.5" strokeWidth={3} aria-hidden="true" />
            )}
          </span>
          {row.label}
          <span className="ml-auto font-mono text-[10px] text-ink/35">
            {row.time}
          </span>
        </li>
      ))}
    </ol>
  );
}

const HISTORY = [
  {
    logo: "/hosts/claude-code.svg",
    name: "frontend",
    target: "→ @backend",
    time: "09:42",
    text: m.landing_demo_message_delegate,
  },
  {
    logo: "/hosts/codex.svg",
    name: "backend",
    target: "→ @frontend",
    time: "09:47",
    text: m.landing_demo_message_return,
  },
];

function RoomsArt() {
  return (
    <div className="promise-window w-full max-w-[520px] min-w-0">
      <div className="flex items-center gap-2.5 border-b border-white/8 px-3.5 py-2.5">
        <span className="text-[12px] font-medium text-ink/90">
          {m.landing_room_example_two()}
        </span>
        <span className="ml-auto flex items-center gap-2 text-[10px] text-ink/45">
          <span className="flex -space-x-1">
            {["claude-code", "codex", "pi"].map((host) => (
              <img
                key={host}
                src={`/hosts/${host}.svg`}
                alt=""
                className="size-[18px] rounded-full border border-[#0c0c0c] bg-[#1a1a1a] p-0.5"
              />
            ))}
          </span>
          {m.landing_promise_rooms_members({ count: 3 })}
        </span>
      </div>
      {HISTORY.map((entry) => (
        <div
          key={entry.time}
          className="border-b border-white/5 px-3.5 py-2.5 last:border-b-0"
        >
          <div className="flex items-center gap-2 text-[10px]">
            <img src={entry.logo} alt="" className="size-3.5" />
            <strong className="font-medium text-ink/85">{entry.name}</strong>
            <span className="text-ink/40">{entry.target}</span>
            <span className="ml-auto font-mono text-ink/35">{entry.time}</span>
          </div>
          <p className="m-0 mt-1 truncate pl-[22px] text-[11px] text-ink/60">
            {entry.text()}
          </p>
        </div>
      ))}
    </div>
  );
}

function HandoffArt() {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-3 sm:flex-row sm:items-stretch">
      <WaitsArt />
      <PermissionsArt />
    </div>
  );
}

/* Each step carries the promise a reader asks about at that point. */
const STEPS: {
  title: () => string;
  body: () => string;
  host: () => string;
  example: () => string;
  art: ReactNode;
  promises: { title: () => string; body: () => string }[];
  link?: { href: string; label: () => string };
}[] = [
  {
    title: m.common_create_room,
    body: m.landing_step_create_body,
    host: () => "Claude Code",
    example: m.landing_step_create_example,
    art: <RoomsArt />,
    promises: [
      { title: m.landing_promise_rooms_title, body: m.landing_rooms_body },
    ],
    link: { href: "/rooms", label: m.nav_my_rooms },
  },
  {
    title: m.landing_step_connect_title,
    body: m.landing_step_connect_body,
    host: () => "Codex",
    example: m.landing_step_connect_example,
    art: <ContextArt />,
    promises: [
      {
        title: m.landing_promise_context_title,
        body: m.landing_promise_context_body,
      },
    ],
  },
  {
    title: m.landing_step_handoff_title,
    body: m.landing_step_handoff_body,
    host: m.landing_step_host_any,
    example: m.landing_step_handoff_example,
    art: <HandoffArt />,
    promises: [
      {
        title: m.landing_promise_waits_title,
        body: m.landing_promise_waits_body,
      },
      {
        title: m.landing_promise_permissions_title,
        body: m.landing_promise_permissions_body,
      },
    ],
  },
];

export function Workflow() {
  const ref = useRef<HTMLOListElement>(null);
  // The connecting line draws itself as the steps scroll into view.
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 75%", "end 60%"],
  });
  const scaleY = useSpring(scrollYProgress, { stiffness: 90, damping: 24 });

  return (
    <Section id="story" className="border-t border-white/6">
      <SectionHeading
        kicker={m.landing_workflow_kicker()}
        title={m.landing_workflow_title()}
        lead={m.landing_workflow_lead()}
      />
      <ol ref={ref} className="story-steps">
        <li aria-hidden="true" className="story-rail">
          <motion.span style={{ scaleY }} />
        </li>
        {STEPS.map((step, index) => (
          <li key={index} className="story-step">
            <span className="story-number">0{index + 1}</span>
            <Reveal className="story-copy">
              <h3>{step.title()}</h3>
              <p>{step.body()}</p>
              <div className="step-example">
                <span>{step.host()}</span>
                <p>{step.example()}</p>
              </div>
              <dl
                className={cn(
                  "story-promises",
                  step.promises.length > 1 && "sm:grid-cols-2",
                )}
              >
                {step.promises.map((promise) => (
                  <div key={promise.title()}>
                    <dt>
                      <Check size={13} strokeWidth={2.5} aria-hidden="true" />
                      {promise.title()}
                    </dt>
                    <dd>{promise.body()}</dd>
                  </div>
                ))}
              </dl>
              {step.link && (
                <SiteLink
                  href={step.link.href}
                  className="mt-3 inline-flex items-center gap-1 text-[13px] text-accent underline-offset-4 hover:underline"
                >
                  {step.link.label()}
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </SiteLink>
              )}
            </Reveal>
            <Reveal className="promise-art" delay={0.1} aria-hidden="true">
              {step.art}
            </Reveal>
          </li>
        ))}
      </ol>
    </Section>
  );
}
