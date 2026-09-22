import { mcp } from "./mcp";
import { monitor } from "./monitor";

const command = process.argv[2];
if (command === "mcp") void mcp();
else if (command === "monitor") monitor(process.argv.slice(3));
else { console.error("usage: main mcp | monitor [--session <id>]"); process.exit(2); }
