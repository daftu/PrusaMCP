# PrusaMCP

**MCP Server intelligent pour PrusaSlicer** — 17 tools pour analyser, configurer et lancer vos impressions 3D depuis Claude ou tout client MCP.

PrusaMCP n'est pas un simple wrapper CLI. C'est un **assistant d'impression 3D** qui analyse votre mesh, recommande des paramètres optimaux avec justification, diagnostique les défauts, et peut piloter PrusaSlicer automatiquement.

## Features

- **Analyse mesh native** — Parser STL binaire/ASCII et 3MF, zéro dépendance externe pour le parsing
- **Moteur de recommandation** — Base de connaissances Bible FDM + Prusa officiel, justification pour chaque réglage
- **MVS-based speed capping** — Calcul automatique des vitesses basé sur le Max Volumetric Speed du matériau
- **17 tools MCP** couvrant tout le workflow d'impression
- **Diagnostic post-print** — Arbre de diagnostic Bible FDM pour 9 défauts courants
- **Base de filaments** — 30+ filaments avec températures, MVS, surface recommandée

## Tools

### Analyse & Recommandation (sans PrusaSlicer)

| Tool | Description |
|------|-------------|
| `analyze_mesh` | Analyse géométrique d'un STL/3MF (dimensions, volume, overhangs, manifold) |
| `check_printability` | Détection de problèmes : murs fins, ponts, overhangs, stabilité |
| `suggest_orientation` | Test de 6 orientations avec scoring (overhangs, hauteur, adhésion) |
| `recommend_profile` | Recommandation de profil complet avec justification par réglage |
| `generate_prusaslicer_config` | Génération de fichier .ini compatible PrusaSlicer |
| `estimate_cost` | Estimation coût (filament + électricité) et temps d'impression |
| `search_filament` | Recherche dans la base de filaments (30+ entrées) |
| `print_wizard` | Assistant complet : analyse + printabilité + orientation + profil + questions |
| `diagnose_print` | Diagnostic post-impression (warping, stringing, sous-extrusion...) |

### PrusaSlicer Integration

| Tool | Description |
|------|-------------|
| `slice_prusaslicer` | Lancer le slicing via CLI avec stats G-code |
| `get_current_model` | Récupérer le modèle ouvert dans PrusaSlicer |
| `screenshot_prusaslicer` | Capture d'écran de PrusaSlicer (même en arrière-plan) |
| `postprocess_gcode` | Post-processing G-code (pause, changement filament, etc.) |
| `upload_print` | Upload vers OctoPrint / Prusa Connect |

### Feedback & Communauté

| Tool | Description |
|------|-------------|
| `submit_feedback` | Soumettre un retour d'expérience après impression |
| `feedback_stats` | Statistiques des retours par matériau/objectif |
| `export_feedback` | Export anonymisé des données communautaires |

## Installation

```bash
git clone https://github.com/Noosbai/PrusaMCP.git
cd PrusaMCP
npm install
npm run build
```

## Configuration

### Claude Desktop / Claude Code

Ajoutez dans votre configuration MCP :

```json
{
  "mcpServers": {
    "prusa-mcp": {
      "command": "node",
      "args": ["C:/chemin/vers/PrusaMCP/build/index.js"],
      "env": {
        "PRUSASLICER_PATH": "C:/Program Files/Prusa3D/PrusaSlicer/prusa-slicer-console.exe"
      }
    }
  }
}
```

### Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `PRUSASLICER_PATH` | Chemin vers `prusa-slicer-console.exe` | Auto-détecté |
| `PRUSASLICER_PROFILES_DIR` | Dossier des profils PrusaSlicer | `%APPDATA%/PrusaSlicer` |
| `OCTOPRINT_URL` | URL de votre instance OctoPrint | — |
| `OCTOPRINT_API_KEY` | Clé API OctoPrint | — |

## Utilisation

### Workflow typique

1. **Analyser un modèle** : `analyze_mesh` pour connaître les dimensions, overhangs, etc.
2. **Vérifier la printabilité** : `check_printability` pour détecter les problèmes potentiels
3. **Obtenir une recommandation** : `recommend_profile` avec votre objectif (draft, standard, quality, strong, speed)
4. **Générer la config** : `generate_prusaslicer_config` pour un .ini prêt à l'emploi
5. **Slicer** : `slice_prusaslicer` pour générer le G-code

### Ou en une commande

`print_wizard` fait tout d'un coup : analyse + printabilité + orientation + profil + estimation de coût + questions pour affiner.

### Objectifs disponibles

| Objectif | Description |
|----------|-------------|
| `draft` / `prototype` | Rapide, qualité secondaire |
| `standard` | Bon compromis qualité/temps |
| `quality` / `beau rendu` | Surface lisse, détails fins |
| `strong` / `solide` | Résistance mécanique maximale |
| `vase` | Mode vase spirale |
| `speed` | Tout à fond, buse grosse |

### Matériaux supportés

PLA, PETG, ABS, ASA, TPU, Nylon, PC — avec températures officielles Prusa, MVS Bible FDM, warnings séchage/enceinte.

## Base de connaissances

Le moteur de recommandation s'appuie sur :

- **Bible de l'impression 3D FDM** — Guide complet orienté réglages PrusaSlicer
- **Documentation officielle Prusa** — Températures, MVS, profils de référence
- **Workflow de calibration** en 9 étapes (mécanique → PID → Z → EM → MVS → rétraction → cooling → PA → accel)
- **Arbre de diagnostic** pour 9 défauts courants avec causes et corrections

### MVS (Max Volumetric Speed) — Le paramètre central

| Matériau | MVS (mm³/s) |
|----------|-------------|
| PLA | ~15 |
| ABS/ASA | ~11 |
| PETG | ~8 |
| Nylon/PC | ~8 |
| PVA/BVOH | ~4 |
| TPU | ~1-2.5 |

## Architecture

```
src/
├── index.ts              # Entry point MCP + STDIO transport
├── types.ts              # Interfaces TypeScript
├── config.ts             # Détection PrusaSlicer
├── stl-parser.ts         # Parser STL binaire/ASCII natif
├── threemf-parser.ts     # Parser 3MF (ZIP + XML)
├── mesh-analyzer.ts      # Analyse géométrique
├── profile-engine.ts     # Moteur de recommandation (Bible FDM)
├── ini-writer.ts         # Génération .ini PrusaSlicer
├── print-issues.ts       # Détection problèmes + diagnostic Bible FDM
├── orientation.ts        # Suggestion d'orientation optimale
├── cost-estimator.ts     # Estimation coût/temps
├── filament-db.ts        # Base de données filaments
├── prusa-cli.ts          # Wrapper CLI PrusaSlicer
├── community-data.json   # Données communautaires (MVS, diagnostic, bonnes pratiques)
└── tools/                # 17 tools MCP
    ├── analyze-mesh.ts
    ├── check-printability.ts
    ├── suggest-orientation.ts
    ├── recommend-profile.ts
    ├── generate-config.ts
    ├── estimate-cost.ts
    ├── search-filament.ts
    ├── print-wizard.ts
    ├── diagnose-print.ts
    ├── slice.ts
    ├── get-current-model.ts
    ├── screenshot-prusaslicer.ts
    ├── postprocess-gcode.ts
    ├── upload-print.ts
    └── feedback.ts
```

## Prérequis

- **Node.js** >= 18
- **PrusaSlicer** (optionnel — nécessaire uniquement pour slice, screenshot, get_current_model)
- **Windows** pour le screenshot (utilise l'API PrintWindow)

## Licence

MIT
