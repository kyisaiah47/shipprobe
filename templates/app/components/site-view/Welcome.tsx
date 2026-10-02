'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSiteView, type SiteView } from './SiteViewProvider';

/* The welcome: one question, one explanation, one small labelled illustration, two equal choices.
 * It opens by itself on `/` unless the reader turned it off or the URL carries welcome=0, and the
 * footer's Start here always reopens it. Closing, Escape and a click on the backdrop close it
 * without changing the view. */
const OFF_KEY = 'shipprobe:welcome-off';

export default function Welcome() {
  const mode = useSiteView();
  const path = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previous = useRef<HTMLElement | null>(null);
  const [off, setOff] = useState(false);
  const [visible, setVisible] = useState(false);

  const show = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const d = dialog.current;
    if (d && !d.open) {
      previous.current = document.activeElement as HTMLElement | null;
      d.showModal();
    }
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    if (timer.current) clearTimeout(timer.current);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    timer.current = setTimeout(
      () => {
        dialog.current?.close();
        const back = previous.current;
        if (back && back.isConnected && back !== document.body) back.focus({ preventScroll: true });
      },
      reduced ? 0 : 220,
    );
  }, []);

  useEffect(() => {
    let disabled = false;
    try {
      disabled = localStorage.getItem(OFF_KEY) === '1';
    } catch {}
    setOff(disabled);
    if (path === '/' && !disabled && new URLSearchParams(window.location.search).get('welcome') !== '0') show();
    window.addEventListener('shipprobe:welcome', show);
    return () => {
      window.removeEventListener('shipprobe:welcome', show);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [path, show]);

  function select(view: SiteView) {
    mode?.choose(view);
    close();
  }

  return (
    <dialog
      ref={dialog}
      className="sv-welcome"
      data-visible={visible}
      aria-labelledby="sv-welcome-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      <header className="sv-welcome-top">
        <span className="sv-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={22} height={22} />
          ShipProbe <small>/ START HERE</small>
        </span>
        <button type="button" className="sv-close" aria-label="Close welcome" onClick={close} autoFocus>
          {'×'}
        </button>
      </header>
      <div className="sv-welcome-intro">
        <h2 id="sv-welcome-title">Can a stranger see what your app should keep private?</h2>
        <p>
          ShipProbe reads what your deployed app sends to every visitor, and names each key, open database table or missing
          protection it finds, with where it found it.
        </p>
      </div>
      <section className="sv-illustration" aria-label="Illustration">
        <div className="sv-illustration-top">
          <span>ILLUSTRATION</span>
          <span>A FICTIONAL APP</span>
        </div>
        <p>
          <code>app.example</code> ships a database key that bypasses every access rule.
        </p>
        <p className="sv-illustration-found">Fail, critical. Found in the main script bundle. The check exits 1.</p>
      </section>
      <section className="sv-welcome-choose">
        <h3>How would you like to explore?</h3>
        <p>You can switch anytime.</p>
        <div className="sv-choices">
          <button type="button" onClick={() => select('console')}>
            <b>Console</b>
            <strong>See more at once.</strong>
            <span>All three checks on one screen, findings as tables.</span>
          </button>
          <button type="button" onClick={() => select('simple')}>
            <b>Simple</b>
            <strong>Start with the essentials.</strong>
            <span>One scan first, with details you open as you go.</span>
          </button>
        </div>
      </section>
      <footer className="sv-welcome-foot">
        <label>
          <input
            type="checkbox"
            checked={off}
            onChange={(e) => {
              const value = e.target.checked;
              setOff(value);
              try {
                if (value) localStorage.setItem(OFF_KEY, '1');
                else localStorage.removeItem(OFF_KEY);
              } catch {}
            }}
          />
          Don&apos;t open this when I come back
        </label>
      </footer>
    </dialog>
  );
}
