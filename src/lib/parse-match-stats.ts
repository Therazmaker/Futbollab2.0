/**
 * Lee las estadísticas de un jugador pegadas desde Sofascore / FotMob
 * (en inglés o español) con el formato "etiqueta" en una línea y "valor" en la
 * siguiente. Las cabeceras de sección ("General", "Passing"…) se ignoran.
 *
 * Valores que entiende:
 *   "1.24"              → número
 *   "27/30 (90%)"       → acertados / intentos (%)
 *   "13 (8)"            → intentos (ganados/acertados)
 *   "11.2 km", "32.2 km/h", "128.8 m"  → número (unidad fuera)
 *   "8.22 km (73.2%)"   → número + %
 *
 * Devuelve las stats con nombres en camelCase y, para las que usa el modelo,
 * los nombres que espera (totalShots, xG, keyPasses, groundDuelsWon, rating…).
 * Nunca inventa valores: lo que no está en el texto no aparece.
 */

export interface ParsedStats {
  stats: Record<string, number>;
  minutesPlayed?: number;
  recognized: number;
  unknownLines: string[];
}

/** Etiqueta normalizada → clave. "won" = el número entre paréntesis. */
type Target = { key: string; inner?: string; pct?: string; total?: string };

const LABELS: Array<[RegExp, Target]> = [
  // General
  [/^(goals|goles)$/, { key: "goals" }],
  [/^(expected goals|goles esperados)( \(xg\))?$|^xg$/, { key: "xG" }],
  [/^(assists|asistencias)$/, { key: "assists" }],
  [/^(expected assists|asistencias esperadas)( \(xa\))?$|^xa$/, { key: "xA" }],
  [/^(minutes played|minutos jugados|minutes|minutos)$/, { key: "minutesPlayed" }],
  [/^(sofascore rating|rating|valoracion|valoracion sofascore|nota|fotmob rating)$/, { key: "rating" }],
  // Pases
  [/^(key passes|pases clave)$/, { key: "keyPasses" }],
  [/^(crosses|centros)( \((accurate|precisos|acertados)\))?$/, { key: "crosses", inner: "crossesAccurate" }],
  [/^(accurate passes|pases precisos|pases acertados)$/, { key: "accuratePasses", total: "totalPasses", pct: "accuratePassesPct" }],
  [/^(passes in opposition half|pases en campo rival)( \(acc\.?\))?$/, { key: "oppHalfPassesAccurate", total: "oppHalfPasses", pct: "oppHalfPassesPct" }],
  [/^(passes in own half|pases en campo propio)( \(acc\.?\))?$/, { key: "ownHalfPassesAccurate", total: "ownHalfPasses", pct: "ownHalfPassesPct" }],
  [/^(long balls|balones largos|pases largos)( \((accurate|precisos|acertados)\))?$/, { key: "longBallsAccurate", total: "longBalls", pct: "longBallsPct" }],
  // Carrera
  [/^(distance covered|distancia recorrida)$/, { key: "distanceKm" }],
  [/^(top speed|velocidad maxima)$/, { key: "topSpeedKmh" }],
  [/^(number of sprints|sprints|numero de sprints)$/, { key: "sprints" }],
  [/^(walking \+ jogging|caminando \+ trotando)$/, { key: "walkJogKm", pct: "walkJogPct" }],
  [/^(running|corriendo|carrera)$/, { key: "runningKm", pct: "runningPct" }],
  [/^(high-speed running|carrera a alta velocidad)$/, { key: "highSpeedKm", pct: "highSpeedPct" }],
  [/^(sprinting|esprintando)$/, { key: "sprintingKm", pct: "sprintingPct" }],
  // Tiro
  [/^(total shots|tiros totales|remates totales|tiros|remates)$/, { key: "totalShots" }],
  [/^(expected goals on target|goles esperados a puerta)( \(xgot\))?$|^xgot$/, { key: "xGOT" }],
  [/^(shots on target|tiros a puerta|remates a puerta)$/, { key: "shotsOnTarget" }],
  [/^(shots off target|tiros fuera|remates fuera)$/, { key: "shotsOffTarget" }],
  [/^(shots blocked|tiros bloqueados|remates bloqueados)$/, { key: "shotsBlocked" }],
  [/^(big chances missed|ocasiones claras falladas|grandes ocasiones falladas)$/, { key: "bigChancesMissed" }],
  [/^(big chances created|ocasiones claras creadas|grandes ocasiones creadas)$/, { key: "bigChancesCreated" }],
  [/^(offsides|fueras de juego|fuera de juego)$/, { key: "offsides" }],
  [/^(hit woodwork|al palo|tiros al palo)$/, { key: "hitWoodwork" }],
  // Regate y posesión
  [/^(touches|toques)$/, { key: "touches" }],
  [/^(unsuccessful touches|toques fallidos|malos controles)$/, { key: "unsuccessfulTouches" }],
  [/^(dribbles|regates)( \((successful|exitosos|completados)\))?$/, { key: "dribbles", inner: "dribblesCompleted" }],
  [/^(was fouled|faltas recibidas)$/, { key: "wasFouled" }],
  [/^(possession lost|posesion perdida|perdidas de balon)$/, { key: "possessionLost" }],
  [/^(total carrying distance|distancia total en conduccion)$/, { key: "carryDistanceM" }],
  [/^(carries|conducciones)$/, { key: "carries" }],
  [/^(progressive carries|conducciones progresivas)$/, { key: "progressiveCarries" }],
  [/^(total progression|progresion total)$/, { key: "totalProgressionM" }],
  [/^(progressive carrying distance|distancia de conduccion progresiva)$/, { key: "progressiveCarryM" }],
  [/^(longest progressive carry|conduccion progresiva mas larga)$/, { key: "longestProgressiveCarryM" }],
  // Defensa
  [/^(def\.? contributions|defensive contributions|contribuciones defensivas)$/, { key: "defensiveContributions" }],
  [/^(tackles|entradas)( \((won|ganadas|exitosas)\))?$/, { key: "tackles", inner: "tacklesWon" }],
  [/^(interceptions|intercepciones)$/, { key: "interceptions" }],
  [/^(clearances|despejes)$/, { key: "clearances" }],
  [/^(blocked shots|tiros bloqueados \(def\)|remates bloqueados \(def\))$/, { key: "blockedShots" }],
  [/^(recoveries|recuperaciones)$/, { key: "recoveries" }],
  [/^(ground duels|duelos en el suelo|duelos terrestres|duelos por abajo)( \((won|ganados)\))?$/, { key: "groundDuels", inner: "groundDuelsWon" }],
  [/^(aerial duels|duelos aereos)( \((won|ganados)\))?$/, { key: "aerialDuels", inner: "aerialDuelsWon" }],
  [/^(duels|duelos)( \((won|ganados)\))?$/, { key: "duels", inner: "duelsWon" }],
  [/^(fouls|faltas|faltas cometidas)$/, { key: "fouls" }],
  [/^(dribbled past|regateado|le regatearon)$/, { key: "dribbledPast" }],
  [/^(yellow cards?|tarjetas? amarillas?)$/, { key: "yellowCards" }],
  [/^(red cards?|tarjetas? rojas?)$/, { key: "redCards" }],
  // Portero
  [/^(saves|paradas)$/, { key: "saves" }],
  [/^(goals prevented|goles evitados)$/, { key: "goalsPrevented" }],
];

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const NUM = String.raw`-?\d+(?:[.,]\d+)?`;
const num = (s: string) => Number(s.replace(",", "."));

/** ¿Es una línea de valor? (empieza por número) */
function parseValue(line: string): { main: number; second?: number; pct?: number } | null {
  const t = line.trim().replace(/['’]$/, "");
  let m = t.match(new RegExp(`^(${NUM})\\s*/\\s*(${NUM})(?:\\s*\\((${NUM})\\s*%\\))?$`));
  if (m) return { main: num(m[1]), second: num(m[2]), pct: m[3] !== undefined ? num(m[3]) : undefined };
  m = t.match(new RegExp(`^(${NUM})\\s*(?:km/h|km|m|%)?\\s*\\((${NUM})\\s*%\\)$`));
  if (m) return { main: num(m[1]), pct: num(m[2]) };
  m = t.match(new RegExp(`^(${NUM})\\s*\\((${NUM})\\)$`));
  if (m) return { main: num(m[1]), second: num(m[2]) };
  m = t.match(new RegExp(`^(${NUM})\\s*(?:km/h|km|m|%|min)?$`));
  if (m) return { main: num(m[1]) };
  return null;
}

function camel(label: string) {
  return norm(label)
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""))
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
}

export function parseMatchStats(text: string): ParsedStats {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const stats: Record<string, number> = {};
  const unknownLines: string[] = [];
  let recognized = 0;

  for (let i = 0; i < lines.length; i++) {
    const label = lines[i];
    // También acepta "Etiqueta: valor" o "Etiqueta<TAB>valor" en una sola línea
    const inline = label.match(/^(.+?)\s*[:\t]\s*(.+)$/);
    let valueLine: string | undefined;
    let labelText = label;
    if (inline && parseValue(inline[2])) {
      labelText = inline[1];
      valueLine = inline[2];
    } else if (i + 1 < lines.length && parseValue(lines[i + 1]) && !parseValue(label)) {
      valueLine = lines[i + 1];
      i++;
    } else {
      continue; // cabecera de sección o línea suelta
    }
    const value = parseValue(valueLine)!;
    const n = norm(labelText);
    const hit = LABELS.find(([re]) => re.test(n));
    if (!hit) {
      // Desconocida: se guarda igual con un nombre derivado (no se pierde info)
      const key = camel(labelText);
      if (key) {
        stats[key] = value.main;
        if (value.second !== undefined) stats[`${key}Second`] = value.second;
        if (value.pct !== undefined) stats[`${key}Pct`] = value.pct;
        unknownLines.push(labelText);
      }
      continue;
    }
    const target = hit[1];
    recognized++;
    if (target.total && value.second !== undefined) {
      // "27/30 (90%)" → acertados / total
      stats[target.key] = value.main;
      stats[target.total] = value.second;
      if (target.pct && value.pct !== undefined) stats[target.pct] = value.pct;
      continue;
    }
    stats[target.key] = value.main;
    if (target.inner && value.second !== undefined) stats[target.inner] = value.second;
    if (target.pct && value.pct !== undefined) stats[target.pct] = value.pct;
  }

  const minutesPlayed = stats.minutesPlayed;
  delete stats.minutesPlayed;
  return { stats, minutesPlayed, recognized, unknownLines };
}
