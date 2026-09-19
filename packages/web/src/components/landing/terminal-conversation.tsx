import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { useInView, useReducedMotion } from "motion/react";
import { m } from "../../paraglide/messages";
import { terminalScenario } from "./terminal-scenario";

type Host = "claude" | "codex";
type Scenario = ReturnType<typeof terminalScenario>;

/** Milliseconds into the loop at which each beat of the conversation starts. */
const BEAT = {
  frontendThought: 1500,
  backendThought: 2500,
  request: 5000,
  frontendContinue: 7200,
  backendNotice: 8000,
  backendInbox: 9300,
  backendAfterInbox: 10500,
  reply: 12500,
  backendTurn: 14000,
  frontendNotice: 14500,
  frontendInbox: 15700,
  frontendAfterInbox: 17500,
  backendTests: 18500,
  frontendUpdate: 20500,
  done: 23000,
  settled: 25000,
  loop: 32000,
};

const HOSTS: Record<
  Host,
  { name: string; icon: string; width: number; prompt: string; branch: string }
> = {
  claude: {
    name: "Claude Code",
    icon: "/host-icons/claude-code.svg",
    width: 48,
    prompt: "❯",
    branch: "feat/project-ui",
  },
  codex: {
    name: "Codex",
    icon: "/host-icons/codex.svg",
    width: 40,
    prompt: "›",
    branch: "feat/project-api",
  },
};

function progress(time: number, start: number, end: number) {
  return Math.min(1, Math.max(0, (time - start) / (end - start)));
}

function typed(text: string, time: number, start: number, duration = 1800) {
  const characters = Array.from(text);
  const shown = characters.length * progress(time, start, start + duration);
  return characters.slice(0, Math.floor(shown)).join("");
}

/** Loop time that advances only while the demo is visible; fixed when motion is reduced. */
function useLoopTime(ref: RefObject<HTMLElement | null>) {
  const inView = useInView(ref, { amount: 0.15 });
  const reduce = useReducedMotion();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!inView || reduce) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = now - last;
      last = now;
      if (!document.hidden) {
        setElapsed((value) => (value + delta) % BEAT.loop);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [inView, reduce]);

  return reduce ? BEAT.settled : elapsed;
}

export function TerminalConversation() {
  const ref = useRef<HTMLDivElement>(null);
  const time = useLoopTime(ref);
  const scenario = terminalScenario({
    request: m.landing_parallel_request(),
    response: m.landing_parallel_response(),
  });
  const turn: Host | null =
    time < BEAT.request || time >= BEAT.done
      ? null
      : time < BEAT.backendTurn
        ? "claude"
        : "codex";

  return (
    <div ref={ref} className="terminal-conversation" id="example">
      <Transfer time={time} />
      <div className="sr-only">{m.landing_parallel_summary()}</div>
      <div className="conversation-screens" aria-hidden="true">
        <TerminalWindow
          host="claude"
          identity={scenario.frontend}
          active={turn === "claude"}
          time={time}
        >
          <ClaudeSession time={time} scenario={scenario} />
        </TerminalWindow>
        <TerminalWindow
          host="codex"
          identity={scenario.backend}
          active={turn === "codex"}
          time={time}
        >
          <CodexSession time={time} scenario={scenario} />
        </TerminalWindow>
      </div>
    </div>
  );
}

/** The message in flight between the two sessions, drawn above them. */
function Transfer({ time }: { time: number }) {
  const returning = time >= BEAT.reply;
  const [from, to]: [Host, Host] = returning
    ? ["codex", "claude"]
    : ["claude", "codex"];
  const [start, end] = returning
    ? [BEAT.reply, BEAT.frontendInbox]
    : [BEAT.request, BEAT.backendInbox];
  const received = time >= end;

  return (
    <div
      className="conversation-transfer"
      data-visible={time >= BEAT.request && time < BEAT.frontendUpdate}
      data-returning={returning}
      aria-hidden="true"
    >
      <span>{HOSTS[from].name}</span>
      <ArrowRight size={13} />
      <span>{HOSTS[to].name}</span>
      <span className="transfer-state">
        {received ? <Check size={12} /> : <ArrowUpRight size={12} />}
        {received
          ? m.landing_parallel_received()
          : m.landing_parallel_sending()}
      </span>
      <i style={{ transform: `scaleX(${progress(time, start, end)})` }} />
    </div>
  );
}

function TerminalWindow({
  host,
  identity,
  active,
  time,
  children,
}: {
  host: Host;
  identity: string;
  active: boolean;
  time: number;
  children: ReactNode;
}) {
  const output = useRef<HTMLDivElement>(null);
  const { name, icon, width, prompt, branch } = HOSTS[host];

  useEffect(() => {
    if (output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [time]);

  return (
    <article className={`agent-terminal ${host}-terminal`} data-active={active}>
      <header>
        <span className="terminal-lights">
          <i />
          <i />
          <i />
        </span>
        <strong>{name}</strong>
        <span>~/atlas</span>
      </header>
      <div className="terminal-host-banner">
        <img
          className="host-mark"
          src={icon}
          width={width}
          height="40"
          alt=""
        />
        <div>
          <b>{name}</b>
          <span>{identity}</span>
        </div>
      </div>
      <div ref={output} className="agent-terminal-output">
        {children}
      </div>
      <div className="agent-input">
        {prompt} <span className="terminal-caret" />
      </div>
      <footer>{branch}</footer>
    </article>
  );
}

function ClaudeSession({
  time,
  scenario,
}: {
  time: number;
  scenario: Scenario;
}) {
  return (
    <>
      <p className="agent-answer">● {m.landing_parallel_frontend_work()}</p>
      <div className="agent-tool-call">
        <p>
          ● <b>Update</b>
          <span className="terminal-dim">
            (src/components/project-list.tsx)
          </span>
        </p>
        <pre className="terminal-diff">
          + &lt;ProjectList projects=&#123;projects&#125; /&gt;
          <br />+ &lt;EmptyState /&gt;
        </pre>
      </div>
      {time >= BEAT.frontendThought && (
        <p className="agent-thinking">
          {typed(
            m.landing_parallel_frontend_thought(),
            time,
            BEAT.frontendThought,
          )}
        </p>
      )}
      {time >= BEAT.request && (
        <ToolCall
          host="claude"
          name="send"
          params={scenario.send}
          active={time < BEAT.backendInbox}
        >
          <p>└ Sent {scenario.requestId}.</p>
        </ToolCall>
      )}
      {time >= BEAT.frontendContinue && (
        <p className="agent-answer">
          ●{" "}
          {typed(
            m.landing_parallel_frontend_continue(),
            time,
            BEAT.frontendContinue,
          )}
        </p>
      )}
      {time >= BEAT.frontendNotice && (
        <p className="agent-notice" data-active={time < BEAT.frontendInbox}>
          Tandry: 1 unread message from {scenario.backend}.
        </p>
      )}
      {time >= BEAT.frontendInbox && (
        <ToolCall
          host="claude"
          name="inbox"
          params={scenario.inbox}
          active={time < BEAT.frontendUpdate}
        >
          <p>
            {scenario.responseId} · {scenario.backend}
          </p>
          <p>{m.landing_parallel_response()}</p>
        </ToolCall>
      )}
      {time >= BEAT.frontendAfterInbox && (
        <p className="agent-thinking inbox-thinking">
          {typed(
            m.landing_parallel_frontend_after_inbox(),
            time,
            BEAT.frontendAfterInbox,
            1700,
          )}
        </p>
      )}
      {time >= BEAT.frontendUpdate && (
        <div className="agent-tool-call">
          <p>
            ● <b>Update</b>
            <span className="terminal-dim">(src/lib/projects.ts)</span>
          </p>
          <pre className="terminal-diff">
            + updatedAt: string;
            <br />+ new Date(project.updatedAt)
          </pre>
        </div>
      )}
      {time >= BEAT.done && (
        <p className="agent-answer">
          ● {typed(m.landing_parallel_frontend_done(), time, BEAT.done)}
        </p>
      )}
    </>
  );
}

function CodexSession({
  time,
  scenario,
}: {
  time: number;
  scenario: Scenario;
}) {
  return (
    <>
      <p className="agent-answer">{m.landing_parallel_backend_work()}</p>
      <div className="agent-tool-call">
        <p>
          <span className="terminal-dim">Edited</span>{" "}
          <b>src/routes/projects.ts</b>
        </p>
        <pre className="terminal-diff">
          + app.get("/api/projects", listProjects);
        </pre>
      </div>
      {time >= BEAT.backendThought && (
        <p className="agent-thinking">
          {typed(
            m.landing_parallel_backend_thought(),
            time,
            BEAT.backendThought,
          )}
        </p>
      )}
      {time >= BEAT.backendNotice && (
        <p className="agent-notice" data-active={time < BEAT.backendInbox}>
          Tandry: 1 unread message from {scenario.frontend}.
        </p>
      )}
      {time >= BEAT.backendInbox && (
        <ToolCall
          host="codex"
          name="inbox"
          params={scenario.inbox}
          active={time < BEAT.reply}
        >
          <p>
            {scenario.requestId} · {scenario.frontend}
          </p>
          <p>{m.landing_parallel_request()}</p>
        </ToolCall>
      )}
      {time >= BEAT.backendAfterInbox && (
        <p className="agent-thinking inbox-thinking">
          {typed(
            m.landing_parallel_backend_after_inbox(),
            time,
            BEAT.backendAfterInbox,
            1400,
          )}
        </p>
      )}
      {time >= BEAT.reply && (
        <ToolCall
          host="codex"
          name="send"
          params={scenario.reply}
          active={time < BEAT.frontendInbox}
        >
          <p>└ Sent {scenario.responseId}.</p>
        </ToolCall>
      )}
      {time >= BEAT.backendTests && (
        <div className="agent-tool-call">
          <p>
            <span className="terminal-dim">Ran</span> <b>pnpm test projects</b>
          </p>
          <p className="agent-tool-detail terminal-code">
            ✓ GET /api/projects
            <br />✓ updatedAt · ISO 8601
          </p>
        </div>
      )}
      {time >= BEAT.done && (
        <p className="agent-answer">
          {typed(m.landing_parallel_backend_done(), time, BEAT.done)}
        </p>
      )}
    </>
  );
}

function ToolCall({
  host,
  name,
  params,
  active,
  children,
}: {
  host: Host;
  name: "send" | "inbox";
  params: object;
  active: boolean;
  children?: ReactNode;
}) {
  const outgoing = name === "send";
  return (
    <div
      className="agent-tool-call mcp-call"
      data-direction={outgoing ? "outgoing" : "incoming"}
      data-active={active}
    >
      <p className="mcp-call-heading">
        <span>
          {host === "claude" ? (
            <>
              <span className="terminal-bullet">●</span> <b>tandry - {name}</b>{" "}
              <span className="terminal-dim">(MCP)</span>
            </>
          ) : (
            <>
              <span className="terminal-dim">Called</span> <b>tandry.{name}</b>
            </>
          )}
        </span>
        <span className="mcp-direction">
          {outgoing ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}
          {outgoing
            ? m.landing_parallel_sending()
            : m.landing_parallel_receiving()}
        </span>
      </p>
      <ToolParams params={params} />
      {children && <div className="agent-tool-detail">{children}</div>}
    </div>
  );
}

function ToolParams({ params }: { params: object }) {
  const entries = Object.entries(params);
  if (entries.length === 0) return null;
  return (
    <pre className="mcp-params">
      <code>
        {"{\n"}
        {entries.map(([key, value], index) => (
          <span className="json-entry" key={key}>
            {"  "}
            <span className="json-key">{JSON.stringify(key)}</span>
            {": "}
            {JSON.stringify(value)
              .split(/("(?:\\.|[^"\\])*")/g)
              .map((token, tokenIndex) => (
                <span
                  className={token.startsWith('"') ? "json-string" : undefined}
                  key={tokenIndex}
                >
                  {token}
                </span>
              ))}
            {index < entries.length - 1 ? ",\n" : "\n"}
          </span>
        ))}
        {"}"}
      </code>
    </pre>
  );
}
