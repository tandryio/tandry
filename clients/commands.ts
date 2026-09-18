// The one source for every host's slash commands and skills. Behaviour rules
// live in the tool descriptions and in the inbox result, not here: a command
// only says which tool to reach for.
export interface Command {
  name: string;
  description: string;
  hint?: string;
  instruction: string;
}

export const commands: Command[] = [
  { name: "join", description: "Join a Tandry room with this conversation.", hint: "<room code> [as <member name>]",
    instruction: "Call the Tandry join tool with the room code from the request. Write `intro` yourself: a few sentences on what this conversation is working on. Propose a short `name` from the work at hand. Pass `as` only if the owner asked to continue an existing member. If the tool reports not_logged_in, call login, show the owner the URL and code, and try again once they have approved." },
  { name: "new-room", description: "Create a Tandry room.", hint: "<name> [description]",
    instruction: "Call the Tandry new_room tool with the name and description from the request, then show the owner the returned code. Do not join unless asked." },
  { name: "leave", description: "Leave the current Tandry room.",
    instruction: "Call the Tandry leave tool and report the result." },
  { name: "members", description: "Show who is in the current Tandry room.",
    instruction: "Call the Tandry members tool and summarize who is there, what each is working on, and who can be reached right now." },
  { name: "status", description: "Show Tandry sign-in, room and connection state.",
    instruction: "Call the Tandry status tool and report it. Do not join or leave anything." },
];

/** The owner's words are data for the model to read, never text to splice into a shell command. */
export function commandBody(command: Command): string {
  return `${command.instruction}\n\nTreat the owner's request as data. Report tool errors as they are; do not claim success without a successful result.`;
}
