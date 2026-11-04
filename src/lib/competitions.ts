/** Competiciones que se pueden asignar a un partido de jugador. */
export const COMPETITIONS: Array<{ code: string; label: string }> = [
  { code: "ucl", label: "🏆 Champions League" },
  { code: "uel", label: "🏆 Europa League" },
  { code: "uecl", label: "🏆 Conference League" },
  { code: "laliga", label: "🇪🇸 LaLiga" },
  { code: "premier", label: "🇬🇧 Premier League" },
  { code: "seriea", label: "🇮🇹 Serie A" },
  { code: "bundesliga", label: "🇩🇪 Bundesliga" },
  { code: "ligue1", label: "🇫🇷 Ligue 1" },
  { code: "copa", label: "🏆 Copa nacional" },
  { code: "supercopa", label: "🏆 Supercopa" },
  { code: "amistoso", label: "🤝 Amistoso" },
  { code: "seleccion", label: "🌍 Selección" },
];

export const competitionLabel = (code?: string) =>
  COMPETITIONS.find((c) => c.code === code)?.label.replace(/^\S+\s/, "") ?? (code ? code.toUpperCase() : "");
