import { useEffect, useState } from "react";

/** Toggle every `intervalMs`. Used to animate unread-row foreground color. */
export function useBlink(intervalMs = 500): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setOn((x) => !x), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return on;
}
