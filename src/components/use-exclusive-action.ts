"use client";

import { useRef, useState } from "react";

export function useExclusiveAction() {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);

  async function run<Result>(action: () => Promise<Result>) {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setPending(true);
    try {
      return await action();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { pending, run } as const;
}
