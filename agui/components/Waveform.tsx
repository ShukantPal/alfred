"use client";

interface WaveformProps {
  /** Animate the bars while Alfred is speaking; settle them when done. */
  speaking: boolean;
}

// Decorative voice indicator for Alfred's spoken replies. CSS-only animation
// (see globals.css) so there's no rAF loop, and it respects prefers-reduced-motion.
const BAR_COUNT = 5;

export function Waveform({ speaking }: WaveformProps) {
  return (
    <span
      className={`chat-waveform${speaking ? " chat-waveform--speaking" : ""}`}
      role="img"
      aria-label={speaking ? "Alfred is speaking" : "Alfred replied by voice"}
    >
      {Array.from({ length: BAR_COUNT }).map((_, index) => (
        <span
          key={index}
          className="chat-waveform__bar"
          style={{ animationDelay: `${index * 0.12}s` }}
        />
      ))}
    </span>
  );
}
