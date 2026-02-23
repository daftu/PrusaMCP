import type { MeshAnalysis, GCodeStats } from "./types.js";

export interface CostEstimate {
  filamentWeightG: number;
  filamentLengthMm: number;
  filamentCostEur: number;
  electricityCostEur: number;
  totalCostEur: number;
  printTimeSeconds: number;
  printTimeFormatted: string;
}

export interface CostParams {
  filamentPricePerKg: number;   // EUR/kg
  filamentDensity: number;       // g/cm³ (PLA ≈ 1.24, PETG ≈ 1.27, ABS ≈ 1.04)
  electricityPricePerKwh: number; // EUR/kWh
  printerWattage: number;        // watts during printing
}

const MATERIAL_DENSITY: Record<string, number> = {
  PLA: 1.24,
  PETG: 1.27,
  ABS: 1.04,
  ASA: 1.07,
  TPU: 1.21,
  NYLON: 1.14,
  PC: 1.20,
};

const DEFAULT_FILAMENT_PRICE = 22; // EUR/kg for generic PLA

/**
 * Estimate cost from G-code stats (already sliced).
 */
export function estimateCostFromGCode(
  stats: GCodeStats,
  params: Partial<CostParams> = {},
): CostEstimate {
  const pricePerKg = params.filamentPricePerKg ?? DEFAULT_FILAMENT_PRICE;
  const electricityPrice = params.electricityPricePerKwh ?? 0.25;
  const wattage = params.printerWattage ?? 200;

  const weightG = stats.filamentUsedG ?? 0;
  const lengthMm = stats.filamentUsedMm ?? 0;
  const printTimeSeconds = stats.estimatedTimeSeconds ?? 0;

  const filamentCost = (weightG / 1000) * pricePerKg;
  const printTimeHours = printTimeSeconds / 3600;
  const electricityCost = (wattage / 1000) * printTimeHours * electricityPrice;

  return {
    filamentWeightG: weightG,
    filamentLengthMm: lengthMm,
    filamentCostEur: round2(filamentCost),
    electricityCostEur: round2(electricityCost),
    totalCostEur: round2(filamentCost + electricityCost),
    printTimeSeconds,
    printTimeFormatted: formatTime(printTimeSeconds),
  };
}

/**
 * Rough cost estimate from mesh analysis (before slicing).
 * Less accurate but doesn't require PrusaSlicer.
 */
export function estimateCostFromMesh(
  analysis: MeshAnalysis,
  layerHeight: number,
  infillPercent: number,
  perimeters: number,
  printSpeed: number,
  material: string = "PLA",
  params: Partial<CostParams> = {},
  filamentDiameter: number = 1.75,
): CostEstimate {
  const density = params.filamentDensity ?? MATERIAL_DENSITY[material.toUpperCase()] ?? 1.24;
  const pricePerKg = params.filamentPricePerKg ?? DEFAULT_FILAMENT_PRICE;
  const electricityPrice = params.electricityPricePerKwh ?? 0.25;
  const wattage = params.printerWattage ?? 200;

  // Estimate filament volume:
  // Shell volume = surface area × perimeters × line width (≈ nozzle diameter)
  const lineWidth = 0.45; // approximate
  const shellVolume = analysis.surfaceArea * perimeters * lineWidth; // mm³

  // Infill volume = (total volume - shell volume) × infill%
  const innerVolume = Math.max(0, analysis.volume - shellVolume);
  const infillVolume = innerVolume * (infillPercent / 100);

  // Top/bottom solid layers (assume 4 each at layer_height)
  const topBottomArea = analysis.boundingBox.size.x * analysis.boundingBox.size.y;
  const solidVolume = topBottomArea * layerHeight * 8; // 4 top + 4 bottom

  const totalFilamentVolume = shellVolume + infillVolume + solidVolume; // mm³
  const weightG = (totalFilamentVolume / 1000) * density; // mm³ to cm³ then × g/cm³

  // Filament length (1.75mm or 2.85mm diameter)
  const filamentCrossSectionMm2 = Math.PI * (filamentDiameter / 2) ** 2;
  const lengthMm = totalFilamentVolume / filamentCrossSectionMm2;

  // Time estimate: total volume / (line width × layer height × speed)
  const extrusionRate = lineWidth * layerHeight * printSpeed; // mm³/s
  const printTimeSeconds = extrusionRate > 0
    ? (totalFilamentVolume / extrusionRate) * 1.3  // 1.3× factor for travel moves
    : 0;

  const filamentCost = (weightG / 1000) * pricePerKg;
  const printTimeHours = printTimeSeconds / 3600;
  const electricityCost = (wattage / 1000) * printTimeHours * electricityPrice;

  return {
    filamentWeightG: round2(weightG),
    filamentLengthMm: round2(lengthMm),
    filamentCostEur: round2(filamentCost),
    electricityCostEur: round2(electricityCost),
    totalCostEur: round2(filamentCost + electricityCost),
    printTimeSeconds: Math.round(printTimeSeconds),
    printTimeFormatted: formatTime(printTimeSeconds),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function formatTime(seconds: number): string {
  if (seconds <= 0) return "N/A";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return `${m}min ${s}s`;
  return `${s}s`;
}
