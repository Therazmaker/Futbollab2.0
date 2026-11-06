"use client";

import React, { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { competitionLabel } from "@/lib/competitions";

const card = "bg-surface-container-low rounded-xl p-space-md border border-surface-container-high/60 shadow-md";
const pct = (x: number | null | undefined, d = 0) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(d)}%`);
const f2 = (x: number | null | undefined) => (x === null || x === undefined ? "—" : x.toFixed(3));

const FLAG_LABEL: Record<string, string> = {
  FAVORITO_CLARO: "Favorito claro",
  EMPATE_VIVO: "Empate vivo",
  SORPRESA_POSIBLE: "Sorpresa posible",
  VALOR: "Discrepancia (antes «Valor»)",
  TU_INFO: "Tu información",
  FAVORITO_FRAGIL: "Favorito frágil",
};

export function RadarTraining({ competition }: { competition: string }) {
  const data = useQuery(api.radar.getTraining, { competition });
  if (data === undefined) return <div className={`${card} font-mono text-xs text-on-surface-variant`}>Calculando…</div>;
  return <TrainingReport data={data} competition={competition} />;
}

export function TrainingReport({ data, competition }: { data: any; competition: string }) {
  const [help, setHelp] = useState(false);

  if (data.matches === 0) {
    return (
      <div className={`${card} font-mono text-[11px] text-on-surface-variant flex flex-col gap-1`}>
        <p className="text-on-surface font-bold">Todavía no hay partidos evaluados{competition !== "all" ? ` en ${competitionLabel(competition)}` : ""}.</p>
        <p>
          Cada vez que abres el Radar se guarda una foto de lo que el modelo dice ANTES de cada partido (probabilidades, alertas, jugadores). Cuando
          pongas el marcador, aquí se puntúa contra esa foto.
        </p>
        {data.pendingSnapshots > 0 && <p>{data.pendingSnapshots} partidos con foto esperando resultado.</p>}
      </div>
    );
  }

  const small = data.matches < data.minSample;
  return (
    <div className="flex flex-col gap-3">
      <ClvCard data={data} />
      <div className={`${card} font-mono text-[11px] flex flex-col gap-1`}>
        <div className="flex justify-between items-baseline">
          <span className="text-on-surface font-bold text-sm">{data.matches} partidos evaluados</span>
          <button onClick={() => setHelp(!help)} className="text-secondary text-[10px]">
            {help ? "ocultar ayuda" : "¿cómo leerlo?"}
          </button>
        </div>
        {data.oneXTwo && (
          <p className="text-on-surface-variant">
            Resultado más probable acertado: <b className="text-primary">{pct(data.oneXTwo.hitRate)}</b> (90 %: {pct(data.oneXTwo.hitCi.low)}–
            {pct(data.oneXTwo.hitCi.high)}) · log-loss 1X2 {data.oneXTwo.logLoss.toFixed(3)} (adivinar al azar = 1.099)
          </p>
        )}
        <p className="text-on-surface-variant">
          {data.pendingSnapshots} con foto esperando resultado
          {data.lateSnapshots ? ` · ${data.lateSnapshots} fotos tomadas al poner el marcador (sin abrir el Radar antes)` : ""}
        </p>
        {small && (
          <p className="text-amber-300">
            Muestra pequeña (&lt; {data.minSample}): los números se mueven mucho de un partido a otro. Las recomendaciones aparecen con más partidos.
          </p>
        )}
        {help && (
          <div className="text-[10px] text-on-surface-variant border-t border-surface-container-high pt-1 mt-1 flex flex-col gap-1">
            <p>
              <b className="text-on-surface">CLV</b> (closing line value): compara tu cuota con la de cierre, ya sin el margen de la casa. Si
              apostaste a 2,40 y cerró a 2,10, le ganaste al mercado aunque luego pierdas la apuesta. Con pocos partidos dice mucho más que el
              ROI, que necesita cientos de apuestas para dejar de ser suerte.
            </p>
            <p>
              <b className="text-on-surface">Brier</b>: error de una probabilidad (0 = perfecto). "Mejora" compara con usar solo la frecuencia de la
              liga: positivo = el modelo aporta.
            </p>
            <p>
              <b className="text-on-surface">Calibración</b>: si el modelo dice 30 %, debería pasar ~30 % de las veces.
            </p>
            <p>
              <b className="text-on-surface">Alertas</b>: cuántas veces pasa lo que la alerta anuncia, frente a lo que esperaba el modelo y el mercado.
              El intervalo es el margen de error con esa muestra.
            </p>
          </div>
        )}
      </div>

      {data.tips.length > 0 && (
        <div className={`${card} font-mono text-[11px] flex flex-col gap-1 border-primary/40`}>
          <span className="text-primary font-bold uppercase text-[10px]">Lo que dicen los datos</span>
          {data.tips.map((t: string, i: number) => (
            <p key={i} className="text-on-surface">
              • {t}
            </p>
          ))}
        </div>
      )}

      {/* Mercados */}
      <div className={card}>
        <span className="font-mono text-xs uppercase text-primary font-bold">Mercados</span>
        <table className="w-full font-mono text-[10px] mt-1">
          <thead>
            <tr className="text-on-surface-variant">
              <th className="text-left font-normal">Mercado</th>
              <th className="text-right font-normal">n</th>
              <th className="text-right font-normal">Brier</th>
              <th className="text-right font-normal">Liga</th>
              <th className="text-right font-normal">Mejora</th>
            </tr>
          </thead>
          <tbody>
            {data.markets.map((m: any) => (
              <tr key={m.key} className="border-t border-surface-container-high/40">
                <td className="py-0.5 text-on-surface">{m.label}</td>
                <td className="text-right">{m.n}</td>
                <td className="text-right">{f2(m.brier)}</td>
                <td className="text-right">{f2(m.brierBase)}</td>
                <td className={`text-right font-bold ${m.improvement === null ? "" : m.improvement >= 0 ? "text-primary" : "text-error"}`}>
                  {m.improvement === null ? "—" : `${m.improvement >= 0 ? "+" : ""}${m.improvement.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Calibración */}
      {data.calibration.length > 0 && (
        <div className={card}>
          <span className="font-mono text-xs uppercase text-primary font-bold">Calibración 1X2</span>
          <div className="flex flex-col gap-1 mt-2 font-mono text-[10px]">
            {data.calibration.map((b: any) => (
              <div key={b.range} className="flex items-center gap-2">
                <span className="w-16 text-on-surface-variant">{b.range}</span>
                <div className="relative flex-1 h-3 bg-surface-container rounded">
                  <div className="absolute top-0 bottom-0 bg-secondary/40 rounded" style={{ width: pct(b.predicted) }} title="Predicho" />
                  <div className="absolute top-0 bottom-0 w-1 bg-primary" style={{ left: pct(Math.min(0.99, b.observed)) }} title="Real" />
                </div>
                <span className="w-28 text-right text-on-surface">
                  {pct(b.predicted)} → <b className="text-primary">{pct(b.observed)}</b> <span className="text-on-surface-variant">n={b.n}</span>
                </span>
              </div>
            ))}
            <p className="text-[9px] text-on-surface-variant">Barra = probabilidad media que dio el modelo; marca verde = cuántas veces pasó de verdad.</p>
          </div>
        </div>
      )}

      {/* Alertas */}
      {data.flags.length > 0 && (
        <div className={card}>
          <span className="font-mono text-xs uppercase text-primary font-bold">Alertas</span>
          <div className="flex flex-col divide-y divide-surface-container-high/40 mt-1 font-mono text-[10px]">
            {data.flags.map((f: any) => (
              <div key={f.code} className="py-1.5">
                <div className="flex justify-between">
                  <span className="text-on-surface font-bold">{FLAG_LABEL[f.code] ?? f.code}</span>
                  <span>
                    {f.hits}/{f.n} · <b className="text-primary">{pct(f.rate)}</b>
                  </span>
                </div>
                <p className="text-on-surface-variant">
                  "{f.event}": real {pct(f.rate)} (90 %: {pct(f.ci.low)}–{pct(f.ci.high)}) · el modelo esperaba {pct(f.expected)}
                  {f.market !== null ? ` · el mercado ${pct(f.market)}` : ""}
                  {f.roi !== null ? ` · rendimiento ${f.roi >= 0 ? "+" : ""}${(f.roi * 100).toFixed(1)} % por apuesta` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bajas y jugadores */}
      {(data.absence || data.players.score || data.players.shot1) && (
        <div className={`${card} font-mono text-[10px] flex flex-col gap-1`}>
          <span className="font-mono text-xs uppercase text-primary font-bold">Bajas y jugadores</span>
          {data.absence && (
            <p className="text-on-surface-variant">
              <b className="text-on-surface">Ajuste por bajas</b> (n={data.absence.n}): goles reales {data.absence.goals.toFixed(2)} · esperados con
              ajuste {data.absence.expectedAdjusted.toFixed(2)} · sin ajuste {data.absence.expectedBase.toFixed(2)}. Error medio{" "}
              {data.absence.maeAdjusted.toFixed(2)} vs {data.absence.maeBase.toFixed(2)} sin ajuste.
            </p>
          )}
          {data.players.score && (
            <p className="text-on-surface-variant">
              <b className="text-on-surface">Marca</b> (n={data.players.score.n}): el modelo esperaba {pct(data.players.score.predicted)}, marcaron{" "}
              {pct(data.players.score.observed)} · Brier {f2(data.players.score.brier)}
            </p>
          )}
          {data.players.shot1 && (
            <p className="text-on-surface-variant">
              <b className="text-on-surface">≥1 tiro</b> (n={data.players.shot1.n}): esperado {pct(data.players.shot1.predicted)}, real{" "}
              {pct(data.players.shot1.observed)} · Brier {f2(data.players.shot1.brier)}
            </p>
          )}
          <p className="text-[9px] text-on-surface-variant">Solo cuentan los jugadores que tenían pronóstico y luego registraste en ese partido.</p>
        </div>
      )}
    </div>
  );
}

/** CLV: ¿tu cuota era mejor que la de cierre? y ¿el mercado se mueve hacia el modelo? */
function ClvCard({ data }: { data: any }) {
  const b = data.clvBacktest;
  const signed = (x: number, d = 1) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;
  return (
    <div className={`${card} font-mono text-[11px] flex flex-col gap-1.5`}>
      <span className="text-on-surface font-bold text-sm">CLV · contra la cuota de cierre</span>
      {!data.vsClosing ? (
        <p className="text-on-surface-variant">
          Ningún partido evaluado tiene cuota de cierre todavía. Ponla en la tarjeta del partido («Cierre») o pulsa «Actualizar jornadas» en
          Ligas → 🔧 para traerla de football-data.
        </p>
      ) : (
        <>
          <p className="text-on-surface-variant">
            1X2 con {data.vsClosing.n} partidos (log-loss, menor = mejor): modelo solo{" "}
            <b className="text-on-surface">{data.vsClosing.logLossModel.toFixed(3)}</b> · Radar (mercado + tus correcciones){" "}
            <b className="text-on-surface">{data.vsClosing.logLossFinal.toFixed(3)}</b> · cierre del mercado{" "}
            <b className="text-on-surface">{data.vsClosing.logLossClose.toFixed(3)}</b>
          </p>
          {data.towardModel && (
            <p className="text-on-surface-variant">
              El mercado se movió hacia el modelo en <b className="text-primary">{pct(data.towardModel.rate)}</b> de {data.towardModel.n} partidos
              (90 %: {pct(data.towardModel.ci.low)}–{pct(data.towardModel.ci.high)}). 50 % = el modelo no sabe nada que el mercado no sepa.
            </p>
          )}
          {data.clv ? (
            <p className="text-on-surface-variant">
              Discrepancias ({data.clv.n}): CLV medio{" "}
              <b className={data.clv.mean >= 0 ? "text-primary" : "text-error"}>{signed(data.clv.mean)}</b> (90 %: {signed(data.clv.ci.low)} a{" "}
              {signed(data.clv.ci.high)}) · le ganan al cierre {pct(data.clv.beatRate)}
            </p>
          ) : (
            <p className="text-on-surface-variant">Aún no hay discrepancias con cuota de cierre.</p>
          )}
        </>
      )}
      {data.corrections && (
        <p className="text-on-surface-variant">
          Tus correcciones por bajas ({data.corrections.n} partidos): Δ log-loss frente al mercado{" "}
          <b className={data.corrections.delta < 0 ? "text-primary" : "text-error"}>
            {data.corrections.delta >= 0 ? "+" : ""}
            {data.corrections.delta.toFixed(3)}
          </b>{" "}
          (90 %: {data.corrections.ci.low.toFixed(3)} a {data.corrections.ci.high.toFixed(3)}). Negativo = tus bajas mejoran al mercado.
        </p>
      )}
      <p className="text-[10px] text-on-surface-variant border-t border-surface-container-high pt-1">
        Referencia del histórico ({b.nToward.toLocaleString()} partidos, solo resultados y tiros): el mercado se movía hacia el modelo el{" "}
        {pct(b.towardModel, 1)} de las veces, y las discrepancias de ≥5 pts daban CLV {signed(b.clv)} y ROI {signed(b.roi)} (n={b.n.toLocaleString()}).
        Es decir: con solo resultados el modelo no le gana al mercado. Lo que mide este panel es si TUS datos (bajas, narraciones, jugadores) sí lo
        hacen.
      </p>
    </div>
  );
}
