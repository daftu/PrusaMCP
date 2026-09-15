# PrusaMCP

**Intelligent MCP Server for PrusaSlicer** — 17 tools to analyze, configure and launch your 3D prints from Claude or any MCP client.

PrusaMCP is not a simple CLI wrapper. It's a **3D printing assistant** that analyzes your mesh, recommends optimal settings with justification, diagnoses defects, and can drive PrusaSlicer automatically.

> Built with [Claude Code](https://claude.ai/claude-code).

## Features

- **Native mesh analysis** — Binary/ASCII STL and 3MF parser, zero external dependencies for parsing
- **Recommendation engine** — Bible FDM + official Prusa knowledge base, justification for every setting
- **MVS-based speed capping** — Automatic speed calculation based on material Max Volumetric Speed
- **17 MCP tools** covering the full print workflow
- **Post-print diagnostics** — Bible FDM diagnostic tree for 9 common defects
- **Filament database** — 30+ filaments with temperatures, MVS, recommended surface

## Tools

### Analysis & Recommendation (no PrusaSlicer needed)

| Tool | Description |
|------|-------------|
| `analyze_mesh` | Geometric analysis of STL/3MF (dimensions, volume, overhangs, manifold) |
| `check_printability` | Issue detection: thin walls, bridges, overhangs, stability |
| `suggest_orientation` | Test 6 orientations with scoring (overhangs, height, adhesion) |
| `recommend_profile` | Full profile recommendation with per-setting justification |
| `generate_prusaslicer_config` | Generate PrusaSlicer-compatible .ini file |
| `estimate_cost` | Cost estimate (filament + electricity) and print time |
| `search_filament` | Search filament database (30+ entries) |
| `print_wizard` | All-in-one: analysis + printability + orientation + profile + questions |
| `diagnose_print` | Post-print diagnosis (warping, stringing, under-extrusion...) |

### PrusaSlicer Integration

| Tool | Description |
|------|-------------|
| `slice_prusaslicer` | Run slicing via CLI with G-code stats |
| `get_current_model` | Get the model currently open in PrusaSlicer |
| `screenshot_prusaslicer` | Capture PrusaSlicer window (even in background) |
| `postprocess_gcode` | G-code post-processing (pause, filament change, etc.) |
| `upload_print` | Upload to OctoPrint / Prusa Connect |

### Feedback & Community

| Tool | Description |
|------|-------------|
| `submit_feedback` | Submit print feedback after printing |
| `feedback_stats` | Feedback statistics by material/goal |
| `export_feedback` | Anonymized community data export |

## Installation

```bash
git clone https://github.com/Noosbai/PrusaMCP.git
cd PrusaMCP
npm install
npm run build
```

## Configuration

### Claude Desktop / Claude Code

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "prusa-mcp": {
      "command": "node",
      "args": ["/path/to/PrusaMCP/build/index.js"],
      "env": {
        "PRUSASLICER_PATH": "C:/Program Files/Prusa3D/PrusaSlicer/prusa-slicer-console.exe"
      }
    }
  }
}
```

### macOS

The server detects `/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer`
(and user Applications or Original Prusa Drivers installations) and reads profiles
from `~/Library/Application Support/PrusaSlicer`. No `APPDATA` workaround is needed.

```json
{
  "mcpServers": {
    "prusa-mcp": {
      "command": "node",
      "args": ["/Users/dawidmos/repos/PrusaMCP/build/index.js"],
      "env": {
        "PRUSASLICER_PATH": "/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer"
      }
    }
  }
}
```

Use an absolute Node executable path if the MCP host cannot find `node`.
Build with `npm run build` after updating the source, then restart the MCP server.

Window detection uses macOS Quartz through the built-in `osascript` JavaScript
bridge. Screenshots use `screencapture` for the selected window only. The MCP host
needs Screen Recording access in System Settings > Privacy & Security and access
to the logged-in graphical session. The server reports missing permission without
changing permissions or prompting automatically. No Xcode or third-party runtime
is required. Windows retains its PowerShell/PrintWindow implementation.

If several PrusaSlicer projects are open, the tools return their titles and IDs;
repeat the call with `window_id` to select one. They do not activate or modify it.
`get_current_model` reads preset names from the **saved** `PrusaSlicer.ini` and
analyzes the **saved** model file. It cannot export or read unsaved GUI settings or
object/modifier overrides. A `*` in the window title is reported as unsaved changes.
A title without a filename does not prove that the plate is empty.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PRUSASLICER_PATH` | Path to the PrusaSlicer executable | Auto-detected |
| `PRUSASLICER_PROFILES_DIR` | PrusaSlicer profiles folder | macOS: `~/Library/Application Support/PrusaSlicer`; Windows: `%APPDATA%/PrusaSlicer` |
| `PRUSASLICER_TRUSTED_SCRIPTS` | JSON object mapping administrator-approved script IDs to commands | `{}` (scripts disabled) |
| `OCTOPRINT_URL` | Your OctoPrint instance URL | — |
| `OCTOPRINT_API_KEY` | OctoPrint API key | — |

## Usage

### Typical Workflow

1. **Analyze a model**: `analyze_mesh` to get dimensions, overhangs, etc.
2. **Check printability**: `check_printability` to detect potential issues
3. **Get a recommendation**: `recommend_profile` with your goal (draft, standard, quality, strong, speed)
4. **Generate config**: `generate_prusaslicer_config` for a ready-to-use .ini
5. **Slice**: `slice_prusaslicer` to generate G-code

### Or in one command

`print_wizard` does everything at once: analysis + printability + orientation + profile + cost estimate + follow-up questions to refine.

### Available Goals

| Goal | Description |
|------|-------------|
| `draft` / `prototype` | Fast, quality secondary |
| `standard` | Good quality/time balance |
| `quality` / `fine` | Smooth surface, fine details |
| `strong` / `structural` | Maximum mechanical strength |
| `vase` | Spiral vase mode |
| `speed` | Everything maxed out |

### Supported Materials

PLA, PETG, ABS, ASA, TPU, Nylon, PC — with official Prusa temperatures, Bible FDM MVS values, drying/enclosure warnings.

## Knowledge Base

The recommendation engine is built on:

- **Bible de l'impression 3D FDM** — Comprehensive FDM settings guide for PrusaSlicer
- **Official Prusa documentation** — Temperatures, MVS, reference profiles
- **9-step calibration workflow** (mechanical → PID → Z → EM → MVS → retraction → cooling → PA → accel)
- **Diagnostic tree** for 9 common defects with causes and fixes

### MVS (Max Volumetric Speed) — The Central Parameter

| Material | MVS (mm³/s) |
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
├── index.ts              # MCP entry point + STDIO transport
├── types.ts              # TypeScript interfaces
├── config.ts             # PrusaSlicer detection
├── stl-parser.ts         # Native binary/ASCII STL parser
├── threemf-parser.ts     # 3MF parser (ZIP + XML)
├── mesh-analyzer.ts      # Geometric analysis
├── profile-engine.ts     # Recommendation engine (Bible FDM)
├── ini-writer.ts         # PrusaSlicer .ini generation
├── print-issues.ts       # Issue detection + Bible FDM diagnostics
├── orientation.ts        # Optimal orientation suggestion
├── cost-estimator.ts     # Cost/time estimation
├── filament-db.ts        # Filament database
├── prusa-cli.ts          # PrusaSlicer CLI wrapper
├── community-data.json   # Community data (MVS, diagnostics, best practices)
└── tools/                # 17 MCP tools
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

## Requirements

- **Node.js** >= 18
- **PrusaSlicer** (optional — only needed for slice, screenshot, get_current_model)
- **macOS or Windows** for window detection and screenshots (macOS requires Screen Recording permission for the MCP host)

## License

MIT

## Structured macOS GUI access

Prefer these tools to screenshots for parameter inspection:

- `open_prusaslicer_tab`: navigate through named menu entries, then read fields.
- `read_prusaslicer_fields`: return JSON with PrusaSlicer parameter names from
  `AXHelp`, live values (including unsaved edits), enabled state, role and section.
- `set_prusaslicer_field`: change one explicitly authorized numeric text field,
  using its exact parameter name and an `expected_value` from a fresh read.
  The tool commits through the UI, reports readback and never saves the project.

These tools require Accessibility/Automation access for the MCP host in addition
  to the existing window-detection permission. They do not grant permissions.
Coverage is limited to currently exposed controls in the selected settings
category and UI mode. Category navigation, custom-drawn dropdowns, object
modifiers and hidden fields are not a complete API: do not infer their values
from absent controls. Disabled fields can represent inheritance and are not
necessarily effective settings. Numeric writes do not enable overrides or
change checkboxes/dropdowns. A validation dialog or a normalized readback must
be resolved by inspecting the result, not by assuming the requested value stuck.
Screenshots remain available as a fallback for custom geometry and visual checks.


### Slicing files and host scripts

`slice_prusaslicer` writes to a unique staging directory next to the requested
output, then publishes the complete file without replacing an existing name.
An existing destination returns `output_exists`; choose a new `output_gcode`.
A nonzero process exit always fails. Exit zero without a nonempty output returns
`output_missing`. Temporary files from the request are removed after completion.

Host `post_process` scripts from imported INI files and 3MF projects are disabled
by default through an explicit CLI override. An administrator can configure
`PRUSASLICER_TRUSTED_SCRIPTS`, for example as this environment variable value:

```json
{"audit":"/opt/print-tools/audit-gcode"}
```

A client may select `trusted_script_id: "audit"` when calling
`slice_prusaslicer`. Only that configured command is used, replacing imported
scripts. Omitting the ID keeps scripts disabled even when the map is configured.
Unknown IDs and raw command fields are rejected. Responses identify the selected
policy (`disabled` or `trusted:<id>`); the configured command is redacted from
native diagnostics. Scripts run with the server user's permissions and receive
PrusaSlicer's temporary G-code path. This allowlist is not a script sandbox;
configure only reviewed commands and do not print secrets from scripts.

This behavior is verified against stock PrusaSlicer 2.9.6. Its CLI gives command
line settings precedence over INI and 3MF settings and prompts before executing a
script; PrusaMCP supplies confirmation only for a selected configured ID.
See [Prusa's post-processing documentation](https://help.prusa3d.com/article/post-processing-scripts_283913)
and the [2.9.6 configuration loading implementation](https://github.com/prusa3d/PrusaSlicer/blob/version_2.9.6/src/CLI/LoadPrintData.cpp).
Printer start/end/custom G-code is separate from these host scripts.

The isolated real-backend acceptance test requires Python 3 for its generated
3MF fixture and runs without accessing user projects or printer profiles:

```bash
npm run build
PRUSASLICER_REAL_TEST=/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer node --test test/test-slice-real.js
```

### Structured tool results and capability diagnostics

Every tool publishes an MCP `outputSchema` and returns `structuredContent` with
`source`, `coverage`, `status`, `warnings`, optional `revision`/`error`, and typed
`data`. Text content is the same JSON result, including the human-readable
`summary`; screenshot tools also retain their image content. Execution errors
set `isError: true` and include an error code. Tool annotations describe side
effects; they do not authorize an operation.

`coverage` describes the requested operation. `confirmed` means complete
coverage; partial edits retain their actual results. GUI validation dialogs or
failed readback require user action and a fresh read, and do not imply that an
attempted edit was undone. `get_current_model` reports partial coverage because
saved files and presets do not establish the unsaved GUI scene. An upload's HTTP
acceptance does not establish physical printing.

Call `get_capabilities` without arguments for read-only diagnostics:

- CLI executable, version, FFF/SLA help options, actions, transformations and
  limitations. `PRUSASLICER_PATH` overrides automatic discovery even when the
  configured path is unavailable. The three help probes have bounded timeouts;
  cached detection is reused only for the same path and binary contents.
- Host and macOS probe process, separate granted/denied/unknown permission states,
  GUI-session availability, and the current JXA/capture backend limitations.
  Probes never request permissions, activate a project, capture an image or slice.
  The current Quartz selector requires Screen Recording. Automation remains
  unknown because this probe does not send Apple Events. Permission observations
  apply to the reported host/probe context, not every application on the machine.

Only version 2.9.6 has the tested-version flag. Help options from another version
are observations, not a claim that its operations meet the tested integration
contract. Files remain available independently of CLI and GUI diagnostics;
individual file access is checked when a tool uses that file.

Shared Zod contracts are exported from `contracts.ts`: file revisions hash the
contents, while live revisions identify an observed session revision rather than
a full project snapshot. Setting addresses use zero-based extruder indices and
require a target for object, volume and height-range scopes. Unknown effective
settings carry `effective_known: false` and `effective_value: null`.

## Native presets and configuration (PrusaSlicer 2.9.6)

The configuration tools use stock PrusaSlicer CLI and an optional native preset helper, both with isolated data directories.
They do not change the active GUI project, run slicing, or install presets in the
user's profile directory. Set `PRUSASLICER_PATH` and, for installed preset queries,
`PRUSASLICER_PROFILES_DIR` as described above.

| Tool | Behavior |
| --- | --- |
| `list_printer_models` | Lists installed FFF or SLA models and printer preset IDs. |
| `list_presets` | Lists compatible print/material IDs for a returned printer ID. |
| `resolve_configuration` | Resolves one saved INI/3MF or a complete preset tuple, with optional overrides. |
| `validate_settings` | Checks typed global edits against a snapshot revision and then native validation; does not apply edits. An empty changes list returns the catalog and validates the snapshot. |
| `import_configuration` | Imports a flat INI or native preset bundle in a server-managed workspace. |
| `export_configuration` | Writes a flat INI snapshot or its selected native preset bundle; existing files are never replaced. |

For example, resolve a saved configuration:

```json
{
  "base": { "type": "file", "path": "/work/input.ini" },
  "overrides": { "layer_height": "0.2" }
}
```

Alternatively, use `base.type = "presets"` with `printer_profile_id`,
`print_profile_id`, and `material_profile_ids` returned by the listing tools.
The tuple must provide one compatible material per FFF extruder, or one SLA
material. Ambiguous native preset names are rejected. System print/material IDs use the verified vendor file identity. A missing
or ambiguous system vendor source is rejected. User presets retain
`vendor_id = null` when their vendor is unknown.

Use the returned `revision.sha256` as `snapshot_revision` for `validate_settings`:

```json
{
  "snapshot_revision": "<sha256 from resolve_configuration>",
  "changes": [
    { "address": { "scope": "global", "key": "fill_density" }, "value": "25%" },
    { "address": { "scope": "global", "key": "temperature", "extruder_index": 0 }, "value": 215 }
  ]
}
```

Booleans use JSON booleans, integers/floats use numbers, percentages use strings
such as `"25%"`, enums use native names, and vectors use arrays. Extruder indexes
start at zero. The catalog covers modeled keys advertised by stock 2.9.6 help;
complex point types and unmodeled keys are explicitly unsupported. GUI locations
are null unless confirmed in that version's source. Layer-event information
reports the firmware and commands present in native configuration; it does not
certify physical behavior.

`resolve_configuration.overrides` contains native serialized INI values, with
escaped newlines for G-code text. Native precedence is CLI options above `--load`
files, above the selected preset tuple or 3MF configuration. The resolver puts
explicit overrides in a later `--load` layer. Configuration results include
omitted, unsupported, and converted field names. `input_diagnostics_known=false`
means source conversion details are unavailable; an empty list then does not
prove that no conversion occurred. These snapshots describe saved/effective
configuration, not unsaved GUI state. Snapshot and workspace IDs belong to the
running MCP server session.

### Named preset bundles

Build the [native preset helper](native/README.md) from the pinned PrusaSlicer
2.9.6 source and set `PRUSAMCP_NATIVE_CONFIG_PATH` to its executable. It calls
PrusaSlicer's own preset loader, compatibility checks and exporter. Stock CLI
alone has no bundle import action. A missing helper reports
`native_backend_missing`; flat INI and saved-project operations remain available.

1. Call `import_configuration` with `path` and `workspace_id`. A bundle import
   returns separate profile IDs, including profiles with the same name in
   different categories. It does not select a default tuple or return a snapshot.
2. Choose the printer, print and material IDs from that response and pass them
   to `resolve_configuration` with `base.type = "presets"`. All IDs must belong
   to the same imported bundle. Compatibility is checked by the native helper
   during resolution; empty compatibility arrays on imported IDs are not a verdict.
3. Pass the resolved `snapshot_id` to `export_configuration` with
   `format = "bundle"` and a new `output_path`.

With the helper configured, installed preset tuples can also be exported. The
snapshot retains a native flattened bundle of the selected presets, so later
profile edits cannot change its export. Overrides may produce native generated
material names to preserve separate values for each extruder; printer and print
names remain unchanged so name-based compatibility conditions still apply. A snapshot from a
flat file has no selected preset set and cannot be exported as a bundle.

Native preset bundles omit project fields such as color-change heights and purge
volume matrices. Bundle export names these fields in `omitted_fields` and
`bundle_omitted_fields`, and reports `partial` with a warning. The source snapshot
and flat INI retain their values; use flat INI when transferring project settings.

The helper runs in a separate process and uses no GUI or private application ABI.
Its sources and pinned build instructions are included; no prebuilt helper is
bundled with the npm package. See its AGPL-3.0-or-later notices before distributing
a compiled helper.

Host connection secrets and executable `post_process` scripts are omitted from
configuration results and exports; omissions list field names only. Custom
printer G-code text is preserved. Executable post-processing remains governed
by the existing trusted-script policy.

The versioned type facts come from stock CLI help and the official
[PrintConfig definitions](https://github.com/prusa3d/PrusaSlicer/blob/version_2.9.6/src/libslic3r/PrintConfig.cpp).
String serialization follows the native
[Config implementation](https://github.com/prusa3d/PrusaSlicer/blob/version_2.9.6/src/libslic3r/Config.cpp),
and confirmed GUI category mappings come from
[Tab.cpp](https://github.com/prusa3d/PrusaSlicer/blob/version_2.9.6/src/slic3r/GUI/Tab.cpp).

### Saved 3MF projects

`read_project_geometry(path)` reads the package's main-model relationship, local
mesh indices, components and build instances. Source vertices use the model's
unit; `transform_mm` and instance bounding boxes use millimeters. Object, volume
and instance IDs are scoped to the returned SHA-256 revision. Unused resources
remain resources and are not added to the build. Required geometry extensions,
cross-part references, missing objects and cyclic components are rejected.
Component expansion is limited to 100000 object visits per scene read.

`read_project_metadata(path, resolve_effective=false)` links PrusaSlicer object
and volume overrides to those IDs. It reports roles, printability and zero-based
extruder assignments (`null` means no explicit assignment). Stored overrides are
not effective values. With `resolve_effective=true`, the existing native 2.9.6
configuration resolver supplies a separate global snapshot; scoped effective
values remain unknown. Host secrets and executable scripts are omitted from
responses. Painting, variable layers, text/SVG and SLA payloads are reported as
opaque presence, with partial coverage, and are never generated or interpreted.
These reads describe the saved file, not unsaved GUI state.

`write_project_copy(source, expected_revision, supported_patch, output)` creates
a new file and refuses an existing destination or stale source revision. The
patch is an array, including an empty array for a preserving copy:

```json
[
  {"operation":"rename_object","object_id":"object:1","name":"Bracket"},
  {"operation":"transform_instance","instance_id":"instance:0","transform":[1,0,0,0,1,0,0,0,1,10,0,0]}
]
```

Matrices use the 3MF row-vector order (nine linear coefficients followed by
three translations in the model unit). Only the identified XML attributes are
patched; every unedited ZIP entry's uncompressed content remains identical.
ZIP compression and container metadata can change. Unknown dependent package
parts prevent instance transforms; opaque auxiliary geometry permits origin
translations but prevents changes of basis that would need native regeneration.
A missing native object-name field is not synthesized. The source is checked
again immediately before atomic publication without replacement. The writer
reports `native_validated=false`: it does not launch PrusaSlicer. The supported
format is checked separately with stock 2.9.6 open/save acceptance fixtures.

Legacy mesh analysis now includes only printable build instances and ModelPart
volumes. Its volume is the source mesh volume: it does not compute negative
volume subtraction or overlapping-volume union, and is not a sliced material
consumption measurement.

3MF archives are read in memory without extracting paths to disk. XML DTDs are
rejected. Server environment variables `PRUSAMCP_3MF_MAX_TOTAL_BYTES` (default
1073741824) and `PRUSAMCP_3MF_MAX_ENTRY_BYTES` (default 536870912) limit the total
and individual uncompressed entry sizes. Both must be positive integer byte
counts. Limits are checked before entry decompression and during streaming.

The text fixture `test/fixtures/native-2.9.6-project.json` contains selected
unchanged entries from a synthetic cube project saved in stock PrusaSlicer
2.9.6: ModelPart, NegativeVolume, ParameterModifier, overrides and variable
layers. Thumbnail and global print configuration are excluded. Synthetic tests
supply their own global overrides and opaque painting/SLA examples.
