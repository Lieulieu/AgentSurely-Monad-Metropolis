import { useId } from "react";

/**
 * AgentSurely mark: a shield (the bond) holding an agent whose body is a check mark (the verified result).
 * Original artwork — source files in docs/brand.
 */
export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`as-${id}`} x1="12" y1="6" x2="54" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5B7CF5" />
          <stop offset="1" stopColor="#2A4ABA" />
        </linearGradient>
      </defs>
      <path d="M32 4 55 12.5v16.3C55 43.6 45.6 54.6 32 60 18.4 54.6 9 43.6 9 28.8V12.5Z" fill={`url(#as-${id})`} />
      <path d="M32 8.3 51 15.3v13.5c0 12.2-7.6 21.4-19 26.4" fill="none" stroke="#fff" strokeOpacity=".18" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="32" cy="21" r="6.2" fill="#fff" />
      <path d="m20.5 38 7.5 7.5 15.5-15" fill="none" stroke="#fff" strokeWidth="5.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ dark }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <Logo />
      <span className={dark ? "text-[17px] font-semibold tracking-tight text-white" : "text-[17px] font-semibold tracking-tight text-ink"}>
        Agent<span className={dark ? "text-brand-bright" : "text-brand"}>Surely</span>
      </span>
    </span>
  );
}
