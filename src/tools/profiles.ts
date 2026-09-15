import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { artifactRefSchema, revisionSchema, toolResultObjectSchema, toolResultSchema } from "../contracts.js";
import { ConfigurationService } from "../config-resolver.js";

const technologySchema = z.enum(["FFF", "SLA"]);
const presetSchema = z.object({ id: z.string(), kind: z.enum(["printer", "print", "filament", "sla_print", "sla_material"]), name: z.string(), origin: z.enum(["system", "user"]),
  vendor_id: z.string().nullable(), directory: z.string(), technology: technologySchema, extruder_count: z.number().optional(), nozzle_variant: z.string().optional(),
  compatible_printer_ids: z.array(z.string()), compatible_print_ids: z.array(z.string()) });
const modelsSchema = z.object({ models: z.array(z.object({ id: z.string(), name: z.string(), vendor_id: z.string(), vendor_name: z.string(), technology: technologySchema, printers: z.array(presetSchema) })) });
const presetsSchema = z.object({ printer: presetSchema, profiles: z.array(presetSchema) });
const snapshotSchema = z.object({ snapshot_id: z.string(), revision: revisionSchema, version: z.literal("2.9.6"), technology: technologySchema,
  extruder_count: z.number().int().nonnegative(), settings: z.record(z.string()),
  layers: z.array(z.object({source: z.enum(["saved_file", "presets", "overrides"]), description: z.string()})),
  omitted_fields: z.array(z.string()), unsupported_fields: z.array(z.string()), converted_fields: z.array(z.string()), input_diagnostics_known: z.boolean() });
const flatImportSchema = z.object({workspace_id: z.string(), format: z.literal("flat_ini"), profiles: z.array(presetSchema), snapshot: snapshotSchema, artifact: artifactRefSchema, native_validated: z.literal(true)});
const importSchema = z.discriminatedUnion("format", [flatImportSchema, z.object({workspace_id: z.string(), format: z.literal("bundle"), profiles: z.array(presetSchema),
  artifact: artifactRefSchema, native_validated: z.literal(true), omitted_fields: z.array(z.string()), converted_fields: z.array(z.string()),
  unsupported_fields: z.array(z.string()), input_diagnostics_known: z.boolean()})]);
const exportSchema = z.object({ artifact: artifactRefSchema, source_revision: revisionSchema, format: z.enum(["flat_ini", "bundle"]), omitted_fields: z.array(z.string()) });
// Overrides are already serialized INI values; typed user edits use validate_settings first.
const overridesSchema = z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.string().regex(/^[^\r\n]*$/)).default({});
const tupleSchema = z.object({ type: z.literal("presets"), printer_profile_id: z.string(), print_profile_id: z.string(), material_profile_ids: z.array(z.string()).min(1) });
const readAnnotations = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false};
const writeAnnotations = {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false};

/** Values in native errors may contain credentials; expose only a stable code. */
async function response<D extends z.ZodTypeAny>(schema: D, operation: () => Promise<z.input<D>>, source: "cli" | "file" = "cli") {
  let result;
  try {
    const data = await operation();
    const diagnostics = data as {input_diagnostics_known?: boolean; unsupported_fields?: string[]};
    const warnings = [
      ...(diagnostics.input_diagnostics_known === false ? ["Source conversion diagnostics are unavailable; empty conversion lists do not establish that no conversion occurred."] : []),
      ...(diagnostics.unsupported_fields?.length ? ["Some input keys were not retained by the native slicer; see unsupported_fields."] : []),
    ];
    result = toolResultSchema(schema).parse({source, coverage: warnings.length ? "partial" : "complete", status: warnings.length ? "partial" : "confirmed", warnings, summary: "Configuration operation completed.", data});
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = /^[a-z][a-z_]+:/.exec(message)?.[0].slice(0, -1) ?? "configuration_failed";
    result = toolResultSchema(schema).parse({source, coverage: "unsupported", status: "failed", warnings: [], summary: `Configuration operation failed (${code}).`, data: null,
      error: {code, message: `Configuration operation failed (${code}).`}});
  }
  return {content: [{type: "text" as const, text: JSON.stringify(result)}], structuredContent: result, ...(result.status === "failed" ? {isError:true} : {})};
}

export function registerProfileTools(server: McpServer, service: ConfigurationService) {
  server.registerTool("list_printer_models", {description: "List installed native printer models and preset IDs from an isolated copy of the configured profiles directory. Does not change the active GUI or install vendor profiles.",
    inputSchema: {technology: technologySchema.default("FFF")}, outputSchema: toolResultObjectSchema(modelsSchema), annotations: readAnnotations },
    async ({technology}) => response(modelsSchema, async () => ({models: await service.profiles.listPrinterModels(technology)})));
  server.registerTool("list_presets", {description: "List print and material presets compatible with one printer ID previously returned by list_printer_models. FFF and SLA materials remain distinct; ambiguous native names are rejected.",
    inputSchema: {printer_profile_id: z.string(), technology: technologySchema}, outputSchema: toolResultObjectSchema(presetsSchema), annotations: readAnnotations},
    async ({printer_profile_id, technology}) => response(presetsSchema, () => service.profiles.listPresets(printer_profile_id, technology)));
  server.registerTool("resolve_configuration", {description: "Resolve one saved INI/3MF or a complete compatible preset tuple with the native slicer, without slicing. Overrides are a separate layer of native serialized INI values (use escaped newlines). Returns an immutable in-memory snapshot and SHA-256; input_diagnostics_known=false means conversion/unknown-key provenance could not be established for the source; effective settings do not describe unsaved GUI state. Host secrets and executable scripts are omitted.",
    inputSchema: {base: z.discriminatedUnion("type", [z.object({type: z.literal("file"), path: z.string()}), tupleSchema]), overrides: overridesSchema},
    outputSchema: toolResultObjectSchema(snapshotSchema), annotations: readAnnotations},
    async ({base,overrides}) => response(snapshotSchema, () => base.type === "file" ? service.resolveFile(base.path, overrides) : service.resolvePresets(base,overrides)));
  server.registerTool("import_configuration", {description: "Import a flat INI or named preset bundle into a server-managed isolated workspace after native validation. Does not install presets in the user directory. Preset bundles use the pinned native helper and return separate profile IDs; resolve a complete tuple of those IDs before exporting selected presets. Empty compatibility lists on imported IDs are not a compatibility verdict; native resolution validates the tuple.",
    inputSchema: {path: z.string(), workspace_id: z.string().min(1)}, outputSchema: toolResultObjectSchema(importSchema), annotations: writeAnnotations},
    async ({path,workspace_id}) => response(importSchema, () => service.importConfiguration(path, workspace_id), "file"));
  server.registerTool("export_configuration", {description: "Export a resolved snapshot to a new file. Existing paths are never replaced. Flat INI omits host secrets and scripts; omitted fields are named without values. Bundle export requires a snapshot resolved from an explicit preset tuple with the native helper. It exports only those selected native flattened presets, using native generated names when overrides require splitting material values.",
    inputSchema: {snapshot_id: z.string(), format: z.enum(["flat_ini", "bundle"]), output_path: z.string()}, outputSchema: toolResultObjectSchema(exportSchema), annotations: writeAnnotations},
    async ({snapshot_id,format,output_path}) => response(exportSchema, () => service.exportConfiguration(snapshot_id, format, output_path), "file"));
}
