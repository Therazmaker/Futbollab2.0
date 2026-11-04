import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const getTeams = query({
  args: { league: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("teams").collect();
    if (args.league && args.league !== "all") {
      return all.filter((t: any) => t.league === args.league);
    }
    return all;
  },
});

export const updateTeam = mutation({
  args: {
    teamId: v.id("teams"),
    name: v.optional(v.string()),
    crestUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: any = {};
    if (args.name !== undefined) patch.name = args.name;
    if (args.crestUrl !== undefined) patch.crestUrl = args.crestUrl;
    await ctx.db.patch(args.teamId, patch);
  },
});
