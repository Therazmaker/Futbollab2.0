import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const getClubs = query({
  args: { league: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.league && args.league !== "all") {
      return await ctx.db
        .query("clubs")
        .withIndex("by_league", (q) => q.eq("leagueCode", args.league!))
        .collect();
    }
    return await ctx.db.query("clubs").collect();
  },
});

export const updateClubTactics = mutation({
  args: {
    clubId: v.id("clubs"),
    formation: v.string(),
    tempo: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.clubId, {
      formation: args.formation,
      tempo: args.tempo,
      lastUpdated: Date.now(),
    });
  },
});
