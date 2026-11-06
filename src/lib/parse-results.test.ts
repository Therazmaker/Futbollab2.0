import { describe, expect, test } from "vitest";
import { parseResults } from "./parse-results";

describe("pegar resultados", () => {
  test("una línea por partido, con y sin fecha", () => {
    const { rows } = parseResults(
      `2026-11-07 Valencia 1-2 Real Madrid
08/11/2026 Atlético de Madrid 3 - 0 Getafe
Real Betis 2:2 Sevilla
09.11. 21:00 Girona 0-1 Barcelona`,
      "2026-11-10"
    );
    expect(rows).toEqual([
      { date: "2026-11-07", home: "Valencia", away: "Real Madrid", homeGoals: 1, awayGoals: 2 },
      { date: "2026-11-08", home: "Atlético de Madrid", away: "Getafe", homeGoals: 3, awayGoals: 0 },
      { date: "2026-11-08", home: "Real Betis", away: "Sevilla", homeGoals: 2, awayGoals: 2 },
      { date: "2026-11-09", home: "Girona", away: "Barcelona", homeGoals: 0, awayGoals: 1 },
    ]);
  });

  test("bloques tipo FlashScore / Sofascore", () => {
    const { rows } = parseResults(
      `07.11. 21:00
Valencia
Real Madrid
1
2
FT
Osasuna
Celta de Vigo
0
0`,
      "2026-11-10"
    );
    expect(rows).toEqual([
      { date: "2026-11-07", home: "Valencia", away: "Real Madrid", homeGoals: 1, awayGoals: 2 },
      { date: "2026-11-07", home: "Osasuna", away: "Celta de Vigo", homeGoals: 0, awayGoals: 0 },
    ]);
  });

  test("CSV con cabecera de football-data y sin cabecera", () => {
    const a = parseResults(`Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG\nSP1,15/08/2026,18:30,Alaves,Getafe,3,0`, "2026-11-10");
    expect(a.rows).toEqual([{ date: "2026-08-15", home: "Alaves", away: "Getafe", homeGoals: 3, awayGoals: 0 }]);
    const b = parseResults(`2026-10-01;Elche;Levante;1;1`, "2026-11-10");
    expect(b.rows[0]).toMatchObject({ home: "Elche", away: "Levante", homeGoals: 1, awayGoals: 1 });
  });

  test("no inventa partidos con datos incompletos", () => {
    const { rows, skipped } = parseResults(`Valencia\nReal Madrid\n1`, "2026-11-10");
    expect(rows).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });
});
