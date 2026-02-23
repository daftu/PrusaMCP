import type { Triangle, Vec3, MeshAnalysis } from "./types.js";

export interface PrintIssue {
  severity: "error" | "warning" | "info";
  category: string;
  message: string;
  detail?: string;
  bibleFdmRef?: string;  // Reference to Bible FDM diagnostic
}

export interface DefectDiagnosis {
  defect: string;
  symptoms: string[];
  causes: string[];
  fixes: string[];
}

export interface PrintabilityReport {
  score: number; // 0-100, higher = more printable
  issues: PrintIssue[];
  summary: string;
  diagnosticHints?: DefectDiagnosis[];  // Bible FDM based hints
}

/**
 * Analyze a mesh for common 3D printing issues.
 */
export function detectPrintIssues(
  triangles: Triangle[],
  analysis: MeshAnalysis,
  nozzleDiameter: number = 0.4,
): PrintabilityReport {
  const issues: PrintIssue[] = [];

  // 1. Manifold check
  if (!analysis.isManifold) {
    issues.push({
      severity: "error",
      category: "Mesh",
      message: `Mesh non-manifold : ${analysis.nonManifoldEdges} arêtes ouvertes`,
      detail: "Le slicer peut mal interpréter l'intérieur/extérieur. Réparer avec PrusaSlicer ou Meshmixer.",
    });
  }

  // 2. Zero-volume / degenerate triangles
  const degenerateCount = countDegenerateTriangles(triangles);
  if (degenerateCount > 0) {
    const pct = ((degenerateCount / triangles.length) * 100).toFixed(1);
    issues.push({
      severity: degenerateCount > triangles.length * 0.01 ? "warning" : "info",
      category: "Mesh",
      message: `${degenerateCount} triangles dégénérés (${pct}%)`,
      detail: "Triangles d'aire nulle — peuvent causer des artefacts de slicing.",
    });
  }

  // 3. Thin walls detection
  const thinWalls = detectThinWalls(triangles, analysis, nozzleDiameter);
  if (thinWalls.hasThinWalls) {
    issues.push({
      severity: "warning",
      category: "Murs fins",
      message: `Sections potentiellement trop fines pour une buse de ${nozzleDiameter}mm`,
      detail: `La dimension minimale détectée est ~${thinWalls.minThickness.toFixed(2)}mm. ` +
        `Minimum recommandé : ${(nozzleDiameter * 1.2).toFixed(2)}mm (1.2× buse). ` +
        `${thinWalls.thinRegions} zones concernées.`,
    });
  }

  // 4. Overhang analysis (Bible FDM: overhang>30% → supports nécessaires)
  if (analysis.overhangPercent > 30) {
    issues.push({
      severity: "warning",
      category: "Overhangs",
      message: `${analysis.overhangPercent.toFixed(1)}% de faces en overhang sévère`,
      detail: "Beaucoup d'overhangs — supports nécessaires ou réorientation de la pièce recommandée.",
      bibleFdmRef: "Support Z contact distance = 50-75% hauteur de couche. Styles : Grid/Snug/Organic.",
    });
  } else if (analysis.overhangPercent > 5) {
    issues.push({
      severity: "info",
      category: "Overhangs",
      message: `${analysis.overhangPercent.toFixed(1)}% d'overhangs modérés`,
      detail: "Supports recommandés pour les zones concernées.",
      bibleFdmRef: "Bible FDM : PrusaSlicer propose Grid, Snug et Organic. Top contact Z distance = 50-75% layer height.",
    });
  }

  // 5. Bridging detection
  const bridges = detectBridges(triangles, nozzleDiameter);
  if (bridges.maxBridgeLength > 0) {
    const severity = bridges.maxBridgeLength > 20 ? "warning" : "info";
    issues.push({
      severity,
      category: "Ponts",
      message: `Pont le plus long détecté : ~${bridges.maxBridgeLength.toFixed(1)}mm`,
      detail: bridges.maxBridgeLength > 20
        ? "Ponts >20mm risquent de s'affaisser. Réduire la vitesse de pont ou ajouter des supports."
        : "Ponts courts — devrait être OK avec un bon refroidissement.",
    });
  }

  // 6. Small features
  if (analysis.hasSmallDetails) {
    const minFeatureSize = nozzleDiameter * 0.8;
    issues.push({
      severity: "info",
      category: "Détails fins",
      message: `Détails fins détectés (${analysis.smallDetailPercent.toFixed(1)}% de petits triangles)`,
      detail: `Des features plus petites que ~${minFeatureSize.toFixed(1)}mm pourraient ne pas être imprimées correctement. ` +
        `Considérer un layer height plus fin.`,
    });
  }

  // 7. Size check — too small or too large
  const bb = analysis.boundingBox.size;
  if (bb.x < 1 || bb.y < 1 || bb.z < 0.5) {
    issues.push({
      severity: "warning",
      category: "Taille",
      message: `Pièce très petite : ${bb.x.toFixed(1)} × ${bb.y.toFixed(1)} × ${bb.z.toFixed(1)}mm`,
      detail: "Les pièces très petites sont difficiles à imprimer — adhésion au plateau et détails compromis.",
    });
  }

  // 8. Tall and narrow — tip-over risk
  const maxXY = Math.max(bb.x, bb.y);
  if (bb.z > 3 * maxXY && bb.z > 30) {
    issues.push({
      severity: "warning",
      category: "Stabilité",
      message: `Pièce haute et étroite (ratio ${(bb.z / maxXY).toFixed(1)}:1)`,
      detail: "Risque de décollement ou bascule. Utiliser un brim large ou un raft.",
    });
  }

  // 9. Very large overhangs at bottom (elephant foot)
  const bottomFaces = countBottomFaces(triangles);
  if (bottomFaces.flatBottomPercent < 5 && triangles.length > 100) {
    issues.push({
      severity: "info",
      category: "Adhésion",
      message: "Très peu de surface de contact avec le plateau",
      detail: `Seulement ${bottomFaces.flatBottomPercent.toFixed(1)}% de faces au contact du plateau. Brim recommandé.`,
    });
  }

  // Compute printability score
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === "error") score -= 25;
    if (issue.severity === "warning") score -= 10;
    if (issue.severity === "info") score -= 3;
  }
  score = Math.max(0, Math.min(100, score));

  // Summary
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warning").length;
  let summary: string;
  if (errorCount > 0) {
    summary = `Problèmes critiques détectés (${errorCount} erreur(s)). Correction nécessaire avant impression.`;
  } else if (warnCount > 0) {
    summary = `Imprimable avec précautions (${warnCount} avertissement(s)). Vérifier les paramètres.`;
  } else {
    summary = "Bonne printabilité. Aucun problème majeur détecté.";
  }

  // Generate Bible FDM diagnostic hints based on detected issues
  const diagnosticHints = generateDiagnosticHints(issues);

  return { score, issues, summary, diagnosticHints };
}

// ─── Helpers ─────────────────────────────────────────────────

function countDegenerateTriangles(triangles: Triangle[]): number {
  let count = 0;
  for (const t of triangles) {
    const area = triangleArea(t.v1, t.v2, t.v3);
    if (area < 1e-10) count++;
  }
  return count;
}

function triangleArea(v1: Vec3, v2: Vec3, v3: Vec3): number {
  const ax = v2.x - v1.x, ay = v2.y - v1.y, az = v2.z - v1.z;
  const bx = v3.x - v1.x, by = v3.y - v1.y, bz = v3.z - v1.z;
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  return Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
}

/**
 * Detect thin walls by finding opposing faces that are too close.
 * Simplified approach: compute the "thickness" by looking at the min bounding box
 * dimension relative to the nozzle, and checking for narrow cross-sections.
 */
function detectThinWalls(
  triangles: Triangle[],
  analysis: MeshAnalysis,
  nozzleDiameter: number,
): { hasThinWalls: boolean; minThickness: number; thinRegions: number } {
  const bb = analysis.boundingBox.size;
  const minDim = Math.min(bb.x, bb.y, bb.z);
  const minPrintable = nozzleDiameter * 1.2;

  // Quick check: if the smallest bounding box dimension is thin
  if (minDim < minPrintable) {
    return { hasThinWalls: true, minThickness: minDim, thinRegions: 1 };
  }

  // Slice-based thin wall detection: sample Z heights and check cross-section width
  const zMin = analysis.boundingBox.min.z;
  const zMax = analysis.boundingBox.max.z;
  const zRange = zMax - zMin;
  if (zRange <= 0) return { hasThinWalls: false, minThickness: minDim, thinRegions: 0 };

  const sampleCount = Math.min(20, Math.max(5, Math.floor(zRange / 2)));
  let thinRegions = 0;
  let globalMinThickness = minDim;

  for (let i = 0; i < sampleCount; i++) {
    const z = zMin + (zRange * (i + 0.5)) / sampleCount;
    const intersections = sliceAtZ(triangles, z);

    if (intersections.length >= 4) {
      // Sort X coordinates of intersection points
      const xs = intersections.map((p) => p.x).sort((a, b) => a - b);
      // Check gaps between consecutive intersections (wall thickness)
      for (let j = 0; j < xs.length - 1; j += 2) {
        const wallWidth = xs[j + 1] - xs[j];
        if (wallWidth > 0 && wallWidth < minPrintable) {
          thinRegions++;
          globalMinThickness = Math.min(globalMinThickness, wallWidth);
        }
      }
    }
  }

  return {
    hasThinWalls: thinRegions > 0,
    minThickness: globalMinThickness,
    thinRegions,
  };
}

/**
 * Find intersection points of triangles with a horizontal plane at given Z.
 */
function sliceAtZ(triangles: Triangle[], z: number): Vec3[] {
  const points: Vec3[] = [];

  for (const t of triangles) {
    const verts = [t.v1, t.v2, t.v3];
    const edges: [Vec3, Vec3][] = [
      [verts[0], verts[1]],
      [verts[1], verts[2]],
      [verts[2], verts[0]],
    ];

    for (const [a, b] of edges) {
      if ((a.z <= z && b.z >= z) || (b.z <= z && a.z >= z)) {
        const dz = b.z - a.z;
        if (Math.abs(dz) < 1e-10) continue;
        const t_param = (z - a.z) / dz;
        if (t_param < 0 || t_param > 1) continue;
        points.push({
          x: a.x + t_param * (b.x - a.x),
          y: a.y + t_param * (b.y - a.y),
          z,
        });
      }
    }
  }

  return points;
}

/**
 * Detect potential bridge distances by finding horizontal overhangs
 * with no support below.
 */
function detectBridges(
  triangles: Triangle[],
  _nozzleDiameter: number,
): { maxBridgeLength: number; bridgeCount: number } {
  let maxBridgeLength = 0;
  let bridgeCount = 0;

  // Find nearly horizontal faces that are overhangs (normal pointing down)
  // These are potential bridge surfaces
  for (const t of triangles) {
    const normal = computeNormal(t.v1, t.v2, t.v3);

    // Nearly horizontal face pointing down = potential bridge
    if (normal.z < -0.9) {
      // Compute the span of this face in XY
      const xSpan = Math.max(t.v1.x, t.v2.x, t.v3.x) - Math.min(t.v1.x, t.v2.x, t.v3.x);
      const ySpan = Math.max(t.v1.y, t.v2.y, t.v3.y) - Math.min(t.v1.y, t.v2.y, t.v3.y);
      const span = Math.max(xSpan, ySpan);

      if (span > maxBridgeLength) {
        maxBridgeLength = span;
      }
      bridgeCount++;
    }
  }

  return { maxBridgeLength, bridgeCount };
}

/**
 * Count faces at the very bottom of the model (touching the build plate).
 */
function countBottomFaces(
  triangles: Triangle[],
): { flatBottomCount: number; flatBottomPercent: number } {
  if (triangles.length === 0) return { flatBottomCount: 0, flatBottomPercent: 0 };

  // Find the lowest Z
  let minZ = Infinity;
  for (const t of triangles) {
    minZ = Math.min(minZ, t.v1.z, t.v2.z, t.v3.z);
  }

  const threshold = minZ + 0.5; // within 0.5mm of the bottom
  let bottomCount = 0;

  for (const t of triangles) {
    if (t.v1.z < threshold && t.v2.z < threshold && t.v3.z < threshold) {
      const normal = computeNormal(t.v1, t.v2, t.v3);
      if (normal.z < -0.7) { // face pointing down = on build plate
        bottomCount++;
      }
    }
  }

  return {
    flatBottomCount: bottomCount,
    flatBottomPercent: (bottomCount / triangles.length) * 100,
  };
}

function computeNormal(v1: Vec3, v2: Vec3, v3: Vec3): Vec3 {
  const ax = v2.x - v1.x, ay = v2.y - v1.y, az = v2.z - v1.z;
  const bx = v3.x - v1.x, by = v3.y - v1.y, bz = v3.z - v1.z;
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len === 0) return { x: 0, y: 0, z: 1 };
  return { x: nx / len, y: ny / len, z: nz / len };
}

// ─── Bible FDM Diagnostic Hints ─────────────────────────────

/**
 * Bible FDM defect diagnostic database.
 * Maps mesh-detected issues to likely print defects and their fixes.
 */
const BIBLE_FDM_DIAGNOSTICS: DefectDiagnosis[] = [
  {
    defect: "Warping potentiel",
    symptoms: ["Pièce haute et étroite", "Matériau ABS/ASA/PC/Nylon", "Grande surface de contact"],
    causes: ["Temp/adhésion insuffisantes", "Courants d'air", "Matériaux techniques sans enceinte"],
    fixes: [
      "Enceinte fermée si ABS/ASA/PC/Nylon",
      "Brim 5mm+ minimum",
      "Temp bed adéquate (ABS:100°C, PETG:85°C)",
      "Surface propre (IPA/eau selon sheet et matériau)",
    ],
  },
  {
    defect: "Problèmes d'overhangs",
    symptoms: ["Faces en surplomb >45°", "Surfaces mal formées dessous"],
    causes: ["Overhang trop raide sans support", "Refroidissement insuffisant"],
    fixes: [
      "Ajouter supports (Grid/Snug/Organic dans PrusaSlicer)",
      "Support Z contact = 50-75% de la hauteur de couche",
      "Réorienter la pièce pour minimiser les overhangs",
      "Augmenter le refroidissement (sauf ABS/ASA)",
    ],
  },
  {
    defect: "Ponts fragiles",
    symptoms: ["Affaissement sur ponts longs", "Fils/cordes sur bridges"],
    causes: ["Pont trop long sans support", "Vitesse pont trop haute", "Refroidissement insuffisant"],
    fixes: [
      "Réduire bridge speed (40% de la vitesse d'impression)",
      "Augmenter bridge fan speed à 100% (sauf ABS)",
      "Bridge flow ratio : réduire légèrement si cordes",
      "Ajouter supports si pont >20mm",
    ],
  },
  {
    defect: "Adhésion au plateau",
    symptoms: ["Peu de surface de contact", "Pièce instable"],
    causes: ["Surface de contact trop petite", "Première couche mal calibrée", "Surface sale"],
    fixes: [
      "Brim ou raft si surface de contact faible",
      "Ajuster Live Adjust Z pendant impression",
      "Augmenter bed +5-10°C si adhésion limite",
      "Nettoyer surface (IPA pour PEI, eau chaude pour Textured)",
    ],
  },
  {
    defect: "Détails fins perdus",
    symptoms: ["Features très petites", "Haute densité de triangles localement"],
    causes: ["Buse trop grosse pour les détails", "Layer height trop élevé"],
    fixes: [
      "Utiliser une buse plus fine (0.25mm pour détails XY)",
      "Réduire layer height (25-30% du diamètre buse)",
      "Prusa déconseille <0.10mm (gain faible vs temps très élevé)",
    ],
  },
];

/**
 * Generate Bible FDM diagnostic hints based on detected printability issues.
 */
function generateDiagnosticHints(issues: PrintIssue[]): DefectDiagnosis[] {
  const hints: DefectDiagnosis[] = [];
  const categories = new Set(issues.map((i) => i.category));

  if (categories.has("Stabilité") || categories.has("Adhésion")) {
    const warpHint = BIBLE_FDM_DIAGNOSTICS.find((d) => d.defect === "Warping potentiel");
    if (warpHint) hints.push(warpHint);
  }

  if (categories.has("Overhangs")) {
    const ohHint = BIBLE_FDM_DIAGNOSTICS.find((d) => d.defect === "Problèmes d'overhangs");
    if (ohHint) hints.push(ohHint);
  }

  if (categories.has("Ponts")) {
    const brHint = BIBLE_FDM_DIAGNOSTICS.find((d) => d.defect === "Ponts fragiles");
    if (brHint) hints.push(brHint);
  }

  if (categories.has("Adhésion")) {
    const adhHint = BIBLE_FDM_DIAGNOSTICS.find((d) => d.defect === "Adhésion au plateau");
    if (adhHint) hints.push(adhHint);
  }

  if (categories.has("Détails fins")) {
    const detHint = BIBLE_FDM_DIAGNOSTICS.find((d) => d.defect === "Détails fins perdus");
    if (detHint) hints.push(detHint);
  }

  return hints;
}
