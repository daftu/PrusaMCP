import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { PrintFeedback } from "./feedback-store.js";

// ─── Community Data Types ────────────────────────────────────

export interface CommunityData {
  version: string;
  lastUpdated: string;
  contributors: number;
  totalPrints: number;
  insights: {
    materialTempAdjustments: Record<string, {
      samples: number;
      avgNozzleTemp: number;
      avgBedTemp: number;
      notes: string;
    }>;
    commonIssuesByMaterial: Record<string, string[]>;
    printerQuirks: Record<string, string[]>;
    bestPractices: Array<{
      condition: string;
      recommendation: string;
      confidence: number;
    }>;
    speedLimits: Record<string, {
      safe: number;
      fast: number;
      risky: number;
    }>;
  };
  aggregatedFeedback: AnonymizedFeedback[];
}

export interface AnonymizedFeedback {
  material: string;
  printerType: string;    // generic type, not exact model
  nozzle: number;
  goal: string;
  layerHeight: number;
  infillPercent: number;
  printSpeed: number;
  nozzleTemp: number;
  bedTemp: number;
  supportUsed: boolean;
  qualityScore: number;
  adhesionScore: number;
  strengthScore: number;
  overallScore: number;
  issues: string[];
}

// ─── Load Community Data ─────────────────────────────────────

const COMMUNITY_FILE_BUNDLED = join(
  new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
  "community-data.json",
);
const COMMUNITY_FILE_LOCAL = join(homedir(), ".prusa-mcp", "community-data.json");

export async function loadCommunityData(): Promise<CommunityData> {
  // Prefer local (updated) version, fallback to bundled
  for (const path of [COMMUNITY_FILE_LOCAL, COMMUNITY_FILE_BUNDLED]) {
    if (existsSync(path)) {
      try {
        const content = await readFile(path, "utf-8");
        return JSON.parse(content) as CommunityData;
      } catch {
        continue;
      }
    }
  }

  // Return empty structure if nothing found
  return {
    version: "1.0.0",
    lastUpdated: new Date().toISOString().split("T")[0],
    contributors: 0,
    totalPrints: 0,
    insights: {
      materialTempAdjustments: {},
      commonIssuesByMaterial: {},
      printerQuirks: {},
      bestPractices: [],
      speedLimits: {},
    },
    aggregatedFeedback: [],
  };
}

// ─── Anonymize & Export ──────────────────────────────────────

/**
 * Anonymize a user's feedback for community sharing.
 * Strips file paths, exact printer names (generalizes), timestamps.
 */
export function anonymizeFeedback(feedback: PrintFeedback): AnonymizedFeedback {
  return {
    material: feedback.material.toUpperCase(),
    printerType: generalizePrinter(feedback.printer),
    nozzle: feedback.nozzle,
    goal: feedback.goal,
    layerHeight: feedback.layerHeight,
    infillPercent: feedback.infillPercent,
    printSpeed: feedback.printSpeed,
    nozzleTemp: feedback.nozzleTemp,
    bedTemp: feedback.bedTemp,
    supportUsed: feedback.supportUsed,
    qualityScore: feedback.qualityScore,
    adhesionScore: feedback.adhesionScore,
    strengthScore: feedback.strengthScore,
    overallScore: feedback.overallScore,
    issues: feedback.issues,
  };
}

/**
 * Export all local feedback as anonymized community-ready data.
 */
export function exportForCommunity(
  feedbacks: PrintFeedback[],
): AnonymizedFeedback[] {
  return feedbacks.map(anonymizeFeedback);
}

/**
 * Merge community feedback into local community data file.
 */
export async function importCommunityData(
  newData: AnonymizedFeedback[],
): Promise<void> {
  const community = await loadCommunityData();
  community.aggregatedFeedback.push(...newData);
  community.totalPrints += newData.length;
  community.lastUpdated = new Date().toISOString().split("T")[0];
  await saveCommunityData(community);
}

async function saveCommunityData(data: CommunityData): Promise<void> {
  const dir = join(homedir(), ".prusa-mcp");
  if (!existsSync(dir)) {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
  }
  await writeFile(COMMUNITY_FILE_LOCAL, JSON.stringify(data, null, 2), "utf-8");
}

// ─── Community-Informed Recommendations ──────────────────────

export interface CommunityInsight {
  hasData: boolean;
  recommendedNozzleTemp?: number;
  recommendedBedTemp?: number;
  commonIssues: string[];
  bestPractices: string[];
  speedLimit?: number;
  communityScore?: number;  // average score for similar prints
  sampleCount: number;
}

/**
 * Get community insights for a given material + settings combo.
 */
export function getCommunityInsight(
  community: CommunityData,
  material: string,
  goal: string,
  nozzle: number,
): CommunityInsight {
  const mat = material.toUpperCase();

  // Base insights from curated data
  const tempData = community.insights.materialTempAdjustments[mat];
  const issues = community.insights.commonIssuesByMaterial[mat] ?? [];
  const speed = community.insights.speedLimits[mat];

  const practices = community.insights.bestPractices
    .filter((bp) => {
      const cond = bp.condition.toLowerCase();
      return cond.includes(`material=${mat.toLowerCase()}`) && bp.confidence > 0.7;
    })
    .map((bp) => bp.recommendation);

  // Aggregated feedback for similar prints
  const similar = community.aggregatedFeedback.filter(
    (f) =>
      f.material === mat &&
      Math.abs(f.nozzle - nozzle) < 0.15 &&
      f.goal === goal,
  );

  let communityScore: number | undefined;
  let recommendedNozzleTemp: number | undefined;
  let recommendedBedTemp: number | undefined;

  if (similar.length >= 3) {
    // Use community data
    communityScore = similar.reduce((s, f) => s + f.overallScore, 0) / similar.length;
    recommendedNozzleTemp = Math.round(
      similar.reduce((s, f) => s + f.nozzleTemp, 0) / similar.length,
    );
    recommendedBedTemp = Math.round(
      similar.reduce((s, f) => s + f.bedTemp, 0) / similar.length,
    );
  } else if (tempData && tempData.samples > 0) {
    recommendedNozzleTemp = tempData.avgNozzleTemp;
    recommendedBedTemp = tempData.avgBedTemp;
  }

  return {
    hasData: similar.length > 0 || !!tempData,
    recommendedNozzleTemp,
    recommendedBedTemp,
    commonIssues: issues,
    bestPractices: practices,
    speedLimit: speed?.safe,
    communityScore,
    sampleCount: similar.length,
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function generalizePrinter(printer: string): string {
  const lower = printer.toLowerCase();
  if (lower.includes("ender")) return "Ender-series";
  if (lower.includes("prusa") && lower.includes("mk4")) return "Prusa-MK4";
  if (lower.includes("prusa") && lower.includes("mk3")) return "Prusa-MK3";
  if (lower.includes("prusa") && lower.includes("mini")) return "Prusa-MINI";
  if (lower.includes("bambu")) return "Bambu-Lab";
  if (lower.includes("voron")) return "Voron";
  if (lower.includes("artillery")) return "Artillery";
  if (lower.includes("cr-")) return "Creality-CR";
  if (lower.includes("anycubic")) return "Anycubic";
  return "Generic-FDM";
}
