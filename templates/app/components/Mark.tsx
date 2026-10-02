/* The ShipProbe mark, served from app/icon.svg, beside the name. */
export default function Mark({ size = 24 }: { size?: number }) {
  return (
    <span className="mark">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.svg" alt="" width={size} height={size} />
      <span>ShipProbe</span>
    </span>
  );
}
