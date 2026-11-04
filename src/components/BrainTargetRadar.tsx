"use client";

import React, { useState } from "react";

export interface PredictionMetricPoint {
  id: string;
  name: string; // e.g. "Tiros", "xG", "Pases Clave", "Duelos"
  predicted: number;
  actual: number;
  matchIndex: number;
  categoryAngle: number; // degrees: Tiros 45°, xG 135°, Pases 225°, Duelos 315°
}

export interface PlottedMetricPoint extends PredictionMetricPoint {
  x: number;
  y: number;
  r: number;
  errorRatio: number;
  color: string;
  glow: string;
  deltaPct: number;
}

export interface BrainTargetRadarProps {
  metrics: PredictionMetricPoint[];
  selectedMatchLabel?: string;
  width?: number;
  height?: number;
}

export function BrainTargetRadar({
  metrics,
  selectedMatchLabel = "Convergencia del Modelo (P1 → P2)",
  width = 340,
  height = 340,
}: BrainTargetRadarProps) {
  const [activeTooltip, setActiveTooltip] = useState<PlottedMetricPoint | null>(null);

  const size = width;
  const center = size / 2;
  const maxRadius = center - 28;

  // Calculate coordinates for each metric
  const plottedPoints = metrics.map((m) => {
    // Relative error ratio: |actual - predicted| / max(actual, 1)
    const errorRatio = Math.min(1.0, Math.abs(m.actual - m.predicted) / Math.max(m.actual, 1));
    const r = errorRatio * maxRadius;

    // Directional bias: clockwise (+10°) if over-predicted, counterclockwise (-10°) if under-predicted
    let adjustedAngle = m.categoryAngle;
    if (m.predicted > m.actual) {
      adjustedAngle += 10;
    } else if (m.predicted < m.actual) {
      adjustedAngle -= 10;
    }

    const rad = (adjustedAngle * Math.PI) / 180;
    const x = center + r * Math.cos(rad);
    const y = center + r * Math.sin(rad);

    // Color bracket according to error ratio
    let color = "#10B981"; // Emerald (< 25% error)
    let glow = "rgba(16, 185, 129, 0.5)";
    if (errorRatio >= 0.5) {
      color = "#EF4444"; // Red (> 50% error)
      glow = "rgba(239, 68, 68, 0.5)";
    } else if (errorRatio >= 0.25) {
      color = "#06B6D4"; // Cyan (25-50% error)
      glow = "rgba(6, 182, 212, 0.5)";
    }

    const deltaPct = ((m.actual - m.predicted) / Math.max(m.predicted, 1)) * 100;

    return {
      ...m,
      x,
      y,
      r,
      errorRatio,
      color,
      glow,
      deltaPct,
    };
  });

  // Polyline polygon connecting the metrics in category order
  const polygonPoints = plottedPoints
    .sort((a, b) => a.categoryAngle - b.categoryAngle)
    .map((p) => `${p.x},${p.y}`)
    .join(" ");

  // Category labels positioned outside maxRadius
  const categoryLabels = [
    { label: "Tiros / 90", angle: 45 },
    { label: "xG Gen", angle: 135 },
    { label: "Pases Clave", angle: 225 },
    { label: "Duelos", angle: 315 },
  ];

  return (
    <div className="flex flex-col items-center bg-surface-container-low rounded-xl p-space-md border border-surface-container-high/60 relative overflow-hidden shadow-lg w-full">
      {/* HUD Header */}
      <div className="flex items-center justify-between w-full mb-2">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[18px] text-primary animate-pulse">
            radar
          </span>
          <span className="font-mono text-xs font-bold text-on-surface uppercase tracking-wider">
            Brain Convergence Radar
          </span>
        </div>
        <span className="font-mono text-[10px] text-secondary bg-secondary/10 px-2 py-0.5 rounded border border-secondary/20">
          {selectedMatchLabel}
        </span>
      </div>

      <p className="font-mono text-[10px] text-on-surface-variant w-full mb-2">
        El centro (<code className="text-primary font-bold">r = 0</code>) representa error cero (proyección perfecta). Los puntos convergen al centro a medida que el modelo calibra.
      </p>

      {/* SVG Bullseye Polar Radar */}
      <div className="relative flex items-center justify-center my-1">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="select-none overflow-visible"
        >
          <defs>
            <radialGradient id="radarGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#10B981" stopOpacity="0.18" />
              <stop offset="50%" stopColor="#06B6D4" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#0F172A" stopOpacity="0" />
            </radialGradient>
            <filter id="pointGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background circular ambient gradient */}
          <circle cx={center} cy={center} r={maxRadius} fill="url(#radarGlow)" />

          {/* Crosshair Axes */}
          <line
            x1={center - maxRadius}
            y1={center}
            x2={center + maxRadius}
            y2={center}
            stroke="#1E293B"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          <line
            x1={center}
            y1={center - maxRadius}
            x2={center}
            y2={center + maxRadius}
            stroke="#1E293B"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          {/* Diagonal axes */}
          <line
            x1={center - maxRadius * 0.707}
            y1={center - maxRadius * 0.707}
            x2={center + maxRadius * 0.707}
            y2={center + maxRadius * 0.707}
            stroke="#1E293B"
            strokeWidth="1"
            strokeDasharray="2 4"
          />
          <line
            x1={center - maxRadius * 0.707}
            y1={center + maxRadius * 0.707}
            x2={center + maxRadius * 0.707}
            y2={center - maxRadius * 0.707}
            stroke="#1E293B"
            strokeWidth="1"
            strokeDasharray="2 4"
          />

          {/* Ring 4: >75% error (Outer dashed) */}
          <circle
            cx={center}
            cy={center}
            r={maxRadius}
            fill="none"
            stroke="#EF4444"
            strokeOpacity="0.3"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />

          {/* Ring 3: ±50% error */}
          <circle
            cx={center}
            cy={center}
            r={maxRadius * 0.75}
            fill="none"
            stroke="#F59E0B"
            strokeOpacity="0.35"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />

          {/* Ring 2: ±25% error */}
          <circle
            cx={center}
            cy={center}
            r={maxRadius * 0.5}
            fill="none"
            stroke="#06B6D4"
            strokeOpacity="0.45"
            strokeWidth="1.5"
          />

          {/* Ring 1: Bullseye Core ±10% error (Emerald glow) */}
          <circle
            cx={center}
            cy={center}
            r={maxRadius * 0.25}
            fill="rgba(16, 185, 129, 0.08)"
            stroke="#10B981"
            strokeOpacity="0.75"
            strokeWidth="2"
          />

          {/* Absolute Center Dot */}
          <circle cx={center} cy={center} r={3} fill="#10B981" />
          <circle cx={center} cy={center} r={6} fill="none" stroke="#10B981" strokeOpacity="0.5" />

          {/* Category Section Labels */}
          {categoryLabels.map((cat, idx) => {
            const rad = (cat.angle * Math.PI) / 180;
            const lx = center + (maxRadius + 16) * Math.cos(rad);
            const ly = center + (maxRadius + 16) * Math.sin(rad);
            return (
              <text
                key={idx}
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-on-surface-variant font-mono text-[9px] font-bold"
              >
                {cat.label}
              </text>
            );
          })}

          {/* Vector footprint polygon connecting the metric error nodes */}
          {polygonPoints && (
            <polygon
              points={polygonPoints}
              fill="rgba(6, 182, 212, 0.12)"
              stroke="#06B6D4"
              strokeWidth="1.5"
              strokeDasharray="3 2"
              className="transition-all duration-700"
            />
          )}

          {/* Interactive Metric Points */}
          {plottedPoints.map((point) => {
            const isHovered = activeTooltip?.id === point.id;
            return (
              <g
                key={point.id}
                className="cursor-pointer transition-all duration-500"
                onMouseEnter={() => setActiveTooltip(point)}
                onMouseLeave={() => setActiveTooltip(null)}
                onClick={() => setActiveTooltip(activeTooltip?.id === point.id ? null : point)}
              >
                {/* Glowing halo */}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={isHovered ? 12 : 8}
                  fill={point.glow}
                  filter="url(#pointGlow)"
                  className="animate-pulse"
                />

                {/* Core Point */}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={isHovered ? 6 : 4.5}
                  fill={point.color}
                  stroke="#0F172A"
                  strokeWidth="2"
                />

                {/* Metric Abbreviation label next to node */}
                <text
                  x={point.x}
                  y={point.y - 9}
                  textAnchor="middle"
                  className="fill-on-surface font-mono text-[8px] font-bold pointer-events-none drop-shadow-md"
                >
                  {point.name}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Hover / Click Tooltip Overlay */}
        {activeTooltip && (
          <div className="absolute top-2 inset-x-4 bg-surface/95 backdrop-blur-md border border-primary/50 rounded-xl p-2.5 shadow-2xl flex items-center justify-between text-xs font-mono animate-fadeIn z-30">
            <div>
              <p className="font-bold text-on-surface flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{
                    backgroundColor:
                      activeTooltip.errorRatio < 0.25
                        ? "#10B981"
                        : activeTooltip.errorRatio < 0.5
                        ? "#06B6D4"
                        : "#EF4444",
                  }}
                />
                <span>{activeTooltip.name}</span>
              </p>
              <p className="text-[10px] text-on-surface-variant">
                Predicho: <span className="text-secondary font-bold">{activeTooltip.predicted}</span> | Real:{" "}
                <span className="text-primary font-bold">{activeTooltip.actual}</span>
              </p>
            </div>

            <div className="flex flex-col items-end">
              <span
                className={`font-bold text-xs ${
                  activeTooltip.errorRatio < 0.25
                    ? "text-primary"
                    : activeTooltip.errorRatio < 0.5
                    ? "text-secondary"
                    : "text-tertiary"
                }`}
              >
                {activeTooltip.deltaPct >= 0
                  ? `+${activeTooltip.deltaPct.toFixed(1)}%`
                  : `${activeTooltip.deltaPct.toFixed(1)}%`}
              </span>
              <span className="text-[9px] text-on-surface-variant">
                Error: {(activeTooltip.errorRatio * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Compact Legend at the Bottom */}
      <div className="grid grid-cols-4 gap-1.5 w-full pt-2 border-t border-surface-container-high/60 mt-1 font-mono text-[9px] text-center">
        <div className="flex items-center justify-center gap-1 bg-surface-container px-1 py-0.5 rounded border border-primary/30">
          <span className="w-2 h-2 rounded-full bg-primary" />
          <span className="text-primary font-bold">±10% Core</span>
        </div>
        <div className="flex items-center justify-center gap-1 bg-surface-container px-1 py-0.5 rounded border border-secondary/30">
          <span className="w-2 h-2 rounded-full bg-secondary" />
          <span className="text-secondary">±25% Ok</span>
        </div>
        <div className="flex items-center justify-center gap-1 bg-surface-container px-1 py-0.5 rounded border border-amber-500/30">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span className="text-amber-400">±50% Drift</span>
        </div>
        <div className="flex items-center justify-center gap-1 bg-surface-container px-1 py-0.5 rounded border border-rose-500/30">
          <span className="w-2 h-2 rounded-full bg-rose-500" />
          <span className="text-rose-400">&gt;75% Bias</span>
        </div>
      </div>
    </div>
  );
}
