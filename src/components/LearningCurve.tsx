"use client";

import React, { useMemo, useState } from "react";

export interface LearningPoint {
  index: number;
  matchDate: string;
  opponent?: string;
  modelError: number;
  naiveError: number;
  noiseFloor: number;
}

interface LearningCurveProps {
  points: LearningPoint[];
  selectedIndex?: number;
  onSelect?: (index: number) => void;
}

/**
 * Curva de aprendizaje honesta: cada punto es una predicción hecha ANTES del
 * partido (solo con partidos anteriores).
 *  - Línea verde: error medio acumulado del modelo.
 *  - Línea gris discontinua: error del método ingenuo (media simple de sus partidos).
 *  - Banda inferior: piso de ruido = error que ni un modelo perfecto puede evitar,
 *    porque un partido es aleatorio. El objetivo es pegarse a ese piso, no llegar a 0.
 */
export function LearningCurve({ points, selectedIndex, onSelect }: LearningCurveProps) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 340;
  const H = 190;
  const pad = { l: 34, r: 10, t: 14, b: 26 };

  const series = useMemo(() => {
    let m = 0;
    let n = 0;
    let f = 0;
    return points.map((p, i) => {
      m += p.modelError;
      n += p.naiveError;
      f += p.noiseFloor;
      const k = i + 1;
      return { ...p, cumModel: m / k, cumNaive: n / k, cumFloor: f / k };
    });
  }, [points]);

  if (points.length < 2) {
    return (
      <div className="bg-surface-container-low rounded-xl p-space-md border border-surface-container-high/60 font-mono text-[11px] text-on-surface-variant">
        La curva de aprendizaje aparece a partir de 2 partidos registrados. Cada partido nuevo se
        predice primero con los anteriores y luego se compara con lo que pasó.
      </div>
    );
  }

  const maxY = Math.max(...series.map((s) => Math.max(s.modelError, s.cumNaive, s.cumModel))) * 1.1 || 1;
  const x = (i: number) => pad.l + (i / Math.max(1, series.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / maxY) * (H - pad.t - pad.b);
  const line = (key: "cumModel" | "cumNaive" | "cumFloor") =>
    series.map((s, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(s[key]).toFixed(1)}`).join(" ");
  const floorArea =
    `M${x(0)},${y(0)} ` +
    series.map((s, i) => `L${x(i).toFixed(1)},${y(s.cumFloor).toFixed(1)}`).join(" ") +
    ` L${x(series.length - 1)},${y(0)} Z`;

  const last = series[series.length - 1];
  const gain = last.cumNaive > 0 ? ((last.cumNaive - last.cumModel) / last.cumNaive) * 100 : 0;
  const gapToFloor = last.cumFloor > 0 ? ((last.cumModel - last.cumFloor) / last.cumFloor) * 100 : 0;
  const active = hover ?? (selectedIndex !== undefined ? selectedIndex : null);
  const ticks = [0, maxY / 2, maxY];

  return (
    <div className="bg-surface-container-low rounded-xl p-space-md border border-surface-container-high/60 w-full">
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono text-xs font-bold text-on-surface uppercase tracking-wider flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px] text-primary">monitoring</span>
          Curva de aprendizaje
        </span>
        <span
          className={`font-mono text-[10px] px-2 py-0.5 rounded border ${
            gain >= 0 ? "text-primary bg-primary/10 border-primary/30" : "text-tertiary bg-tertiary/10 border-tertiary/30"
          }`}
        >
          {gain >= 0 ? "−" : "+"}
          {Math.abs(gain).toFixed(0)}% error vs ingenuo
        </span>
      </div>
      <p className="font-mono text-[10px] text-on-surface-variant mb-1">
        Error medio acumulado (predicción hecha antes de cada partido). A {gapToFloor.toFixed(0)}% del piso de ruido.
      </p>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#1E293B" strokeDasharray="3 4" />
            <text x={pad.l - 4} y={y(t)} textAnchor="end" dominantBaseline="central" className="fill-on-surface-variant font-mono text-[8px]">
              {t.toFixed(2)}
            </text>
          </g>
        ))}
        <path d={floorArea} fill="rgba(148,163,184,0.12)" />
        <path d={line("cumFloor")} fill="none" stroke="#64748B" strokeWidth="1" />
        <path d={line("cumNaive")} fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeDasharray="5 4" />
        {series.map((s, i) => (
          <circle key={`dot-${i}`} cx={x(i)} cy={y(s.modelError)} r={active === i ? 3.5 : 2} fill="#06B6D4" fillOpacity={active === i ? 1 : 0.45} />
        ))}
        <path d={line("cumModel")} fill="none" stroke="#10B981" strokeWidth="2.25" />
        {series.map((s, i) => (
          <rect
            key={`hit-${i}`}
            x={x(i) - (W - pad.l - pad.r) / series.length / 2}
            y={pad.t}
            width={(W - pad.l - pad.r) / series.length}
            height={H - pad.t - pad.b}
            fill="transparent"
            className="cursor-pointer"
            onMouseEnter={() => setHover(i)}
            onClick={() => onSelect?.(i)}
          />
        ))}
        {active !== null && series[active] && (
          <line x1={x(active)} x2={x(active)} y1={pad.t} y2={H - pad.b} stroke="#06B6D4" strokeOpacity="0.5" />
        )}
        <text x={pad.l} y={H - 8} className="fill-on-surface-variant font-mono text-[8px]">
          partido 1
        </text>
        <text x={W - pad.r} y={H - 8} textAnchor="end" className="fill-on-surface-variant font-mono text-[8px]">
          partido {series.length}
        </text>
      </svg>

      {active !== null && series[active] && (
        <div className="font-mono text-[10px] text-on-surface-variant flex justify-between border-t border-surface-container-high/60 pt-1.5">
          <span>
            #{active + 1} {series[active].matchDate} vs {series[active].opponent ?? "?"}
          </span>
          <span>
            este partido <span className="text-secondary">{series[active].modelError.toFixed(2)}</span> · acumulado{" "}
            <span className="text-primary">{series[active].cumModel.toFixed(2)}</span>
          </span>
        </div>
      )}

      <div className="grid grid-cols-4 gap-1 font-mono text-[9px] mt-2">
        <span className="flex items-center gap-1 text-primary">
          <span className="w-3 h-0.5 bg-primary inline-block" /> modelo
        </span>
        <span className="flex items-center gap-1 text-on-surface-variant">
          <span className="w-3 h-0.5 border-t border-dashed border-slate-400 inline-block" /> ingenuo
        </span>
        <span className="flex items-center gap-1 text-on-surface-variant">
          <span className="w-2 h-2 rounded-full bg-cyan-500/60 inline-block" /> 1 partido
        </span>
        <span className="flex items-center gap-1 text-on-surface-variant">
          <span className="w-3 h-2 bg-slate-500/30 inline-block" /> ruido
        </span>
      </div>
    </div>
  );
}
