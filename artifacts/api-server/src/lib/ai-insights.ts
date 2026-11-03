import Anthropic from "@anthropic-ai/sdk";
import { logger } from "./logger";

export type AiSuggestion = {
  summary: string;
  recommendations: string[];
  source: "claude" | "rules";
};

export async function createAiSuggestion(
  anonymizedAdherenceData: Record<string, unknown>,
  fallbackSummary: string,
  fallbackRecommendations: string[],
): Promise<AiSuggestion> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      summary: fallbackSummary,
      recommendations: fallbackRecommendations,
      source: "rules",
    };
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 8192,
      system:
        "You write brief medication-adherence observations for a fictional capstone demo. The supplied data contains only anonymized counts and rates. Do not diagnose, infer a condition, or recommend changing, stopping, starting, or adjusting medication. Suggest practical reminder and routine ideas, and recommend discussing concerns with a healthcare provider. Return only valid JSON with a summary string and a recommendations array of 2 or 3 short strings.",
      messages: [
        {
          role: "user",
          content: `Create a plain-language adherence summary and 2-3 supportive tips from these anonymous aggregates:\n${JSON.stringify(anonymizedAdherenceData)}`,
        },
      ],
    });
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const jsonText = text.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonText) throw new Error("Model response did not contain structured insight.");
    const decoded = JSON.parse(jsonText) as {
      summary?: unknown;
      recommendations?: unknown;
    };
    if (typeof decoded.summary !== "string" || !Array.isArray(decoded.recommendations)) {
      throw new Error("Model response had an invalid insight shape.");
    }
    const recommendations = decoded.recommendations
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().slice(0, 180))
      .filter(Boolean)
      .slice(0, 3);
    if (recommendations.length < 2) {
      throw new Error("Model response did not include enough supportive tips.");
    }
    return {
      summary: decoded.summary.trim().slice(0, 600),
      recommendations,
      source: "claude",
    };
  } catch {
    logger.warn("Anthropic insight generation failed; using rules-based guidance.");
    return {
      summary: fallbackSummary,
      recommendations: fallbackRecommendations,
      source: "rules",
    };
  }
}
