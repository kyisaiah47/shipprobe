'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { runCheck, type CheckKind, type CheckResult } from '@/lib/checks';

/* The checks' state lives here, above both views, so a typed URL, a running scan and a finished
 * result all survive a switch between Console and Simple. Only preferences go to storage; drafts
 * and results stay in memory. One request per check at a time. */
type Slot = { draft: Record<string, unknown>; running: boolean; result: CheckResult | null };
type Store = {
  slot: (kind: CheckKind) => Slot;
  setDraft: (kind: CheckKind, patch: Record<string, unknown>) => void;
  run: (kind: CheckKind) => Promise<void>;
};

const EMPTY: Slot = { draft: {}, running: false, result: null };
const Context = createContext<Store | null>(null);

export function useChecks() {
  const store = useContext(Context);
  if (!store) throw new Error('useChecks must be used inside CheckState');
  return store;
}

export default function CheckState({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const live = useRef<Record<string, Slot>>({});
  live.current = slots;

  const slot = useCallback((kind: CheckKind) => slots[kind] ?? EMPTY, [slots]);
  const patch = useCallback((kind: CheckKind, p: Partial<Slot>) => {
    setSlots((s) => ({ ...s, [kind]: { ...(s[kind] ?? EMPTY), ...p } }));
  }, []);
  const setDraft = useCallback(
    (kind: CheckKind, d: Record<string, unknown>) => {
      const cur = live.current[kind] ?? EMPTY;
      patch(kind, { draft: { ...cur.draft, ...d } });
    },
    [patch],
  );
  const run = useCallback(
    async (kind: CheckKind) => {
      const cur = live.current[kind] ?? EMPTY;
      if (cur.running) return;
      patch(kind, { running: true });
      const result = await runCheck(kind, cur.draft);
      patch(kind, { running: false, result });
    },
    [patch],
  );

  return <Context.Provider value={{ slot, setDraft, run }}>{children}</Context.Provider>;
}
