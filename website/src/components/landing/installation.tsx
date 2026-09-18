import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Check, Copy } from "lucide-react";
import { m } from "../../paraglide/messages";
import { cn } from "../../lib/cn";
import { Button } from "../ui/button";
import { Kicker } from "../ui/kicker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Container } from "../layout/section";
import { REPO_URL } from "../layout/site-header";
import { Reveal } from "../motion/reveal";

type HostKey =
  "claude" | "codex" | "chatgpt" | "codex-desktop" | "claude-desktop";
const HOSTS: Record<
  HostKey,
  {
    label: string;
    install?: string;
    create?: () => string;
    delivery: () => string;
    setup: () => string;
    note: () => string;
    guide: string;
  }
> = {
  claude: {
    label: "Claude Code CLI",
    install: "pnpm agent claude",
    create: m.install_create_claude,
    delivery: m.install_delivery_automatic,
    setup: m.install_local_setup,
    note: m.install_note_claude,
    guide: "/docs/hosts#claude-code-cli",
  },
  codex: {
    label: "Codex CLI",
    install: "pnpm agent codex",
    create: m.install_create_codex,
    delivery: m.install_delivery_automatic,
    setup: m.install_local_setup,
    note: m.install_note_codex,
    guide: "/docs/hosts#codex-cli",
  },
  chatgpt: {
    label: "ChatGPT Web",
    delivery: m.install_delivery_on_demand,
    setup: m.install_remote_setup,
    create: m.install_create_web,
    note: m.install_note_chatgpt,
    guide: "/docs/hosts#chatgpt-web",
  },
  "codex-desktop": {
    label: "Codex Desktop",
    delivery: m.install_delivery_unverified,
    setup: m.install_desktop_setup,
    note: m.install_note_codex_desktop,
    guide: "/docs/hosts#codex-desktop",
  },
  "claude-desktop": {
    label: "Claude Desktop",
    delivery: m.install_delivery_unavailable,
    setup: m.install_claude_desktop_setup,
    note: m.install_note_claude_desktop,
    guide: "/docs/hosts#claude-desktop",
  },
};
const HOST_KEYS = Object.keys(HOSTS) as HostKey[];

/** Hosts installed from source; linked from the install box. */
const MORE_HOSTS = [
  { label: "Pi", href: `${REPO_URL}/blob/redesign/clients/pi/README.md` },
  {
    label: "OpenCode",
    href: `${REPO_URL}/blob/redesign/clients/opencode/README.md`,
  },
  {
    label: "DeepSeek Harness",
    href: `${REPO_URL}/blob/redesign/clients/dsh/README.md`,
  },
];

function CopyButton({
  value,
  onNotice,
}: {
  value: string;
  onNotice: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onNotice(m.common_copied());
    } catch {
      onNotice(m.common_copy_failed());
    }
  };
  return (
    <Button variant="ghost" size="sm" onClick={copy} className="gap-1.5">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={copied ? "check" : "copy"}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0 }}
          transition={{ duration: 0.15 }}
          className={cn("grid place-items-center", copied && "text-mint")}
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
        </motion.span>
      </AnimatePresence>
      {copied ? m.common_copied() : m.common_copy()}
    </Button>
  );
}

function StepTitle({
  index,
  children,
  action,
}: {
  index: number;
  children: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-5 place-items-center rounded-full border border-accent/30 font-mono text-[9px] text-accent">
        {index}
      </span>
      <h3 className="m-0 flex-1 text-[13px] font-medium text-ink">
        {children}
      </h3>
      {action}
    </div>
  );
}

function CommandBlock({ children }: { children: string }) {
  return (
    <pre className="m-0 mt-3 mb-5 overflow-x-auto rounded-lg border border-white/8 bg-[#090c14]/85 p-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink/75 [overflow-wrap:anywhere]">
      <code>{children}</code>
    </pre>
  );
}

export function Installation() {
  const [host, setHost] = useState<HostKey>("claude");
  const [notice, setNotice] = useState("");
  const [endpoint, setEndpoint] = useState<string>();
  useEffect(() => {
    if (window.location.protocol === "https:") {
      setEndpoint(`${window.location.origin}/mcp`);
    }
  }, []);

  return (
    <section
      id="install"
      className="relative scroll-mt-24 overflow-hidden border-y border-white/6 py-20 md:py-28"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 50% 70% at 8% 100%, rgba(94,166,255,0.14), transparent 60%)",
        }}
      />
      <Container className="relative grid items-center gap-12 md:grid-cols-[0.85fr_1.15fr] md:gap-16">
        <Reveal>
          <Kicker className="mb-5">{m.install_kicker()}</Kicker>
          <h2 className="m-0 font-display text-[2.6rem] leading-[1.04] font-normal text-ink md:text-[3.4rem]">
            {m.install_title_1()}
            <br />
            <em className="text-accent">{m.install_title_2()}</em>
          </h2>
          <p className="mt-6 mb-8 max-w-md text-[15px] leading-relaxed text-ink/60">
            {m.install_lead_1()} {m.install_lead_2()}
          </p>
          <Button asChild variant="primary" size="lg">
            <a href="/login">
              {m.install_sign_in()}
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </a>
          </Button>
        </Reveal>

        <Reveal
          delay={0.1}
          className="glass min-w-0 overflow-hidden rounded-2xl"
        >
          <Tabs
            value={host}
            onValueChange={(value) => {
              setHost(value as HostKey);
              setNotice("");
            }}
          >
            <div className="border-b border-white/8 bg-white/3 p-2">
              <TabsList
                aria-label={m.install_tabs_label()}
                className="grid grid-cols-2 border-0 bg-transparent p-0 sm:grid-cols-3"
              >
                {HOST_KEYS.map((key) => (
                  <TabsTrigger key={key} value={key}>
                    {HOSTS[key].label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            {HOST_KEYS.map((key) => {
              const selected = HOSTS[key];
              const remote = key === "chatgpt";
              const command = remote ? endpoint : selected.install;
              return (
                <TabsContent key={key} value={key} className="p-5 md:p-6">
                  <p className="m-0 mb-3 text-xs font-medium text-accent">
                    {selected.delivery()}
                  </p>
                  <p className="m-0 mb-5 text-[13px] leading-relaxed text-ink/60">
                    {selected.note()}
                  </p>
                  <StepTitle
                    index={1}
                    action={
                      command && (
                        <CopyButton value={command} onNotice={setNotice} />
                      )
                    }
                  >
                    {remote
                      ? m.install_step_connect()
                      : m.install_step_install({ host: selected.label })}
                  </StepTitle>
                  <p className="m-0 mt-3 mb-5 text-[13px] leading-relaxed text-ink/60">
                    {selected.setup()}
                  </p>
                  {command && <CommandBlock>{command}</CommandBlock>}
                  {remote && !endpoint && (
                    <p className="mb-5 text-xs text-ink/60">
                      {m.install_remote_localhost()}
                    </p>
                  )}

                  {selected.create && (
                    <>
                      <StepTitle index={2}>
                        {remote
                          ? m.install_step_oauth()
                          : m.install_step_authorize()}
                      </StepTitle>
                      <p className="m-0 mt-3 mb-5 text-[13px] leading-relaxed text-ink/60">
                        {remote
                          ? m.install_step_oauth_body()
                          : m.install_step_authorize_body()}
                      </p>

                      <StepTitle
                        index={3}
                        action={
                          <CopyButton
                            value={selected.create()}
                            onNotice={setNotice}
                          />
                        }
                      >
                        {m.install_step_join()}
                      </StepTitle>
                      <CommandBlock>{selected.create()}</CommandBlock>
                    </>
                  )}
                  <a
                    href={selected.guide}
                    className="mt-3 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                  >
                    {m.install_guide_link()}
                  </a>
                  <details className="mt-5 border-t border-white/8 pt-4 text-xs leading-relaxed text-ink/60">
                    <summary className="cursor-pointer text-ink/80">
                      {m.install_existing_title()}
                    </summary>
                    <p>{m.install_existing_body()}</p>
                    <a
                      href="/docs/hosts#switching-connections"
                      className="text-accent underline underline-offset-4"
                    >
                      {m.install_switch_guide()}
                    </a>
                  </details>
                  <p className="m-0 mt-5 border-t border-white/8 pt-4 text-xs leading-relaxed text-ink/55">
                    {m.install_more_hosts()}{" "}
                    {MORE_HOSTS.map((item, index) => (
                      <span key={item.href}>
                        {index > 0 && " · "}
                        <a
                          href={item.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-ink/80 underline underline-offset-4 hover:text-ink"
                        >
                          {item.label} ↗
                        </a>
                      </span>
                    ))}
                  </p>
                </TabsContent>
              );
            })}
          </Tabs>
          <p role="status" className="sr-only">
            {notice}
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
