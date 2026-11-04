"""
Convierte el export del FutbolLab viejo (futbollab_standalone) en JSON limpio
para importarlo en FutbolLab 2.0.

Uso:
  unzip futbollab_standalone.zip -d /tmp/fl
  python3 scripts/legacy/build_legacy_data.py /tmp/fl/futbollab_standalone data/legacy

Qué hace:
  - ligas  -> códigos de la app nueva (seriea, premier, bundesliga, ligue1)
  - equipos -> nombre + liga
  - partidos -> resultado final, deduplicados por (local, visitante, fecha)
  - jugadores -> posición + totales de temporada (minutos, goles, asistencias, tarjetas)
No inventa nada: si un campo no existe en el origen, no se escribe.
"""
import glob
import json
import os
import sys

LEAGUE_CODES = {
    "Serie A": ("seriea", "Italia"),
    "Premier League": ("premier", "Inglaterra"),
    "Bundesliga": ("bundesliga", "Alemania"),
    "Ligue 1": ("ligue1", "Francia"),
    "LaLiga": ("laliga", "España"),
}
POSITIONS = {"GK": "GK", "DF": "DF", "MF": "MF", "FW": "FW"}
# El FutbolLab viejo tenía algunos equipos duplicados con otro nombre
TEAM_ALIASES = {"napoli": "napoles", "hamburger sv": "hamburgo"}


def canonical_name(name):
    import unicodedata
    n = unicodedata.normalize("NFD", name)
    n = "".join(c for c in n if unicodedata.category(c) != "Mn").lower().strip()
    return TEAM_ALIASES.get(n, n)


def load_dir(path):
    out = []
    for f in sorted(glob.glob(os.path.join(path, "*.json"))):
        with open(f, encoding="utf-8") as fh:
            txt = fh.read().strip()
        if txt:
            out.append(json.loads(txt))
    return out


def to_int(v):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def main(src, dst):
    db = os.path.join(src, "brain", "database")
    leagues_raw = load_dir(os.path.join(db, "leagues"))
    league_by_id = {}
    for lg in leagues_raw:
        if lg.get("name") in LEAGUE_CODES:
            code, country = LEAGUE_CODES[lg["name"]]
            league_by_id[lg["id"]] = {"legacyId": lg["id"], "code": code, "name": lg["name"], "country": country}

    matches_raw = [m for m in load_dir(os.path.join(db, "tracker")) if str(m.get("id", "")).startswith("tr_")]
    teams_raw = {t["id"]: t for t in load_dir(os.path.join(db, "teams"))}

    matches, seen, team_league, team_names = [], set(), {}, {}
    skipped = {"sin_marcador": 0, "liga_desconocida": 0, "duplicado": 0}
    for m in matches_raw:
        hg, ag = to_int(m.get("homeGoals")), to_int(m.get("awayGoals"))
        if hg is None or ag is None:
            skipped["sin_marcador"] += 1
            continue
        lg = league_by_id.get(m.get("leagueId"))
        if not lg:
            skipped["liga_desconocida"] += 1
            continue
        date = str(m.get("date", ""))[:10]
        key = (m["homeId"], m["awayId"], date)
        if key in seen:
            skipped["duplicado"] += 1
            continue
        seen.add(key)
        matches.append({
            "legacyId": m["id"], "league": lg["code"], "date": date,
            "homeLegacyId": m["homeId"], "awayLegacyId": m["awayId"],
            "homeGoals": hg, "awayGoals": ag,
        })
        for side in ("home", "away"):
            tid = m[f"{side}Id"]
            team_league.setdefault(tid, lg["code"])
            if m.get(f"{side}Name"):
                team_names.setdefault(tid, m[f"{side}Name"])
    matches.sort(key=lambda r: (r["date"], r["legacyId"]))

    # Equipos: se fusionan duplicados (mismo nombre canónico y liga). Se queda
    # el id con más partidos; los demás pasan a `mergedLegacyIds`.
    played = {}
    for m in matches:
        for k in ("homeLegacyId", "awayLegacyId"):
            played[m[k]] = played.get(m[k], 0) + 1
    groups = {}
    for tid, code in sorted(team_league.items()):
        name = (teams_raw.get(tid) or {}).get("name") or team_names.get(tid)
        if not name:
            continue
        groups.setdefault((code, canonical_name(name)), []).append((played.get(tid, 0), tid, name))
    teams, remap = [], {}
    for (code, _), members in sorted(groups.items()):
        members.sort(reverse=True)
        _, keep, name = members[0]
        for _, tid, _ in members:
            remap[tid] = keep
        row = {"legacyId": keep, "name": name, "league": code}
        if len(members) > 1:
            row["mergedLegacyIds"] = [tid for _, tid, _ in members[1:]]
        teams.append(row)
    deduped, seen2 = [], set()
    for m in matches:
        if m["homeLegacyId"] not in remap or m["awayLegacyId"] not in remap:
            continue
        m["homeLegacyId"], m["awayLegacyId"] = remap[m["homeLegacyId"]], remap[m["awayLegacyId"]]
        key = (m["homeLegacyId"], m["awayLegacyId"], m["date"])
        if key in seen2:
            skipped["duplicado"] += 1
            continue
        seen2.add(key)
        deduped.append(m)
    matches = deduped
    team_ids = set(remap)

    players = []
    for p in load_dir(os.path.join(db, "players")):
        if p.get("teamId") not in team_ids or not p.get("name"):
            continue
        pos = POSITIONS.get(str(p.get("pos") or p.get("position") or "").upper())
        row = {"legacyId": p["id"], "teamLegacyId": remap[p["teamId"]], "name": p["name"], "position": pos or "MF"}
        season = {k: to_int(p.get(k)) for k in ("appearances", "minutes", "goals", "assists", "yellowCards", "redCards")}
        season = {k: v for k, v in season.items() if v is not None}
        if season.get("minutes"):
            row["seasonStats"] = season
        for k in ("age", "number"):
            if to_int(p.get(k)) is not None:
                row[k] = to_int(p.get(k))
        players.append(row)

    os.makedirs(dst, exist_ok=True)
    payload = {
        "leagues": sorted(league_by_id.values(), key=lambda x: x["code"]),
        "teams": teams,
        "matches": matches,
        "players": players,
    }
    for k, v in payload.items():
        with open(os.path.join(dst, f"{k}.json"), "w", encoding="utf-8") as fh:
            json.dump(v, fh, ensure_ascii=False, separators=(",", ":"))
    print({k: len(v) for k, v in payload.items()}, "omitidos:", skipped)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
