/**
 * Fixed page backdrop: layered radial glows, three slowly drifting blurred
 * orbs, a vignette and a film-grain overlay. Everything is CSS-driven so it
 * costs nothing on the main thread.
 */
export function Aurora() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(60% 50% at 14% 8%, rgba(94,166,255,0.16), transparent 60%)," +
            "radial-gradient(55% 45% at 86% 12%, rgba(179,157,255,0.14), transparent 60%)," +
            "radial-gradient(75% 60% at 50% 104%, rgba(125,227,212,0.1), transparent 66%)",
        }}
      />
      <div className="absolute top-[-12%] -left-32 size-[46vw] animate-drift rounded-full bg-accent-strong/20 blur-[130px]" />
      <div className="absolute top-[6%] right-[-14%] size-[42vw] animate-drift-slow rounded-full bg-glow/15 blur-[140px]" />
      <div className="absolute bottom-[-18%] left-1/3 size-[44vw] animate-drift rounded-full bg-mint/10 blur-[150px] [animation-delay:-9s]" />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 0%, transparent 52%, rgba(4,6,12,0.85) 100%)",
        }}
      />
      <div className="noise absolute inset-0 opacity-[0.05] mix-blend-soft-light" />
    </div>
  );
}
