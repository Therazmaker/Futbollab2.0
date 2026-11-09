"use client";

import React, { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { PICK_MARKETS, pickLabel } from "../../convex/lib/picks";
import { competitionLabel } from "@/lib/competitions";
import { QuickResultSheet } from "./QuickResultSheet";

/* Colores de serie validados (dataviz validate_palette, modo oscuro sobre #181c24):
   IA azul / tú naranja — ΔE CVD 21, ΔE normal 27, contraste ≥ 3:1. */
const SERIES = { ai: { color: "#3987e5", label: "IA" }, user: { color: "#d95926", label: "Tú" } } as const;

const card = "bg-surface-container-low rounded-xl p-space-md border border-surface-container-high/60 shadow-md";
const pct = (x: number | null | undefined, d = 0) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(d)}%`);
const signed = (x: number, d = 2) => `${x >= 0 ? "+" : ""}${x.toFixed(d)}`;

/** "Histórico del Radar": tus predicciones y las de la IA, resueltas solas, con sus gráficos. */
export function RadarHistory({ competition }: { competition: string }) {
  const [source, setSource] = useState<"all" | "ai" | "user">("all");
  const data = useQuery(api.radarAi.getHistory, { competition, source });
  if (data === undefined) return <div className={`${card} font-mono text-xs text-on-surface-variant`}>Calculando…</div>;
  const s = data.summary;

  return (
    <div className="flex flex-col gap-3 font-mono text-[11px]">
      <div className="flex gap-1 self-start bg-surface-container rounded-lg p-0.5 border border-surface-container-highest">
        {(
          [
            ["all", "Todos"],
            ["ai", "🤖 IA"],
            ["user", "✋ Tú"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setSource(k)} className={`px-3 py-1 rounded ${source === k ? "bg-primary text-on-primary font-bold" : "text-on-surface-variant"}`}>
            {l}
          </button>
        ))}
      </div>

      {s.total === 0 ? (
        <div className={`${card} text-on-surface-variant flex flex-col gap-1`}>
          <p className="text-on-surface font-bold">Sin predicciones todavía.</p>
          <p>
            En cada tarjeta del Radar: <b className="text-on-surface">🧪 Predicciones</b> → pide la de la IA o apunta la tuya antes del partido. Aquí se
            resuelven solas cuando llega el marcador.
          </p>
        </div>
      ) : (
        <>
          {/* KPIs (como el Histórico del FutbolLab viejo) */}
          <div className="grid grid-cols-3 gap-1.5">
            <Kpi label="Total" value={String(s.total)} />
            <Kpi label="Acertados" value={String(s.won)} tone="good" />
            <Kpi label="Fallidos" value={String(s.n - s.won)} tone="bad" />
            <Kpi label="Pendientes" value={String(s.pending)} />
            <Kpi label="% acierto" value={pct(s.rate)} sub={s.expected !== null ? `Radar esperaba ${pct(s.expected)}` : undefined} />
            <Kpi label="ROI" value={s.roi === null ? "—" : `${s.roi >= 0 ? "+" : ""}${(s.roi * 100).toFixed(1)}%`} tone={s.roi === null ? undefined : s.roi >= 0 ? "good" : "bad"} sub={s.staked ? `${s.staked} con cuota` : "sin cuotas"} />
            <Kpi label="Beneficio" value={s.staked ? `${signed(s.profit)}u` : "—"} tone={s.profit >= 0 ? "good" : "bad"} />
            <Kpi label="Racha actual" value={s.streak.current ? `${s.streak.type === "won" ? "🔥" : "❌"} ${s.streak.current}` : "—"} />
            <Kpi label="Mejor racha" value={s.streak.best ? `🔥 ${s.streak.best}` : "—"} />
          </div>
          {s.n > 0 && s.n < 30 && (
            <p className="text-amber-300 text-[10px]">
              Con {s.n} resueltos el % de acierto tiene un margen de {pct(s.ci.low)}–{pct(s.ci.high)}: las rachas aún son sobre todo suerte.
            </p>
          )}
          {s.clv && (
            <p className="text-on-surface-variant">
              CLV de los picks 1X2 / doble oportunidad con cuota ({s.clv.n}):{" "}
              <b className={s.clv.mean >= 0 ? "text-primary" : "text-error"}>{signed(s.clv.mean * 100, 1)}%</b> · le ganan al cierre {pct(s.clv.beat)}
            </p>
          )}

          <ProfitCurve curve={s.curve} source={source} />
          <Breakdowns s={s} />
          {s.calibration.some((b: any) => b.n) && <Calibration rows={s.calibration} />}
        </>
      )}

      {data.previewSignals.length > 0 && <PreviewSignals rows={data.previewSignals} previews={data.previews} />}

      {data.rows.length > 0 && <PickList rows={data.rows} />}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="bg-surface-container rounded-lg py-2 px-1 text-center">
      <div className={`text-base font-bold ${tone === "good" ? "text-primary" : tone === "bad" ? "text-error" : "text-on-surface"}`}>{value}</div>
      <div className="text-[9px] text-on-surface-variant uppercase">{label}</div>
      {sub && <div className="text-[9px] text-on-surface-variant">{sub}</div>}
    </div>
  );
}

/** Beneficio acumulado (unidades) por fecha, IA y tú. Línea fina, cero marcado, tooltip al pasar. */
export function ProfitCurve({ curve, source }: { curve: Array<{ date: string; ai: number; user: number }>; source: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = (source === "all" ? (["ai", "user"] as const) : ([source] as Array<"ai" | "user">)).filter((k) =>
    curve.some((p) => p[k] !== 0)
  );
  if (curve.length < 2 || !series.length) {
    return (
      <div className={`${card} text-on-surface-variant`}>
        <p className="text-on-surface font-bold mb-0.5">Beneficio acumulado</p>
        La curva aparece con al menos 2 jornadas de picks con cuota (el 1X2 usa tu cuota del Radar; en otros mercados pon la cuota al apuntarlo).
      </div>
    );
  }
  const W = 320, H = 150, L = 30, R = 60, T = 10, B = 22;
  const vals = curve.flatMap((p) => series.map((k) => p[k]));
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const pad = (hi - lo) * 0.1 || 1;
  const y = (v: number) => T + ((hi + pad - v) / (hi - lo + 2 * pad)) * (H - T - B);
  const x = (i: number) => L + (i / (curve.length - 1)) * (W - L - R);
  const path = (k: "ai" | "user") => curve.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
  const ticks = [lo, 0, hi].filter((v, i, a) => a.indexOf(v) === i);
  const onMove = (e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) => {
    const svg = e.currentTarget.getBoundingClientRect();
    const cx = "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const rel = ((cx - svg.left) / svg.width) * W;
    setHover(Math.max(0, Math.min(curve.length - 1, Math.round(((rel - L) / (W - L - R)) * (curve.length - 1)))));
  };
  const h = hover !== null ? curve[hover] : null;

  return (
    <div className={card}>
      <div className="flex flex-wrap justify-between items-baseline gap-x-3 mb-1">
        <p className="text-on-surface font-bold">Beneficio acumulado (unidades)</p>
        <div className="flex gap-3 text-[10px] text-on-surface-variant shrink-0">
          {series.map((k) => (
            <span key={k} className="flex items-center gap-1">
              <span className="inline-block w-3 h-[2px] rounded" style={{ background: SERIES[k].color }} />
              {SERIES[k].label}
            </span>
          ))}
        </div>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto touch-none" onMouseMove={onMove} onTouchMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Beneficio acumulado por fecha">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#5b6170" : "#2a2f3a"} strokeWidth={1} strokeDasharray={v === 0 ? "" : "2 3"} />
              <text x={L - 4} y={y(v) + 3} textAnchor="end" fontSize="8" fill="#9aa3b2">
                {v.toFixed(1)}
              </text>
            </g>
          ))}
          <text x={L} y={H - 6} fontSize="8" fill="#9aa3b2">
            {curve[0].date.slice(5)}
          </text>
          <text x={W - R} y={H - 6} fontSize="8" fill="#9aa3b2" textAnchor="end">
            {curve[curve.length - 1].date.slice(5)}
          </text>
          {series.map((k) => (
            <g key={k}>
              <path d={path(k)} fill="none" stroke={SERIES[k].color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {/* Etiqueta directa al final de la línea */}
              <text x={x(curve.length - 1) + 4} y={y(curve[curve.length - 1][k]) + 3} fontSize="8" fill="#e1e6ef">
                {SERIES[k].label} {signed(curve[curve.length - 1][k], 1)}
              </text>
            </g>
          ))}
          {hover !== null && (
            <>
              <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="#5b6170" strokeWidth={1} />
              {series.map((k) => (
                <circle key={k} cx={x(hover)} cy={y(curve[hover][k])} r={4} fill={SERIES[k].color} stroke="#181c24" strokeWidth={2} />
              ))}
            </>
          )}
        </svg>
        {h && (
          <div className="absolute top-0 right-0 bg-surface-container-highest border border-surface-container-high rounded px-2 py-1 text-[10px] pointer-events-none">
            <div className="text-on-surface-variant">{h.date}</div>
            {series.map((k) => (
              <div key={k} className="text-on-surface">
                {SERIES[k].label}: {signed(h[k])}u
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Barras de acierto por mercado / liga / pick / fuente, con la marca de lo que el Radar esperaba. */
export function Breakdowns({ s }: { s: any }) {
  const [by, setBy] = useState<"byMarket" | "byCompetition" | "byPick" | "bySource">("byMarket");
  const label = (key: string) => {
    if (by === "byMarket") return (PICK_MARKETS as any)[key]?.label ?? key;
    if (by === "byCompetition") return competitionLabel(key) || key;
    if (by === "bySource") return key === "ai" ? "🤖 IA" : "✋ Tú";
    const [m, p] = key.split(":");
    return pickLabel(m, p, "Local", "Visitante");
  };
  const rows = (s[by] as any[]).slice(0, 10);
  return (
    <div className={card}>
      <div className="flex justify-between items-center mb-2 gap-2 flex-wrap">
        <p className="text-on-surface font-bold">% de acierto</p>
        <div className="flex gap-1 text-[10px]">
          {(
            [
              ["byMarket", "Mercado"],
              ["byCompetition", "Liga"],
              ["byPick", "Pick"],
              ["bySource", "IA / tú"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} onClick={() => setBy(k)} className={`px-2 py-0.5 rounded ${by === k ? "bg-secondary text-on-secondary font-bold" : "bg-surface-container text-on-surface-variant"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.key} title={`${label(r.key)}: ${r.won}/${r.n} (${pct(r.rate)}); 90 %: ${pct(r.ci.low)}–${pct(r.ci.high)}${r.expected !== null ? `; Radar esperaba ${pct(r.expected)}` : ""}`}>
            <div className="flex justify-between text-[10px]">
              <span className="text-on-surface-variant truncate">{label(r.key)}</span>
              <span className="text-on-surface">
                {pct(r.rate)} ({r.won}/{r.n}){r.expected !== null ? <span className="text-on-surface-variant"> · Radar {pct(r.expected)}</span> : null}
                {r.roi !== null ? <span className={r.roi >= 0 ? "text-primary" : "text-error"}> · ROI {signed(r.roi * 100, 0)}%</span> : null}
              </span>
            </div>
            <div className="relative h-2 mt-0.5 rounded bg-surface-container">
              <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.max(2, (r.rate ?? 0) * 100)}%`, background: SERIES.ai.color }} />
              {r.expected !== null && <div className="absolute -top-0.5 -bottom-0.5 w-[2px] bg-on-surface rounded" style={{ left: `calc(${r.expected * 100}% - 1px)` }} />}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[9px] text-on-surface-variant mt-2">
        La barra es el % de acierto; la raya blanca, lo que el Radar esperaba para esos mismos picks. Barra más allá de la raya = acertando más de lo
        previsto (con muestra pequeña, puede ser suerte: pasa el dedo para ver el margen).
      </p>
    </div>
  );
}

function Calibration({ rows }: { rows: any[] }) {
  return (
    <div className={card}>
      <p className="text-on-surface font-bold mb-1">Calibración de la confianza</p>
      <table className="w-full text-[10px]">
        <thead>
          <tr className="text-on-surface-variant">
            <th className="text-left font-normal">Confianza dicha</th>
            <th className="text-right font-normal">n</th>
            <th className="text-right font-normal">Media</th>
            <th className="text-right font-normal">Salió</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .filter((b) => b.n)
            .map((b) => (
              <tr key={b.range} className="border-t border-surface-container-high/40">
                <td className="py-0.5 text-on-surface-variant">{b.range}</td>
                <td className="text-right text-on-surface">{b.n}</td>
                <td className="text-right text-on-surface">{pct(b.confidence)}</td>
                <td className={`text-right font-bold ${Math.abs((b.observed ?? 0) - (b.confidence ?? 0)) <= 0.08 ? "text-primary" : "text-amber-300"}`}>{pct(b.observed)}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <p className="text-[9px] text-on-surface-variant mt-1">Si la IA (o tú) dice 70 %, debería salir ~7 de cada 10. Muy por debajo = se pasa de confiada.</p>
    </div>
  );
}

/** Qué dice cada señal de la previa y qué cuenta como acierto. */
const SIGNAL_INFO: Record<string, { says: string; event: string; icon: string }> = {
  draw_high: { says: "La previa pinta un partido cerrado, de empate", event: "acabó en empate", icon: "🤝" },
  upset_high: { says: "La previa ve motivos para una sorpresa", event: "el no favorito no perdió", icon: "⚡" },
  narr_home: { says: "El relato de la previa favorece al local", event: "ganó el local", icon: "🏠" },
  narr_away: { says: "El relato de la previa favorece al visitante", event: "ganó el visitante", icon: "✈️" },
  emotional_high: { says: "La previa habla de mucha tensión (derbi, presión, crisis…)", event: "hubo más de 2,5 goles", icon: "🔥" },
};
const MIN_SAMPLE = 30;

function signalVerdict(r: any): { text: string; cls: string } {
  if (!r.nActive) return { text: "Aún no ha salido en ninguna previa.", cls: "text-on-surface-variant" };
  if (r.nActive < 10) return { text: `Con ${r.nActive} ${r.nActive === 1 ? "partido" : "partidos"} todavía no dice nada: es pura suerte.`, cls: "text-on-surface-variant" };
  if (r.marketActive === null) return { text: "Sin cuotas para comparar con el mercado.", cls: "text-on-surface-variant" };
  if (r.ciActive.low > r.marketActive) return { text: "Va por encima de lo que espera el mercado: señal prometedora.", cls: "text-primary" };
  if (r.ciActive.high < r.marketActive) return { text: "Sale menos de lo que espera el mercado: esta señal engaña.", cls: "text-error" };
  return {
    text: r.nActive < MIN_SAMPLE ? "Por ahora parecido al mercado; faltan partidos para decidir." : "Igual que el mercado: el mercado ya lo ve.",
    cls: "text-on-surface-variant",
  };
}

export function PreviewSignals({ rows, previews }: { rows: any[]; previews: number }) {
  const sorted = [...rows].sort((a, b) => b.nActive - a.nActive);
  const ready = sorted.filter((r) => r.nActive >= MIN_SAMPLE).length;
  return (
    <div className={`${card} flex flex-col gap-3`}>
      <div>
        <p className="text-on-surface font-bold text-sm font-sans">🔬 ¿Acierta la previa?</p>
        <p className="text-[10px] text-on-surface-variant mt-0.5 leading-snug">
          Cada vez que pegas una previa, la IA marca señales (empate, sorpresa, a quién favorece el relato…). Aquí se mira si, cuando la previa lo
          dice, pasa <b className="text-on-surface">más de lo que ya esperaba el mercado</b>. Si pasa lo mismo, la previa no te dice nada que las
          cuotas no supieran.
        </p>
        <p className="text-[10px] text-on-surface mt-1">
          {previews} {previews === 1 ? "previa guardada" : "previas guardadas"} ·{" "}
          {ready ? `${ready} señal${ready === 1 ? "" : "es"} con muestra suficiente` : `hacen falta ~${MIN_SAMPLE} partidos por señal para fiarse`}
        </p>
      </div>
      {sorted.map((r) => {
        const info = SIGNAL_INFO[r.key] ?? { says: r.label, event: "pasó", icon: "•" };
        const v = signalVerdict(r);
        const hits = r.rateActive !== null ? Math.round(r.rateActive * r.nActive) : 0;
        return (
          <div key={r.key} className="flex flex-col gap-1 border-t border-surface-container-high/50 pt-2">
            <p className="text-on-surface text-[12px] font-sans leading-snug">
              {info.icon} {info.says}
            </p>
            {r.nActive ? (
              <>
                <p className="text-[10px] text-on-surface-variant">
                  ¿{info.event.charAt(0).toUpperCase() + info.event.slice(1)}? <b className="text-on-surface">{hits} de {r.nActive}</b> ({pct(r.rateActive)})
                  {r.marketActive !== null ? (
                    <>
                      {" "}
                      · el mercado esperaba <b className="text-on-surface">{pct(r.marketActive)}</b>
                    </>
                  ) : null}
                </p>
                {/* Barra: lo que pasó; raya blanca: lo que esperaba el mercado */}
                <div className="relative h-2 rounded bg-surface-container" title={`Margen 90 %: ${pct(r.ciActive.low)}–${pct(r.ciActive.high)}`}>
                  <div className="absolute inset-y-0 rounded bg-surface-container-highest" style={{ left: `${r.ciActive.low * 100}%`, width: `${(r.ciActive.high - r.ciActive.low) * 100}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.max(2, (r.rateActive ?? 0) * 100)}%`, background: SERIES.ai.color }} />
                  {r.marketActive !== null && (
                    <div className="absolute -top-0.5 -bottom-0.5 w-[2px] bg-on-surface rounded" style={{ left: `calc(${r.marketActive * 100}% - 1px)` }} />
                  )}
                </div>
              </>
            ) : null}
            <p className={`text-[10px] leading-snug ${v.cls}`}>{v.text}</p>
            <div className="flex items-center gap-2 text-[9px] text-on-surface-variant">
              <div className="flex-1 h-1 rounded bg-surface-container overflow-hidden">
                <div className="h-full bg-secondary/60" style={{ width: `${Math.min(100, (r.nActive / MIN_SAMPLE) * 100)}%` }} />
              </div>
              <span>
                {Math.min(r.nActive, MIN_SAMPLE)}/{MIN_SAMPLE} para fiarse
              </span>
            </div>
            {r.nRest >= 5 && (
              <p className="text-[9px] text-on-surface-variant">
                En las previas que no lo decían: {info.event} {pct(r.rateRest)} de {r.nRest}.
              </p>
            )}
          </div>
        );
      })}
      <p className="text-[9px] text-on-surface-variant leading-snug">
        Barra azul = cuántas veces pasó · zona gris = margen de error · raya blanca = lo que esperaba el mercado. Una señal vale la pena cuando la
        barra (y su margen) queda claramente a la derecha de la raya.
      </p>
    </div>
  );
}

/** Pendiente solo porque falta el marcador al descanso (mercado de 1ª parte en un partido ya jugado). */
const needsHalfTime = (r: any) => r.verdict === null && r.score && !r.score.includes("(") && (r.market === "htGoalless" || r.market === "htResult");

function PickList({ rows }: { rows: any[] }) {
  const [all, setAll] = useState(false);
  const [ht, setHt] = useState<any | null>(null);
  // Primero los que solo esperan el descanso, para resolverlos rápido
  const ordered = useMemo(() => [...rows.filter(needsHalfTime), ...rows.filter((r) => !needsHalfTime(r))], [rows]);
  const shown = useMemo(() => (all ? ordered : ordered.slice(0, 15)), [ordered, all]);
  const waiting = new Set(rows.filter(needsHalfTime).map((r) => r.matchId)).size;
  const openHt = (r: any) => {
    const [h, a] = String(r.score).split("-").map((x: string) => Number(x));
    setHt({ _id: r.matchId, home: { name: r.home }, away: { name: r.away }, result: { home: h, away: a }, halfTime: null });
  };
  return (
    <div className={card}>
      {ht && <QuickResultSheet match={ht} onClose={() => setHt(null)} />}
      <p className="text-on-surface font-bold mb-1">Predicciones</p>
      {waiting > 0 && (
        <p className="text-[10px] text-amber-300 mb-1">
          {waiting} {waiting === 1 ? "partido espera" : "partidos esperan"} solo el marcador al descanso para resolver sus pronósticos de 1ª parte: pulsa «⏱ Poner descanso».
        </p>
      )}
      {shown.map((r) => (
        <div key={r.id} className="flex items-center gap-2 border-b border-surface-container-high/40 py-1 text-[10px]">
          <span className="w-4">{r.source === "ai" ? "🤖" : "✋"}</span>
          <div className="flex-1 min-w-0">
            <div className="text-on-surface truncate">
              {r.home} – {r.away} {r.score ? <span className="text-on-surface-variant">· {r.score}</span> : null}
            </div>
            <div className="text-on-surface-variant leading-snug">
              {r.date} · {r.label}
              {r.odds ? ` @${r.odds}` : ""}
              {r.confidence !== null ? (
                <>
                  {" · "}
                  <span className="text-on-surface">
                    {r.source === "ai" ? "IA" : "tu confianza"} {pct(r.confidence)}
                  </span>
                </>
              ) : null}
              {r.systemProb !== null ? ` · Radar ${pct(r.systemProb)}` : ""}
            </div>
          </div>
          {needsHalfTime(r) ? (
            <button onClick={() => openHt(r)} className="shrink-0 px-2 h-6 rounded bg-amber-900/40 text-amber-300 border border-amber-700/40">
              ⏱ Poner descanso
            </button>
          ) : (
            <span className={r.verdict === "won" ? "text-primary" : r.verdict === "lost" ? "text-error" : "text-on-surface-variant"}>
              {r.verdict === "won" ? "✓" : r.verdict === "lost" ? "✗" : "…"}
            </span>
          )}
        </div>
      ))}
      {rows.length > 15 && (
        <button onClick={() => setAll(!all)} className="mt-1 text-secondary text-[10px]">
          {all ? "Ver menos" : `Ver las ${rows.length}`}
        </button>
      )}
    </div>
  );
}
