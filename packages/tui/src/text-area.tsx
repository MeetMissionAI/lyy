import { Box, Text, useInput } from "ink";
import type React from "react";
import { useRef, useState } from "react";

/**
 * Multi-line TextInput for Ink, adapted from NousResearch/hermes-agent's
 * TextInput (MIT) trimmed down to what @lyy/tui needs. Keeps:
 *   - value-as-string + cursor-as-offset (simpler than per-line arrays)
 *   - grapheme-aware cursor via Intl.Segmenter
 *   - prev/next position, word-left, word-right
 *   - Home / End / Ctrl+A / Ctrl+E
 *   - Backspace, forward Delete, with word variants (Ctrl+Backspace etc.)
 *   - Ctrl+U kill to start, Ctrl+K kill to end, Ctrl+W delete word back
 *   - Undo (Ctrl+Z) / Redo (Ctrl+Y)
 *   - Shift+Enter / Meta+Enter newline; trailing `\` + Enter fallback
 *   - Bracketed / multi-char paste aggregated with 50ms debounce
 *   - Inverse block cursor
 *
 * Drops (vs. Hermes): text selection, mouse clicks, explicit clipboard hotkeys,
 * mask, onPaste callback hook, useDeclaredCursor (Ink upstream has none).
 */

export interface TextAreaProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: (value: string) => void | Promise<void>;
  placeholder?: string;
  /** Toggles whether keystrokes are consumed. Default true. */
  isActive?: boolean;
}

// ── grapheme helpers ────────────────────────────────────────────────────────

let _segmenter: Intl.Segmenter | null = null;
const seg = (): Intl.Segmenter => {
  if (!_segmenter) {
    _segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  }
  return _segmenter;
};

const STOP_CACHE_MAX = 64;
const stopCache = new Map<string, number[]>();

function graphemeStops(s: string): number[] {
  const hit = stopCache.get(s);
  if (hit) return hit;
  const stops = [0];
  for (const { index } of seg().segment(s)) {
    if (index > 0) stops.push(index);
  }
  if (stops.at(-1) !== s.length) stops.push(s.length);
  stopCache.set(s, stops);
  if (stopCache.size > STOP_CACHE_MAX) {
    const oldest = stopCache.keys().next().value;
    if (oldest !== undefined) stopCache.delete(oldest);
  }
  return stops;
}

function snapPos(s: string, p: number): number {
  const pos = Math.max(0, Math.min(p, s.length));
  let last = 0;
  for (const stop of graphemeStops(s)) {
    if (stop > pos) break;
    last = stop;
  }
  return last;
}

function prevPos(s: string, p: number): number {
  const pos = snapPos(s, p);
  let prev = 0;
  for (const stop of graphemeStops(s)) {
    if (stop >= pos) return prev;
    prev = stop;
  }
  return prev;
}

function nextPos(s: string, p: number): number {
  const pos = snapPos(s, p);
  for (const stop of graphemeStops(s)) {
    if (stop > pos) return stop;
  }
  return s.length;
}

function wordLeft(s: string, p: number): number {
  let i = snapPos(s, p) - 1;
  while (i > 0 && /\s/.test(s[i] ?? "")) i--;
  while (i > 0 && !/\s/.test(s[i - 1] ?? "")) i--;
  return Math.max(0, i);
}

function wordRight(s: string, p: number): number {
  let i = snapPos(s, p);
  while (i < s.length && !/\s/.test(s[i] ?? "")) i++;
  while (i < s.length && /\s/.test(s[i] ?? "")) i++;
  return i;
}

// ── vertical navigation (hard newlines only — terminal visual wrap ignored) ─

function lineStartBefore(s: string, p: number): number {
  const nl = s.lastIndexOf("\n", Math.max(0, p - 1));
  return nl < 0 ? 0 : nl + 1;
}

function lineEndAt(s: string, p: number): number {
  const nl = s.indexOf("\n", p);
  return nl < 0 ? s.length : nl;
}

function moveUp(s: string, p: number): number {
  const lineStart = lineStartBefore(s, p);
  if (lineStart === 0) return p; // already on first line
  const col = p - lineStart;
  const prevLineEnd = lineStart - 1; // the \n at boundary
  const prevLineStart = lineStartBefore(s, prevLineEnd);
  const prevLen = prevLineEnd - prevLineStart;
  return prevLineStart + Math.min(col, prevLen);
}

function moveDown(s: string, p: number): number {
  const lineEnd = lineEndAt(s, p);
  if (lineEnd === s.length) return p; // already on last line
  const lineStart = lineStartBefore(s, p);
  const col = p - lineStart;
  const nextLineStart = lineEnd + 1;
  const nextLineEnd = lineEndAt(s, nextLineStart);
  const nextLen = nextLineEnd - nextLineStart;
  return nextLineStart + Math.min(col, nextLen);
}

// ── render helpers ──────────────────────────────────────────────────────────

const ESC = "\x1b";
const INV_ON = `${ESC}[7m`;
const INV_OFF = `${ESC}[27m`;
const invert = (s: string) => INV_ON + s + INV_OFF;

function renderWithCursor(value: string, cursor: number): string {
  const pos = Math.max(0, Math.min(cursor, value.length));
  let out = "";
  let done = false;
  for (const { segment, index } of seg().segment(value)) {
    if (!done && index >= pos) {
      out += invert(index === pos && segment !== "\n" ? segment : " ");
      done = true;
      if (index === pos && segment !== "\n") continue;
    }
    out += segment;
  }
  return done ? out : out + invert(" ");
}

// ── component ───────────────────────────────────────────────────────────────

export function TextArea({
  value,
  onChange,
  onSubmit,
  placeholder,
  isActive = true,
}: TextAreaProps) {
  const [cursor, setCursor] = useState(value.length);

  // Refs carry latest state into the useInput closure so back-to-back
  // keystrokes that arrive before React flushes don't see stale snapshots.
  const vRef = useRef(value);
  vRef.current = value;
  const curRef = useRef(cursor);
  curRef.current = cursor;

  const undoStack = useRef<{ value: string; cursor: number }[]>([]);
  const redoStack = useRef<{ value: string; cursor: number }[]>([]);

  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;

  function commit(
    next: string,
    nextCursor: number,
    opts: { track?: boolean } = {},
  ): void {
    const track = opts.track ?? true;
    const prev = vRef.current;
    const c = snapPos(next, nextCursor);
    if (track && next !== prev) {
      undoStack.current.push({ value: prev, cursor: curRef.current });
      if (undoStack.current.length > 200) undoStack.current.shift();
      redoStack.current = [];
    }
    curRef.current = c;
    vRef.current = next;
    setCursor(c);
    if (next !== prev) onChangeRef.current(next);
  }

  function swap(
    from: React.MutableRefObject<{ value: string; cursor: number }[]>,
    to: React.MutableRefObject<{ value: string; cursor: number }[]>,
  ): void {
    const entry = from.current.pop();
    if (!entry) return;
    to.current.push({ value: vRef.current, cursor: curRef.current });
    commit(entry.value, entry.cursor, { track: false });
  }

  useInput(
    (input, key) => {
      const v = vRef.current;
      const c = curRef.current;
      const mod = key.ctrl;

      // Enter: submit OR newline
      if (key.return) {
        if (key.shift || key.meta) {
          commit(`${v.slice(0, c)}\n${v.slice(c)}`, c + 1);
          return;
        }
        // Trailing `\` + Enter → replace `\` with newline (universal fallback).
        if (c > 0 && v[c - 1] === "\\") {
          commit(`${v.slice(0, c - 1)}\n${v.slice(c)}`, c);
          return;
        }
        void onSubmitRef.current(v);
        return;
      }

      // Let parent handle Escape (e.g. exit thread view).
      if (key.escape) return;

      // Tab alone: ignore (reserve for future completion; don't insert literal tab).
      if (key.tab) return;

      // Undo / Redo
      if (mod && input === "z" && !key.shift) {
        swap(undoStack, redoStack);
        return;
      }
      if ((mod && input === "y") || (mod && key.shift && input === "z")) {
        swap(redoStack, undoStack);
        return;
      }

      // Ctrl+A / Ctrl+E line start / end (Ink's Key type has no home/end —
      // those physical keys arrive as input escape sequences and are dropped).
      if (mod && input === "a") {
        commit(v, lineStartBefore(v, c), { track: false });
        return;
      }
      if (mod && input === "e") {
        commit(v, lineEndAt(v, c), { track: false });
        return;
      }

      // Arrow navigation
      if (key.leftArrow) {
        commit(v, mod ? wordLeft(v, c) : prevPos(v, c), { track: false });
        return;
      }
      if (key.rightArrow) {
        commit(v, mod ? wordRight(v, c) : nextPos(v, c), { track: false });
        return;
      }
      if (key.upArrow) {
        commit(v, moveUp(v, c), { track: false });
        return;
      }
      if (key.downArrow) {
        commit(v, moveDown(v, c), { track: false });
        return;
      }

      // Backward delete. Ink v5 maps macOS Backspace (\x7f) to `key.delete`
      // and only old \x08 / ctrl+h to `key.backspace`, and it can't distinguish
      // Backspace from fn+Delete (both deliver {delete:true, input:""}). We
      // treat either flag as backward — forward-delete (fn+Delete) is niche
      // and the common Backspace case must work.
      if ((key.backspace || key.delete) && c > 0) {
        const t = mod ? wordLeft(v, c) : prevPos(v, c);
        commit(v.slice(0, t) + v.slice(c), t);
        return;
      }

      // Kill-line shortcuts
      if (mod && input === "u") {
        commit(v.slice(c), 0);
        return;
      }
      if (mod && input === "k") {
        commit(v.slice(0, c), c);
        return;
      }
      if (mod && input === "w") {
        if (c > 0) {
          const t = wordLeft(v, c);
          commit(v.slice(0, t) + v.slice(c), t);
        }
        return;
      }

      // Character / paste input. Normalise CRLF → LF, strip bracketed-paste
      // markers (`\x1b[200~` / `\x1b[201~`) that some terminals emit around
      // clipboard drops, then insert whatever is left at the cursor. Ink
      // delivers each keystroke separately for typed input; longer `input`
      // strings come from paste events and are handled the same way.
      if (input && input.length > 0) {
        // biome-ignore lint/suspicious/noControlCharactersInRegex: bracketed-paste markers start with ESC (\x1b); we strip them here explicitly.
        const bracketedPaste = /\x1b\[20[01]~/g;
        const cleaned = input
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n")
          .replace(bracketedPaste, "");
        if (!cleaned) return;
        commit(v.slice(0, c) + cleaned + v.slice(c), c + cleaned.length);
      }
    },
    { isActive },
  );

  if (value.length === 0) {
    // Show the block cursor even when empty so the focused state is obvious.
    // Placeholder (if any) trails it dimmed.
    return (
      <Text>
        <Text inverse> </Text>
        {placeholder ? <Text dimColor>{placeholder}</Text> : null}
      </Text>
    );
  }

  return (
    <Box>
      <Text wrap="wrap">{renderWithCursor(value, cursor)}</Text>
    </Box>
  );
}
