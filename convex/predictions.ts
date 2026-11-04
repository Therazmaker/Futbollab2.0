import { mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Computes Exponential Moving Average (EMA) and applies active contextual weights
 * to generate next-match predictive performance vectors.
 */
export const calculateAndPredict = mutation({
  args: {
    playerId: v.id("players"),
    opponent: v.string(),
    isAway: v.boolean(),
    tacticalRole: v.optional(v.string()),
    contextFeatures: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // 1. Fetch recent match history for player (up to 10 matches)
    const logs = await ctx.db
      .query("playerMatchLogs")
      .withIndex("by_player", (q: any) => q.eq("playerId", args.playerId))
      .collect();

    logs.sort((a: any, b: any) => (a.matchDate < b.matchDate ? 1 : -1));
    const recentLogs = logs.slice(0, 8);

    // 2. Exponential Moving Average (EMA) with smoothing factor alpha = 0.35
    const alpha = 0.35;
    let baselineShots = 2.2;
    let baselineXg = 0.32;
    let baselineKeyPasses = 2.5;
    let baselineRating = 8.0;

    if (recentLogs.length > 0) {
      let weightedShots = 0;
      let weightedXg = 0;
      let weightedKeyPasses = 0;
      let weightedRating = 0;
      let totalWeight = 0;

      recentLogs.forEach((log: any, idx: number) => {
        const decay = Math.pow(1 - alpha, idx);
        totalWeight += decay;

        const s = log.rawStats?.totalShots ?? log.rawStats?.shots ?? 2.0;
        const x = log.rawStats?.xG ?? 0.3;
        const kp = log.rawStats?.keyPasses ?? 2.0;
        const r = log.rawStats?.rating ?? 8.0;

        weightedShots += s * decay;
        weightedXg += x * decay;
        weightedKeyPasses += kp * decay;
        weightedRating += r * decay;
      });

      if (totalWeight > 0) {
        baselineShots = weightedShots / totalWeight;
        baselineXg = weightedXg / totalWeight;
        baselineKeyPasses = weightedKeyPasses / totalWeight;
        baselineRating = weightedRating / totalWeight;
      }
    }

    // 3. Fetch active contextual weights
    const weights = await ctx.db
      .query("playerWeights")
      .withIndex("by_player_and_feature", (q: any) => q.eq("playerId", args.playerId))
      .collect();

    const weightMap: Record<string, { value: number; confidence: number }> = {};
    weights.forEach((w: any) => {
      weightMap[w.featureName] = { value: w.weightValue, confidence: w.confidenceScore };
    });

    // 4. Context Multipliers
    let multiplier = 1.0;
    const appliedContexts: Array<{ feature: string; impact: number }> = [];

    // Away match penalty or Home match boost
    if (args.isAway) {
      const awayWeight = weightMap["is_away"]?.value ?? -0.12;
      multiplier *= 1 + awayWeight;
      appliedContexts.push({ feature: "is_away", impact: awayWeight });
    } else {
      const homeWeight = weightMap["home_pitch_bias"]?.value ?? 0.084;
      multiplier *= 1 + homeWeight;
      appliedContexts.push({ feature: "home_pitch_bias", impact: homeWeight });
    }

    // Optional context features
    if (args.contextFeatures) {
      for (const feat of args.contextFeatures) {
        if (weightMap[feat]) {
          multiplier *= 1 + weightMap[feat].value;
          appliedContexts.push({ feature: feat, impact: weightMap[feat].value });
        }
      }
    }

    // Final predicted metrics
    const predictedShots = +(baselineShots * multiplier).toFixed(2);
    const predictedXg = +(baselineXg * multiplier).toFixed(2);
    const predictedKeyPasses = +(baselineKeyPasses * multiplier).toFixed(2);

    // Dynamic predictive rating calculation (scale 1 to 10)
    const baseForm = baselineRating + (multiplier - 1.0) * 1.5;
    const predictiveForm = Math.min(9.95, Math.max(6.0, +baseForm.toFixed(2)));

    // Confidence aggregation
    const confidence = +(
      95.0 +
      Math.min(4.5, (recentLogs.length / 10) * 4.0)
    ).toFixed(1);

    const predictedMetrics = {
      totalShots: predictedShots,
      shotsPredicted: +(predictedShots + 0.3).toFixed(2), // Contextual variance ceiling
      xG: predictedXg,
      keyPasses: predictedKeyPasses,
      keyPassesPredicted: +(predictedKeyPasses + 0.3).toFixed(2),
      predictiveForm,
      confidence,
      opponent: args.opponent,
      isAway: args.isAway,
      tacticalRole: args.tacticalRole ?? "AM / Box-to-Box",
      appliedContexts,
    };

    // Save prediction record
    const predictionId = await ctx.db.insert("playerPredictions", {
      playerId: args.playerId,
      predictedMetrics,
      appliedAt: Date.now(),
    });

    return { predictionId, predictedMetrics };
  },
});

/**
 * Ingests match result into playerMatchLogs, computes prediction error deltas,
 * recalibrates playerWeights via gradient step, and outputs the updated model state.
 */
export const recordMatchAndCalibrate = mutation({
  args: {
    playerId: v.id("players"),
    matchDate: v.string(),
    opponent: v.string(),
    opponentTeamId: v.optional(v.id("teams")),
    competition: v.optional(v.string()),
    isAway: v.boolean(),
    minutesPlayed: v.number(),
    rawStats: v.any(),
    tacticalRole: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Ingest into playerMatchLogs
    const matchLogId = await ctx.db.insert("playerMatchLogs", {
      playerId: args.playerId,
      matchDate: args.matchDate,
      opponent: args.opponent,
      opponentTeamId: args.opponentTeamId,
      competition: args.competition || "laliga",
      isAway: args.isAway,
      tacticalRole: args.tacticalRole ?? "AM / Box-to-Box",
      minutesPlayed: args.minutesPlayed,
      rawStats: args.rawStats,
    });

    // 2. Fetch the latest prediction for this player
    const predictions = await ctx.db
      .query("playerPredictions")
      .withIndex("by_player", (q: any) => q.eq("playerId", args.playerId))
      .collect();

    predictions.sort((a: any, b: any) => b.appliedAt - a.appliedAt);
    const latestPred = predictions[0];

    // 3. Extract actual values
    const actualShots = +(args.rawStats?.totalShots ?? args.rawStats?.shots ?? 0);
    const actualXg = +(args.rawStats?.xG ?? 0);
    const actualKeyPasses = +(args.rawStats?.keyPasses ?? 0);

    const actualMetrics = {
      totalShots: actualShots,
      xG: actualXg,
      keyPasses: actualKeyPasses,
      rating: +(args.rawStats?.rating ?? 8.0),
    };

    // 4. Calculate Deltas: actual - predicted
    const predShots = latestPred?.predictedMetrics?.totalShots ?? 2.4;
    const predXg = latestPred?.predictedMetrics?.xG ?? 0.35;
    const predKeyPasses = latestPred?.predictedMetrics?.keyPasses ?? 2.8;

    const deltas = {
      totalShots: +(actualShots - predShots).toFixed(2),
      xG: +(actualXg - predXg).toFixed(2),
      keyPasses: +(actualKeyPasses - predKeyPasses).toFixed(2),
    };

    // 5. Gradient Descent / Feedback Calibration for Weights
    // newWeight = currentWeight + (learningRate * sign(delta) * normalizedDelta)
    const learningRate = 0.05;
    const targetFeature = args.isAway ? "is_away" : "home_pitch_bias";

    const existingWeights = await ctx.db
      .query("playerWeights")
      .withIndex("by_player_and_feature", (q: any) =>
        q.eq("playerId", args.playerId).eq("featureName", targetFeature)
      )
      .first();

    const normalizedDelta = deltas.totalShots / Math.max(predShots, 1.0);
    const gradientStep =
      learningRate * Math.sign(normalizedDelta) * Math.min(Math.abs(normalizedDelta), 1.0);

    let updatedWeightValue = args.isAway ? -0.12 : 0.084;
    let newConfidence = 0.85;

    if (existingWeights) {
      updatedWeightValue = +(existingWeights.weightValue + gradientStep).toFixed(4);
      newConfidence = Math.min(0.99, +(existingWeights.confidenceScore + 0.02).toFixed(2));

      await ctx.db.patch(existingWeights._id, {
        weightValue: updatedWeightValue,
        confidenceScore: newConfidence,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("playerWeights", {
        playerId: args.playerId,
        featureName: targetFeature,
        weightValue: updatedWeightValue,
        confidenceScore: newConfidence,
        updatedAt: Date.now(),
      });
    }

    // 6. Update the prediction record with actuals and deltas
    if (latestPred) {
      await ctx.db.patch(latestPred._id, {
        matchLogId,
        actualMetrics,
        deltas,
      });
    }

    return {
      matchLogId,
      actualMetrics,
      deltas,
      calibratedWeight: {
        featureName: targetFeature,
        newValue: updatedWeightValue,
        confidence: newConfidence,
      },
    };
  },
});
