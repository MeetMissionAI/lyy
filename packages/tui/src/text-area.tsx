import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

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

  useInput(
    (input, key) => {
      // Shift+Tab: newline (Claude Code convention alternative)
      if (key.tab && key.shift) {
        insertText("\n");
        return;
      }

      if (key.return) {
        void onSubmit(value);
        return;
      }

      if (key.escape) {
        // don't consume; let parent handle (e.g. exit thread view)
        return;
      }

      if (key.leftArrow) {
        moveLeft();
        return;
      }
      if (key.rightArrow) {
        moveRight();
        return;
      }
      if (key.upArrow) {
        moveUp();
        return;
      }
      if (key.downArrow) {
        moveDown();
        return;
      }

      if (key.backspace || key.delete) {
        deleteBackward();
        return;
      }

      if (input && input.length > 0) {
        insertText(input);
      }
    },
    { isActive },
  );

  function insertText(text: string): void {
    // Text may contain \n from paste or Shift+Tab. Insert line by line.
    const chunks = text.split("\n");
    const head = lines.slice(0, cursor.row);
    const current = lines[cursor.row] ?? "";
    const tail = lines.slice(cursor.row + 1);

    const before = current.slice(0, cursor.col);
    const after = current.slice(cursor.col);

    let newLines: string[];
    let newRow: number;
    let newCol: number;

    if (chunks.length === 1) {
      newLines = [...head, before + chunks[0] + after, ...tail];
      newRow = cursor.row;
      newCol = cursor.col + chunks[0].length;
    } else {
      const first = before + chunks[0];
      const last = chunks[chunks.length - 1] + after;
      const middle = chunks.slice(1, -1);
      newLines = [...head, first, ...middle, last, ...tail];
      newRow = cursor.row + chunks.length - 1;
      newCol = chunks[chunks.length - 1].length;
    }
    onChange(newLines.join("\n"));
    setCursor({ row: newRow, col: newCol });
  }

  function deleteBackward(): void {
    if (cursor.col > 0) {
      const line = lines[cursor.row] ?? "";
      const newLine = line.slice(0, cursor.col - 1) + line.slice(cursor.col);
      const next = [...lines];
      next[cursor.row] = newLine;
      onChange(next.join("\n"));
      setCursor({ row: cursor.row, col: cursor.col - 1 });
      return;
    }
    if (cursor.row > 0) {
      const prev = lines[cursor.row - 1] ?? "";
      const curr = lines[cursor.row] ?? "";
      const merged = prev + curr;
      const next = [...lines];
      next.splice(cursor.row - 1, 2, merged);
      onChange(next.join("\n"));
      setCursor({ row: cursor.row - 1, col: prev.length });
    }
  }

  function moveLeft(): void {
    if (cursor.col > 0) {
      setCursor({ row: cursor.row, col: cursor.col - 1 });
      return;
    }
    if (cursor.row > 0) {
      const prev = lines[cursor.row - 1] ?? "";
      setCursor({ row: cursor.row - 1, col: prev.length });
    }
  }

  function moveRight(): void {
    const line = lines[cursor.row] ?? "";
    if (cursor.col < line.length) {
      setCursor({ row: cursor.row, col: cursor.col + 1 });
      return;
    }
    if (cursor.row < lines.length - 1) {
      setCursor({ row: cursor.row + 1, col: 0 });
    }
  }

  function moveUp(): void {
    if (cursor.row === 0) return;
    const prev = lines[cursor.row - 1] ?? "";
    setCursor({ row: cursor.row - 1, col: Math.min(cursor.col, prev.length) });
  }

  function moveDown(): void {
    if (cursor.row >= lines.length - 1) return;
    const next = lines[cursor.row + 1] ?? "";
    setCursor({ row: cursor.row + 1, col: Math.min(cursor.col, next.length) });
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
