/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as legacy from "../legacy.js";
import type * as lib_engine from "../lib/engine.js";
import type * as lib_leagueTable from "../lib/leagueTable.js";
import type * as lib_playerModel from "../lib/playerModel.js";
import type * as lib_ratingModel from "../lib/ratingModel.js";
import type * as lib_ratingStore from "../lib/ratingStore.js";
import type * as lib_teamMatches from "../lib/teamMatches.js";
import type * as lib_teamRatings from "../lib/teamRatings.js";
import type * as players from "../players.js";
import type * as predictions from "../predictions.js";
import type * as teams from "../teams.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  legacy: typeof legacy;
  "lib/engine": typeof lib_engine;
  "lib/leagueTable": typeof lib_leagueTable;
  "lib/playerModel": typeof lib_playerModel;
  "lib/ratingModel": typeof lib_ratingModel;
  "lib/ratingStore": typeof lib_ratingStore;
  "lib/teamMatches": typeof lib_teamMatches;
  "lib/teamRatings": typeof lib_teamRatings;
  players: typeof players;
  predictions: typeof predictions;
  teams: typeof teams;
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
