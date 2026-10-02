'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Welcome from './Welcome';

/* The view authority. Console is the default for a new visitor. A valid ?view= wins over the
 * saved choice, and a valid explicit choice is saved. Storage access is wrapped, because a
 * private window can throw on read. */
export type SiteView = 'console' | 'simple';
type Mode = { view: SiteView; choose: (view: SiteView) => void; welcome: () => void };

const Context = createContext<Mode | null>(null);
export function useSiteView() {
  return useContext(Context);
}

const VIEW_KEY = 'shipprobe:view';

export default function SiteViewProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<SiteView>('console');
  const path = usePathname();

  const choose = useCallback((next: SiteView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {}
    const url = new URL(window.location.href);
    if (url.searchParams.has('view')) {
      url.searchParams.set('view', next);
      window.history.replaceState(window.history.state, '', url.href);
    }
  }, []);

  useEffect(() => {
    const explicit = new URLSearchParams(window.location.search).get('view');
    if (explicit === 'simple' || explicit === 'console') {
      choose(explicit);
      return;
    }
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(VIEW_KEY);
    } catch {}
    setView(saved === 'simple' ? 'simple' : 'console');
  }, [path, choose]);

  const welcome = useCallback(() => window.dispatchEvent(new Event('shipprobe:welcome')), []);

  return (
    <Context.Provider value={{ view, choose, welcome }}>
      <div className="sv-surface" data-view={view}>
        {children}
      </div>
      <Welcome />
    </Context.Provider>
  );
}
