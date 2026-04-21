import { Box, Text, useInput } from "ink";
import React, { useRef, useState } from "react";

export interface TextAreaProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: (value: string) => void | Promise<void>;
  placeholder?: string;
  /** Non-empty focus = accept keys. Default true. */
  isActive?: boolean;
}

interface Cursor {
  row: number;
  col: number;
}

/**
 * Multi-line text input. Enter submits; Shift+Tab inserts newline. Arrow keys
 * move the cursor in all four directions. Paste-as-keystrokes (terminal
 * forwards clipboard characters through stdin, including embedded \n) is
 * handled by splitting the input on newline and inserting line breaks at the
 * cursor. Copy uses the terminal's native selection — Ink/stdin receives no
 * clipboard signal so we can't re-implement it, and don't need to.
 */
export function TextArea({
  value,
  onChange,
  onSubmit,
  placeholder,
  isActive = true,
}: TextAreaProps) {
  const [cursor, setCursor] = useState<Cursor>({ row: 0, col: 0 });
  const lines = value.length === 0 ? [""] : value.split("\n");

  // Refs mirror latest state/props so the useInput handler — whose React
  // closure may still hold a snapshot from an earlier render — always reads
  // the freshest values. Without this, typing `\` then Enter races: the
  // Enter handler closure captured `value` before `\` landed, saw no trailing
  // backslash, and fell through to submit. Now we deref via ref.
  const valueRef = useRef(value);
  valueRef.current = value;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  useInput(
    (input, key) => {
      // Always read from refs so we see post-render state (avoids the race
      // where typing `\` then Enter fires the Enter handler before React
      // has flushed the setState from the `\` keystroke).
      const curValue = valueRef.current;
      const cur = cursorRef.current;
      const curLines = curValue.length === 0 ? [""] : curValue.split("\n");

      if (key.return) {
        if (key.shift) {
          insertText("\n", curLines, cur);
          return;
        }
        // Fallback: trailing `\` + Enter. Replace the `\` with a newline.
        const curLine = curLines[cur.row] ?? "";
        if (cur.col > 0 && curLine[cur.col - 1] === "\\") {
          const head = curLines.slice(0, cur.row);
          const tail = curLines.slice(cur.row + 1);
          const before = curLine.slice(0, cur.col - 1); // drop \
          const after = curLine.slice(cur.col);
          const next = [...head, before, after, ...tail];
          onChange(next.join("\n"));
          setCursor({ row: cur.row + 1, col: 0 });
          return;
        }
        void onSubmit(curValue);
        return;
      }

      if (key.escape) {
        return;
      }

      if (key.leftArrow) {
        moveLeft(curLines, cur);
        return;
      }
      if (key.rightArrow) {
        moveRight(curLines, cur);
        return;
      }
      if (key.upArrow) {
        moveUp(curLines, cur);
        return;
      }
      if (key.downArrow) {
        moveDown(curLines, cur);
        return;
      }

      if (key.backspace || key.delete) {
        deleteBackward(curLines, cur);
        return;
      }

      if (input && input.length > 0) {
        insertText(input, curLines, cur);
      }
    },
    { isActive },
  );

  function insertText(text: string, curLines: string[], cur: Cursor): void {
    const chunks = text.split("\n");
    const head = curLines.slice(0, cur.row);
    const current = curLines[cur.row] ?? "";
    const tail = curLines.slice(cur.row + 1);

    const before = current.slice(0, cur.col);
    const after = current.slice(cur.col);

    let newLines: string[];
    let newRow: number;
    let newCol: number;

    if (chunks.length === 1) {
      newLines = [...head, before + chunks[0] + after, ...tail];
      newRow = cur.row;
      newCol = cur.col + chunks[0].length;
    } else {
      const first = before + chunks[0];
      const last = chunks[chunks.length - 1] + after;
      const middle = chunks.slice(1, -1);
      newLines = [...head, first, ...middle, last, ...tail];
      newRow = cur.row + chunks.length - 1;
      newCol = chunks[chunks.length - 1].length;
    }
    onChange(newLines.join("\n"));
    setCursor({ row: newRow, col: newCol });
  }

  function deleteBackward(curLines: string[], cur: Cursor): void {
    if (cur.col > 0) {
      const line = curLines[cur.row] ?? "";
      const newLine = line.slice(0, cur.col - 1) + line.slice(cur.col);
      const next = [...curLines];
      next[cur.row] = newLine;
      onChange(next.join("\n"));
      setCursor({ row: cur.row, col: cur.col - 1 });
      return;
    }
    if (cur.row > 0) {
      const prev = curLines[cur.row - 1] ?? "";
      const curr = curLines[cur.row] ?? "";
      const merged = prev + curr;
      const next = [...curLines];
      next.splice(cur.row - 1, 2, merged);
      onChange(next.join("\n"));
      setCursor({ row: cur.row - 1, col: prev.length });
    }
  }

  function moveLeft(curLines: string[], cur: Cursor): void {
    if (cur.col > 0) {
      setCursor({ row: cur.row, col: cur.col - 1 });
      return;
    }
    if (cur.row > 0) {
      const prev = curLines[cur.row - 1] ?? "";
      setCursor({ row: cur.row - 1, col: prev.length });
    }
  }

  function moveRight(curLines: string[], cur: Cursor): void {
    const line = curLines[cur.row] ?? "";
    if (cur.col < line.length) {
      setCursor({ row: cur.row, col: cur.col + 1 });
      return;
    }
    if (cur.row < curLines.length - 1) {
      setCursor({ row: cur.row + 1, col: 0 });
    }
  }

  function moveUp(curLines: string[], cur: Cursor): void {
    if (cur.row === 0) return;
    const prev = curLines[cur.row - 1] ?? "";
    setCursor({ row: cur.row - 1, col: Math.min(cur.col, prev.length) });
  }

  function moveDown(curLines: string[], cur: Cursor): void {
    if (cur.row >= curLines.length - 1) return;
    const next = curLines[cur.row + 1] ?? "";
    setCursor({ row: cur.row + 1, col: Math.min(cur.col, next.length) });
  }

  if (value.length === 0 && placeholder) {
    return <Text dimColor>{placeholder}</Text>;
  }

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        if (i !== cursor.row) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positionally stable within this render
            <Text key={i}>{line.length === 0 ? " " : line}</Text>
          );
        }
        const before = line.slice(0, cursor.col);
        const atChar = line[cursor.col] ?? " ";
        const after = line.slice(cursor.col + 1);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positionally stable within this render
          <Text key={i}>
            {before}
            <Text inverse>{atChar}</Text>
            {after}
          </Text>
        );
      })}
    </Box>
  );
}
