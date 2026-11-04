import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || "https://exciting-blackbird-312.convex.cloud";
const convex = new ConvexHttpClient(convexUrl);

/**
 * Helper to call Gemini Vision API to parse match screenshots into structured football metrics.
 */
async function parseScreenshotWithGemini(
  base64Data: string,
  mimeType: string,
  apiKey: string
): Promise<any> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const prompt = `You are an expert sports data analyst. Analyze this match report screenshot (Sofascore / FotMob / WhoScored).
Extract all player match performance stats into clean JSON with these exact fields if present:
- totalShots (number)
- shotsOnTarget (number)
- xG (number)
- keyPasses (number)
- accuratePassesPct (number)
- touches (number)
- dribblesCompleted (number)
- groundDuelsWon (number)
- aerialDuelsWon (number)
- recoveries (number)
- minutesPlayed (number, default 90)
- rating (number, e.g. 7.9)
- opponent (string, if visible)
- isAway (boolean, if visible)

Return ONLY valid JSON without markdown wrapping.`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini Vision API error: ${errorText}`);
  }

  const result = await response.json();
  const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return JSON.parse(rawText);
}

const STAT_FIELDS = [
  "totalShots",
  "shotsOnTarget",
  "xG",
  "keyPasses",
  "accuratePassesPct",
  "touches",
  "dribblesCompleted",
  "groundDuelsWon",
  "aerialDuelsWon",
  "recoveries",
  "rating",
] as const;

/** Se queda solo con números reales. Nunca rellena con valores inventados. */
function cleanStats(source: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (!source || typeof source !== "object") return out;
  for (const k of STAT_FIELDS) {
    const raw = source[k];
    if (raw === null || raw === undefined || raw === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    let playerId: any = null;
    let matchDate = new Date().toISOString().split("T")[0];
    let opponent: string | null = null;
    let opponentTeamId: any = undefined;
    let competition: string = "laliga";
    let isAway: boolean | null = null;
    let minutesPlayed: number | null = null;
    let tacticalRole: string | undefined = undefined;
    let contextFeatures: string[] | undefined = undefined;
    let nextFixture: { opponent: string; isAway: boolean; opponentTeamId?: string } | null = null;
    let extracted: any = null;
    let body: any = {};

    const contentType = req.headers.get("content-type") || "";
    const geminiKey = process.env.GEMINI_API_KEY;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      body = Object.fromEntries(
        Array.from(formData.entries()).filter(([, value]) => typeof value === "string")
      );
      if (body.isAway !== undefined) body.isAway = body.isAway === "true";
      if (body.minutesPlayed !== undefined) body.minutesPlayed = Number(body.minutesPlayed);
      if (body.nextFixture) body.nextFixture = JSON.parse(body.nextFixture);
      const file = formData.get("file") as File | null;
      if (file) {
        if (!geminiKey) {
          return NextResponse.json(
            { success: false, error: "No hay GEMINI_API_KEY: no se puede leer la captura. Introduce las stats a mano." },
            { status: 422 }
          );
        }
        const bytes = await file.arrayBuffer();
        extracted = await parseScreenshotWithGemini(Buffer.from(bytes).toString("base64"), file.type || "image/png", geminiKey);
      }
    } else {
      body = await req.json();
      if (body.imageBase64) {
        if (!geminiKey) {
          return NextResponse.json(
            { success: false, error: "No hay GEMINI_API_KEY: no se puede leer la captura. Introduce las stats a mano." },
            { status: 422 }
          );
        }
        extracted = await parseScreenshotWithGemini(body.imageBase64, body.mimeType || "image/png", geminiKey);
      }
    }

    playerId = body.playerId || null;
    if (body.matchDate) matchDate = body.matchDate;
    if (body.opponentTeamId) opponentTeamId = body.opponentTeamId;
    if (body.competition) competition = body.competition;
    if (body.tacticalRole) tacticalRole = body.tacticalRole;
    if (Array.isArray(body.contextFeatures)) contextFeatures = body.contextFeatures;
    if (body.nextFixture?.opponent && typeof body.nextFixture.isAway === "boolean") nextFixture = body.nextFixture;

    // Lo que el usuario escribe manda sobre lo que lee el OCR
    opponent = body.opponent || extracted?.opponent || null;
    isAway = typeof body.isAway === "boolean" ? body.isAway : typeof extracted?.isAway === "boolean" ? extracted.isAway : null;
    const mins = Number(body.minutesPlayed ?? extracted?.minutesPlayed);
    minutesPlayed = Number.isFinite(mins) && mins > 0 ? mins : null;
    const rawStats = { ...cleanStats(extracted), ...cleanStats(body.rawStats ?? body) };

    const missing = [
      !opponent && "opponent",
      isAway === null && "isAway",
      minutesPlayed === null && "minutesPlayed",
      Object.keys(rawStats).length === 0 && "rawStats",
    ].filter(Boolean);
    if (missing.length) {
      return NextResponse.json(
        { success: false, error: `Faltan datos reales del partido: ${missing.join(", ")}` },
        { status: 422 }
      );
    }

    if (!playerId) {
      const profile = await convex.query(api.players.getPlayerProfile, {});
      playerId = profile?.player?._id ?? (await convex.mutation(api.players.seedBellinghamDemo, {})).playerId;
    }

    const calibration = await convex.mutation(api.predictions.recordMatchAndCalibrate, {
      playerId,
      matchDate,
      opponent: opponent!,
      opponentTeamId: opponentTeamId || undefined,
      competition,
      isAway: isAway!,
      minutesPlayed: minutesPlayed!,
      rawStats,
      tacticalRole,
      contextFeatures,
    });

    // Solo se pronostica el próximo partido si nos dicen cuál es
    const nextForecast = nextFixture
      ? await convex.mutation(api.predictions.calculateAndPredict, {
          playerId,
          opponent: nextFixture.opponent,
          isAway: nextFixture.isAway,
          opponentTeamId: (nextFixture.opponentTeamId as any) || undefined,
          tacticalRole,
        })
      : null;

    return NextResponse.json({ success: true, calibration, nextForecast, ingestedStats: rawStats });
  } catch (error: any) {
    console.error("Ingestion API error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to ingest match" },
      { status: 500 }
    );
  }
}
