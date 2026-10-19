// SPDX-License-Identifier: Apache-2.0
// The living backdrop: drifting aurora in the section's colours, a ledger
// grid, a slowly turning zero-knowledge seal, and a canvas of loot sparks
// rising past a constellation of proof nodes. Purely decorative; static for
// reduced-motion users and skipped entirely where canvas is unavailable.
import { useEffect, useRef } from "react";

type Spark = { x: number; y: number; vy: number; vx: number; r: number; hue: number; life: number; twinkle: number };
type Node = { x: number; y: number; vx: number; vy: number };

// Brand hues: violet, gold, pink, cyan.
const HUES = [262, 43, 330, 190];

export function ArcaneBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,#120d3a_0%,#06051a_55%)]" />
      <div
        className="absolute -left-[15%] -top-[20%] size-[70vmax] rounded-full opacity-40 blur-[110px] animate-[aurora_26s_ease-in-out_infinite]"
        style={{ background: "radial-gradient(circle, var(--sec-a), transparent 62%)", transition: "background 1s" }}
      />
      <div
        className="absolute -right-[20%] top-[10%] size-[60vmax] rounded-full opacity-25 blur-[120px] animate-[aurora_32s_ease-in-out_infinite_reverse]"
        style={{ background: "radial-gradient(circle, var(--sec-b), transparent 62%)" }}
      />
      <div
        className="absolute -bottom-[30%] left-[25%] size-[55vmax] rounded-full opacity-20 blur-[120px] animate-[aurora_38s_ease-in-out_infinite]"
        style={{ background: "radial-gradient(circle, var(--sec-c), transparent 62%)" }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-[55vh] animate-[grid-pan_6s_linear_infinite] opacity-[0.22]"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in oklab, var(--sec-a) 45%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--sec-a) 45%, transparent) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          transform: "perspective(600px) rotateX(62deg)",
          transformOrigin: "bottom",
          maskImage: "linear-gradient(to top, #000 10%, transparent 85%)",
        }}
      />
      <Seal />
      <SparkField />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(3,2,14,0.75)_100%)]" />
    </div>
  );
}

/** A huge, faint seal of rune rings turning behind the page. */
function Seal() {
  const ticks = Array.from({ length: 72 }, (_, i) => i);
  const runes = "ᚱᚢᚾᛖᛋᛁᚷᛚᛟᛞᚨᛉᛗᛏᚦᚹ".split("");
  return (
    <svg viewBox="0 0 400 400" className="absolute -right-[18vmax] -top-[18vmax] size-[70vmax] opacity-[0.13]">
      <defs>
        <linearGradient id="seal-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--sec-a)" />
          <stop offset="100%" stopColor="var(--sec-b)" />
        </linearGradient>
      </defs>
      <g className="origin-center animate-[spin-slow_120s_linear_infinite]" style={{ transformBox: "fill-box" }}>
        <circle cx="200" cy="200" r="190" fill="none" stroke="url(#seal-g)" strokeWidth="1.2" />
        {ticks.map((i) => (
          <line
            key={i}
            x1="200"
            y1="14"
            x2="200"
            y2={i % 6 === 0 ? 30 : 22}
            stroke="url(#seal-g)"
            strokeWidth={i % 6 === 0 ? 2 : 0.8}
            transform={`rotate(${i * 5} 200 200)`}
          />
        ))}
        {runes.map((r, i) => (
          <text key={i} x="200" y="52" textAnchor="middle" fontSize="14" fill="url(#seal-g)" transform={`rotate(${(i * 360) / runes.length} 200 200)`}>
            {r}
          </text>
        ))}
      </g>
      <g className="origin-center animate-[spin-rev_80s_linear_infinite]" style={{ transformBox: "fill-box" }}>
        <circle cx="200" cy="200" r="130" fill="none" stroke="url(#seal-g)" strokeWidth="1" strokeDasharray="4 8" />
        <polygon points="200,80 304,260 96,260" fill="none" stroke="url(#seal-g)" strokeWidth="1" />
        <polygon points="200,320 96,140 304,140" fill="none" stroke="url(#seal-g)" strokeWidth="1" />
      </g>
      <circle cx="200" cy="200" r="70" fill="none" stroke="url(#seal-g)" strokeWidth="1.5" />
      <circle cx="200" cy="200" r="20" fill="none" stroke="url(#seal-g)" strokeWidth="2" />
    </svg>
  );
}

function SparkField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || typeof window === "undefined" || /jsdom/i.test(navigator.userAgent)) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let raf = 0;
    let sparks: Spark[] = [];
    let nodes: Node[] = [];

    const spawn = (anywhere: boolean): Spark => ({
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : h + 10,
      vy: -(0.15 + Math.random() * 0.55),
      vx: (Math.random() - 0.5) * 0.15,
      r: 0.6 + Math.random() * 1.9,
      hue: HUES[Math.floor(Math.random() * HUES.length)]!,
      life: Math.random(),
      twinkle: 0.01 + Math.random() * 0.03,
    });

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const area = (w * h) / 1e6;
      sparks = Array.from({ length: Math.round(45 * area + 25) }, () => spawn(true));
      nodes = Array.from({ length: Math.round(14 * area + 10) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
      }));
    };

    const star = (x: number, y: number, r: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y - r * 3);
      ctx.quadraticCurveTo(x, y, x + r * 3, y);
      ctx.quadraticCurveTo(x, y, x, y + r * 3);
      ctx.quadraticCurveTo(x, y, x - r * 3, y);
      ctx.quadraticCurveTo(x, y, x, y - r * 3);
      ctx.fill();
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      // Proof constellation: nodes linked when close, like a circuit forming.
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
      }
      ctx.lineWidth = 0.6;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!;
          const b = nodes[j]!;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 190) {
            ctx.strokeStyle = `hsla(262, 90%, 75%, ${0.1 * (1 - d / 190)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      for (const n of nodes) {
        ctx.fillStyle = "hsla(262, 90%, 80%, 0.35)";
        ctx.fillRect(n.x - 1.5, n.y - 1.5, 3, 3);
      }
      // Loot sparks drifting upward, twinkling.
      for (const s of sparks) {
        s.y += s.vy;
        s.x += s.vx;
        s.life += s.twinkle;
        if (s.y < -10) Object.assign(s, spawn(false));
        const a = 0.25 + 0.55 * Math.abs(Math.sin(s.life * Math.PI));
        const color = `hsla(${s.hue}, 95%, 72%, ${a})`;
        if (s.r > 1.9) star(s.x, s.y, s.r * 0.9, color);
        else {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (!reduced) raf = requestAnimationFrame(draw);
    };

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduced) raf = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return <canvas ref={ref} className="absolute inset-0" />;
}
