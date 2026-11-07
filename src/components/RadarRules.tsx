"use client";

import React, { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { featureCatalog, TARGETS, TEAM_ONLY_TARGETS } from "../../convex/lib/features";

const card = "bg-surface-container-low rounded-xl p-space-md border border-surface-container-high/60 shadow-md";
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)} %`);
const CATALOG = featureCatalog();
const OPS: Record<string, string> = { ">=": "≥", "<=": "≤", "=": "=" };
const VERDICT: Record<string, { label: string; cls: string }> = {
  better: { label: "Le gana al mercado", cls: "bg-primary/20 text-primary" },
  same: { label: "Igual que el mercado", cls: "bg-surface-container-high text-on-surface-variant" },
  worse: { label: "Peor que el mercado", cls: "bg-error/20 text-error" },
  few: { label: "Pocos casos", cls: "bg-amber-900/40 text-amber-300" },
};

function condText(c: { feature: string; op: string; value: number }) {
  const isProb = /_prob$/.test(c.feature);
  return `${CATALOG[c.feature] ?? c.feature} ${OPS[c.op] ?? c.op} ${isProb ? `${Math.round(c.value * 100)} %` : c.value}`;
}

/** Detector: reglas que dictas tú, probadas en el histórico y buscadas en los partidos que vienen. */
export function RadarRules() {
  const rules = useQuery(api.rules.listRules);
  const run = useAction(api.rules.runBacktest);
  const setActive = useMutation(api.rules.setActive);
  const del = useMutation(api.rules.deleteRule);
  const seed = useMutation(api.rules.seedStarterRules);
  const [editing, setEditing] = useState<any | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const rerun = async (ruleId?: Id<"radarRules">) => {
    setBusy(ruleId ?? "all");
    try {
      await run({ ruleId });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 font-mono text-[11px]">
      <div className={`${card} flex flex-col gap-1.5`}>
        <p className="text-on-surface font-bold text-sm font-sans">🔎 Detector</p>
        <p className="text-on-surface-variant">
          Escribe tus reglas con tus palabras («si al Getafe le metieron 3 en el último partido y el rival viene de Champions, se conforman con el
          empate»). La IA las traduce a datos, se prueban con el histórico y el Radar te marca los partidos que las cumplen. Tú solo entras a revisar.
        </p>
        <div className="flex gap-2">
          <button onClick={() => setEditing({})} className="px-3 h-8 rounded-lg bg-primary text-on-primary font-bold">
            + Nueva regla
          </button>
          {rules && rules.length > 0 && (
            <button onClick={() => rerun()} disabled={!!busy} className="px-3 h-8 rounded-lg bg-surface-container-high text-secondary border border-secondary/30 disabled:opacity-50">
              {busy === "all" ? "Probando…" : "Probar todas otra vez"}
            </button>
          )}
        </div>
      </div>

      {rules?.length === 0 && (
        <div className="px-1 flex flex-col gap-1.5 text-on-surface-variant">
          <p>Aún no hay reglas. Empieza por una que uses siempre, o carga las cinco que probamos en el chat (underdog que empata mucho, favorito aplastante…).</p>
          <button
            onClick={async () => {
              await seed({});
              await rerun();
            }}
            disabled={!!busy}
            className="self-start px-3 h-8 rounded-lg bg-surface-container-high text-secondary border border-secondary/30 disabled:opacity-50"
          >
            {busy ? "Probando…" : "Cargar las reglas que probamos"}
          </button>
        </div>
      )}

      {rules?.map((r: any) => {
        const bt = r.backtest;
        const v = bt ? VERDICT[bt.verdict] : null;
        return (
          <div key={r._id} className={`${card} flex flex-col gap-1.5 ${r.active ? "" : "opacity-60"}`}>
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <p className="text-on-surface font-bold">
                  {r.name}
                  {r.teamName && <span className="text-secondary"> · {r.teamName}</span>}
                </p>
                <p className="text-[10px] text-on-surface-variant italic">«{r.text}»</p>
              </div>
              {v && <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${v.cls}`}>{v.label}</span>}
            </div>
            <div className="text-[10px] text-on-surface-variant">
              {r.conditions.map((c: any, i: number) => (
                <div key={i}>• {condText(c)}</div>
              ))}
              {r.manualChecks.map((m: string, i: number) => (
                <div key={`m${i}`}>✋ Revisar a mano: {m}</div>
              ))}
              <div className="text-on-surface">→ {r.targetLabel}</div>
            </div>
            {bt ? (
              <div className="text-[10px] text-on-surface-variant border-t border-surface-container-high/40 pt-1">
                {bt.n === 0 ? (
                  "En el histórico no se cumplió nunca: quizá los umbrales son demasiado estrictos."
                ) : (
                  <>
                    En el histórico se cumplió <b className="text-on-surface">{bt.n}</b> veces y pasó{" "}
                    <b className="text-on-surface">{pct(bt.rate)}</b> (90 %: {pct(bt.ci.low)}–{pct(bt.ci.high)})
                    {bt.market !== null ? (
                      <>
                        {" "}
                        · el mercado esperaba <b className="text-on-surface">{pct(bt.market)}</b>
                      </>
                    ) : (
                      " · sin cuota para comparar"
                    )}
                    {bt.roi !== null ? (
                      <span className={bt.roi >= 0 ? "text-primary" : "text-error"}> · ROI {bt.roi >= 0 ? "+" : ""}{(bt.roi * 100).toFixed(1)} %</span>
                    ) : null}
                    {bt.live?.n ? ` · desde que la creaste: ${bt.live.hits}/${bt.live.n}` : ""}
                    <div className="flex gap-0.5 mt-1">
                      {bt.last.map((x: any) => (
                        <span key={x.matchId} title={x.date} className={`w-3 h-3 rounded-sm ${x.hit ? "bg-primary" : "bg-error/70"}`} />
                      ))}
                      <span className="ml-1">últimas veces</span>
                    </div>
                  </>
                )}
              </div>
            ) : (
              r.conditions.length > 0 && <p className="text-[10px] text-on-surface-variant">Sin probar todavía.</p>
            )}
            <div className="flex gap-3 text-[10px]">
              {r.conditions.length > 0 && (
                <button onClick={() => rerun(r._id)} disabled={!!busy} className="text-secondary disabled:opacity-50">
                  {busy === r._id ? "Probando…" : "Probar en el histórico"}
                </button>
              )}
              <button onClick={() => setEditing(r)} className="text-secondary">
                Editar
              </button>
              <button onClick={() => setActive({ ruleId: r._id, active: !r.active })} className="text-on-surface-variant">
                {r.active ? "Pausar" : "Activar"}
              </button>
              <button onClick={() => confirm("¿Borrar esta regla?") && del({ ruleId: r._id })} className="text-error">
                Borrar
              </button>
            </div>
          </div>
        );
      })}

      {editing && <RuleEditor initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/**
 * Crear / editar una regla. `initial.context` (opcional) es el partido que la
 * inspiró, desde «¿Qué me faltó mirar?».
 */
export function RuleEditor({ initial, onClose }: { initial: any; onClose: () => void }) {
  const save = useMutation(api.rules.saveRule);
  const run = useAction(api.rules.runBacktest);
  const [text, setText] = useState<string>(initial.text ?? "");
  const [rule, setRule] = useState<any | null>(
    initial._id
      ? {
          name: initial.name,
          team: initial.teamId ? { _id: initial.teamId, name: initial.teamName } : null,
          conditions: initial.conditions,
          target: initial.target,
          manualChecks: initial.manualChecks,
          explanation: "",
        }
      : null
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const translate = async () => {
    setBusy("ai");
    setErrors([]);
    try {
      const res = await fetch("/api/radar-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rule", text, context: initial.context }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
      setRule(json.rule);
      setErrors(json.errors ?? []);
    } catch (e: any) {
      setErrors([e?.message ?? String(e)]);
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    setBusy("save");
    setErrors([]);
    try {
      const ruleId = await save({
        ruleId: initial._id,
        name: rule.name,
        text,
        teamId: rule.team?._id,
        conditions: rule.conditions.map((c: any) => ({ feature: c.feature, op: c.op, value: Number(c.value) })),
        target: rule.target,
        manualChecks: rule.manualChecks,
        originMatchId: initial.originMatchId,
      });
      if (rule.conditions.length) await run({ ruleId });
      onClose();
    } catch (e: any) {
      setErrors([e?.message ?? String(e)]);
    } finally {
      setBusy(null);
    }
  };

  const setCond = (i: number, patch: any) => setRule({ ...rule, conditions: rule.conditions.map((c: any, j: number) => (i === j ? { ...c, ...patch } : c)) });
  const features = Object.entries(CATALOG).filter(([k]) => rule?.team || !/^(team|opp)_/.test(k));

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto overscroll-contain flex justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface-container-low border border-primary/40 rounded-2xl w-full max-w-md p-5 shadow-2xl my-auto flex flex-col gap-3 font-mono text-[11px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start">
          <p className="text-sm font-bold text-on-surface font-sans">{initial._id ? "Editar regla" : "Nueva regla"}</p>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-surface-container text-on-surface-variant">
            ✕
          </button>
        </div>
        {initial.context && <p className="text-[10px] text-on-surface-variant whitespace-pre-line border-l-2 border-secondary/50 pl-2">{initial.context}</p>}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Ej.: si al no favorito le metieron 3 o más en su último partido y el favorito jugó Champions entre semana, el favorito no gana"
          className="w-full p-2 rounded-lg bg-surface-container text-on-surface border border-surface-container-high"
        />
        <button onClick={translate} disabled={busy !== null || text.trim().length < 10} className="self-start px-3 h-8 rounded-lg bg-primary text-on-primary font-bold disabled:opacity-50">
          {busy === "ai" ? "Traduciendo…" : rule ? "✨ Volver a traducir" : "✨ Traducir con IA"}
        </button>

        {rule && (
          <div className="flex flex-col gap-2 border-t border-surface-container-high pt-2">
            {rule.explanation && <p className="text-[10px] text-on-surface-variant">{rule.explanation}</p>}
            <label className="text-[10px] text-on-surface-variant uppercase">
              Nombre
              <input value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} className="w-full h-8 px-2 mt-0.5 rounded-lg bg-surface-container text-on-surface border border-surface-container-high normal-case" />
            </label>
            <div className="text-[10px] text-on-surface-variant">
              {rule.team ? (
                <span>
                  Solo para <b className="text-secondary">{rule.team.name}</b>{" "}
                  <button onClick={() => setRule({ ...rule, team: null })} className="text-error">
                    (quitar)
                  </button>
                </span>
              ) : (
                "Regla general (cualquier equipo)"
              )}
            </div>
            <span className="text-[10px] text-on-surface-variant uppercase">Condiciones (todas a la vez)</span>
            {rule.conditions.map((c: any, i: number) => (
              <div key={i} className="flex flex-col gap-1 p-1.5 rounded-lg bg-surface-container">
                <select value={c.feature} onChange={(e) => setCond(i, { feature: e.target.value })} className="h-8 px-1 rounded bg-surface-container-low text-on-surface text-[10px]">
                  {features.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
                <div className="flex gap-1">
                  <select value={c.op} onChange={(e) => setCond(i, { op: e.target.value })} className="h-8 px-1 rounded bg-surface-container-low text-on-surface">
                    {Object.entries(OPS).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <input inputMode="decimal" value={c.value} onChange={(e) => setCond(i, { value: e.target.value.replace(",", ".") })} className="flex-1 h-8 px-2 rounded bg-surface-container-low text-on-surface" />
                  <button onClick={() => setRule({ ...rule, conditions: rule.conditions.filter((_: any, j: number) => j !== i) })} className="px-2 text-error">
                    ✕
                  </button>
                </div>
                {/_prob$/.test(c.feature) && <span className="text-[9px] text-on-surface-variant">Probabilidad en 0–1 (0.7 = 70 %)</span>}
              </div>
            ))}
            <button onClick={() => setRule({ ...rule, conditions: [...rule.conditions, { feature: "fav_prob", op: ">=", value: 0.6 }] })} className="self-start text-secondary text-[10px]">
              + Añadir condición
            </button>
            <label className="text-[10px] text-on-surface-variant uppercase">
              Qué predice
              <select value={rule.target} onChange={(e) => setRule({ ...rule, target: e.target.value })} className="w-full h-8 px-1 mt-0.5 rounded-lg bg-surface-container text-on-surface normal-case">
                {Object.entries(TARGETS)
                  .filter(([k]) => rule.team || !TEAM_ONLY_TARGETS.has(k))
                  .map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-[10px] text-on-surface-variant uppercase">
              Revisar a mano (una por línea)
              <textarea
                value={rule.manualChecks.join("\n")}
                onChange={(e) => setRule({ ...rule, manualChecks: e.target.value.split("\n") })}
                rows={2}
                className="w-full p-2 mt-0.5 rounded-lg bg-surface-container text-on-surface border border-surface-container-high normal-case"
                placeholder="Ej.: ¿rota el favorito?"
              />
            </label>
          </div>
        )}
        {errors.length > 0 && (
          <div className="text-error text-[10px]">
            {errors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
        )}
        {rule && (
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-3 h-8 rounded-lg text-on-surface-variant">
              Cancelar
            </button>
            <button onClick={submit} disabled={busy !== null} className="px-3 h-8 rounded-lg bg-primary text-on-primary font-bold disabled:opacity-50">
              {busy === "save" ? "Guardando y probando…" : "Guardar y probar"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
