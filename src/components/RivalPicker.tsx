"use client";

import React, { useMemo, useState } from "react";
import { activeIn } from "../../convex/lib/noLeague";
import { competitionLabel } from "@/lib/competitions";

interface RivalPickerProps {
  /** Todos los equipos (de api.teams.getTeams) */
  teams: any[];
  /** Equipo propio (se excluye de la lista) */
  excludeId?: string;
  value: string;
  onChange: (teamId: string, team: any | null) => void;
  /** Competición que filtra la lista. Si se omite, el picker muestra su propio selector. */
  competition?: string;
  /** Competiciones a ofrecer en el selector propio (p. ej. la liga del equipo y la UCL). */
  scopes?: string[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

const input =
  "w-full h-9 px-2.5 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary disabled:opacity-60";

/**
 * Elegir rival filtrando por competición (liga doméstica, Champions…), con
 * buscador y la opción de ver todos los equipos.
 */
export function RivalPicker({
  teams,
  excludeId,
  value,
  onChange,
  competition,
  scopes,
  placeholder = "— Rival —",
  required,
  disabled,
  className = "",
}: RivalPickerProps) {
  const [ownScope, setOwnScope] = useState<string>(scopes?.[0] ?? "all");
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const scope = showAll ? "all" : competition ?? ownScope;

  const list = useMemo(() => {
    const q = search
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();
    return teams
      .filter((t) => t._id !== excludeId)
      .filter((t) => scope === "all" || activeIn(t, scope))
      .filter((t) => !q || t.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [teams, excludeId, scope, search]);

  // Si el rival elegido no está en la lista filtrada, se sigue mostrando
  const selected = teams.find((t) => t._id === value);
  const options = selected && !list.some((t) => t._id === value) ? [selected, ...list] : list;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex gap-1.5">
        {competition === undefined && scopes && scopes.length > 0 && (
          <select
            value={showAll ? "all" : ownScope}
            onChange={(e) => {
              setShowAll(false);
              setOwnScope(e.target.value);
            }}
            disabled={disabled}
            className={`${input} !w-36 shrink-0`}
            aria-label="Competición del rival"
          >
            {scopes.map((c) => (
              <option key={c} value={c}>
                {competitionLabel(c) || c}
              </option>
            ))}
            <option value="all">Todos</option>
          </select>
        )}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar rival…"
          disabled={disabled}
          className={`${input} flex-1 min-w-0`}
        />
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value, teams.find((t) => t._id === e.target.value) ?? null)}
        required={required}
        disabled={disabled}
        className={input}
      >
        <option value="">
          {placeholder} {scope !== "all" ? `(${competitionLabel(scope) || scope}: ${list.length})` : `(${list.length})`}
        </option>
        {options.map((t) => (
          <option key={t._id} value={t._id}>
            {t.name}
            {scope === "all" || t.league === "intl" ? ` · ${t.league === "intl" ? "sin liga" : competitionLabel(t.league) || t.league}` : ""}
          </option>
        ))}
      </select>
      {competition !== undefined && competition !== "all" && (
        <label className="flex items-center gap-1.5 font-mono text-[10px] text-on-surface-variant cursor-pointer">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} disabled={disabled} />
          Ver equipos de todas las competiciones
        </label>
      )}
    </div>
  );
}
