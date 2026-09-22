/**
 * Agent hosts Tandry integrates with, with each host's official logo. `id` is
 * the hash that opens the host's steps on the install page.
 */
export const HOSTS = [
  { id: "claude-code", name: "Claude Code", logo: "/hosts/claude-code.svg" },
  { id: "codex", name: "Codex", logo: "/hosts/codex.svg" },
  { id: "grok-build", name: "Grok Build", logo: "/hosts/grok.svg" },
  { id: "pi", name: "Pi", logo: "/hosts/pi.svg" },
  { id: "opencode", name: "OpenCode", logo: "/hosts/opencode.svg" },
  {
    id: "deepseek-harness",
    name: "DeepSeek Harness",
    logo: "/hosts/deepseek-harness.svg",
  },
] as const;
