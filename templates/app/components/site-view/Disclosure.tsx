'use client';

import { useId, useState, type ReactNode } from 'react';

/* A question and its answer. The body animates open and closed, and while closed it is inert, so
 * it is out of the tab order and out of the accessibility tree. */
export default function Disclosure({ title, children }: { title: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="sv-disclosure">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <span className="sv-sign" aria-hidden="true">+</span>
      </button>
      <div id={id} className="sv-reveal" data-open={open} inert={!open}>
        <div>
          <div className="sv-answer">{children}</div>
        </div>
      </div>
    </div>
  );
}
