import { spawn } from "node:child_process";

/**
 * Detect a Claude mention at the start of the message. Matches `@claude` or
 * `@cc` (case-insensitive) followed by any whitespace + punctuation, so all
 * of these work: `@Claude help`, `@claude, help`, `@CC: help`, `@Claude,help`.
 * `\b` prevents false matches like `@Claudette`. Returns the remainder as the
 * question, or null if no mention.
 */
export function parseClaudeMention(body: string): { question: string } | null {
  const m = body.match(/^@(claude|cc)\b[\s\p{P}]*/iu);
  return m ? { question: body.slice(m[0].length) } : null;
}

export interface BuildPromptInput {
  threadId: string;
  threadShortId: number;
  peerName: string;
  history: { sentAt: string; fromPeer: string; body: string }[];
  selfPeerId: string;
  question: string;
}

export function buildClaudePrompt(input: BuildPromptInput): string {
  const lines = input.history.map((m) => {
    const who = m.fromPeer === input.selfPeerId ? "me" : input.peerName;
    const time = m.sentAt.replace("T", " ").slice(0, 16);
    return `[${time}] ${who}: ${m.body}`;
  });
  return `You are in LYY thread #${input.threadShortId} with @${input.peerName}. Help me craft a reply.

History:
${lines.join("\n")}

My question: ${input.question}

To send your draft back to me, call the lyy.suggest_reply tool with thread_id="${input.threadId}" and body="<your draft>". The draft will appear as a card in my TUI for me to accept, edit, and send. Do NOT send it yourself.`;
}

/**
 * Focus the left zellij pane and paste `text` into it. Uses `zellij action
 * write-chars` which delivers characters as if the user typed them; claude's
 * Ink textarea accepts the input. Does NOT submit — user hits Enter.
 *
 * Caveat: newlines in `text` are interpreted by claude's input as submit. We
 * send the prompt on a single line (history collapsed to " · " separator) to
 * avoid the premature submit. Future work: bracketed paste for multi-line.
 */
export async function injectIntoClaudePane(text: string): Promise<void> {
  if (!process.env.ZELLIJ) {
    throw new Error("inject requires running inside zellij");
  }
  await run("zellij", ["action", "move-focus", "left"]);
  // flatten newlines so claude input doesn't auto-submit on \n
  const singleLine = text.replace(/\n+/g, " · ");
  await run("zellij", ["action", "write-chars", singleLine]);
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
}
