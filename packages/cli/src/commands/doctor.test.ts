import { describe, expect, it } from "vitest";
import { findRogueDaemons } from "./doctor.js";

const PS_OUT = `
  100 /usr/bin/zsh
 8013 node /home/me/code/lyy/packages/daemon/bin/../node_modules/.bin/../tsx/dist/cli.mjs /home/me/code/lyy/packages/daemon/bin/../src/bin.ts
 8014 /Users/me/.volta/tools/image/node/22.18.0/bin/node /home/me/code/lyy/packages/daemon/bin/lyy-daemon
 9001 /Users/me/.lyy/runtime/daemon/bin/lyy-daemon
 9002 /usr/bin/cat /etc/hosts
 9003 node /different/path/not-lyy-daemon
`;

describe("findRogueDaemons", () => {
  it("identifies daemons not in the legit set", () => {
    const rogue = findRogueDaemons(PS_OUT, new Set([8013]));
    expect(rogue.sort((a, b) => a - b)).toEqual([8014, 9001]);
  });

  it("returns empty when every daemon is legit", () => {
    expect(findRogueDaemons(PS_OUT, new Set([8013, 8014, 9001]))).toEqual([]);
  });

  it("ignores non-daemon processes even when their pid is not in legit set", () => {
    const rogue = findRogueDaemons(PS_OUT, new Set());
    expect(rogue).not.toContain(100); // zsh
    expect(rogue).not.toContain(9002); // cat
    expect(rogue).not.toContain(9003); // unrelated node
  });

  it("handles empty ps output", () => {
    expect(findRogueDaemons("", new Set())).toEqual([]);
  });

  it("tolerates leading whitespace in ps output", () => {
    const pad = "      9001   /Users/me/.lyy/runtime/daemon/bin/lyy-daemon\n";
    expect(findRogueDaemons(pad, new Set())).toEqual([9001]);
  });
});
