import { useEffect, useState } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Check, Copy } from "lucide-react";
import { m } from "../../paraglide/messages";
import { Reveal } from "../motion/reveal";
import { SiteLink } from "../ui/site-link";

/** The hosted site's remote MCP endpoint; other HTTPS deployments use their own origin. */
const HOSTED_MCP = "https://tandry.io/mcp";
export const MARKETPLACE = "tandryio/tandry-marketplace";
export const PLUGIN = "tandry@tandry-marketplace";

type Block = {
  /** Shown in the block's title bar: where the lines are typed. */
  label: () => string;
  /** `$` for a shell, `›` for a host prompt, none for a file. */
  prompt?: string;
  /** Receives the MCP URL this page is served with. */
  lines: (endpoint: string) => string[];
};
type Step = { title: () => string; body: () => string; block?: Block };
type Host = {
  /** Also the URL hash that selects this host, e.g. `/install#codex`. */
  key: string;
  name: string;
  logo: string;
  group: "coding" | "chat";
  tier: "push" | "pull";
  source: () => string;
  steps: Step[];
  note: () => string;
  guide: string;
};

const terminal = (...lines: string[]): Block => ({
  label: m.install_label_terminal,
  prompt: "$",
  lines: () => lines,
});
const inHost = (label: string, ...lines: string[]): Block => ({
  label: () => label,
  prompt: "›",
  lines: () => lines,
});
const askAgent = (...lines: (() => string)[]): Block => ({
  label: m.install_label_prompt,
  prompt: "›",
  lines: () => lines.map((line) => line()),
});

const signIn: Step = {
  title: m.install_step_sign_in,
  body: m.install_step_sign_in_body,
  block: askAgent(m.install_prompt_sign_in),
};
const room: Step = {
  title: m.install_step_room,
  body: m.install_step_room_body,
  block: askAgent(m.install_prompt_create, m.install_prompt_join),
};

const HOSTS: Host[] = [
  {
    key: "claude-code",
    name: "Claude Code",
    logo: "/hosts/claude-code.svg",
    group: "coding",
    tier: "push",
    source: m.install_source_marketplace,
    steps: [
      {
        title: m.install_step_plugin,
        body: m.install_step_plugin_claude,
        block: inHost(
          "Claude Code",
          `/plugin marketplace add ${MARKETPLACE}`,
          `/plugin install ${PLUGIN}`,
        ),
      },
      signIn,
      room,
    ],
    note: m.install_note_claude,
    guide: "/docs/hosts#claude-code-cli",
  },
  {
    key: "codex",
    name: "Codex",
    logo: "/hosts/codex.svg",
    group: "coding",
    tier: "push",
    source: m.install_source_marketplace,
    steps: [
      {
        title: m.install_step_plugin,
        body: m.install_step_plugin_codex,
        block: terminal(
          `codex plugin marketplace add ${MARKETPLACE}`,
          `codex plugin add ${PLUGIN}`,
        ),
      },
      {
        title: m.install_step_hooks,
        body: m.install_step_hooks_body,
        block: inHost("Codex", "/hooks"),
      },
      signIn,
      room,
    ],
    note: m.install_note_codex,
    guide: "/docs/hosts#codex-cli",
  },
  {
    key: "grok-build",
    name: "Grok Build",
    logo: "/hosts/grok.svg",
    group: "coding",
    tier: "push",
    source: m.install_source_marketplace,
    steps: [
      {
        title: m.install_step_plugin,
        body: m.install_step_plugin_grok,
        block: terminal(
          `grok plugin marketplace add ${MARKETPLACE}`,
          // Grok qualifies a plugin by its marketplace's repository, not by the marketplace name.
          `grok plugin install tandry@${MARKETPLACE} --trust`,
        ),
      },
      signIn,
      room,
    ],
    note: m.install_note_grok,
    guide: "/docs/hosts#grok-build",
  },
  {
    key: "pi",
    name: "Pi",
    logo: "/hosts/pi.svg",
    group: "coding",
    tier: "push",
    source: m.install_source_npm,
    steps: [
      {
        title: m.install_step_plugin,
        body: m.install_step_plugin_pi,
        block: terminal("pi install npm:@tandryio/pi"),
      },
      signIn,
      room,
    ],
    note: m.install_note_pi,
    guide: "/docs/hosts#other-hosts",
  },
  {
    key: "opencode",
    name: "OpenCode",
    logo: "/hosts/opencode.svg",
    group: "coding",
    tier: "push",
    source: m.install_source_npm,
    steps: [
      {
        title: m.install_step_plugin,
        body: m.install_step_plugin_opencode,
        block: {
          label: () => "opencode.json",
          lines: () => ['{ "plugin": ["@tandryio/opencode"] }'],
        },
      },
      signIn,
      room,
    ],
    note: m.install_note_opencode,
    guide: "/docs/hosts#other-hosts",
  },
  {
    key: "deepseek-harness",
    name: "DeepSeek Harness",
    logo: "/hosts/deepseek-harness.svg",
    group: "coding",
    tier: "push",
    source: m.install_source_npm,
    steps: [
      {
        title: m.install_step_plugin,
        body: m.install_step_plugin_dsh,
        block: terminal("dsh plugin --profile web add @tandryio/dsh"),
      },
      signIn,
      room,
    ],
    note: m.install_note_dsh,
    guide: "/docs/hosts#other-hosts",
  },
  {
    key: "chatgpt",
    name: "ChatGPT",
    logo: "/host-icons/chatgpt.svg",
    group: "chat",
    tier: "pull",
    source: m.install_source_remote,
    steps: [
      {
        title: m.install_step_developer_mode,
        body: m.install_step_developer_mode_body,
      },
      {
        title: m.install_step_connector,
        body: m.install_step_connector_body,
        block: { label: () => "MCP URL", lines: (endpoint) => [endpoint] },
      },
      {
        title: m.install_step_authorize,
        body: m.install_step_sign_in_web_body,
      },
      {
        title: m.install_step_room,
        body: m.install_step_room_web_body,
        block: askAgent(m.install_prompt_create, m.install_prompt_join),
      },
    ],
    note: m.install_note_chatgpt,
    guide: "/docs/hosts#chatgpt-web",
  },
];

/** One line per command: host prompts take one command at a time. */
export function CopyButton({ value }: { value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  };
  const label =
    state === "copied"
      ? m.common_copied()
      : state === "failed"
        ? m.common_copy_failed()
        : m.common_copy();
  return (
    <button
      type="button"
      className="install-copy"
      data-state={state}
      onClick={copy}
      aria-label={`${m.common_copy()}: ${value}`}
      title={label}
    >
      {state === "copied" ? (
        <Check size={13} aria-hidden="true" />
      ) : (
        <Copy size={13} aria-hidden="true" />
      )}
      <span className="sr-only" aria-live="polite">
        {state === "idle" ? "" : label}
      </span>
    </button>
  );
}

function CommandBlock({ block, lines }: { block: Block; lines: string[] }) {
  return (
    <div className="install-block">
      <div className="install-block-bar">{block.label()}</div>
      {lines.map((line) => (
        <div key={line} className="install-line">
          <code>
            {block.prompt && (
              <span className="install-prompt" aria-hidden="true">
                {block.prompt}
              </span>
            )}
            {line}
          </code>
          <CopyButton value={line} />
        </div>
      ))}
    </div>
  );
}

const GROUPS = [
  { key: "coding", label: m.install_group_coding },
  { key: "chat", label: m.install_group_chat },
] as const;

function HostLogo({ host }: { host: Host }) {
  return (
    <img src={host.logo} alt="" width={20} height={20} data-host={host.key} />
  );
}

export function Installation() {
  const [selected, setSelected] = useState(HOSTS[0]!.key);
  const [endpoint, setEndpoint] = useState(HOSTED_MCP);
  useEffect(() => {
    if (window.location.protocol === "https:") {
      setEndpoint(`${window.location.origin}/mcp`);
    }
  }, []);
  // A host's key in the hash opens its steps; links from the landing page use this.
  useEffect(() => {
    const open = () => {
      const key = decodeURIComponent(window.location.hash.slice(1));
      if (!HOSTS.some((host) => host.key === key)) return;
      setSelected(key);
      document.getElementById("install")?.scrollIntoView();
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  const select = (key: string) => {
    setSelected(key);
    history.replaceState(null, "", `#${key}`);
  };

  return (
    <>
      <section className="install-hero">
        <Reveal>
          <h1>{m.install_title()}</h1>
          <p className="install-lead">{m.install_lead()}</p>
        </Reveal>
      </section>

      <section id="install" className="install-body">
        <Reveal delay={0.15}>
          <TabsPrimitive.Root
            value={selected}
            onValueChange={select}
            orientation="vertical"
            className="install-picker"
          >
            <TabsPrimitive.List
              aria-label={m.install_tabs_label()}
              className="install-hosts"
            >
              {GROUPS.map((group) => (
                <div
                  key={group.key}
                  role="presentation"
                  className="install-group"
                >
                  <p className="install-group-label" aria-hidden="true">
                    {group.label()}
                  </p>
                  {HOSTS.filter((host) => host.group === group.key).map(
                    (host) => (
                      <TabsPrimitive.Trigger
                        key={host.key}
                        value={host.key}
                        className="install-host"
                      >
                        <HostLogo host={host} />
                        {host.name}
                      </TabsPrimitive.Trigger>
                    ),
                  )}
                </div>
              ))}
            </TabsPrimitive.List>

            {HOSTS.map((host) => (
              <TabsPrimitive.Content
                key={host.key}
                value={host.key}
                className="install-panel"
              >
                <header>
                  <HostLogo host={host} />
                  <strong>{host.name}</strong>
                  <span>
                    {host.tier === "push"
                      ? m.install_tier_push()
                      : m.install_tier_pull()}
                  </span>
                  <span className="install-source">{host.source()}</span>
                </header>
                <ol className="install-steps">
                  {host.steps.map((step, index) => (
                    <li key={index}>
                      <span className="install-step-number">0{index + 1}</span>
                      <div>
                        <h2>{step.title()}</h2>
                        <p>{step.body()}</p>
                        {step.block && (
                          <CommandBlock
                            block={step.block}
                            lines={step.block.lines(endpoint)}
                          />
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
                <footer>
                  <p>{host.note()}</p>
                  <SiteLink href={host.guide}>
                    {m.install_guide_link()} →
                  </SiteLink>
                </footer>
              </TabsPrimitive.Content>
            ))}
          </TabsPrimitive.Root>
        </Reveal>
      </section>
    </>
  );
}
