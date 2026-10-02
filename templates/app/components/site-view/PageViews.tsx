'use client';

import type { ReactNode } from 'react';
import { useSiteView } from './SiteViewProvider';

/* One page, two compositions. Only the active one is mounted, so there is one header, one main
 * and one footer at a time. */
export default function PageViews({ consoleView, simpleView }: { consoleView: ReactNode; simpleView: ReactNode }) {
  return <>{useSiteView()?.view === 'simple' ? simpleView : consoleView}</>;
}
