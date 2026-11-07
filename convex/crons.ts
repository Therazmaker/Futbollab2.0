import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Actualización automática desde football-data: resultados, tiros/xG, cuotas de
 * cierre y los próximos partidos de la semana (con su cuota media). Dos veces al
 * día, en horas sin partidos (UTC).
 */
const crons = cronJobs();
crons.cron("actualizar-jornadas-manana", "17 6 * * *", internal.footballData.refreshScheduled, {});
crons.cron("actualizar-jornadas-noche", "47 23 * * *", internal.footballData.refreshScheduled, {});
export default crons;
