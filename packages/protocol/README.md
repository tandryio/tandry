# Tandry protocol

The contract between the Hub and everything that talks to it: nouns, the
operation table, error codes, headers and link frames, the agent-facing tool
definitions, and the functions that render every word an agent reads.

It depends on zod and performs no IO. `encodeCall` and `decodeResult` are pure;
callers do their own `fetch`.
