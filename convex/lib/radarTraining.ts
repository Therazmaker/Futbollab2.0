/**
 * Entrenamiento del Radar: puntúa las fotos previas contra los resultados.
 * Puro (sin Convex) para poder probarlo.
 *
 * No ajusta pesos solo: con pocos partidos eso sería aprender ruido. Mide con
 * intervalos de confianza y da recomendaciones solo cuando la muestra alcanza.
 */

export interface EvalSnapshot {
  probs: Record<string, number>;
  base: Record<string, number> | null;
  baseProbs?: { home: number; draw: number; away: number } | null;
  expectedGoals: { home: number; away: number };
  attackFactor: { home: number; away: number };
  odds?: { home?: number; draw?: number; away?: number } | null;
  fair?: { home: number; draw: number; away: number } | null;
  flags: string[];
  favorite: "home" | "away";
  bestEdge?: { outcome: "home" | "draw" | "away"; odds: number; model: number; fair: number } | null;
  players: Array<{ playerId: string; pScore: number; pShot1: number; pShot2: number }>;
  late: boolean;
}

export interface EvalResult {
  homeGoals: number;
  awayGoals: number;
  /** Cuotas de cierre del mercado (para el CLV) */
  closingOdds?: { home: number; draw: number; away: number } | null;
  /** Partidos de jugadores de ese partido: goles y tiros reales */
  playerLogs: Array<{ playerId: string; goals: number | null; shots: number | null }>;
}

export const MARKET_LABELS: Record<string, string> = {
  home: "Gana local",
  draw: "Empate",
  away: "Gana visitante",
  over15: "Más de 1.5",
  over25: "Más de 2.5",
  over35: "Más de 3.5",
  btts: "Ambos marcan",
  homeCleanSheet: "Local portería a cero",
  awayCleanSheet: "Visitante portería a cero",
};
const BASE_KEY: Record<string, string> = { home: "homeWin", draw: "draw", away: "awayWin" };

export const FLAG_EVENTS: Record<string, string> = {
  FAVORITO_CLARO: "gana el favorito",
  EMPATE_VIVO: "empate",
  SORPRESA_POSIBLE: "gana el no favorito",
  VALOR: "sale el resultado de la discrepancia",
  FAVORITO_FRAGIL: "el favorito del mercado no gana",
};

/** Intervalo de Wilson al 90 % para una proporción. */
export function wilson(hits: number, n: number, z = 1.645) {
  if (!n) return { low: 0, high: 1 };
  const p = hits / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { low: Math.max(0, c - h), high: Math.min(1, c + h) };
}

/** Cuotas → probabilidades justas (sin margen). */
function fairOf(o: { home?: number; draw?: number; away?: number } | null | undefined) {
  if (!o || !(o.home! > 1 && o.draw! > 1 && o.away! > 1)) return null;
  const i = { home: 1 / o.home!, draw: 1 / o.draw!, away: 1 / o.away! };
  const t = i.home + i.draw + i.away;
  return { home: i.home / t, draw: i.draw / t, away: i.away / t };
}

/**
 * Referencia del histórico (football-data, 3.920 partidos 2024-08 → 2026-11, modelo
 * walk-forward contra la cuota media de apertura). Ver PR "CLV".
 */
export const CLV_BACKTEST = { n: 1487, clv: -0.056, roi: -0.223, towardModel: 0.493, nToward: 3919 };

const outcomeOf = (h: number, a: number) => (h > a ? "home" : h === a ? "draw" : "away");

export function evaluate(rows: Array<{ snap: EvalSnapshot; result: EvalResult }>) {
  const markets: Record<string, { n: number; brier: number; brierBase: number; nBase: number }> = {};
  let ll = 0, hits = 0, n1x2 = 0;
  const buckets = [0, 0.2, 0.35, 0.5, 0.65, 1.01].slice(0, -1).map((lo, i, arr) => ({
    lo,
    hi: [0.2, 0.35, 0.5, 0.65, 1.01][i],
    n: 0,
    pred: 0,
    obs: 0,
  }));
  const flags: Record<string, { n: number; hits: number; expected: number; market: number; nMarket: number; profit: number }> = {};
  const absence = { n: 0, errAdj: 0, errBase: 0, goals: 0, adj: 0, base: 0 };
  const players = { score: { n: 0, brier: 0, pred: 0, obs: 0 }, shot1: { n: 0, brier: 0, pred: 0, obs: 0 } };
  let late = 0;
  // CLV: ¿tu cuota (la de la foto previa) era mejor que la de cierre?
  const clv = { n: 0, sum: 0, sum2: 0, beat: 0 };
  const toward = { n: 0, hits: 0 };
  const vsClose = { n: 0, llModel: 0, llClose: 0 };

  for (const { snap, result } of rows) {
    if (snap.late) late++;
    const hg = result.homeGoals, ag = result.awayGoals, out = outcomeOf(hg, ag);
    const events: Record<string, boolean> = {
      home: out === "home",
      draw: out === "draw",
      away: out === "away",
      over15: hg + ag > 1,
      over25: hg + ag > 2,
      over35: hg + ag > 3,
      btts: hg > 0 && ag > 0,
      homeCleanSheet: ag === 0,
      awayCleanSheet: hg === 0,
    };
    for (const k of Object.keys(MARKET_LABELS)) {
      const p = snap.probs[k];
      if (typeof p !== "number") continue;
      const y = events[k] ? 1 : 0;
      const m = (markets[k] ??= { n: 0, brier: 0, brierBase: 0, nBase: 0 });
      m.n++;
      m.brier += (p - y) ** 2;
      const b = snap.base?.[BASE_KEY[k] ?? k];
      if (typeof b === "number") {
        m.brierBase += (b - y) ** 2;
        m.nBase++;
      }
    }
    // 1X2: log-loss, acierto del más probable, calibración
    const P = { home: snap.probs.home, draw: snap.probs.draw, away: snap.probs.away };
    ll += -Math.log(Math.max(1e-6, P[out]));
    const best = (["home", "draw", "away"] as const).reduce((a, b) => (P[b] > P[a] ? b : a));
    if (best === out) hits++;
    n1x2++;
    for (const o of ["home", "draw", "away"] as const) {
      const bk = buckets.find((b) => P[o] >= b.lo && P[o] < b.hi)!;
      bk.n++;
      bk.pred += P[o];
      bk.obs += out === o ? 1 : 0;
    }
    // Alertas
    const fav = snap.favorite;
    const und = fav === "home" ? "away" : "home";
    const mktFav = snap.fair ? (snap.fair.home >= snap.fair.away ? "home" : "away") : null;
    for (const code of snap.flags) {
      let hit: boolean | null = null, expected = 0, market: number | null = null, profit = 0;
      if (code === "FAVORITO_CLARO") { hit = out === fav; expected = P[fav]; market = snap.fair ? snap.fair[fav] : null; }
      else if (code === "EMPATE_VIVO") { hit = out === "draw"; expected = P.draw; market = snap.fair ? snap.fair.draw : null; }
      else if (code === "SORPRESA_POSIBLE") { hit = out === und; expected = P[und]; market = snap.fair ? snap.fair[und] : null; }
      else if (code === "VALOR" && snap.bestEdge) {
        hit = out === snap.bestEdge.outcome;
        expected = snap.bestEdge.model;
        market = snap.bestEdge.fair;
        profit = hit ? snap.bestEdge.odds - 1 : -1;
      } else if (code === "FAVORITO_FRAGIL" && mktFav && snap.fair) {
        hit = out !== mktFav;
        expected = 1 - P[mktFav];
        market = 1 - snap.fair[mktFav];
      }
      if (hit === null) continue;
      const f = (flags[code] ??= { n: 0, hits: 0, expected: 0, market: 0, nMarket: 0, profit: 0 });
      f.n++;
      if (hit) f.hits++;
      f.expected += expected;
      if (market !== null) { f.market += market; f.nMarket++; }
      f.profit += profit;
    }
    // CLV y movimiento de la cuota
    const close = fairOf(result.closingOdds);
    if (close) {
      vsClose.n++;
      vsClose.llModel += -Math.log(Math.max(1e-6, P[out]));
      vsClose.llClose += -Math.log(Math.max(1e-6, close[out]));
      if (snap.fair) {
        // Resultado donde modelo y tu cuota más discrepaban: ¿el cierre se movió hacia el modelo?
        const k = (["home", "draw", "away"] as const).reduce((a, b) =>
          Math.abs(P[b] - snap.fair![b]) > Math.abs(P[a] - snap.fair![a]) ? b : a
        );
        const mv = close[k] - snap.fair[k];
        if (Math.abs(mv) > 0.002) {
          toward.n++;
          if (Math.sign(mv) === Math.sign(P[k] - snap.fair[k])) toward.hits++;
        }
      }
      if (snap.flags.includes("VALOR") && snap.bestEdge) {
        const c = snap.bestEdge.odds * close[snap.bestEdge.outcome] - 1;
        clv.n++;
        clv.sum += c;
        clv.sum2 += c * c;
        if (c > 0) clv.beat++;
      }
    }
    // Bajas: ¿el ajuste acerca los goles esperados a los reales?
    for (const side of ["home", "away"] as const) {
      const fct = snap.attackFactor?.[side] ?? 1;
      if (fct >= 1) continue;
      const adj = snap.expectedGoals[side];
      const base = adj / fct;
      const g = side === "home" ? hg : ag;
      absence.n++;
      absence.errAdj += Math.abs(g - adj);
      absence.errBase += Math.abs(g - base);
      absence.goals += g;
      absence.adj += adj;
      absence.base += base;
    }
    // Jugadores: probabilidad de marcar y de tirar
    for (const p of snap.players) {
      const log = result.playerLogs.find((l) => l.playerId === p.playerId);
      if (!log) continue; // no jugó: el pronóstico suponía que jugaba
      if (log.goals !== null) {
        const y = log.goals > 0 ? 1 : 0;
        players.score.n++;
        players.score.brier += (p.pScore - y) ** 2;
        players.score.pred += p.pScore;
        players.score.obs += y;
      }
      if (log.shots !== null) {
        const y = log.shots >= 1 ? 1 : 0;
        players.shot1.n++;
        players.shot1.brier += (p.pShot1 - y) ** 2;
        players.shot1.pred += p.pShot1;
        players.shot1.obs += y;
      }
    }
  }

  const marketRows = Object.entries(markets).map(([k, m]) => ({
    key: k,
    label: MARKET_LABELS[k],
    n: m.n,
    brier: m.brier / m.n,
    brierBase: m.nBase ? m.brierBase / m.nBase : null,
    improvement: m.nBase ? ((m.brierBase / m.nBase - m.brier / m.n) / (m.brierBase / m.nBase)) * 100 : null,
  }));
  const flagRows = Object.entries(flags).map(([code, f]) => {
    const ci = wilson(f.hits, f.n);
    return {
      code,
      event: FLAG_EVENTS[code] ?? code,
      n: f.n,
      hits: f.hits,
      rate: f.hits / f.n,
      ci,
      expected: f.expected / f.n,
      market: f.nMarket ? f.market / f.nMarket : null,
      roi: code === "VALOR" ? f.profit / f.n : null,
    };
  });
  const calibration = buckets
    .filter((b) => b.n)
    .map((b) => ({ range: `${Math.round(b.lo * 100)}–${Math.round(Math.min(b.hi, 1) * 100)}%`, n: b.n, predicted: b.pred / b.n, observed: b.obs / b.n }));

  // Recomendaciones solo con muestra suficiente
  const tips: string[] = [];
  const MIN = 30;
  for (const b of calibration) {
    if (b.n >= 50 && Math.abs(b.observed - b.predicted) >= 0.07) {
      tips.push(
        `Cuando el modelo da ${b.range}, en realidad pasa un ${Math.round(b.observed * 100)} % (n=${b.n}): está ${b.observed > b.predicted ? "infravalorando" : "sobrevalorando"} esos resultados.`
      );
    }
  }
  for (const f of flagRows) {
    if (f.n < MIN) continue;
    if (f.ci.high < f.expected - 0.02) tips.push(`"${f.code}" acierta menos de lo que el modelo esperaba (${Math.round(f.rate * 100)} % vs ${Math.round(f.expected * 100)} %, n=${f.n}): conviene subir su umbral.`);
    if (f.ci.low > f.expected + 0.02) tips.push(`"${f.code}" acierta más de lo esperado (${Math.round(f.rate * 100)} % vs ${Math.round(f.expected * 100)} %, n=${f.n}): el modelo se queda corto en esos partidos.`);
    if (f.code === "VALOR" && f.roi !== null) tips.push(`Apostando 1 a cada "valor": ${f.roi >= 0 ? "+" : ""}${(f.roi * 100).toFixed(1)} % por apuesta (n=${f.n}).`);
  }
  if (absence.n >= 15) {
    tips.push(
      absence.errAdj < absence.errBase
        ? `El ajuste por bajas acerca los goles esperados a los reales (error ${(absence.errAdj / absence.n).toFixed(2)} vs ${(absence.errBase / absence.n).toFixed(2)} sin ajuste, n=${absence.n}).`
        : `El ajuste por bajas NO mejora (error ${(absence.errAdj / absence.n).toFixed(2)} vs ${(absence.errBase / absence.n).toFixed(2)} sin ajuste, n=${absence.n}): habría que reducirlo.`
    );
  }

  const clvMean = clv.n ? clv.sum / clv.n : 0;
  const clvSd = clv.n > 1 ? Math.sqrt(Math.max(0, clv.sum2 / clv.n - clvMean * clvMean)) : 0;
  const clvRow = clv.n
    ? {
        n: clv.n,
        mean: clvMean,
        ci: { low: clvMean - (1.645 * clvSd) / Math.sqrt(clv.n), high: clvMean + (1.645 * clvSd) / Math.sqrt(clv.n) },
        beatRate: clv.beat / clv.n,
      }
    : null;
  if (clvRow && clvRow.n >= 20) {
    tips.push(
      clvRow.ci.low > 0
        ? `Tus apuestas de "discrepancia" le ganan a la cuota de cierre (CLV ${(clvRow.mean * 100).toFixed(1)} %, n=${clvRow.n}): señal de ventaja real.`
        : clvRow.ci.high < 0
        ? `Tus apuestas de "discrepancia" pierden contra el cierre (CLV ${(clvRow.mean * 100).toFixed(1)} %, n=${clvRow.n}): el mercado sabe más; no apuestes por estas alertas.`
        : `CLV de las discrepancias ${(clvRow.mean * 100).toFixed(1)} % (n=${clvRow.n}): todavía no se distingue de cero.`
    );
  }

  return {
    clv: clvRow,
    towardModel: toward.n ? { n: toward.n, rate: toward.hits / toward.n, ci: wilson(toward.hits, toward.n) } : null,
    vsClosing: vsClose.n ? { n: vsClose.n, logLossModel: vsClose.llModel / vsClose.n, logLossClose: vsClose.llClose / vsClose.n } : null,
    clvBacktest: CLV_BACKTEST,
    matches: rows.length,
    lateSnapshots: late,
    oneXTwo: n1x2 ? { n: n1x2, logLoss: ll / n1x2, hitRate: hits / n1x2, hitCi: wilson(hits, n1x2) } : null,
    markets: marketRows,
    calibration,
    flags: flagRows,
    absence: absence.n
      ? {
          n: absence.n,
          maeAdjusted: absence.errAdj / absence.n,
          maeBase: absence.errBase / absence.n,
          goals: absence.goals / absence.n,
          expectedAdjusted: absence.adj / absence.n,
          expectedBase: absence.base / absence.n,
        }
      : null,
    players: {
      score: players.score.n ? { n: players.score.n, brier: players.score.brier / players.score.n, predicted: players.score.pred / players.score.n, observed: players.score.obs / players.score.n } : null,
      shot1: players.shot1.n ? { n: players.shot1.n, brier: players.shot1.brier / players.shot1.n, predicted: players.shot1.pred / players.shot1.n, observed: players.shot1.obs / players.shot1.n } : null,
    },
    tips,
    minSample: MIN,
  };
}
