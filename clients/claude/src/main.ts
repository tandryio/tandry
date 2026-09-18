import { mcp } from "./mcp";
import { monitor } from "./monitor";

const command = process.argv[2];
if (command === "mcp") void mcp();
else if (command === "monitor") monitor();
else { console.error("usage: main mcp | monitor"); process.exit(2); }
