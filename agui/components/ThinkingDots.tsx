"use client";

// Three bouncing dots shown while Alfred is thinking (the delegate is running),
// before the spoken answer begins. CSS-only animation (see globals.css).
const DOT_COUNT = 3;

export function ThinkingDots() {
  return (
    <span className="chat-thinking" role="img" aria-label="Alfred is thinking">
      {Array.from({ length: DOT_COUNT }).map((_, index) => (
        <span
          key={index}
          className="chat-thinking__dot"
          style={{ animationDelay: `${index * 0.16}s` }}
        />
      ))}
    </span>
  );
}
