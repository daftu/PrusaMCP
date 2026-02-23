export interface FilamentEntry {
  brand: string;
  name: string;
  material: string;
  nozzleTemp: [number, number];  // [min, max]
  bedTemp: [number, number];
  fanSpeed: [number, number];    // [min, max] %
  density: number;               // g/cm³
  maxVolumetricSpeed: number;    // mm³/s — Bible FDM central parameter
  pricePerKg?: number;           // EUR
  notes: string;
  requiresEnclosure?: boolean;
  recommendedSurface?: string;   // Bible FDM: PEI sheet recommendation
}

/**
 * Filament database with brand-specific settings.
 * Temperatures are ranges [recommended_min, recommended_max].
 * MVS values from Bible FDM (Prusa official): PLA~15, PETG~8, ABS/ASA~11, TPU~1-2.5, PVA/BVOH~4
 */
export const FILAMENT_DB: FilamentEntry[] = [
  // === PLA (Bible FDM: 215/210°C buse, 60°C bed, MVS ~15) ===
  { brand: "Prusament", name: "PLA", material: "PLA", nozzleTemp: [210, 220], bedTemp: [40, 60], fanSpeed: [100, 100], density: 1.24, maxVolumetricSpeed: 15, pricePerKg: 30, notes: "Référence qualité Prusa. Précision ±0.02mm. Très constant.", recommendedSurface: "Satin ou Smooth PEI" },
  { brand: "123-3D Jupiter", name: "PLA", material: "PLA", nozzleTemp: [200, 220], bedTemp: [50, 60], fanSpeed: [100, 100], density: 1.24, maxVolumetricSpeed: 15, pricePerKg: 18, notes: "Bon rapport qualité/prix." },
  { brand: "eSUN", name: "PLA+", material: "PLA", nozzleTemp: [205, 225], bedTemp: [60, 60], fanSpeed: [100, 100], density: 1.24, maxVolumetricSpeed: 15, pricePerKg: 20, notes: "PLA+ plus résistant que PLA classique. Bonne adhésion inter-couches." },
  { brand: "Polymaker", name: "PolyTerra PLA", material: "PLA", nozzleTemp: [190, 220], bedTemp: [25, 60], fanSpeed: [100, 100], density: 1.24, maxVolumetricSpeed: 15, pricePerKg: 22, notes: "Mat, finition soyeuse. Bobine carton recyclable." },
  { brand: "Bambu Lab", name: "PLA Basic", material: "PLA", nozzleTemp: [190, 220], bedTemp: [25, 60], fanSpeed: [80, 100], density: 1.24, maxVolumetricSpeed: 15, pricePerKg: 20, notes: "Bon PLA basique, bien calibré." },
  { brand: "Sunlu", name: "PLA", material: "PLA", nozzleTemp: [190, 220], bedTemp: [50, 60], fanSpeed: [100, 100], density: 1.24, maxVolumetricSpeed: 14, pricePerKg: 15, notes: "Budget PLA, qualité variable entre lots. MVS légèrement réduit par précaution." },
  { brand: "Devil Design", name: "PLA", material: "PLA", nozzleTemp: [200, 235], bedTemp: [50, 60], fanSpeed: [100, 100], density: 1.24, maxVolumetricSpeed: 15, pricePerKg: 22, notes: "Bonne qualité, large gamme de couleurs." },
  { brand: "Extrudr", name: "PLA NX2", material: "PLA", nozzleTemp: [195, 225], bedTemp: [0, 60], fanSpeed: [50, 100], density: 1.24, maxVolumetricSpeed: 15, pricePerKg: 35, notes: "PLA haut de gamme, extrusion très régulière." },
  { brand: "Generic", name: "PLA", material: "PLA", nozzleTemp: [190, 220], bedTemp: [50, 60], fanSpeed: [100, 100], density: 1.24, maxVolumetricSpeed: 15, pricePerKg: 20, notes: "Bible FDM: stringing si trop chaud. Privilégier EM/MVS avant rétraction.", recommendedSurface: "Satin ou Smooth PEI" },

  // === PETG (Bible FDM: 230/240°C buse, 85/90°C bed, MVS ~8) ===
  { brand: "Prusament", name: "PETG", material: "PETG", nozzleTemp: [230, 250], bedTemp: [80, 90], fanSpeed: [30, 50], density: 1.27, maxVolumetricSpeed: 8, pricePerKg: 30, notes: "PETG de référence. Précision ±0.02mm. Stringing léger normal.", recommendedSurface: "Textured/Satin PEI" },
  { brand: "eSUN", name: "PETG", material: "PETG", nozzleTemp: [230, 250], bedTemp: [75, 90], fanSpeed: [30, 60], density: 1.27, maxVolumetricSpeed: 8, pricePerKg: 22, notes: "Bon PETG budget. Sécher si stocké longtemps." },
  { brand: "Polymaker", name: "PolyLite PETG", material: "PETG", nozzleTemp: [230, 250], bedTemp: [70, 80], fanSpeed: [50, 80], density: 1.27, maxVolumetricSpeed: 8, pricePerKg: 25, notes: "Moins de stringing que la plupart des PETG." },
  { brand: "Generic", name: "PETG", material: "PETG", nozzleTemp: [225, 245], bedTemp: [80, 90], fanSpeed: [30, 50], density: 1.27, maxVolumetricSpeed: 8, pricePerKg: 22, notes: "Bible FDM: rétraction max 0.8-1mm. MVS ~8 mm³/s. Oozing/stringing si trop chaud.", recommendedSurface: "Textured/Satin PEI" },

  // === ABS (Bible FDM: 255°C buse, 100°C bed, MVS ~11) ===
  { brand: "Prusament", name: "ABS", material: "ABS", nozzleTemp: [240, 255], bedTemp: [100, 110], fanSpeed: [0, 15], density: 1.04, maxVolumetricSpeed: 11, pricePerKg: 30, notes: "Enceinte fermée obligatoire. Bonne résistance thermique.", requiresEnclosure: true },
  { brand: "eSUN", name: "ABS+", material: "ABS", nozzleTemp: [235, 255], bedTemp: [95, 110], fanSpeed: [0, 10], density: 1.04, maxVolumetricSpeed: 11, pricePerKg: 18, notes: "ABS+ moins sujet au warping que l'ABS classique.", requiresEnclosure: true },
  { brand: "Generic", name: "ABS", material: "ABS", nozzleTemp: [235, 255], bedTemp: [100, 110], fanSpeed: [0, 0], density: 1.04, maxVolumetricSpeed: 11, pricePerKg: 20, notes: "Bible FDM: enceinte obligatoire. Warping: priorité enceinte > brim > temp plateau.", requiresEnclosure: true },

  // === ASA (Bible FDM: 260°C buse, 105/110°C bed, MVS ~11) ===
  { brand: "Prusament", name: "ASA", material: "ASA", nozzleTemp: [240, 260], bedTemp: [100, 110], fanSpeed: [0, 20], density: 1.07, maxVolumetricSpeed: 11, pricePerKg: 35, notes: "Résistant UV, idéal extérieur. Enceinte fermée.", requiresEnclosure: true, recommendedSurface: "Smooth ou Textured PEI" },
  { brand: "Generic", name: "ASA", material: "ASA", nozzleTemp: [240, 260], bedTemp: [100, 110], fanSpeed: [0, 15], density: 1.07, maxVolumetricSpeed: 11, pricePerKg: 28, notes: "Bible FDM: enceinte + anti-courants d'air. Ajuster supports/overhang speed plutôt que fan.", requiresEnclosure: true },

  // === TPU (Bible FDM: 220-240°C buse, 55-75°C bed, MVS ~1-2.5) ===
  { brand: "Prusament", name: "TPU 95A", material: "TPU", nozzleTemp: [220, 240], bedTemp: [55, 75], fanSpeed: [30, 60], density: 1.21, maxVolumetricSpeed: 2.5, pricePerKg: 32, notes: "Bible FDM: MVS 1-2.5 mm³/s. Rétraction délicate. Smooth PEI déconseillé sans colle.", recommendedSurface: "Satin/Textured (pas Smooth sans colle)" },
  { brand: "Sainsmart", name: "TPU 95A", material: "TPU", nozzleTemp: [220, 240], bedTemp: [40, 60], fanSpeed: [30, 60], density: 1.21, maxVolumetricSpeed: 2, pricePerKg: 30, notes: "Flexible Shore 95A. Vitesse max 25mm/s. Direct drive recommandé." },
  { brand: "Generic", name: "TPU", material: "TPU", nozzleTemp: [210, 240], bedTemp: [40, 65], fanSpeed: [30, 50], density: 1.21, maxVolumetricSpeed: 2, pricePerKg: 28, notes: "Bible FDM: vitesse cadrée via MVS (1-2.5 mm³/s). Rétraction minimale.", recommendedSurface: "PA Nylon/Satin/Textured PEI" },

  // === NYLON (Bible FDM: 285°C buse, 110°C bed, hygroscopique) ===
  { brand: "Polymaker", name: "PolyMide CoPA", material: "NYLON", nozzleTemp: [250, 270], bedTemp: [70, 90], fanSpeed: [0, 30], density: 1.14, maxVolumetricSpeed: 8, pricePerKg: 45, notes: "Très résistant. Sécher 12h à 80°C avant impression.", requiresEnclosure: true, recommendedSurface: "Special PA Nylon sheet" },
  { brand: "Generic", name: "Nylon", material: "NYLON", nozzleTemp: [250, 285], bedTemp: [70, 110], fanSpeed: [0, 20], density: 1.14, maxVolumetricSpeed: 8, pricePerKg: 35, notes: "Bible FDM: hygroscopique. Séchage obligatoire. Enceinte critique. Priorité plateau/surface/enceinte.", requiresEnclosure: true, recommendedSurface: "Special PA Nylon sheet" },

  // === PC (Bible FDM: 275°C buse, 110/115°C bed) ===
  { brand: "Prusament", name: "PC Blend", material: "PC", nozzleTemp: [265, 280], bedTemp: [100, 115], fanSpeed: [0, 20], density: 1.20, maxVolumetricSpeed: 8, pricePerKg: 40, notes: "Polycarbonate. Très haute résistance. Enceinte 50°C+ requise.", requiresEnclosure: true, recommendedSurface: "Textured/Satin PEI (glue séparation)" },
  { brand: "Generic", name: "PC", material: "PC", nozzleTemp: [260, 280], bedTemp: [100, 115], fanSpeed: [0, 10], density: 1.20, maxVolumetricSpeed: 8, pricePerKg: 38, notes: "Bible FDM: enceinte 50°C+ obligatoire. Risque arrachement sheet. Couche séparation recommandée.", requiresEnclosure: true },

  // === Composites (Bible FDM: variable, buse trempée recommandée) ===
  { brand: "Generic", name: "PLA Bois", material: "PLA-WOOD", nozzleTemp: [190, 220], bedTemp: [50, 60], fanSpeed: [80, 100], density: 1.15, maxVolumetricSpeed: 10, pricePerKg: 30, notes: "Bible FDM: risque bouchage. Buse ≥0.5mm recommandée.", recommendedSurface: "Smooth PEI" },
  { brand: "Generic", name: "PLA Métal", material: "PLA-METAL", nozzleTemp: [200, 230], bedTemp: [50, 60], fanSpeed: [80, 100], density: 2.0, maxVolumetricSpeed: 8, pricePerKg: 40, notes: "Bible FDM: buse trempée obligatoire (abrasif). Risque bouchage.", recommendedSurface: "Smooth PEI" },

  // === Solubles (Bible FDM: MVS ~4 mm³/s) ===
  { brand: "Prusament", name: "PVA", material: "PVA", nozzleTemp: [190, 210], bedTemp: [45, 60], fanSpeed: [50, 80], density: 1.23, maxVolumetricSpeed: 4, pricePerKg: 60, notes: "Bible FDM: support soluble. MVS ~4 mm³/s. Séchage recommandé." },
  { brand: "Generic", name: "BVOH", material: "BVOH", nozzleTemp: [190, 210], bedTemp: [45, 60], fanSpeed: [50, 80], density: 1.14, maxVolumetricSpeed: 4, pricePerKg: 65, notes: "Bible FDM: support soluble alternatif au PVA. MVS ~4 mm³/s." },
];

/**
 * Search filament database.
 */
export function searchFilaments(
  query?: string,
  material?: string,
  brand?: string,
): FilamentEntry[] {
  let results = [...FILAMENT_DB];

  if (material) {
    results = results.filter((f) => f.material.toUpperCase() === material.toUpperCase());
  }
  if (brand) {
    results = results.filter((f) => f.brand.toLowerCase().includes(brand.toLowerCase()));
  }
  if (query) {
    const q = query.toLowerCase();
    results = results.filter(
      (f) =>
        f.brand.toLowerCase().includes(q) ||
        f.name.toLowerCase().includes(q) ||
        f.material.toLowerCase().includes(q) ||
        f.notes.toLowerCase().includes(q),
    );
  }

  return results;
}

/**
 * Get the best matching filament entry for a brand + material.
 */
export function getFilamentSettings(
  brand: string,
  material: string,
): FilamentEntry | null {
  const exact = FILAMENT_DB.find(
    (f) =>
      f.brand.toLowerCase() === brand.toLowerCase() &&
      f.material.toUpperCase() === material.toUpperCase(),
  );
  if (exact) return exact;

  // Fallback to generic
  return FILAMENT_DB.find(
    (f) => f.brand === "Generic" && f.material.toUpperCase() === material.toUpperCase(),
  ) ?? null;
}
