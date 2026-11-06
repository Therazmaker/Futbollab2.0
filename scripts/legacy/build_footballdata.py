"""
Genera data/legacy/fd_teams.json y fd_matches.json con los CSV públicos de
football-data.co.uk (LaLiga, Premier, Serie A, Bundesliga, Ligue 1; 2023-24 → hoy).

Cada partido trae marcador, tiros, tiros a puerta, xG (solo temporadas recientes)
y cuotas medias de cierre. Los partidos que ya estaban en el histórico del
FutbolLab viejo (data/legacy/matches.json) se reutilizan con su mismo legacyId:
así la importación solo les añade las estadísticas, sin duplicarlos.

Uso:
  python3 scripts/legacy/build_footballdata.py CSV_DIR
CSV_DIR con ficheros <DIV>_<temporada>.csv, p. ej. SP1_2627.csv, E0_2526.csv
(https://football-data.co.uk/mmz4281/<temporada>/<DIV>.csv)
"""
import csv, glob, json, os, re, sys, unicodedata
from datetime import datetime, timedelta

DIVS = {"SP1": "laliga", "E0": "premier", "I1": "seriea", "D1": "bundesliga", "F1": "ligue1"}

# LaLiga no estaba en el histórico viejo: nombre en la app + alias para enlazar equipos creados a mano
LALIGA = {
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

# Nombre del CSV -> nombre del equipo en el histórico viejo (cuando no coinciden)
TO_LEGACY = {
    "Leeds": "Leeds Utd", "Man City": "Manchester City", "Man United": "Manchester Utd", "Nott'm Forest": "Nottingham Forest",
    "Bologna": "Bolonia", "Napoli": "Nápoles",
    "Dortmund": "Borussia Dortmund", "Ein Frankfurt": "Eintracht Fráncfort", "FC Koln": "Colonia", "Freiburg": "Friburgo",
    "Hamburg": "Hamburgo", "Heidenheim": "Heidenheim 1846", "Hoffenheim": "TSG Hoffenheim", "Leverkusen": "Bayer Leverkusen",
    "M'gladbach": "Borussia M'gladbach", "Mainz": "FSV Mainz", "Stuttgart": "VfB Stuttgart", "Werder Bremen": "SV Werder Bremen",
    "Wolfsburg": "VfL Wolfsburg",
    "Marseille": "Marsella", "Nice": "Niza", "Paris SG": "PSG", "Rennes": "Stade Rennais", "Strasbourg": "Estrasburgo",
}

# Equipos que no estaban en el histórico (descendidos antes o recién ascendidos)
NEW_NAMES = {
    "Coventry": ("Coventry City", ["Coventry"]), "Hull": ("Hull City", ["Hull"]), "Ipswich": ("Ipswich Town", ["Ipswich"]),
    "Leicester": ("Leicester City", ["Leicester"]), "Luton": ("Luton Town", ["Luton"]),
    "Sheffield United": ("Sheffield United", ["Sheffield Utd"]), "Southampton": ("Southampton", []),
    "Empoli": ("Empoli", []), "Frosinone": ("Frosinone", []), "Monza": ("Monza", []), "Salernitana": ("Salernitana", []),
    "Venezia": ("Venezia", ["Venecia"]),
    "Bochum": ("VfL Bochum", ["Bochum"]), "Darmstadt": ("Darmstadt 98", ["Darmstadt"]), "Elversberg": ("SV Elversberg", ["Elversberg"]),
    "Holstein Kiel": ("Holstein Kiel", []), "Paderborn": ("SC Paderborn", ["Paderborn"]), "Schalke 04": ("Schalke 04", ["Schalke"]),
    "Clermont": ("Clermont Foot", ["Clermont"]), "Le Mans": ("Le Mans", []), "Montpellier": ("Montpellier", []),
    "Reims": ("Stade de Reims", ["Reims"]), "St Etienne": ("Saint-Étienne", ["St Etienne", "Saint Etienne"]), "Troyes": ("Troyes", []),
}


def norm(s):
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"\b(fc|cf|ac|as|ss|ssc|afc|sc|de|club)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


slug = lambda s: re.sub(r"[^a-z0-9]+", "_", norm(s)).strip("_")


def num(r, k):
    v = r.get(k, "")
    try:
        return float(v) if v != "" else None
    except ValueError:
        return None


def main(csv_dir):
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "legacy")
    legacy_teams = json.load(open(os.path.join(root, "teams.json")))
    legacy_matches = json.load(open(os.path.join(root, "matches.json")))
    by_name = {(t["league"], norm(t["name"])): t["legacyId"] for t in legacy_teams}
    # Partidos del histórico por (local, visitante) -> [(fecha, legacyId)]
    old = {}
    for m in legacy_matches:
        old.setdefault((m["homeLegacyId"], m["awayLegacyId"]), []).append((m["date"], m["legacyId"]))

    new_teams = {}

    def team_id(div, name):
        lg = DIVS[div]
        if lg == "laliga":
            disp, aliases = LALIGA[name]
            tid = f"sp_{slug(name)}"  # mismo id que la primera importación de LaLiga
            new_teams[tid] = {"legacyId": tid, "name": disp, "league": lg, "aliases": aliases}
            return tid
        key = (lg, norm(TO_LEGACY.get(name, name)))
        if key in by_name:
            return by_name[key]
        if name not in NEW_NAMES:
            raise SystemExit(f"Equipo sin mapear: {div} {name}")
        disp, aliases = NEW_NAMES[name]
        tid = f"fd_{lg}_{slug(name)}"
        new_teams[tid] = {"legacyId": tid, "name": disp, "league": lg, "aliases": aliases}
        return tid

    out, reused = [], 0
    for path in sorted(glob.glob(os.path.join(csv_dir, "*_*.csv"))):
        div, season = os.path.basename(path)[:-4].split("_")
        if div not in DIVS:
            continue
        with open(path, encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                if not r.get("HomeTeam") or r.get("FTHG", "") == "" or r.get("FTAG", "") == "":
                    continue
                d = r["Date"]
                date = datetime.strptime(d, "%d/%m/%Y" if len(d.split("/")[-1]) == 4 else "%d/%m/%y")
                iso = date.strftime("%Y-%m-%d")
                h, a = team_id(div, r["HomeTeam"]), team_id(div, r["AwayTeam"])
                lid = f"{div.lower()}_{season}_{iso}_{slug(r['HomeTeam'])}_{slug(r['AwayTeam'])}"
                for od, olid in old.get((h, a), []):
                    if abs((datetime.strptime(od, "%Y-%m-%d") - date).days) <= 1:
                        lid, iso = olid, od  # mismo partido que el histórico: se enriquece
                        reused += 1
                        break
                row = {
                    "legacyId": lid, "league": DIVS[div], "date": iso, "homeLegacyId": h, "awayLegacyId": a,
                    "homeGoals": int(r["FTHG"]), "awayGoals": int(r["FTAG"]),
                }
                st = {k: num(r, c) for k, c in (("hs", "HS"), ("as", "AS"), ("hst", "HST"), ("ast", "AST"), ("hxg", "HxG"), ("axg", "AxG"))}
                st = {k: v for k, v in st.items() if v is not None}
                if {"hs", "as", "hst", "ast"} <= st.keys():
                    row["stats"] = st
                co = {k: num(r, c) for k, c in (("home", "AvgCH"), ("draw", "AvgCD"), ("away", "AvgCA"), ("over25", "AvgC>2.5"), ("under25", "AvgC<2.5"))}
                co = {k: v for k, v in co.items() if v and v > 1}
                if {"home", "draw", "away"} <= co.keys():
                    row["closingOdds"] = co
                out.append(row)
    out.sort(key=lambda m: (m["date"], m["legacyId"]))
    teams = sorted(new_teams.values(), key=lambda t: t["legacyId"])
    json.dump(teams, open(os.path.join(root, "fd_teams.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    json.dump(out, open(os.path.join(root, "fd_matches.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"{len(teams)} equipos nuevos, {len(out)} partidos ({reused} ya estaban en el histórico), {out[0]['date']} → {out[-1]['date']}")


if __name__ == "__main__":
    main(sys.argv[1])
