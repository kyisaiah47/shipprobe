import type { ReactNode } from 'react';

export default function Footer({ controls }: { controls?: ReactNode }) {
  return (
    <footer className="foot">
      <p>
        Checks run on this server with{' '}
        <a href="https://github.com/kyisaiah47/shipprobe">ShipProbe</a>, which is MIT licensed. Page, plan and promote checks run
        from the CLI: <code>npx shipprobe page &lt;url&gt;</code>.
      </p>
      {controls}
    </footer>
  );
}
