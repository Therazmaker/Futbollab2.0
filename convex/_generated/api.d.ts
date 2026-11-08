/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as footballData from "../footballData.js";
import type * as legacy from "../legacy.js";
import type * as lib_bold from "../lib/bold.js";
import type * as lib_boldMatch from "../lib/boldMatch.js";
import type * as lib_competitionTable from "../lib/competitionTable.js";
import type * as lib_engine from "../lib/engine.js";
import type * as lib_features from "../lib/features.js";
import type * as lib_footballData from "../lib/footballData.js";
import type * as lib_leagueTable from "../lib/leagueTable.js";
import type * as lib_markets from "../lib/markets.js";
import type * as lib_teamTrends from "../lib/teamTrends.js";
import type * as lib_preview from "../lib/preview.js";
import type * as lib_picks from "../lib/picks.js";
import type * as lib_pickHistory from "../lib/pickHistory.js";
import type * as lib_aiPredict from "../lib/aiPredict.js";
import type * as lib_matchReading from "../lib/matchReading.js";
import type * as lib_narrative from "../lib/narrative.js";
import type * as lib_noLeague from "../lib/noLeague.js";
import type * as lib_playerLayer from "../lib/playerLayer.js";
import type * as lib_playerModel from "../lib/playerModel.js";
import type * as lib_radar from "../lib/radar.js";
import type * as lib_radarMatch from "../lib/radarMatch.js";
import type * as lib_radarSnapshot from "../lib/radarSnapshot.js";
import type * as lib_radarTraining from "../lib/radarTraining.js";
import type * as lib_ratingModel from "../lib/ratingModel.js";
import type * as lib_ratingStore from "../lib/ratingStore.js";
import type * as lib_ruleAi from "../lib/ruleAi.js";
import type * as lib_ruleBacktest from "../lib/ruleBacktest.js";
import type * as lib_ruleMatch from "../lib/ruleMatch.js";
import type * as lib_season from "../lib/season.js";
import type * as lib_teamMatches from "../lib/teamMatches.js";
import type * as lib_thesisAi from "../lib/thesisAi.js";
import type * as lib_teamRatings from "../lib/teamRatings.js";
import type * as lib_xgBlend from "../lib/xgBlend.js";
import type * as narratives from "../narratives.js";
import type * as players from "../players.js";
import type * as radar from "../radar.js";
import type * as radarAi from "../radarAi.js";
import type * as results from "../results.js";
import type * as rules from "../rules.js";
import type * as predictions from "../predictions.js";
import type * as teams from "../teams.js";
import type * as theses from "../theses.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  footballData: typeof footballData;
  legacy: typeof legacy;
  "lib/bold": typeof lib_bold;
  "lib/boldMatch": typeof lib_boldMatch;
  "lib/competitionTable": typeof lib_competitionTable;
  "lib/engine": typeof lib_engine;
  "lib/features": typeof lib_features;
  "lib/footballData": typeof lib_footballData;
  "lib/leagueTable": typeof lib_leagueTable;
  "lib/markets": typeof lib_markets;
  "lib/teamTrends": typeof lib_teamTrends;
  "lib/preview": typeof lib_preview;
  "lib/picks": typeof lib_picks;
  "lib/pickHistory": typeof lib_pickHistory;
  "lib/aiPredict": typeof lib_aiPredict;
  "lib/matchReading": typeof lib_matchReading;
  "lib/narrative": typeof lib_narrative;
  "lib/noLeague": typeof lib_noLeague;
  "lib/playerLayer": typeof lib_playerLayer;
  "lib/playerModel": typeof lib_playerModel;
  "lib/radar": typeof lib_radar;
  "lib/radarMatch": typeof lib_radarMatch;
  "lib/radarSnapshot": typeof lib_radarSnapshot;
  "lib/radarTraining": typeof lib_radarTraining;
  "lib/ratingModel": typeof lib_ratingModel;
  "lib/ratingStore": typeof lib_ratingStore;
  "lib/ruleAi": typeof lib_ruleAi;
  "lib/ruleBacktest": typeof lib_ruleBacktest;
  "lib/ruleMatch": typeof lib_ruleMatch;
  "lib/season": typeof lib_season;
  "lib/teamMatches": typeof lib_teamMatches;
  "lib/thesisAi": typeof lib_thesisAi;
  "lib/teamRatings": typeof lib_teamRatings;
  "lib/xgBlend": typeof lib_xgBlend;
  narratives: typeof narratives;
  players: typeof players;
  radar: typeof radar;
  radarAi: typeof radarAi;
  results: typeof results;
  rules: typeof rules;
  predictions: typeof predictions;
  teams: typeof teams;
  theses: typeof theses;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
