import { useEffect, useState } from "react";

const DURATION = 600;
const plain = (n) => Number(n).toLocaleString("en-AE");
const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Counts up from zero once when it first appears. Text such as "500+" shows at once.
export default function AnimatedNumber({ value, format = plain }) {
  const animates = isNumber(value) && !reducedMotion();
  const [shown, setShown] = useState(animates ? 0 : value);

  useEffect(() => {
    if (!animates) return undefined;
    let frame;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / DURATION, 1);
      const eased = 1 - (1 - t) ** 3;
      setShown(t < 1 ? Math.round(value * eased) : value);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animates, value]);

  const current = animates ? shown : value;
  return <span className="sum-num">{isNumber(current) ? format(current) : current}</span>;
}
