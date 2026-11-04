# FutbolLab 2.0 - Tactical HUD & Predictive Analytics ⚽🧠

FutbolLab 2.0 es una plataforma de inteligencia táctica y analítica predictiva de fútbol basada en los prototipos de **Google Stitch**, impulsada por **Next.js 14 (App Router)**, **Convex** como backend reactivo en tiempo real, y un **Motor Offline-First** con IndexedDB (Dexie) para sincronización continua sin pérdida de datos.

---

## ⚡ Características Principales

1. **Diseño fiel a Google Stitch:**
   - **Leagues & Teams Explorer:** Selector de ligas (LaLiga, Premier, Serie A, Champions, Bundesliga), buscador en tiempo real, ordenamiento por xT, densidad y puntos, catálogo con Win Rate, xG/90, PPDA y formaciones.
   - **Player Profile & Predictive Lab:** Ficha de Jude Bellingham (#5), rating predictivo en vivo (9.42/10), comparativa Expected vs Observed p90 (disparos, pases clave, duelos aéreos, xT) y simulador interactivo de fatiga e infiltración.
   - **Team View - Tactical & Squad Hub:** Bento card de club (Real Madrid CF), simulación Monte Carlo de partido contra Athletic Club en San Mamés, **pizarra táctica 2D interactiva** con alineaciones dinámicas (4-3-1-2 / 4-3-3) y lista de plantilla con índice de fatiga.

2. **Sincronización Instantánea y Modo Offline:**
   - **Tiempo real con Convex:** Suscripciones reactivas ultrarrápidas mediante WebSockets.
   - **Soporte Offline nativo:** Si no hay conexión (`navigator.onLine === false`), las acciones (ajustes tácticos, simulaciones de partido, recálculos) se guardan de inmediato en la base de datos local (IndexedDB) con estado `pending`.
   - **Auto-Sync:** Al restablecerse la conexión, el `SyncEngine` vacía la cola en orden cronológico y sincroniza con Convex sin intervención del usuario.
   - **HUD Telemetría:** Indicador visual en la cabecera mostrando estado `ACTIVO`, `CONVEX EN VIVO`, `SINCRONIZANDO (X)` o `OFFLINE (X PENDIENTES)`.

---

## 🧠 Motor de perfil del jugador (`convex/lib/engine.ts`)

La lógica del criminalista: primero la **tasa base del tipo** (su posición), después la **evidencia del individuo**, y solo nos alejamos de la base cuando la evidencia alcanza.

* **Firma por 90'**: tiros, xG, pases clave y duelos se modelan como Poisson por minuto jugado, con prior Gamma = media de la posición (vale 3 partidos completos). Un partido de 20' ya no cuenta como uno de 90'.
* **Modus operandi**: efectos de contexto (visitante, defensa del rival, etiquetas propias) estimados con todos los partidos a la vez (Newton sobre la verosimilitud penalizada). Se recalculan desde cero en cada cambio, así que editar o borrar un partido corrige el perfil.
* **Predicción = distribución**: Binomial Negativa → media, intervalo 80% y P(≥1), P(≥2). La "confianza" es el % del pronóstico que sale de datos propios.
* **Curva de aprendizaje honesta**: cada partido se predice solo con los anteriores (walk-forward) y se compara con la realidad, contra un método ingenuo y contra el piso de ruido (el error que ningún modelo puede evitar).
* **Nada inventado**: si falta una stat, no se rellena. El endpoint `/api/ingest-match` responde 422 si faltan datos reales.

`npm test` ejecuta los tests del motor y de las funciones de Convex (`convex/model.test.ts`).

## 📦 Histórico del FutbolLab anterior

`data/legacy/` contiene 1.330 partidos (Serie A, Premier, Bundesliga, Ligue 1, ago-2025 → may-2026), 79 equipos y 1.014 jugadores con totales de temporada, generados con:

```bash
python3 scripts/legacy/build_legacy_data.py /ruta/futbollab_standalone data/legacy
```

En la app, el explorador de ligas muestra el botón **Importar histórico** (acción `legacy:importLegacyData`, se puede repetir sin duplicar). Al importar se recalculan tablas, forma y la fuerza ataque/defensa de cada equipo (`legacy:recomputeTeamStrength`), que el motor usa como contexto del rival.

---

## 🛠️ Stack Tecnológico

* **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS.
* **Backend Reactivo:** Convex (`https://exciting-blackbird-312.convex.cloud`).
* **Offline Engine:** Dexie.js (IndexedDB wrapper) + Optimistic UI updates.
* **Diseño e Iconografía:** Google Fonts Inter, JetBrains Mono y Material Symbols Outlined (provenientes de Google Stitch).
* **Despliegue:** Optimizado para Vercel.

---

## 🚀 Puesta en Marcha Local

1. Instalar dependencias:
   ```bash
   npm install
   ```

2. Configurar variables de entorno (`.env.local`):
   ```bash
   NEXT_PUBLIC_CONVEX_URL=https://exciting-blackbird-312.convex.cloud
   ```

3. Iniciar el servidor de desarrollo:
   ```bash
   npm run dev
   ```
   Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

---

## 🌐 Despliegue en Vercel

1. Haz push a GitHub:
   ```bash
   git add .
   git commit -m "feat: FutbolLab 2.0 with Convex real-time & offline sync"
   git push origin main
   ```
2. Importa el repositorio `Futbollab2.0` en [Vercel](https://vercel.com).
3. Añade la variable de entorno en Vercel:
   - `NEXT_PUBLIC_CONVEX_URL`: `https://exciting-blackbird-312.convex.cloud`
4. ¡Listo! Vercel desplegará automáticamente con soporte SSR y edge network.
