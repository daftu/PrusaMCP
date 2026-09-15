import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

// ─── Data Model ──────────────────────────────────────────────

export interface PrintFeedback {
  id: string;
  timestamp: string;

  // What was printed
  modelName: string;
  modelPath?: string;
  material: string;
  printer: string;
  nozzle: number;

  // Settings used
  goal: string;
  layerHeight: number;
  infillPercent: number;
  perimeters: number;
  printSpeed: number;
  nozzleTemp: number;
  bedTemp: number;
  supportUsed: boolean;
  brimUsed: boolean;

  // Results — scored 1-5 (1=terrible, 5=parfait)
  qualityScore: number;       // qualité de surface
  adhesionScore: number;      // adhésion au plateau
  strengthScore: number;      // solidité perçue
  overallScore: number;       // satisfaction globale

  // Issues encountered
  issues: string[];           // warping, stringing, under-extrusion, layer shift, etc.

  // Free-form notes
  notes: string;

  // Computed: was this a success?
  success: boolean;           // overallScore >= 3
}

export interface FeedbackStats {
  totalPrints: number;
  successRate: number;
  avgQuality: number;
  avgAdhesion: number;
  avgStrength: number;
  commonIssues: Array<{ issue: string; count: number; percent: number }>;
  bestSettings: {
    material: string;
    layerHeight: number;
    avgScore: number;
    count: number;
  }[];
}

// ─── Storage ─────────────────────────────────────────────────

const FEEDBACK_DIR = join(homedir(), ".prusa-mcp");
const FEEDBACK_FILE = join(FEEDBACK_DIR, "feedback.json");

async function ensureDir(): Promise<void> {
  if (!existsSync(FEEDBACK_DIR)) {
    await mkdir(FEEDBACK_DIR, { recursive: true });
  }
}

export async function loadFeedback(): Promise<PrintFeedback[]> {
  if (!existsSync(FEEDBACK_FILE)) return [];

  try {
    const content = await readFile(FEEDBACK_FILE, "utf-8");
    return JSON.parse(content) as PrintFeedback[];
  } catch {
    return [];
  }
}

export async function saveFeedback(feedbacks: PrintFeedback[]): Promise<void> {
  await ensureDir();
  await writeFile(FEEDBACK_FILE, JSON.stringify(feedbacks, null, 2), "utf-8");
}

export async function addFeedback(feedback: PrintFeedback): Promise<void> {
  const feedbacks = await loadFeedback();
  feedbacks.push(feedback);
  await saveFeedback(feedbacks);
}

// ─── Analytics ───────────────────────────────────────────────

export function computeStats(feedbacks: PrintFeedback[]): FeedbackStats {
  if (feedbacks.length === 0) {
    return {
      totalPrints: 0,
      successRate: 0,
      avgQuality: 0,
      avgAdhesion: 0,
      avgStrength: 0,
      commonIssues: [],
      bestSettings: [],
    };
  }

  const n = feedbacks.length;
  const successes = feedbacks.filter((f) => f.success).length;

  // Averages
  const avgQuality = feedbacks.reduce((s, f) => s + f.qualityScore, 0) / n;
  const avgAdhesion = feedbacks.reduce((s, f) => s + f.adhesionScore, 0) / n;
  const avgStrength = feedbacks.reduce((s, f) => s + f.strengthScore, 0) / n;

  // Common issues
  const issueCount = new Map<string, number>();
  for (const f of feedbacks) {
    for (const issue of f.issues) {
      issueCount.set(issue, (issueCount.get(issue) ?? 0) + 1);
    }
  }
  const commonIssues = [...issueCount.entries()]
    .map(([issue, count]) => ({ issue, count, percent: (count / n) * 100 }))
    .sort((a, b) => b.count - a.count);

  // Best settings per material
  const materialGroups = new Map<string, PrintFeedback[]>();
  for (const f of feedbacks) {
    const key = f.material.toUpperCase();
    const group = materialGroups.get(key) ?? [];
    group.push(f);
    materialGroups.set(key, group);
  }

  const bestSettings = [...materialGroups.entries()].map(([material, group]) => {
    // Find the layer height with the best average score
    const layerGroups = new Map<number, number[]>();
    for (const f of group) {
      const scores = layerGroups.get(f.layerHeight) ?? [];
      scores.push(f.overallScore);
      layerGroups.set(f.layerHeight, scores);
    }

    let bestLayer = 0.2;
    let bestAvg = 0;
    let bestCount = 0;
    for (const [lh, scores] of layerGroups) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (avg > bestAvg || (avg === bestAvg && scores.length > bestCount)) {
        bestLayer = lh;
        bestAvg = avg;
        bestCount = scores.length;
      }
    }

    return { material, layerHeight: bestLayer, avgScore: Math.round(bestAvg * 10) / 10, count: group.length };
  });

  return {
    totalPrints: n,
    successRate: (successes / n) * 100,
    avgQuality,
    avgAdhesion,
    avgStrength,
    commonIssues,
    bestSettings,
  };
}

// ─── Recommendation Adjustments ──────────────────────────────

export interface FeedbackAdjustments {
  tempAdjust: number;        // °C to add/subtract from nozzle temp
  speedMultiplier: number;   // multiply print speed by this
  infillAdjust: number;      // % to add/subtract from infill
  brimRecommended: boolean;
  supportRecommended: boolean;
  warnings: string[];
}

/**
 * Learn from past prints for a given material+printer combo.
 * Returns adjustments to apply to recommendations.
 */
export function learnFromFeedback(
  feedbacks: PrintFeedback[],
  material: string,
  printer: string,
): FeedbackAdjustments {
  const adjustments: FeedbackAdjustments = {
    tempAdjust: 0,
    speedMultiplier: 1.0,
    infillAdjust: 0,
    brimRecommended: false,
    supportRecommended: false,
    warnings: [],
  };

  // Filter relevant feedback
  const relevant = feedbacks.filter(
    (f) =>
      f.material.toUpperCase() === material.toUpperCase() &&
      f.printer.toLowerCase().includes(printer.toLowerCase()),
  );

  if (relevant.length < 2) return adjustments; // Not enough data

  // Analyze issues
  const issueFreq = new Map<string, number>();
  for (const f of relevant) {
    for (const issue of f.issues) {
      issueFreq.set(issue, (issueFreq.get(issue) ?? 0) + 1);
    }
  }

  const n = relevant.length;

  // Stringing → lower temp
  const stringing = issueFreq.get("stringing") ?? 0;
  if (stringing / n > 0.3) {
    adjustments.tempAdjust -= 5;
    adjustments.warnings.push(
      `Stringing fréquent (${Math.round(stringing / n * 100)}% des prints) — temp buse réduite de 5°C`,
    );
  }

  // Under-extrusion → higher temp, slower speed
  const underExtrusion = issueFreq.get("under-extrusion") ?? 0;
  if (underExtrusion / n > 0.2) {
    adjustments.tempAdjust += 5;
    adjustments.speedMultiplier = 0.9;
    adjustments.warnings.push(
      `Sous-extrusion fréquente — temp +5°C et vitesse -10%`,
    );
  }

  // Warping → brim recommended
  const warping = issueFreq.get("warping") ?? 0;
  if (warping / n > 0.2) {
    adjustments.brimRecommended = true;
    adjustments.warnings.push(
      `Warping fréquent (${Math.round(warping / n * 100)}% des prints) — brim recommandé`,
    );
  }

  // Poor adhesion → brim
  const poorAdhesion = relevant.filter((f) => f.adhesionScore <= 2).length;
  if (poorAdhesion / n > 0.3) {
    adjustments.brimRecommended = true;
    adjustments.warnings.push(
      `Adhésion souvent faible — brim fortement recommandé`,
    );
  }

  // Low strength scores → more infill
  const weakPrints = relevant.filter((f) => f.strengthScore <= 2).length;
  if (weakPrints / n > 0.3) {
    adjustments.infillAdjust += 10;
    adjustments.warnings.push(
      `Solidité souvent insuffisante — infill +10%`,
    );
  }

  // Speed issues (layer shifts, ringing)
  const layerShift = issueFreq.get("layer-shift") ?? 0;
  const ringing = issueFreq.get("ringing") ?? 0;
  if ((layerShift + ringing) / n > 0.2) {
    adjustments.speedMultiplier = Math.min(adjustments.speedMultiplier, 0.85);
    adjustments.warnings.push(
      `Problèmes de vitesse détectés — vitesse réduite de 15%`,
    );
  }

  return adjustments;
}
