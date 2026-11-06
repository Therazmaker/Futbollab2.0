"""
Genera data/legacy/laliga_teams.json y laliga_matches.json a partir de los CSV
públicos de football-data.co.uk (LaLiga, código SP1).

Uso:
  python3 scripts/legacy/build_laliga.py CSV_DIR
CSV_DIR debe tener SP1_2324.csv, SP1_2425.csv… (https://football-data.co.uk/mmz4281/<temporada>/SP1.csv)
"""
import csv, glob, json, os, re, sys
from datetime import datetime

# Nombre del CSV -> (nombre en la app, alias para enlazar con equipos ya creados a mano)
TEAMS = {
    "Alaves": ("Alavés", ["Deportivo Alavés"]),
    "Almeria": ("Almería", ["UD Almería"]),
    "Ath Bilbao": ("Athletic Club", ["Athletic Bilbao", "Athletic", "Ath Bilbao"]),
    "Ath Madrid": ("Atlético de Madrid", ["Atlético Madrid", "Atletico", "Atleti", "Ath Madrid"]),
    "Barcelona": ("Barcelona", ["FC Barcelona", "Barça", "Barca"]),
    "Betis": ("Real Betis", ["Betis"]),
    "Cadiz": ("Cádiz", []),
    "Celta": ("Celta de Vigo", ["Celta", "RC Celta"]),
    "Elche": ("Elche", []),
    "Espanol": ("Espanyol", ["Espanol", "RCD Espanyol"]),
    "Getafe": ("Getafe", []),
    "Girona": ("Girona", []),
    "Granada": ("Granada", []),
    "La Coruna": ("Deportivo de La Coruña", ["Deportivo", "Deportivo La Coruña", "La Coruña", "Depor"]),
    "Las Palmas": ("Las Palmas", ["UD Las Palmas"]),
    "Leganes": ("Leganés", []),
    "Levante": ("Levante", []),
    "Malaga": ("Málaga", []),
    "Mallorca": ("Mallorca", ["RCD Mallorca"]),
    "Osasuna": ("Osasuna", ["CA Osasuna"]),
    "Oviedo": ("Real Oviedo", ["Oviedo"]),
    "Real Madrid": ("Real Madrid", []),
    "Santander": ("Racing de Santander", ["Racing Santander", "Racing"]),
    "Sevilla": ("Sevilla", []),
    "Sociedad": ("Real Sociedad", ["Sociedad"]),
    "Valencia": ("Valencia", []),
    "Valladolid": ("Real Valladolid", ["Valladolid"]),
    "Vallecano": ("Rayo Vallecano", ["Rayo"]),
    "Villarreal": ("Villarreal", []),
}

slug = lambda s: re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def main(csv_dir: str):
    seen_teams, matches = set(), []
    for path in sorted(glob.glob(os.path.join(csv_dir, "SP1_*.csv"))):
        season = os.path.basename(path)[4:8]
        with open(path, encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                h, a = r.get("HomeTeam"), r.get("AwayTeam")
                if not h or not a or r.get("FTHG", "") == "" or r.get("FTAG", "") == "":
                    continue
                if h not in TEAMS or a not in TEAMS:
                    raise SystemExit(f"Equipo sin mapear: {h} / {a}")
                d = r["Date"]
                date = datetime.strptime(d, "%d/%m/%Y" if len(d.split("/")[-1]) == 4 else "%d/%m/%y").strftime("%Y-%m-%d")
                seen_teams.update([h, a])
                matches.append({
                    "legacyId": f"sp1_{season}_{date}_{slug(h)}_{slug(a)}",
                    "league": "laliga",
                    "date": date,
                    "homeLegacyId": f"sp_{slug(h)}",
                    "awayLegacyId": f"sp_{slug(a)}",
                    "homeGoals": int(r["FTHG"]),
                    "awayGoals": int(r["FTAG"]),
                })
    teams = [
        {"legacyId": f"sp_{slug(k)}", "name": TEAMS[k][0], "league": "laliga", "aliases": TEAMS[k][1]}
        for k in sorted(seen_teams)
    ]
    matches.sort(key=lambda m: (m["date"], m["legacyId"]))
    out = os.path.join(os.path.dirname(__file__), "..", "..", "data", "legacy")
    json.dump(teams, open(os.path.join(out, "laliga_teams.json"), "w"), ensure_ascii=False, indent=1)
    json.dump(matches, open(os.path.join(out, "laliga_matches.json"), "w"), ensure_ascii=False, indent=1)
    print(f"{len(teams)} equipos, {len(matches)} partidos ({matches[0]['date']} → {matches[-1]['date']})")


if __name__ == "__main__":
    main(sys.argv[1])
