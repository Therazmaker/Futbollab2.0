"use client";

import React, { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { HScroll } from "./HScroll";

/**
 * Anatomía de la temporada: por qué un equipo gana o pierde.
 * Puntos reales vs esperados (mercado) vs merecidos (xG), su Elo partido a partido
 * y un grafo que une cada partido con las causas que lo explican.
 */

const card = "bg-surface-container-low rounded-xl p-space-md border border-surface-container-high/60 shadow-md";
// Polaridad (validada para daltonismo sobre #181c24): azul suma, naranja resta
const POS = "#3987e5";
const NEG = "#d95926";
const INK = "#dfe2ee";
const INK2 = "#bbcabf";
const GRAY = "#7d8590";
const GRID = "#262a33";
const RES: Record<string, { fill: string; letter: string }> = {
  W: { fill: "#4edea3", letter: "G" },
  D: { fill: "#4cd7f6", letter: "E" },
  L: { fill: "#ffb4ab", letter: "P" },
};
const SHORT: Record<string, string> = {
  outplayed: "Jugó mejor",
  underplayed: "Jugó peor",
  clinical: "Pegada",
  wasteful: "Falló ocasiones",
  keeper: "Portería",
  oppClinical: "Rival certero",
  vsBig: "vs grandes",
  vsMid: "vs medios",
  vsWeak: "vs débiles",
  tired: "Cansancio",
  ownRed: "Con 10",
  oppRed: "Rival con 10",
  absences: "Bajas",
  comeback: "Remontó",
  collapse: "Le remontaron",
  injuryInGame: "Lesión",
};

/** Punto de color + número con signo (el color nunca va solo) */
function Signed({ v, suffix = "" }: { v: number; suffix?: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-bold text-on-surface shrink-0">
      {Math.abs(v) >= 0.5 && <span className="w-2 h-2 rounded-full inline-block" style={{ background: v >= 0 ? POS : NEG }} />}
      {sg(v)}
      {suffix}
    </span>
  );
}

const f1 = (x: number) => x.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const sg = (x: number) => `${x >= 0 ? "+" : "−"}${f1(Math.abs(x))}`;
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const short3 = (s: string) => s.replace(/^(Real|FC|CF|AC|AS|SS|SC|RC|CD|UD|RCD|Club|Atlético de|Athletic|1\. FC|VfL|VfB|TSG|SV)\s+/i, "").slice(0, 3).toUpperCase();

type Sel = { kind: "cause"; key: string } | { kind: "match"; id: string } | null;

export function SeasonStory({ teamId, onOpenMatch }: { teamId: Id<"teams">; onOpenMatch?: (id: Id<"matches">) => void }) {
  const [season, setSeason] = useState<string | undefined>(undefined);
  const data = useQuery(api.story.getSeasonStory, { teamId, season });
  const [sel, setSel] = useState<Sel>(null);
  const [open, setOpen] = useState(true);
  const [showMethod, setShowMethod] = useState(false);

  if (data === undefined) return <div className={`${card} font-mono text-[11px] text-on-surface-variant`}>🧬 Analizando la temporada…</div>;
  if (data === null) return null;
  if (!data.available) return <div className={`${card} font-mono text-[11px] text-on-surface-variant`}>🧬 {data.reason}</div>;
  const s = data.story;

  return (
    <div className={`${card} flex flex-col gap-3`}>
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => setOpen(!open)} className="font-mono text-xs uppercase text-primary font-bold flex items-center gap-1.5 text-left">
          🧬 Anatomía de la temporada <span className="text-on-surface-variant">{open ? "▾" : "▸"}</span>
        </button>
        {data.seasons.length > 1 && (
          <div className="flex gap-1 shrink-0">
            {data.seasons.slice(0, 3).map((x) => (
              <button
                key={x}
                onClick={() => {
                  setSeason(x);
                  setSel(null);
                }}
                className={`px-2 h-6 rounded-md font-mono text-[10px] whitespace-nowrap ${x === s.season ? "bg-primary text-on-primary font-bold" : "bg-surface-container text-on-surface-variant"}`}
              >
                {x}
              </button>
            ))}
          </div>
        )}
      </div>

      {open && (
        <>
          {s.played === 0 ? (
            <p className="font-mono text-[11px] text-on-surface-variant">{s.summary[0]}</p>
          ) : (
            <>
              <Kpis s={s} />
              <div className="flex flex-col gap-1.5 text-[12px] leading-snug text-on-surface">
                {s.summary.map((l: string, i: number) => (
                  <p key={i} className={i === 1 ? "font-bold" : ""}>
                    {l}
                  </p>
                ))}
              </div>
              <PointsChart s={s} sel={sel} setSel={setSel} />
              <EloChart s={s} sel={sel} setSel={setSel} />
              <CauseGraph s={s} sel={sel} setSel={setSel} />
              <Detail s={s} sel={sel} setSel={setSel} onOpenMatch={onOpenMatch} />
              <Splits s={s} />
              {s.keyMatches.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase text-secondary font-bold">Los partidos que más movieron su temporada</span>
                  {s.keyMatches.map((k: string, i: number) => (
                    <p key={i} className="font-mono text-[10px] text-on-surface-variant leading-snug">
                      {i + 1}. {k}
                    </p>
                  ))}
                </div>
              )}
              <button onClick={() => setShowMethod(!showMethod)} className="self-start font-mono text-[10px] text-secondary">
                {showMethod ? "▾" : "▸"} ¿Cómo se calcula?
              </button>
              {showMethod && (
                <div className="font-mono text-[10px] text-on-surface-variant leading-snug flex flex-col gap-1">
                  <p>
                    <b className="text-on-surface">Esperado</b>: los puntos que le daba el mercado antes de cada partido (cuotas de cierre sin margen: 3 × P(gana) +
                    P(empata)). Ya tiene en cuenta al rival, la localía y las bajas conocidas: perder con un grande fuera cuesta poco; perder en casa con el
                    colista cuesta mucho. Sin cuotas, se estima con el Elo.
                  </p>
                  <p>
                    <b className="text-on-surface">Merecido</b>: los puntos que valían sus ocasiones y las del rival (xG; si no hay, estimado con los tiros).
                  </p>
                  <p>
                    <b className="text-on-surface">Real − esperado = rendimiento + suerte</b>. Rendimiento = merecido − esperado (jugó mejor o peor de lo
                    previsto). Suerte = real − merecido, repartida entre su definición (goles − xG) y lo que encajó frente a lo que concedió.
                  </p>
                  <p>
                    <b className="text-on-surface">Contextos</b> (grandes/débiles, cansancio, rojas, bajas…): real − esperado en los partidos donde se dio. Un
                    rival es «grande» si está en el cuarto superior de la liga por Elo en ese momento, y «débil» si está en el 30 % inferior.
                  </p>
                  <p>
                    <b className="text-on-surface">Elo</b>: sube al ganar y baja al perder, más cuanto más fuerte es el rival y más amplio el marcador.
                  </p>
                  <p>Sirve para entender, no para predecir: el mercado ya sabe casi todo esto. Lo útil es ver cuándo la tabla engaña.</p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Kpis({ s }: { s: any }) {
  const tiles = [
    { label: "Puntos", value: String(s.points), sub: `${s.played} partidos` },
    { label: "Esperados", value: f1(s.expected), sub: "por el mercado" },
    { label: "Merecidos", value: s.deserved === null ? "—" : f1(s.deserved), sub: "por sus ocasiones" },
    { label: "Suerte", value: s.luck === null ? "—" : sg(s.luck), sub: s.luck === null ? "falta xG" : s.luck >= 0 ? "a favor" : "en contra" },
  ];
  return (
    <div className="grid grid-cols-4 gap-1.5 text-center font-mono">
      {tiles.map((t) => (
        <div key={t.label} className="bg-surface-container rounded-lg py-1.5 px-1">
          <p className="text-[9px] text-on-surface-variant uppercase">{t.label}</p>
          <p className="text-base font-bold text-on-surface">{t.value}</p>
          <p className="text-[8px] text-on-surface-variant leading-tight">{t.sub}</p>
        </div>
      ))}
    </div>
  );
}

/** Puntos acumulados: real vs merecido vs esperado. Toca para ver cada jornada. */
function PointsChart({ s, sel, setSel }: { s: any; sel: Sel; setSel: (x: Sel) => void }) {
  const W = 340;
  const H = 150;
  const P = { l: 26, r: 76, t: 10, b: 18 };
  const ms: any[] = s.matches;
  const cum = useMemo(() => {
    let r = 0;
    let e = 0;
    let d = 0;
    let dOk = true;
    const out = [{ r: 0, e: 0, d: 0 as number | null }];
    for (const m of ms) {
      r += m.points;
      e += m.expected;
      if (m.deserved === null) dOk = false;
      else d += m.deserved;
      out.push({ r, e, d: dOk ? d : null });
    }
    return out;
  }, [ms]);
  const max = Math.max(3, ...cum.map((c) => Math.max(c.r, c.e, c.d ?? 0)));
  const x = (i: number) => P.l + (i / Math.max(1, ms.length)) * (W - P.l - P.r);
  const y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b);
  const path = (k: "r" | "e" | "d") =>
    cum
      .map((c, i) => (c[k] === null ? null : `${x(i)},${y(c[k] as number)}`))
      .filter(Boolean)
      .map((p, i) => `${i ? "L" : "M"}${p}`)
      .join(" ");
  const selIdx = sel?.kind === "match" ? ms.findIndex((m) => m._id === sel.id) : -1;
  const last = cum[cum.length - 1];
  const ticks = [0, Math.round(max / 2), Math.round(max)];
  const lines = [
    { k: "r" as const, label: "Real", color: INK, dash: undefined, v: last.r },
    { k: "d" as const, label: "Merecido", color: POS, dash: "5 3", v: last.d },
    { k: "e" as const, label: "Esperado", color: GRAY, dash: "2 3", v: last.e },
  ].filter((l) => l.v !== null);
  // Etiquetas directas al final, separadas para que no se pisen
  const labelY = lines.map((l) => ({ ...l, y: y(l.v as number) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labelY.length; i++) if (labelY[i].y - labelY[i - 1].y < 11) labelY[i].y = labelY[i - 1].y + 11;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase text-secondary font-bold">Puntos acumulados</span>
        <div className="flex gap-2.5 font-mono text-[9px] text-on-surface-variant">
          {lines.map((l) => (
            <span key={l.k} className="flex items-center gap-1">
              <svg width="14" height="6">
                <line x1="0" y1="3" x2="14" y2="3" stroke={l.color} strokeWidth="2" strokeDasharray={l.dash} />
              </svg>
              {l.label}
            </span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" role="img" aria-label="Puntos acumulados reales, merecidos y esperados por jornada">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1" />
            <text x={P.l - 4} y={y(t) + 3} textAnchor="end" fontSize="8" fill={INK2} fontFamily="monospace">
              {t}
            </text>
          </g>
        ))}
        {selIdx >= 0 && <line x1={x(selIdx + 1)} x2={x(selIdx + 1)} y1={P.t} y2={H - P.b} stroke={INK2} strokeWidth="1" strokeDasharray="2 2" />}
        {lines.map((l) => (
          <path key={l.k} d={path(l.k)} fill="none" stroke={l.color} strokeWidth="2" strokeDasharray={l.dash} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {labelY.map((l) => (
          <text key={l.k} x={W - P.r + 4} y={l.y + 3} fontSize="8.5" fill={INK} fontFamily="monospace">
            {l.label} {l.k === "r" ? l.v : f1(l.v as number)}
          </text>
        ))}
        <text x={P.l} y={H - 4} fontSize="8" fill={INK2} fontFamily="monospace">
          inicio
        </text>
        <text x={W - P.r} y={H - 4} textAnchor="end" fontSize="8" fill={INK2} fontFamily="monospace">
          jornada {ms.length}
        </text>
        {ms.map((m, i) => (
          <rect
            key={m._id}
            x={x(i + 0.5)}
            y={P.t}
            width={x(1) - x(0)}
            height={H - P.t - P.b}
            fill="transparent"
            onMouseEnter={() => setSel({ kind: "match", id: m._id })}
            onClick={() => setSel({ kind: "match", id: m._id })}
          />
        ))}
      </svg>
      {selIdx >= 0 && (
        <p className="font-mono text-[10px] text-on-surface-variant">
          Tras la jornada {selIdx + 1} ({ddmm(ms[selIdx].date)} vs {ms[selIdx].opponent}): real {cum[selIdx + 1].r} · merecido{" "}
          {cum[selIdx + 1].d === null ? "—" : f1(cum[selIdx + 1].d!)} · esperado {f1(cum[selIdx + 1].e)}
        </p>
      )}
    </div>
  );
}

/** Elo partido a partido; cada punto es un partido (G/E/P). */
function EloChart({ s, sel, setSel }: { s: any; sel: Sel; setSel: (x: Sel) => void }) {
  const W = 340;
  const H = 120;
  const P = { l: 30, r: 12, t: 12, b: 16 };
  const ms: any[] = s.matches;
  const vals = [s.eloStart, ...ms.map((m) => m.eloAfter), 1500];
  const lo = Math.min(...vals) - 10;
  const hi = Math.max(...vals) + 10;
  const x = (i: number) => P.l + (i / Math.max(1, ms.length)) * (W - P.l - P.r);
  const y = (v: number) => H - P.b - ((v - lo) / (hi - lo)) * (H - P.t - P.b);
  const pts = [s.eloStart, ...ms.map((m) => m.eloAfter)];
  const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase text-secondary font-bold">
        Elo: {s.eloStart} → {s.eloNow}{" "}
        <span className="text-on-surface-variant normal-case font-normal">(1500 = equipo medio)</span>
      </span>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" role="img" aria-label="Evolución del Elo del equipo partido a partido">
        <line x1={P.l} x2={W - P.r} y1={y(1500)} y2={y(1500)} stroke={GRAY} strokeWidth="1" strokeDasharray="3 3" />
        <text x={P.l - 4} y={y(1500) + 3} textAnchor="end" fontSize="8" fill={INK2} fontFamily="monospace">
          1500
        </text>
        {[hi - 10, lo + 10]
          .filter((v) => Math.abs(y(v) - y(1500)) > 12)
          .map((v) => (
            <text key={v} x={P.l - 4} y={y(v) + 3} textAnchor="end" fontSize="8" fill={INK2} fontFamily="monospace">
              {Math.round(v)}
            </text>
          ))}
        <path d={d} fill="none" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        {ms.map((m, i) => {
          const on = sel?.kind === "match" && sel.id === m._id;
          return (
            <g key={m._id} onMouseEnter={() => setSel({ kind: "match", id: m._id })} onClick={() => setSel({ kind: "match", id: m._id })} className="cursor-pointer">
              <circle cx={x(i + 1)} cy={y(m.eloAfter)} r="10" fill="transparent" />
              <circle cx={x(i + 1)} cy={y(m.eloAfter)} r={on ? 5.5 : 4} fill={RES[m.result].fill} stroke="#181c24" strokeWidth="2" />
            </g>
          );
        })}
      </svg>
      {sel?.kind === "match" &&
        (() => {
          const m = ms.find((z) => z._id === sel.id);
          if (!m) return null;
          return (
            <p className="font-mono text-[10px] text-on-surface-variant">
              {ddmm(m.date)} {m.isHome ? "vs" : "en"} {m.opponent} {m.gf}-{m.ga}: Elo {m.eloBefore} → {m.eloAfter} ({m.eloAfter - m.eloBefore >= 0 ? "+" : ""}
              {m.eloAfter - m.eloBefore}) · Elo del rival {m.oppElo}
            </p>
          );
        })()}
    </div>
  );
}

/** Grafo: causas (arriba) unidas a los partidos (abajo) donde se dieron. */
function CauseGraph({ s, sel, setSel }: { s: any; sel: Sel; setSel: (x: Sel) => void }) {
  const ms: any[] = s.matches;
  const why = s.causes.filter((c: any) => c.group === "why");
  const when = s.causes.filter((c: any) => c.group === "when");
  const PAD = 18;
  const W = Math.max(300, PAD * 2 + ms.length * 30, PAD * 2 + Math.max(why.length, when.length) * 68);
  const Y = { why: 46, when: 150, match: 252 };
  const H = 290;
  const maxAbs = Math.max(0.5, ...s.causes.map((c: any) => Math.abs(c.impact)));
  const rOf = (v: number) => 9 + 13 * Math.sqrt(Math.abs(v) / maxAbs);
  const cx = (i: number, n: number) => PAD + ((i + 0.5) * (W - 2 * PAD)) / Math.max(1, n);
  const pos = new Map<string, { x: number; y: number }>();
  why.forEach((c: any, i: number) => pos.set(c.key, { x: cx(i, why.length), y: Y.why }));
  when.forEach((c: any, i: number) => pos.set(c.key, { x: cx(i, when.length), y: Y.when }));
  const mpos = new Map<string, number>();
  ms.forEach((m, i) => mpos.set(m._id, cx(i, ms.length)));

  const related = (key: string, id: string) => (sel?.kind === "cause" ? sel.key === key : sel?.kind === "match" ? sel.id === id : false);
  const nodeOn = (key: string) => !sel || (sel.kind === "cause" ? sel.key === key : ms.find((m) => m._id === sel.id)?.causes.some((c: any) => c.key === key));
  const matchOn = (m: any) => !sel || (sel.kind === "match" ? sel.id === m._id : m.causes.some((c: any) => c.key === sel.key));

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase text-secondary font-bold">Grafo de causas</span>
        <div className="flex gap-2.5 font-mono text-[9px] text-on-surface-variant">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: POS }} /> suma puntos
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: NEG }} /> resta puntos
          </span>
        </div>
      </div>
      <p className="font-mono text-[9px] text-on-surface-variant">
        El tamaño de cada causa = cuántos puntos explica. Toca una causa para ver sus partidos, o un partido para ver sus causas.
      </p>
      <HScroll>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: W }} className="select-none shrink-0" role="img" aria-label="Grafo que une cada causa con los partidos donde influyó">
          <rect x="0" y="0" width={W} height={H} fill="transparent" onClick={() => setSel(null)} />
          <text x="4" y="12" fontSize="8.5" fill={INK2} fontFamily="monospace">
            ¿POR QUÉ? (juego y suerte)
          </text>
          <text x="4" y={Y.when - 32} fontSize="8.5" fill={INK2} fontFamily="monospace">
            ¿CUÁNDO? (contexto: real − esperado)
          </text>
          <text x="4" y={Y.match - 20} fontSize="8.5" fill={INK2} fontFamily="monospace">
            PARTIDOS
          </text>
          {/* Aristas */}
          {ms.flatMap((m) =>
            m.causes.map((c: any) => {
              const a = pos.get(c.key);
              const mx = mpos.get(m._id)!;
              if (!a) return null;
              const on = related(c.key, m._id);
              const my = Y.match - 10;
              return (
                <path
                  key={`${m._id}-${c.key}`}
                  d={`M${a.x},${a.y} C${a.x},${(a.y + my) / 2} ${mx},${(a.y + my) / 2} ${mx},${my}`}
                  fill="none"
                  stroke={c.impact >= 0 ? POS : NEG}
                  strokeWidth={on ? 1 + Math.min(2.5, Math.abs(c.impact)) : 1}
                  opacity={sel ? (on ? 0.95 : 0.04) : 0.18}
                />
              );
            })
          )}
          {/* Causas */}
          {s.causes.map((c: any) => {
            const p = pos.get(c.key)!;
            const r = rOf(c.impact);
            const col = c.impact >= 0 ? POS : NEG;
            const on = nodeOn(c.key);
            return (
              <g
                key={c.key}
                opacity={on ? 1 : 0.25}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  setSel(sel?.kind === "cause" && sel.key === c.key ? null : { kind: "cause", key: c.key });
                }}
              >
                <circle cx={p.x} cy={p.y} r={Math.max(r, 16)} fill="transparent" />
                <circle cx={p.x} cy={p.y} r={r} fill={col} fillOpacity="0.28" stroke={col} strokeWidth={sel?.kind === "cause" && sel.key === c.key ? 3 : 1.5} />
                <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="11">
                  {c.icon}
                </text>
                <text x={p.x} y={p.y + r + 10} textAnchor="middle" fontSize="8.5" fill={INK} fontFamily="monospace">
                  {SHORT[c.key] ?? c.label}
                </text>
                <text x={p.x} y={p.y + r + 20} textAnchor="middle" fontSize="8.5" fill={INK2} fontFamily="monospace" fontWeight="bold">
                  {sg(c.impact)} · {c.n}p
                </text>
              </g>
            );
          })}
          {/* Partidos */}
          {ms.map((m) => {
            const mx = mpos.get(m._id)!;
            const on = matchOn(m);
            const picked = sel?.kind === "match" && sel.id === m._id;
            return (
              <g
                key={m._id}
                opacity={on ? 1 : 0.25}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  setSel(picked ? null : { kind: "match", id: m._id });
                }}
              >
                <circle cx={mx} cy={Y.match} r="14" fill="transparent" />
                <circle cx={mx} cy={Y.match} r="9" fill={RES[m.result].fill} fillOpacity="0.9" stroke={picked ? INK : "#181c24"} strokeWidth={picked ? 2.5 : 2} />
                <text x={mx} y={Y.match + 3} textAnchor="middle" fontSize="9" fontWeight="bold" fill="#181c24" fontFamily="monospace">
                  {RES[m.result].letter}
                </text>
                <text x={mx} y={Y.match + 20} textAnchor="middle" fontSize="7.5" fill={INK} fontFamily="monospace">
                  {short3(m.opponent)}
                </text>
                <text x={mx} y={Y.match + 29} textAnchor="middle" fontSize="7" fill={INK2} fontFamily="monospace">
                  {m.gf}-{m.ga}
                </text>
              </g>
            );
          })}
        </svg>
      </HScroll>
    </div>
  );
}

function Detail({ s, sel, setSel, onOpenMatch }: { s: any; sel: Sel; setSel: (x: Sel) => void; onOpenMatch?: (id: Id<"matches">) => void }) {
  if (!sel) return null;
  if (sel.kind === "cause") {
    const c = s.causes.find((z: any) => z.key === sel.key);
    if (!c) return null;
    const rows = s.matches.filter((m: any) => c.matchIds.includes(m._id));
    return (
      <div className="p-2.5 rounded-xl border border-surface-container-high bg-surface-container flex flex-col gap-1.5 font-mono text-[11px]">
        <div className="flex justify-between gap-2">
          <span className="text-on-surface font-bold">
            {c.icon} {c.label}
          </span>
          <Signed v={c.impact} suffix=" pts" />
        </div>
        <p className="text-[10px] text-on-surface-variant">{c.hint}</p>
        <p className="text-[10px] text-on-surface">
          {c.n} partido{c.n === 1 ? "" : "s"}: sacó {c.points} pts de {f1(c.expected)} esperados
          {c.deserved !== null ? ` · por juego merecía ${f1(c.deserved)}` : ""}.
        </p>
        {rows.map((m: any) => {
          const hit = m.causes.find((z: any) => z.key === c.key);
          return (
            <button key={m._id} onClick={() => setSel({ kind: "match", id: m._id })} className="text-left text-[10px] text-on-surface-variant hover:text-on-surface flex justify-between gap-2">
              <span>
                {ddmm(m.date)} {m.isHome ? "vs" : "en"} {m.opponent} {m.gf}-{m.ga}
              </span>
              <Signed v={hit.impact} />
            </button>
          );
        })}
      </div>
    );
  }
  const m = s.matches.find((z: any) => z._id === sel.id);
  if (!m) return null;
  return (
    <div className="p-2.5 rounded-xl border border-surface-container-high bg-surface-container flex flex-col gap-1.5 font-mono text-[11px]">
      <div className="flex justify-between gap-2">
        <span className="text-on-surface font-bold">
          {ddmm(m.date)} · {m.isHome ? `vs ${m.opponent}` : `en ${m.opponent}`} {m.gf}-{m.ga}
          {m.halfTime ? <span className="text-on-surface-variant font-normal"> (desc. {m.halfTime.gf}-{m.halfTime.ga})</span> : null}
        </span>
        {onOpenMatch && (
          <button onClick={() => onOpenMatch(m._id)} className="text-secondary text-[10px] shrink-0">
            Abrir partido
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1 text-center">
        {[
          ["Esperado", f1(m.expected), m.expectedSource === "elo" ? "Elo" : "mercado"],
          ["Merecido", m.deserved === null ? "—" : f1(m.deserved), m.xgf === null ? "sin xG" : `xG ${f1(m.xgf)}–${f1(m.xga)}`],
          ["Real", String(m.points), m.result === "W" ? "ganó" : m.result === "D" ? "empató" : "perdió"],
        ].map(([a, b, c]) => (
          <div key={a} className="bg-surface-container-low rounded-md py-1">
            <p className="text-[9px] text-on-surface-variant uppercase">{a}</p>
            <p className="text-sm font-bold text-on-surface">{b}</p>
            <p className="text-[8px] text-on-surface-variant">{c}</p>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-on-surface leading-snug">{m.sentence}</p>
      <div className="flex flex-wrap gap-1">
        {m.causes.map((c: any) => (
          <button
            key={c.key}
            onClick={() => setSel({ kind: "cause", key: c.key })}
            className="px-1.5 py-0.5 rounded-md bg-surface-container-low text-[10px] border"
            style={{ borderColor: c.impact >= 0 ? POS : NEG }}
          >
            {s.causes.find((z: any) => z.key === c.key)?.icon} {SHORT[c.key]} {sg(c.impact)}
          </button>
        ))}
      </div>
      {m.narrative && <p className="text-[10px] text-on-surface-variant italic leading-snug">🎙️ {m.narrative}</p>}
    </div>
  );
}

function Splits({ s }: { s: any }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase text-secondary font-bold">Dónde gana y dónde pierde puntos</span>
      <table className="w-full font-mono text-[10px]">
        <thead>
          <tr className="text-on-surface-variant text-right">
            <th className="text-left font-normal"></th>
            <th className="font-normal">PJ</th>
            <th className="font-normal">Pts</th>
            <th className="font-normal">Esper.</th>
            <th className="font-normal">Merec.</th>
            <th className="font-normal">vs esp.</th>
          </tr>
        </thead>
        <tbody>
          {s.splits.map((r: any) => {
            const d = r.points - r.expected;
            return (
              <tr key={r.key} className="text-right text-on-surface border-t border-surface-container-high/60">
                <td className="text-left py-0.5">{r.label}</td>
                <td>{r.n}</td>
                <td className="font-bold">{r.points}</td>
                <td>{f1(r.expected)}</td>
                <td>{r.deserved === null ? "—" : f1(r.deserved)}</td>
                <td>
                  <Signed v={d} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
