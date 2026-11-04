import { describe, expect, test } from "vitest";
import { parseMatchStats } from "./parse-match-stats";

const SOFASCORE_EN = `General
Goals
0
Expected goals (xG)
1.24
Assists
0
Expected assists (xA)
0.06
Passing
Key passes
0
Crosses (accurate)
1 (0)
Accurate passes
27/30 (90%)
Passes in opposition half (acc.)
16/18 (89%)
Passes in own half (acc.)
11/12 (92%)
Long balls (accurate)
2/3 (67%)
Running
Distance covered
11.2 km
Top speed
32.2 km/h
Number of sprints
16
Walking + jogging
8.22 km (73.2%)
Running
1.82 km (16.2%)
High-speed running
0.77 km (6.9%)
Sprinting
0.35 km (3.1%)
Shooting
Total shots
2
Expected goals on target (xGOT)
0.79
Shots on target
2
Shots blocked
0
Big chances missed
2
Offsides
1
Dribbling
Touches
55
Unsuccessful touches
2
Dribbles (successful)
2 (1)
Was fouled
4
Possession lost
9
Total carrying distance
128.8 m
Carries
15
Progressive carries
2
Total progression
59.9 m
Progressive carrying distance
46.2 m
Longest progressive carry
23.8 m
Defending
Def. contributions
7
Tackles (won)
3 (2)
Interceptions
1
Clearances
3
Blocked shots
0
Recoveries
4
Ground duels (won)
13 (8)
Aerial duels (won)
4 (2)
Fouls
1
Dribbled past
2`;

describe("parseMatchStats", () => {
  test("lee el bloque de Sofascore completo", () => {
    const { stats, unknownLines, recognized } = parseMatchStats(SOFASCORE_EN);
    expect(unknownLines).toEqual([]);
    expect(recognized).toBe(44);
    expect(stats).toMatchObject({
      goals: 0,
      xG: 1.24,
      assists: 0,
      xA: 0.06,
      keyPasses: 0,
      crosses: 1,
      crossesAccurate: 0,
      accuratePasses: 27,
      totalPasses: 30,
      accuratePassesPct: 90,
      longBallsAccurate: 2,
      longBalls: 3,
      distanceKm: 11.2,
      topSpeedKmh: 32.2,
      sprints: 16,
      walkJogKm: 8.22,
      walkJogPct: 73.2,
      runningKm: 1.82,
      sprintingKm: 0.35,
      totalShots: 2,
      xGOT: 0.79,
      shotsOnTarget: 2,
      shotsBlocked: 0,
      bigChancesMissed: 2,
      offsides: 1,
      touches: 55,
      dribbles: 2,
      dribblesCompleted: 1,
      carryDistanceM: 128.8,
      longestProgressiveCarryM: 23.8,
      defensiveContributions: 7,
      tackles: 3,
      tacklesWon: 2,
      interceptions: 1,
      clearances: 3,
      blockedShots: 0,
      recoveries: 4,
      groundDuels: 13,
      groundDuelsWon: 8,
      aerialDuels: 4,
      aerialDuelsWon: 2,
      fouls: 1,
      dribbledPast: 2,
    });
  });

  test("español, minutos y nota, y formato 'etiqueta: valor'", () => {
    const r = parseMatchStats("Minutos jugados\n78'\nValoración\n7.4\nTiros totales: 3\nDuelos en el suelo (ganados)\n9 (5)");
    expect(r.minutesPlayed).toBe(78);
    expect(r.stats).toMatchObject({ rating: 7.4, totalShots: 3, groundDuels: 9, groundDuelsWon: 5 });
  });

  test("no inventa lo que no está", () => {
    const r = parseMatchStats("General\nGoals\n1");
    expect(r.stats).toEqual({ goals: 1 });
  });
});
