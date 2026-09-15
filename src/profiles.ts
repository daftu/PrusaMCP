import { cp, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { z } from "zod";
import { runPrusaSlicer } from "./prusa-cli.js";
import { detectCliCapabilities } from "./capabilities.js";
import type { PrusaConfig, CliResult } from "./types.js";

const nativePrinter = z.object({ name: z.string(), extruders_cnt: z.number().int().positive().optional(), bed: z.object({}).passthrough() });
const nativeModel = z.object({ id: z.string(), name: z.string(), technology: z.enum(["FFF", "SLA"]), vendor_name: z.string(), vendor_id: z.string(),
  variants: z.array(z.object({ name: z.union([z.string(), z.number()]), printer_profiles: z.array(nativePrinter), user_printer_profiles: z.array(nativePrinter).optional() })).optional(),
  printer_profiles: z.array(nativePrinter).optional(), user_printer_profiles: z.array(nativePrinter).optional() }).refine(model => model.technology === "FFF" ? model.variants !== undefined : model.printer_profiles !== undefined,
    "Printer model must include the native technology-specific profiles array");
export const printerQuerySchema = z.object({ printer_models: z.array(nativeModel) });
const nativePrint = z.object({ name: z.string(), filament_profiles: z.array(z.string()).optional(), user_filament_profiles: z.array(z.string()).optional(), sla_material_profiles: z.array(z.string()).optional(), user_sla_material_profiles: z.array(z.string()).optional() }).refine(print => print.filament_profiles !== undefined || print.sla_material_profiles !== undefined,
  "Print profile must include a native material profiles array");
export const presetQuerySchema = z.object({ printer_profile: z.string(), print_profiles: z.array(nativePrint), user_print_profiles: z.array(nativePrint).optional() });

/** The exit=1 exception is confined to the two verified 2.9.6 profile queries. */
export function parseProfileQuery<T>(result: CliResult, version: string, schema: z.ZodType<T>): T {
  if ((result.exitCode !== 0 && !(version === "2.9.6" && result.exitCode === 1 && (!result.errorCode || result.errorCode === "process_failed"))) || result.stderr.trim()) {
    throw new Error("profile_query_failed: native profile query failed");
  }
  try { return schema.parse(JSON.parse(result.stdout)); }
  catch { throw new Error("invalid_profile_query: native output does not match the profile query schema"); }
}

export interface PresetReference {
  id: string; kind: "printer" | "print" | "filament" | "sla_print" | "sla_material";
  name: string; origin: "system" | "user"; vendor_id: string | null; directory: string; technology: "FFF" | "SLA";
  extruder_count?: number; nozzle_variant?: string; compatible_printer_ids: string[]; compatible_print_ids: string[];
}
export interface PrinterModel {
  id: string; name: string; vendor_id: string; vendor_name: string; technology: "FFF" | "SLA"; printers: PresetReference[];
}

export async function copyProfileData(source: string) {
  const directory = await mkdtemp(join(tmpdir(), "prusamcp-presets-"));
  try {
    for (const name of ["PrusaSlicer.ini", "vendor", "printer", "print", "filament", "sla_print", "sla_material"]) {
      try { await cp(join(source, name), join(directory, name), { recursive: true, dereference: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return directory;
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

export class ProfileService {
  private references = new Map<string, PresetReference>();
  constructor(readonly config: PrusaConfig) {}
  private ref(kind: PresetReference["kind"], name: string, origin: PresetReference["origin"], vendor_id: string | null, technology: "FFF" | "SLA", extra: Partial<PresetReference> = {}) {
    const directory = resolve(this.config.profilesDir);
    const id = createHash("sha256").update(JSON.stringify([directory, kind, vendor_id, name, origin])).digest("hex");
    const reference: PresetReference = { id, kind, name, origin, vendor_id, directory, technology, compatible_printer_ids: [], compatible_print_ids: [], ...extra };
    const previous = this.references.get(id);
    if (previous) {
      reference.compatible_printer_ids = [...new Set([...previous.compatible_printer_ids, ...reference.compatible_printer_ids])];
      reference.compatible_print_ids = [...new Set([...previous.compatible_print_ids, ...reference.compatible_print_ids])];
    }
    this.references.set(id, reference);
    return reference;
  }
  getReference(id: string) {
    const reference = this.references.get(id);
    if (!reference) throw new Error("unknown_preset: list profiles before selecting their IDs");
    return structuredClone(reference);
  }
  async query<T>(args: string[], schema: z.ZodType<T>): Promise<T> {
    const capabilities = await detectCliCapabilities(this.config.executablePath);
    if (capabilities.version !== "2.9.6") throw new Error("unsupported_version: profile queries require verified PrusaSlicer 2.9.6");
    if (!this.config.profilesDir) throw new Error("profiles_directory_missing: configure PRUSASLICER_PROFILES_DIR");
    const temporary = await copyProfileData(this.config.profilesDir);
    try {
      return parseProfileQuery(await runPrusaSlicer(this.config, ["--datadir", temporary, ...args], 30_000), capabilities.version, schema);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  async listPrinterModels(technology: "FFF" | "SLA"): Promise<PrinterModel[]> {
    const result = await this.query(["--query-printer-models", "--printer-technology", technology], printerQuerySchema);
    return result.printer_models.filter(model => model.technology === technology).map(model => {
      const printers: PresetReference[] = [];
      const append = (profiles: z.infer<typeof nativePrinter>[] | undefined, origin: "system" | "user", nozzle_variant?: string) => {
        for (const profile of profiles ?? []) printers.push(this.ref("printer", profile.name, origin, model.vendor_id, technology, { extruder_count: profile.extruders_cnt ?? 0, ...(nozzle_variant ? { nozzle_variant } : {}) }));
      };
      for (const variant of model.variants ?? []) { append(variant.printer_profiles, "system", String(variant.name)); append(variant.user_printer_profiles, "user", String(variant.name)); }
      append(model.printer_profiles, "system"); append(model.user_printer_profiles, "user");
      return { id: model.id, name: model.name, vendor_id: model.vendor_id, vendor_name: model.vendor_name, technology, printers };
    });
  }
  async listPresets(printer_profile_id: string, technology: "FFF" | "SLA") {
    const printer = this.getReference(printer_profile_id);
    if (printer.kind !== "printer" || printer.technology !== technology) throw new Error("incompatible_preset: printer technology does not match");
    this.assertUnambiguous(printer);
    const result = await this.query(["--query-print-filament-profiles", "--printer-profile", printer.name], presetQuerySchema);
    if (result.printer_profile !== printer.name) throw new Error("profile_query_mismatch: slicer returned another printer");
    const profiles: PresetReference[] = [];
    for (const [origin, prints] of [["system", result.print_profiles], ["user", result.user_print_profiles ?? []]] as const) {
      for (const item of prints) {
        if (technology === "FFF" ? item.filament_profiles === undefined : item.sla_material_profiles === undefined) {
          throw new Error("invalid_profile_query: native material array does not match printer technology");
        }
        const print = this.ref(technology === "FFF" ? "print" : "sla_print", item.name, origin, null, technology, { compatible_printer_ids: [printer.id] });
        profiles.push(print);
        const materialGroups = technology === "FFF" ? [["system", item.filament_profiles ?? []], ["user", item.user_filament_profiles ?? []]] as const : [["system", item.sla_material_profiles ?? []], ["user", item.user_sla_material_profiles ?? []]] as const;
        for (const [materialOrigin, materials] of materialGroups) {
          for (const name of materials) {
            const material = this.ref(technology === "FFF" ? "filament" : "sla_material", name, materialOrigin, null, technology, { compatible_printer_ids: [printer.id], compatible_print_ids: [print.id] });
            const existing = profiles.find(profile => profile.id === material.id);
            if (existing) existing.compatible_print_ids = [...new Set([...existing.compatible_print_ids, ...material.compatible_print_ids])]; else profiles.push(material);
          }
        }
      }
    }
    for (const profile of profiles) this.references.set(profile.id, profile);
    return { printer, profiles };
  }
  assertUnambiguous(reference: PresetReference) {
    if ([...this.references.values()].some(other => other.kind === reference.kind && other.name === reference.name && other.id !== reference.id)) {
      throw new Error("ambiguous_preset: native CLI selects by name; use an isolated datadir with an unambiguous selected preset");
    }
  }
}
