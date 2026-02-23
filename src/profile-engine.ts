import type {
  PrintGoal,
  MaterialProfile,
  RecommendedProfile,
  SettingWithReason,
  MeshAnalysis,
} from "./types.js";

// ─── Material Database (Official Prusa values from Bible FDM) ─────

const MATERIALS: Record<string, MaterialProfile> = {
  PLA: {
    name: "PLA",
    nozzleTemp: 210,
    firstLayerNozzleTemp: 215,
    bedTemp: 60,
    fanSpeed: 100,
    minFanSpeed: 100,
    bridgeFanSpeed: 100,
    retractionLength: 0.8,
    retractionSpeed: 35,
    maxVolumetricSpeed: 15,     // Bible: PLA ~15 mm³/s
    notes: "Facile à imprimer. Privilégier EM/MVS avant d'augmenter rétraction pour stringing.",
    requiresEnclosure: false,
    recommendedSurface: "Satin ou Smooth PEI",
  },
  PETG: {
    name: "PETG",
    nozzleTemp: 240,
    firstLayerNozzleTemp: 230,
    bedTemp: 85,
    firstLayerBedTemp: 90,
    fanSpeed: 50,
    minFanSpeed: 30,
    bridgeFanSpeed: 80,
    retractionLength: 0.8,       // Bible: rétraction réduite 0.8-1mm max pour PETG
    retractionSpeed: 30,
    maxVolumetricSpeed: 8,       // Bible: PETG MVS ~8 mm³/s
    notes: "Stringing/oozing si trop chaud. MVS officiel ≈8 mm³/s. Rétraction max 0.8-1mm.",
    requiresEnclosure: false,
    recommendedSurface: "Textured/Satin PEI",
  },
  ABS: {
    name: "ABS",
    nozzleTemp: 255,
    firstLayerNozzleTemp: 255,
    bedTemp: 100,
    fanSpeed: 0,
    minFanSpeed: 0,
    bridgeFanSpeed: 30,
    retractionLength: 0.8,
    retractionSpeed: 35,
    maxVolumetricSpeed: 11,      // Bible: ABS/ASA ~11 mm³/s
    notes: "Enceinte fermée obligatoire. Warping: priorité enceinte, brim, temp plateau.",
    requiresEnclosure: true,
    recommendedSurface: "Smooth PEI ou Textured (avec colle si nécessaire)",
  },
  ASA: {
    name: "ASA",
    nozzleTemp: 260,
    firstLayerNozzleTemp: 260,
    bedTemp: 105,
    firstLayerBedTemp: 110,
    fanSpeed: 0,
    minFanSpeed: 0,
    bridgeFanSpeed: 30,
    retractionLength: 0.8,
    retractionSpeed: 35,
    maxVolumetricSpeed: 11,      // Bible: ABS/ASA ~11 mm³/s
    notes: "Résistant UV. Enceinte obligatoire, anti-courants d'air. Ajuster supports/overhang speed plutôt que fan.",
    requiresEnclosure: true,
    recommendedSurface: "Smooth ou Textured PEI",
  },
  TPU: {
    name: "TPU",
    nozzleTemp: 230,
    firstLayerNozzleTemp: 230,
    bedTemp: 60,
    firstLayerBedTemp: 65,
    fanSpeed: 50,
    minFanSpeed: 30,
    bridgeFanSpeed: 60,
    retractionLength: 0.5,       // Bible: rétraction délicate pour TPU
    retractionSpeed: 20,
    maxVolumetricSpeed: 2,       // Bible: TPU ~1-2.5 mm³/s
    notes: "Vitesse cadrée via MVS (1-2.5 mm³/s). Smooth PEI déconseillé sans séparation (glue). Direct drive recommandé.",
    requiresEnclosure: false,
    recommendedSurface: "PA Nylon / Satin / Textured PEI (pas Smooth sans colle)",
  },
  NYLON: {
    name: "NYLON",
    nozzleTemp: 285,
    firstLayerNozzleTemp: 285,
    bedTemp: 110,
    fanSpeed: 20,
    minFanSpeed: 10,
    bridgeFanSpeed: 50,
    retractionLength: 1.2,
    retractionSpeed: 30,
    maxVolumetricSpeed: 8,
    notes: "Hygroscopique — séchage 12h@80°C obligatoire. Enceinte critique. Priorité plateau/surface/enceinte.",
    requiresEnclosure: true,
    recommendedSurface: "Special PA Nylon sheet",
  },
  PC: {
    name: "PC (Polycarbonate)",
    nozzleTemp: 275,
    firstLayerNozzleTemp: 275,
    bedTemp: 110,
    firstLayerBedTemp: 115,
    fanSpeed: 10,
    minFanSpeed: 0,
    bridgeFanSpeed: 40,
    retractionLength: 0.8,
    retractionSpeed: 35,
    maxVolumetricSpeed: 8,
    notes: "Haute temp. Enceinte 50°C+ obligatoire. Risque d'arrachement sheet — couche séparation selon cas.",
    requiresEnclosure: true,
    recommendedSurface: "Textured/Satin PEI (glue séparation si Smooth)",
  },
};

// ─── Goal Presets ────────────────────────────────────────────

interface GoalPreset {
  layerRatio: number;       // Multiplier on nozzle diameter for layer height
  speedMultiplier: number;  // Multiplier on base speed
  infill: number;           // %
  fillPattern: string;
  perimeters: number;
  description: string;
}

const GOALS: Record<PrintGoal, GoalPreset> = {
  draft: {
    layerRatio: 0.625,   // e.g., 0.25mm for 0.4mm nozzle
    speedMultiplier: 1.5,
    infill: 10,
    fillPattern: "grid",
    perimeters: 2,
    description: "Prototype rapide — vitesse max, qualité minimum",
  },
  standard: {
    layerRatio: 0.5,     // e.g., 0.20mm for 0.4mm nozzle
    speedMultiplier: 1.0,
    infill: 20,
    fillPattern: "grid",
    perimeters: 3,
    description: "Bon compromis qualité/temps",
  },
  quality: {
    layerRatio: 0.3,     // e.g., 0.12mm for 0.4mm nozzle
    speedMultiplier: 0.6,
    infill: 20,
    fillPattern: "gyroid",
    perimeters: 4,
    description: "Beau rendu — surface lisse, détails visibles",
  },
  strong: {
    layerRatio: 0.5,
    speedMultiplier: 0.8,
    infill: 50,
    fillPattern: "cubic",
    perimeters: 5,
    description: "Production solide — résistance mécanique maximale",
  },
  vase: {
    layerRatio: 0.5,
    speedMultiplier: 0.6,
    infill: 0,
    fillPattern: "rectilinear",
    perimeters: 1,
    description: "Mode vase spirale — 1 paroi, pas de remplissage",
  },
  speed: {
    layerRatio: 0.75,    // max layer height
    speedMultiplier: 2.0,
    infill: 10,
    fillPattern: "grid",
    perimeters: 2,
    description: "Speedrun — buse grosse, tout à fond",
  },
};

// ─── Goal Aliases ────────────────────────────────────────────

const GOAL_ALIASES: Record<string, PrintGoal> = {
  "draft": "draft",
  "prototype": "draft",
  "prototype rapide": "draft",
  "rapide": "draft",
  "fast": "draft",
  "quick": "draft",
  "brouillon": "draft",

  "standard": "standard",
  "normal": "standard",
  "default": "standard",
  "balanced": "standard",
  "équilibré": "standard",

  "quality": "quality",
  "qualité": "quality",
  "beau rendu": "quality",
  "beau": "quality",
  "fine": "quality",
  "detail": "quality",
  "détail": "quality",
  "high quality": "quality",

  "strong": "strong",
  "solide": "strong",
  "production solide": "strong",
  "résistant": "strong",
  "structural": "strong",
  "production": "strong",
  "robust": "strong",
  "mechanical": "strong",

  "vase": "vase",
  "vase mode": "vase",
  "spiral": "vase",
  "spirale": "vase",

  "speed": "speed",
  "speedrun": "speed",
  "extrusion maxi": "speed",
  "max speed": "speed",
  "fastest": "speed",
};

// ─── Nozzle Size Reference Table (Bible FDM) ────────────────
// Prusa official: max layer height ≈ 80% nozzle, usable range 25%-75%
// Auto extrusion width = 1.125 × nozzle diameter

interface NozzleSpec {
  minLayerHeight: number;
  maxLayerHeight: number;
  autoExtrusionWidth: number;
  notes: string;
}

function getNozzleSpec(nozzle: number): NozzleSpec {
  return {
    minLayerHeight: round2(nozzle * 0.25),  // Bible: 25% of nozzle
    maxLayerHeight: round2(nozzle * 0.80),   // Bible: 80% of nozzle (Prusa official)
    autoExtrusionWidth: round2(nozzle * 1.125), // Bible: PrusaSlicer default = 1.125×D
    notes: nozzle >= 0.6
      ? `Buse ${nozzle}mm : possible +10-20°C et MVS↑ si besoin de débit. Attention capé par MVS — réduire layer height donne "détail gratuit".`
      : nozzle <= 0.25
        ? `Buse ${nozzle}mm : détails XY meilleurs. Vitesses réalistes plus basses. Supports plus fins et faciles à retirer.`
        : `Buse ${nozzle}mm : standard. Prusa déconseille <0.10mm (gain faible vs temps très élevé).`,
  };
}

// ─── Main Recommendation Engine ──────────────────────────────

export function recommendProfile(
  printer: string,
  nozzle: number,
  goal: string,
  material: string,
  meshAnalysis?: MeshAnalysis,
  options?: { inputShaper?: boolean },
): RecommendedProfile {
  // Validate nozzle diameter
  if (!nozzle || nozzle <= 0 || nozzle > 3) {
    nozzle = 0.4; // safe fallback
  }

  // Resolve goal
  const resolvedGoal = resolveGoal(goal);
  const preset = GOALS[resolvedGoal];

  // Resolve material
  const mat = MATERIALS[material.toUpperCase()] ?? MATERIALS["PLA"];

  // Nozzle specs (Bible FDM rules)
  const nozzleSpec = getNozzleSpec(nozzle);

  // Input Shaper mode (Bible FDM: higher accel/speed if firmware supports it)
  const inputShaper = options?.inputShaper ?? false;

  // Base speeds (mm/s) — higher base if Input Shaper enabled
  const baseSpeed = inputShaper ? 80 : 60;
  const baseTravelSpeed = inputShaper ? 200 : 150;

  // Compute settings
  const warnings: string[] = [];

  // Input Shaper warning
  if (inputShaper) {
    warnings.push("Mode Input Shaper activé — vitesses et accélérations plus élevées (Bible FDM: vérifier correspondance profil ⇄ firmware)");
  }

  // Layer height: nozzle × ratio, clamped to [25%, 80%] of nozzle (Bible FDM rule)
  const rawLayerHeight = round2(nozzle * preset.layerRatio);
  const layerHeight = clamp(rawLayerHeight, nozzleSpec.minLayerHeight, nozzleSpec.maxLayerHeight);

  // Line width: PrusaSlicer default = 1.125×nozzle, or wider for speed
  const lineWidth = resolvedGoal === "speed"
    ? round2(nozzle * 1.2)
    : nozzleSpec.autoExtrusionWidth;

  // Print speed — compute but then check against MVS
  let printSpeed = Math.round(baseSpeed * preset.speedMultiplier);

  // MVS check: volumetric_flow = layer_height × line_width × speed
  // Bible: MVS is THE central parameter — caps speed automatically
  const maxVolumetricFlow = mat.maxVolumetricSpeed;
  const theoreticalFlow = layerHeight * lineWidth * printSpeed;
  let mvsLimited = false;

  if (theoreticalFlow > maxVolumetricFlow) {
    const cappedSpeed = Math.floor(maxVolumetricFlow / (layerHeight * lineWidth));
    warnings.push(
      `Débit volumique capé par MVS (${maxVolumetricFlow} mm³/s pour ${mat.name}) : ` +
      `${printSpeed}mm/s → ${cappedSpeed}mm/s. ` +
      `Astuce Bible FDM : réduire la hauteur de couche peut donner du "détail gratuit" sans augmenter le temps.`
    );
    printSpeed = cappedSpeed;
    mvsLimited = true;
  }

  // TPU needs slow speed (Bible: vitesse cadrée via MVS)
  if (mat.name === "TPU") {
    printSpeed = Math.min(printSpeed, 25);
    if (!mvsLimited) {
      warnings.push("TPU: vitesse limitée à 25mm/s max. Direct drive recommandé.");
    }
  }

  const travelSpeed = Math.round(baseTravelSpeed * Math.min(preset.speedMultiplier, 1.5));
  const firstLayerSpeed = Math.round(printSpeed * 0.5);

  // Infill
  let infill = preset.infill;
  let fillPattern = preset.fillPattern;
  if (resolvedGoal === "strong" && meshAnalysis) {
    if (meshAnalysis.volume < 5000) {
      infill = 80;
      warnings.push("Pièce très petite (<5cm³) — infill augmenté à 80% pour la solidité");
    }
  }

  // Perimeters
  const perimeters = preset.perimeters;

  // Supports — based on mesh analysis
  let supportMaterial = false;
  let supportStyle = "grid";
  // Bible: Top contact Z distance = 50-75% of layer height
  const supportContactDistance = round2(layerHeight * 0.6);
  if (meshAnalysis && meshAnalysis.overhangPercent > 5) {
    supportMaterial = true;
    supportStyle = meshAnalysis.overhangPercent > 20 ? "snug" : "grid";
    warnings.push(
      `${meshAnalysis.overhangPercent.toFixed(1)}% de faces en overhang détectées — supports activés`
    );
  }

  // Brim — if small footprint or ABS/ASA/Nylon/PC or tall piece
  let brimWidth = 0;
  const needsBrim =
    mat.requiresEnclosure ||
    (meshAnalysis && meshAnalysis.boundingBox.size.z > 3 * Math.max(
      meshAnalysis.boundingBox.size.x,
      meshAnalysis.boundingBox.size.y
    ));

  if (needsBrim) {
    brimWidth = 5;
    warnings.push("Brim activé (5mm) — matériau sujet au warping ou pièce haute/étroite");
  }

  // Acceleration
  let acceleration = 1000;
  if (resolvedGoal === "speed") acceleration = 2500;
  if (resolvedGoal === "quality") acceleration = 500;
  if (mat.name === "TPU") acceleration = 500;

  // Cooling (Bible: detailed per material)
  const fanSpeed = mat.fanSpeed;
  const minFanSpeed = mat.minFanSpeed;
  const bridgeFanSpeed = mat.bridgeFanSpeed ?? 100;
  let minLayerTime = 10;
  if (resolvedGoal === "quality") {
    minLayerTime = 15;
  }

  // Nozzle temp adjustment for large nozzles (Bible: +10-20°C for 0.6mm+ nozzle to increase flow)
  let nozzleTemp = mat.nozzleTemp;
  let firstLayerNozzleTemp = mat.firstLayerNozzleTemp;
  if (nozzle >= 0.6 && resolvedGoal === "speed") {
    nozzleTemp += 15;
    firstLayerNozzleTemp += 10;
    warnings.push(
      `Buse ≥0.6mm en mode speed : temp buse +15°C (${nozzleTemp}°C) pour suivre le débit volumique (Bible FDM : PLA imprimable 10-20°C plus chaud avec buse 0.6mm)`
    );
  } else if (resolvedGoal === "speed") {
    nozzleTemp += 10;
    firstLayerNozzleTemp += 5;
    warnings.push("Mode speed : température buse +10°C pour suivre le débit");
  }

  // Bed temp
  const bedTemp = mat.bedTemp;
  const firstLayerBedTemp = mat.firstLayerBedTemp ?? bedTemp;

  // Drying warnings for hygroscopic materials (Bible FDM)
  const DRYING_INFO: Record<string, string> = {
    NYLON: "Nylon : séchage obligatoire 12h@80°C. Hygroscopique — stocker sous vide avec dessiccant.",
    PC: "PC : séchage recommandé 8h@80°C. Sensible à l'humidité.",
    TPU: "TPU : séchage recommandé 4h@50°C. Absorbe l'humidité rapidement.",
    PETG: "PETG : séchage recommandé 4-6h@65°C si stringing/bulles persistants. Modérément hygroscopique.",
    PVA: "PVA : séchage obligatoire 8h@45°C. Extrêmement hygroscopique — utiliser immédiatement après séchage.",
    BVOH: "BVOH : séchage obligatoire 6h@50°C. Très hygroscopique.",
  };
  const dryInfo = DRYING_INFO[mat.name.toUpperCase()];
  if (dryInfo) {
    warnings.push(`Bible FDM — ${dryInfo}`);
  }

  // Enclosure warnings (Bible FDM)
  if (mat.requiresEnclosure) {
    warnings.push(`${mat.name}: enceinte fermée obligatoire — ${mat.notes}`);
  }

  // Recommended surface (Bible FDM)
  if (mat.recommendedSurface) {
    warnings.push(`Surface plateau recommandée : ${mat.recommendedSurface}`);
  }

  // Extrusion multiplier (Bible: calibration fine du débit réel, default 1.0)
  const extrusionMultiplier = 1.0;

  // Build the recommendation
  const settings: RecommendedProfile["settings"] = {
    layer_height: {
      value: layerHeight,
      reason: `Buse ${nozzle}mm — plage utilisable ${nozzleSpec.minLayerHeight}-${nozzleSpec.maxLayerHeight}mm (Bible FDM: 25%-80% du diamètre buse). ` +
        `Ratio ${preset.layerRatio} → ${rawLayerHeight}mm (${preset.description})`,
    },
    line_width: {
      value: lineWidth,
      reason: `PrusaSlicer auto = ${nozzleSpec.autoExtrusionWidth}mm (1.125×buse). ` +
        `${resolvedGoal === "speed" ? "Mode speed: 1.2×buse pour débit max." : "Valeur standard PrusaSlicer."}`,
    },
    perimeters: {
      value: perimeters,
      reason: resolvedGoal === "strong"
        ? "5 parois pour résistance mécanique maximale"
        : resolvedGoal === "vase"
          ? "1 paroi — mode vase spirale"
          : `${perimeters} parois — ${preset.description.toLowerCase()}`,
    },
    infill_density: {
      value: infill,
      reason: resolvedGoal === "strong"
        ? `${infill}% — haute densité pour résistance`
        : resolvedGoal === "vase"
          ? "0% — mode vase, pas de remplissage"
          : `${infill}% — suffisant pour ${preset.description.toLowerCase()}`,
    },
    fill_pattern: {
      value: fillPattern,
      reason: fillPattern === "gyroid"
        ? "Gyroid — isotrope, bonne résistance dans toutes les directions, beau rendu"
        : fillPattern === "cubic"
          ? "Cubic — résistance 3D optimale pour pièces structurelles"
          : "Grid — simple et rapide",
    },
    nozzle_temperature: {
      value: nozzleTemp,
      reason: `${mat.name} officiel Prusa : ${mat.nozzleTemp}°C${nozzleTemp !== mat.nozzleTemp ? ` (ajusté +${nozzleTemp - mat.nozzleTemp}°C pour débit)` : ""}`,
    },
    first_layer_nozzle_temperature: {
      value: firstLayerNozzleTemp,
      reason: `Première couche ${firstLayerNozzleTemp}°C — légèrement plus chaude pour meilleure adhésion (Bible FDM)`,
    },
    bed_temperature: {
      value: bedTemp,
      reason: `${mat.name} — ${bedTemp}°C (valeur Prusa officielle)`,
    },
    first_layer_bed_temperature: {
      value: firstLayerBedTemp,
      reason: firstLayerBedTemp !== bedTemp
        ? `Première couche : ${firstLayerBedTemp}°C (5°C+ pour adhésion initiale — Bible FDM)`
        : `${firstLayerBedTemp}°C — même que le reste`,
    },
    print_speed: {
      value: printSpeed,
      reason: mvsLimited
        ? `Limité par MVS ${maxVolumetricFlow} mm³/s (${mat.name}). Formule: MVS = layer_height × extrusion_width × speed`
        : `Base ${baseSpeed}mm/s × ${preset.speedMultiplier} (${resolvedGoal})${mat.name === "TPU" ? " — limité pour TPU" : ""}`,
    },
    travel_speed: {
      value: travelSpeed,
      reason: `Déplacement rapide — ${travelSpeed}mm/s`,
    },
    first_layer_speed: {
      value: firstLayerSpeed,
      reason: `50% de la vitesse d'impression — adhésion première couche (Bible FDM : 1ère couche dépend de calibration Z et temp)`,
    },
    support_material: {
      value: supportMaterial,
      reason: meshAnalysis
        ? supportMaterial
          ? `Overhangs détectés (${meshAnalysis.overhangPercent.toFixed(1)}%) — supports nécessaires`
          : `Pas d'overhangs significatifs (${meshAnalysis.overhangPercent.toFixed(1)}%)`
        : "Pas d'analyse mesh disponible — à évaluer visuellement",
    },
    support_material_style: {
      value: supportStyle,
      reason: supportStyle === "snug"
        ? "Beaucoup d'overhangs — support snug pour meilleur contact"
        : "Support grid — standard, facile à retirer",
    },
    support_material_contact_distance: {
      value: supportContactDistance,
      reason: `${supportContactDistance}mm — ~60% de la hauteur de couche (Bible FDM : 50-75% recommandé pour bon retrait)`,
    },
    brim_width: {
      value: brimWidth,
      reason: brimWidth > 0
        ? "Brim pour améliorer l'adhésion et réduire le warping"
        : "Pas de brim nécessaire — bonne surface de contact",
    },
    fan_speed: {
      value: fanSpeed,
      reason: fanSpeed === 0
        ? `${mat.name} — ventilateur désactivé (sinon délamination/warping — Bible FDM)`
        : `${mat.name} — ventilateur à ${fanSpeed}% pour refroidissement optimal`,
    },
    min_fan_speed: {
      value: minFanSpeed,
      reason: `Minimum ${minFanSpeed}%`,
    },
    bridge_fan_speed: {
      value: bridgeFanSpeed,
      reason: `${bridgeFanSpeed}% pour les ponts — refroidissement accru nécessaire pour solidifier le pont (Bible FDM)`,
    },
    min_layer_time: {
      value: minLayerTime,
      reason: `${minLayerTime}s minimum par couche — laisse le temps au plastique de refroidir`,
    },
    retraction_length: {
      value: mat.retractionLength,
      reason: mat.name === "TPU"
        ? `${mat.retractionLength}mm — minimale pour flexible (Bible FDM: rétraction délicate TPU)`
        : mat.name === "PETG"
          ? `${mat.retractionLength}mm — Bible FDM: PETG max 0.8-1mm rétraction`
          : `${mat.retractionLength}mm — standard ${mat.name}. Bible FDM: max 2mm MK3, 3.2mm MINI (bowden).`,
    },
    retraction_speed: {
      value: mat.retractionSpeed,
      reason: `${mat.retractionSpeed}mm/s — vitesse de rétraction ${mat.name}`,
    },
    max_volumetric_speed: {
      value: maxVolumetricFlow,
      reason: `${maxVolumetricFlow} mm³/s — Bible FDM : valeur officielle ${mat.name}. ` +
        `Le MVS est LE levier central PrusaSlicer : il limite auto les vitesses quand nécessaire ` +
        `sans recalculer manuellement (Filament Settings prime sur Print Settings).`,
    },
    extrusion_multiplier: {
      value: extrusionMultiplier,
      reason: `${extrusionMultiplier} — calibration fine du débit réel. Bible FDM : calibrer EM avant d'ajuster rétraction (un mauvais EM imite stringing/blobs).`,
    },
    acceleration: {
      value: acceleration,
      reason: resolvedGoal === "speed"
        ? "2500mm/s² — accélération haute. Bible FDM : trop haut = ringing/layer shift."
        : resolvedGoal === "quality"
          ? "500mm/s² — accélération basse pour réduire ringing (vibrations)"
          : `1000mm/s² — compromis standard. Bible FDM : ajuster si layer shift ou ringing.`,
    },
  };

  return {
    goal: resolvedGoal,
    printer,
    nozzle,
    material: mat.name,
    settings,
    warnings,
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function resolveGoal(input: string): PrintGoal {
  const normalized = input.toLowerCase().trim();
  return GOAL_ALIASES[normalized] ?? "standard";
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}
