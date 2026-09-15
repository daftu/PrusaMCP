import { definitions296 } from "./setting-definitions.js";
import type { SettingAddress } from "./contracts.js";

export interface SettingDefinition {
  type: "bool" | "int" | "float" | "percent" | "float_or_percent" | "enum" | "string";
  technologies: ("FFF" | "SLA")[];
  vector?: boolean;
  extruder_indexed?: boolean;
  min?: number;
  max?: number;
  values?: string[];
}
export type SettingValue = string | number | boolean | (string | number | boolean)[];
export interface ValidationSnapshot {
  revision: { kind: "file"; sha256: string };
  version: string;
  technology: "FFF" | "SLA";
  extruder_count: number;
  settings: Record<string, string>;
}
export interface SettingChange { address: SettingAddress; value: SettingValue }
export interface SettingError { address: SettingAddress; code: string; message: string }

// Confirmed pages and modes in version_2.9.6 GUI/Tab.cpp and PrintConfig.cpp.
// These identify native categories; they do not claim access to the current GUI.
function guiLocation(key: string, technology: "FFF" | "SLA") {
  if (key === "layer_height") return { tab: technology === "FFF" ? "print" : "sla_print", category_id: "layers", required_ui_mode: "simple" };
  if (technology === "FFF" && ["fill_density", "fill_pattern"].includes(key)) return { tab: "print", category_id: "infill", required_ui_mode: "simple" };
  return null;
}
export function getSettingCatalog(version: string, technology: "FFF" | "SLA") {
  if (version !== "2.9.6") throw new Error("unsupported_version: setting definitions require PrusaSlicer 2.9.6");
  return Object.entries(definitions296).filter(([, d]) => d.technologies.includes(technology)).map(([key, definition]) => ({
    key, ...definition, version, gui_location: guiLocation(key, technology),
  }));
}
const escapeString = (s: string) => s.replace(/\\/g, "\\\\").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
const unescapeString = (s: string) => s.replace(/\\(.)/gs, (_, c: string) => c === "n" ? "\n" : c === "r" ? "\r" : c);

/** Native Config.cpp string-list syntax uses semicolons and C-style quoted strings. */
function decodeStringVector(raw: string): string[] {
  if (raw === "") return [];
  const values: string[] = [];
  let value = "", quoted = false, escaped = false;
  for (const c of raw) {
    if (escaped) { value += c === "n" ? "\n" : c === "r" ? "\r" : c; escaped = false; }
    else if (quoted && c === "\\") escaped = true;
    else if (c === '"') quoted = !quoted;
    else if (c === ";" && !quoted) { values.push(value); value = ""; }
    else value += c;
  }
  if (quoted || escaped) throw new Error("invalid_native_value");
  values.push(value);
  return values;
}
export function serializeSetting(definition: SettingDefinition, value: SettingValue): string {
  const scalar = (v: string | number | boolean) => definition.type === "bool" ? (v ? "1" : "0") : definition.type === "string" ? escapeString(String(v)) : String(v);
  if (!Array.isArray(value)) return scalar(value);
  return definition.type === "string" ? value.map(v => `"${escapeString(String(v)).replace(/"/g, '\\"')}"`).join(";") : value.map(scalar).join(",");
}
export function deserializeSetting(definition: SettingDefinition, raw: string): SettingValue {
  const scalar = (v: string): string | number | boolean => {
    if (definition.type === "bool") return v === "1";
    if (definition.type === "int" || definition.type === "float") return Number(v);
    if (definition.type === "float_or_percent") return v.endsWith("%") ? v : Number(v);
    if (definition.type === "percent") return v.endsWith("%") ? v : `${v}%`;
    return definition.type === "string" ? unescapeString(v) : v;
  };
  if (!definition.vector) return scalar(raw);
  if (definition.type === "string") return decodeStringVector(raw);
  return raw === "" ? [] : raw.split(",").map(scalar);
}
function valueError(d: SettingDefinition, value: unknown): string | undefined {
  if (d.type === "bool") return typeof value === "boolean" ? undefined : "Expected boolean";
  if (d.type === "enum") return typeof value === "string" && d.values?.includes(value) ? undefined : "Unknown enum value";
  if (d.type === "string") return typeof value === "string" ? undefined : "Expected string";
  const percent = typeof value === "string" && /^-?(?:\d+(?:\.\d*)?|\.\d+)%$/.test(value);
  if (d.type === "percent" && !percent) return "Expected percentage string, for example 25%";
  if (!(percent && (d.type === "percent" || d.type === "float_or_percent")) && (typeof value !== "number" || !Number.isFinite(value))) return "Expected finite number";
  const n = percent ? Number((value as string).slice(0, -1)) : value as number;
  if (d.type === "int" && !Number.isInteger(n)) return "Expected integer";
  if (d.min !== undefined && n < d.min || d.max !== undefined && n > d.max) return "Outside native parameter range";
  return undefined;
}

/** Pure boundary checks. The caller must then pass overrides through native validation. */
export function validateSettingChanges(snapshot: ValidationSnapshot, snapshotRevision: string, changes: SettingChange[]) {
  const errors: SettingError[] = [];
  const overrides: Record<string, string> = {};
  for (const change of changes) {
    const { address, value } = change;
    const fail = (code: string, message: string) => errors.push({ address, code, message });
    if (snapshot.revision.sha256 !== snapshotRevision) { fail("revision_mismatch", "Refresh the configuration snapshot"); continue; }
    if (snapshot.version !== "2.9.6") { fail("unsupported_version", "Catalog requires PrusaSlicer 2.9.6"); continue; }
    const d = Object.hasOwn(definitions296, address.key) ? definitions296[address.key] : undefined;
    if (!d) { fail("unsupported", "Unknown or unmodeled setting in this catalog version"); continue; }
    if (!d.technologies.includes(snapshot.technology)) { fail("wrong_technology", "Setting is unavailable for this printer technology"); continue; }
    if (address.scope !== "global" || address.target_id !== undefined) { fail("unsupported_scope", "Configuration snapshots address global settings; object scopes require a project session"); continue; }
    if (address.key === "post_process") { fail("script_policy", "Post-processing scripts require the trusted script policy"); continue; }
    if (/^(print_host|printhost_|physical_printer)/.test(address.key)) { fail("private_setting", "Host settings are not exposed by configuration tools"); continue; }
    const indexed = address.extruder_index !== undefined;
    if (indexed && (!d.extruder_indexed || !d.vector || address.extruder_index! >= snapshot.extruder_count || address.extruder_index! < 0 || !Number.isInteger(address.extruder_index))) {
      fail("invalid_extruder_index", "Index must identify an existing extruder on an extruder setting"); continue;
    }
    if (Array.isArray(value) !== Boolean(d.vector && !indexed)) { fail("wrong_type", indexed ? "Indexed changes require a scalar" : d.vector ? "Expected vector" : "Expected scalar"); continue; }
    const values = Array.isArray(value) ? value : [value];
    const invalid = values.map(v => valueError(d, v)).find(Boolean);
    if (invalid) { fail("wrong_value", invalid); continue; }
    if (d.extruder_indexed && !indexed && values.length !== snapshot.extruder_count) { fail("invalid_vector_length", "Vector must contain one value per extruder"); continue; }
    if (indexed) {
      const current = deserializeSetting(d, overrides[address.key] ?? snapshot.settings[address.key] ?? "");
      if (!Array.isArray(current) || current.length !== snapshot.extruder_count) { fail("unknown_effective_value", "Snapshot does not establish the full extruder vector"); continue; }
      current[address.extruder_index!] = value as string | number | boolean;
      overrides[address.key] = serializeSetting(d, current);
    } else overrides[address.key] = serializeSetting(d, value);
  }
  return { valid: errors.length === 0, changes: errors.length === 0 ? changes : [], errors, overrides: errors.length === 0 ? overrides : {} };
}

export function layerEventConfiguration(snapshot: ValidationSnapshot) {
  return { firmware: snapshot.settings.gcode_flavor ?? null,
    pause: snapshot.technology === "FFF" && Boolean(snapshot.settings.pause_print_gcode),
    color_change: snapshot.technology === "FFF" && Boolean(snapshot.settings.color_change_gcode),
    compatibility_source: "native_configuration" as const,
    physical_safety_verified: false as const };
}
