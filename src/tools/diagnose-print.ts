import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Bible FDM defect diagnostic database — comprehensive post-print troubleshooting.
 */
interface DiagnosticEntry {
  defect: string;
  aliases: string[];
  symptoms: string[];
  causes: string[];
  fixes: string[];
  preventionSettings: Record<string, string>;
}

const DIAGNOSTIC_DB: DiagnosticEntry[] = [
  {
    defect: "Warping / Décollement",
    aliases: ["warping", "décollement", "coin qui lève", "curling", "lifting"],
    symptoms: [
      "Coins qui se soulèvent du plateau",
      "Base déformée",
      "Pièce qui se décolle en cours d'impression",
    ],
    causes: [
      "Retrait thermique différentiel (chaud → froid)",
      "Température plateau trop basse",
      "Pas d'enceinte (ABS/ASA/PC/Nylon)",
      "Courants d'air",
      "Surface plateau sale",
      "Première couche mal calibrée (trop haut)",
    ],
    fixes: [
      "Enceinte fermée obligatoire pour ABS/ASA/PC/Nylon",
      "Augmenter bed temp +5-10°C",
      "Ajouter brim 5-10mm",
      "Nettoyer surface (IPA pour Smooth PEI, eau chaude savonneuse pour Textured)",
      "Vérifier Live Adjust Z — première couche doit être bien écrasée",
      "Désactiver ventilateur pour les premières couches (ABS/ASA)",
      "Utiliser un raft si brim insuffisant",
    ],
    preventionSettings: {
      brim_width: "5-10mm",
      bed_temperature: "+5-10°C",
      first_layer_speed: "réduire à 15-20mm/s",
      fan_speed: "0% pour ABS/ASA les 3 premières couches",
    },
  },
  {
    defect: "Stringing / Fils entre les pièces",
    aliases: ["stringing", "fils", "oozing", "bave", "filaments entre"],
    symptoms: [
      "Fils fins entre les parties de la pièce",
      "Toiles d'araignée entre les mouvements de déplacement",
      "Blobs aux points de redémarrage",
    ],
    causes: [
      "Température buse trop haute",
      "Rétraction insuffisante ou trop lente",
      "Extrusion Multiplier (EM) trop élevé — Bible FDM : calibrer EM AVANT rétraction",
      "Filament humide",
      "Travel speed trop bas",
    ],
    fixes: [
      "Bible FDM : calibrer EM d'abord (un mauvais EM imite stringing/blobs)",
      "Réduire température buse -5 à -10°C",
      "Augmenter rétraction length (+0.2mm, max 2mm MK3 / 3.2mm MINI bowden)",
      "Augmenter retraction speed (35-45mm/s)",
      "Augmenter travel speed (150-200mm/s)",
      "Activer wipe (sauf TPU/flex)",
      "Sécher le filament si PETG/Nylon/TPU",
    ],
    preventionSettings: {
      temperature: "-5 à -10°C",
      retract_length: "+0.2mm (max 2mm direct drive)",
      retract_speed: "35-45mm/s",
      travel_speed: "150-200mm/s",
      wipe: "1 (sauf TPU)",
    },
  },
  {
    defect: "Sous-extrusion",
    aliases: ["sous-extrusion", "under-extrusion", "manque matière", "couches incomplètes", "gaps"],
    symptoms: [
      "Couches avec des trous ou manques",
      "Surface avec des gaps visibles",
      "Infill incomplet",
      "Parois fines/transparentes",
    ],
    causes: [
      "Température trop basse pour le débit demandé",
      "MVS (Max Volumetric Speed) dépassé",
      "Buse partiellement bouchée",
      "Extrusion Multiplier trop bas",
      "Filament de mauvais diamètre (vérifier 1.75mm)",
      "Engrenage extrudeur usé ou sale",
    ],
    fixes: [
      "Vérifier que MVS n'est pas dépassé (couche × largeur × vitesse < MVS)",
      "Augmenter température buse +5-10°C",
      "Réduire vitesse d'impression",
      "Cold pull pour déboucher la buse",
      "Calibrer Extrusion Multiplier (Bible FDM : étape 4 du workflow)",
      "Vérifier tension de l'extrudeur et usure de l'engrenage",
      "Mesurer diamètre filament au pied à coulisse",
    ],
    preventionSettings: {
      max_volumetric_speed: "respecter MVS du matériau",
      temperature: "+5-10°C",
      extrusion_multiplier: "calibrer avec cube de test",
    },
  },
  {
    defect: "Sur-extrusion",
    aliases: ["sur-extrusion", "over-extrusion", "bourrelets", "blobs", "trop de matière"],
    symptoms: [
      "Surface rugueuse avec excès de matière",
      "Blobs/zits sur les parois",
      "Couches qui débordent",
      "Elephant foot excessif",
    ],
    causes: [
      "Extrusion Multiplier trop haut",
      "Température trop haute (plastique trop fluide)",
      "Diamètre filament réel > 1.75mm",
      "Flow rate mal calibré",
    ],
    fixes: [
      "Calibrer EM avec cube de test (Bible FDM : mesurer épaisseur paroi)",
      "Réduire température buse -5°C",
      "Mesurer diamètre réel du filament et ajuster dans slicer",
      "Vérifier extrusion_multiplier = 0.95-1.0 typiquement",
    ],
    preventionSettings: {
      extrusion_multiplier: "0.95-1.0 (calibrer)",
      temperature: "-5°C si bourrelets",
    },
  },
  {
    defect: "Layer shift / Décalage de couches",
    aliases: ["layer shift", "décalage", "couches décalées", "shifted layers"],
    symptoms: [
      "Couches décalées en X ou Y",
      "Pièce comme 'coupée' à un endroit",
      "Motif en escalier non intentionnel",
    ],
    causes: [
      "Accélération trop haute",
      "Courroies desserrées",
      "Vitesse trop haute pour la mécanique",
      "Surchauffe drivers moteurs",
      "Obstacle physique (câble, etc.)",
    ],
    fixes: [
      "Réduire accélération (1000mm/s² max sans Input Shaper)",
      "Vérifier tension des courroies X/Y",
      "Réduire vitesse d'impression -20%",
      "Vérifier que rien ne bloque les axes",
      "Bible FDM : Input Shaper permet des accélérations plus hautes",
      "Vérifier refroidissement des drivers (surtout été)",
    ],
    preventionSettings: {
      default_acceleration: "1000 (500-800 sans Input Shaper)",
      perimeter_speed: "réduire de 20%",
    },
  },
  {
    defect: "Ringing / Ghosting",
    aliases: ["ringing", "ghosting", "ondulations", "vibrations", "écho"],
    symptoms: [
      "Ondulations/vagues sur les surfaces planes",
      "Écho des angles vifs",
      "Vibrations visibles autour des features",
    ],
    causes: [
      "Accélération trop haute",
      "Jerk trop élevé",
      "Vitesse d'impression trop haute",
      "Cadre imprimante pas assez rigide",
    ],
    fixes: [
      "Réduire accélération (500-800mm/s²)",
      "Activer Input Shaper si firmware le supporte",
      "Réduire external_perimeter_speed (50% de perimeter_speed)",
      "Vérifier serrage de tous les vis du cadre",
      "Bible FDM : calibration acceleration/jerk = étape 9 du workflow",
    ],
    preventionSettings: {
      default_acceleration: "500-800",
      external_perimeter_speed: "50% de perimeter_speed",
    },
  },
  {
    defect: "Elephant foot / Pied d'éléphant",
    aliases: ["elephant foot", "pied d'éléphant", "base élargie", "première couche écrasée"],
    symptoms: [
      "Base de la pièce plus large que prévu",
      "Première couche qui déborde",
      "Bourrelet à la base",
    ],
    causes: [
      "Live Adjust Z trop bas (première couche trop écrasée)",
      "Bed temp trop haute",
      "Pas de compensation elephant foot dans slicer",
    ],
    fixes: [
      "Ajuster Live Adjust Z (monter légèrement)",
      "Activer elefant_foot_compensation = 0.1-0.2mm dans PrusaSlicer",
      "Réduire bed temp -5°C pour première couche",
      "Bible FDM : calibration première couche = étape 3 du workflow",
    ],
    preventionSettings: {
      elefant_foot_compensation: "0.1-0.2mm",
      first_layer_bed_temperature: "-5°C si pied d'éléphant",
    },
  },
  {
    defect: "Délamination / Séparation de couches",
    aliases: ["délamination", "layer separation", "couches qui se séparent", "splitting"],
    symptoms: [
      "Couches qui se décollent entre elles",
      "Fissures horizontales dans la pièce",
      "Pièce qui se casse facilement en couches",
    ],
    causes: [
      "Température trop basse (adhésion inter-couches faible)",
      "Ventilateur trop fort (surtout ABS/ASA)",
      "Vitesse trop haute",
      "Filament humide",
      "Courants d'air (ABS/ASA)",
    ],
    fixes: [
      "Augmenter température buse +10-15°C",
      "Réduire fan speed (0% pour ABS/ASA, 50% pour PETG)",
      "Enceinte fermée pour ABS/ASA/PC",
      "Réduire vitesse d'impression",
      "Sécher le filament",
      "Bible FDM : l'adhésion inter-couches dépend principalement de la température",
    ],
    preventionSettings: {
      temperature: "+10-15°C",
      max_fan_speed: "0% ABS/ASA, 50% PETG",
    },
  },
  {
    defect: "Bouchage de buse / Clogging",
    aliases: ["clogging", "bouchage", "buse bouchée", "nozzle clog", "jam"],
    symptoms: [
      "Extrusion qui s'arrête en cours d'impression",
      "Claquements de l'extrudeur",
      "Filament qui ne sort plus",
      "Sous-extrusion soudaine",
    ],
    causes: [
      "Heat creep (chaleur qui remonte)",
      "Filament de mauvaise qualité / impuretés",
      "Température trop basse pour le matériau",
      "Rétraction trop longue (zone de transition)",
      "Ventilateur hotend défaillant",
    ],
    fixes: [
      "Cold pull (méthode à froid) pour déboucher",
      "Vérifier ventilateur du hotend (doit tourner à 100%)",
      "Réduire rétraction (max 2mm direct drive, 3.2mm bowden)",
      "Augmenter température buse",
      "Changer buse si usée (surtout avec composites/CF)",
      "Bible FDM : rétraction trop longue = cause #1 de heat creep",
    ],
    preventionSettings: {
      retract_length: "max 2mm (direct drive)",
      temperature: "vérifier plage matériau",
    },
  },
];

export function registerDiagnosePrint(server: McpServer) {
  server.registerTool(
    "diagnose_print",
    {
      title: "Diagnostiquer un défaut d'impression",
      description:
        "Diagnostic post-impression basé sur la Bible FDM. " +
        "Décris le défaut observé et obtiens les causes probables, " +
        "les corrections à appliquer, et les réglages PrusaSlicer à modifier.",
      inputSchema: {
        defect: z.string().describe(
          "Description du défaut observé (ex: 'warping', 'stringing', 'sous-extrusion', " +
          "'couches décalées', 'ringing', 'elephant foot', 'délamination', 'buse bouchée')"
        ),
        material: z.string().optional().describe("Matériau utilisé (PLA, PETG, ABS...)"),
        details: z.string().optional().describe("Détails supplémentaires sur le problème"),
      },
    },
    async ({ defect, material, details }) => {
      const query = defect.toLowerCase().trim();

      // Find matching diagnostics
      const matches = DIAGNOSTIC_DB.filter((entry) =>
        entry.aliases.some((alias) => query.includes(alias)) ||
        query.includes(entry.defect.toLowerCase())
      );

      // If no exact match, do fuzzy search on symptoms
      if (matches.length === 0) {
        const fuzzy = DIAGNOSTIC_DB.filter((entry) =>
          entry.symptoms.some((s) => {
            const sLower = s.toLowerCase();
            return query.split(/\s+/).some((word) => word.length > 3 && sLower.includes(word));
          })
        );
        matches.push(...fuzzy);
      }

      if (matches.length === 0) {
        // Return all available defects as suggestions
        const available = DIAGNOSTIC_DB.map((e) => `- ${e.defect}`).join("\n");
        return {
          content: [{
            type: "text" as const,
            text: `Défaut non reconnu : "${defect}"\n\n` +
              `**Défauts diagnosticables :**\n${available}\n\n` +
              `_Décris le problème avec plus de détails ou utilise un des termes ci-dessus._`,
          }],
        };
      }

      const lines: string[] = [];

      for (const entry of matches) {
        lines.push(`## ${entry.defect}`);
        lines.push("");

        lines.push("### Symptômes");
        for (const s of entry.symptoms) {
          lines.push(`- ${s}`);
        }
        lines.push("");

        lines.push("### Causes probables");
        for (const c of entry.causes) {
          lines.push(`- ${c}`);
        }
        lines.push("");

        // Material-specific notes
        if (material) {
          const matUpper = material.toUpperCase();
          const materialNotes: string[] = [];

          if (entry.defect.includes("Warping") && ["ABS", "ASA", "PC", "NYLON"].includes(matUpper)) {
            materialNotes.push(`${matUpper} est particulièrement sujet au warping — enceinte fermée OBLIGATOIRE`);
          }
          if (entry.defect.includes("Stringing") && matUpper === "PETG") {
            materialNotes.push("PETG est connu pour le stringing — réduire temp à 230°C, rétraction max 0.8-1mm");
          }
          if (entry.defect.includes("Stringing") && matUpper === "TPU") {
            materialNotes.push("TPU : rétraction très limitée (0.5mm max). Accepter un peu de stringing ou post-traiter.");
          }
          if (entry.defect.includes("Délamination") && ["ABS", "ASA"].includes(matUpper)) {
            materialNotes.push(`${matUpper} : ventilateur à 0%, enceinte fermée, temp buse 255-260°C minimum`);
          }

          if (materialNotes.length > 0) {
            lines.push(`### Notes spécifiques ${matUpper}`);
            for (const note of materialNotes) {
              lines.push(`- ${note}`);
            }
            lines.push("");
          }
        }

        lines.push("### Corrections recommandées (Bible FDM)");
        for (let i = 0; i < entry.fixes.length; i++) {
          lines.push(`${i + 1}. ${entry.fixes[i]}`);
        }
        lines.push("");

        lines.push("### Réglages PrusaSlicer à modifier");
        for (const [key, value] of Object.entries(entry.preventionSettings)) {
          lines.push(`- **${key}** : ${value}`);
        }
        lines.push("");
      }

      if (details) {
        lines.push(`_Détails fournis : ${details}_`);
        lines.push("");
      }

      lines.push("---");
      lines.push("_Diagnostic basé sur la Bible de l'impression 3D FDM et les recommandations Prusa officielles._");

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}
