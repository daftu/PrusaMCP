import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { settingAddressSchema, settingValueSchema, toolResultObjectSchema, toolResultSchema } from "../contracts.js";
import { ConfigurationService } from "../config-resolver.js";
import { getSettingCatalog, layerEventConfiguration, validateSettingChanges } from "../setting-catalog.js";

const changeSchema = z.object({ address: settingAddressSchema, value: settingValueSchema });
const errorSchema = z.object({ address: settingAddressSchema, code: z.string(), message: z.string() });
const definitionSchema = z.object({ key: z.string(), type: z.enum(["bool", "int", "float", "percent", "float_or_percent", "enum", "string"]),
  technologies: z.array(z.enum(["FFF", "SLA"])), vector: z.boolean().optional(), extruder_indexed: z.boolean().optional(),
  min: z.number().optional(), max: z.number().optional(), values: z.array(z.string()).optional(), version: z.string(),
  gui_location: z.object({tab: z.string(), category_id: z.string(), required_ui_mode: z.string()}).nullable() });
const dataSchema = z.object({ valid: z.boolean(), snapshot_revision: z.string(), changes: z.array(changeSchema), errors: z.array(errorSchema),
  catalog: z.array(definitionSchema), native_validated: z.boolean(),
  layer_events: z.object({ firmware: z.string().nullable(), pause: z.boolean(), color_change: z.boolean(), compatibility_source: z.literal("native_configuration"), physical_safety_verified: z.literal(false) }) });
export async function validateSettings(service: ConfigurationService, snapshotRevision: string, changes: z.infer<typeof changeSchema>[]) {
  const snapshot = service.getSnapshot(snapshotRevision);
  const result = validateSettingChanges(snapshot, snapshotRevision, changes);
  let nativeValidated = false;
  if (result.valid) {
    try { await service.validateNative(snapshot, result.overrides); nativeValidated = true; }
    catch { for (const change of changes) result.errors.push({ address: change.address, code: "native_validation_failed", message: "PrusaSlicer rejected the combined configuration" });
      // Even an empty request cannot claim success if the native snapshot check failed.
      result.valid = false; result.changes = [];
    }
  }
  return { valid: result.valid, snapshot_revision: snapshotRevision, changes: result.changes, errors: result.errors,
    catalog: getSettingCatalog(snapshot.version, snapshot.technology), native_validated: nativeValidated, layer_events: layerEventConfiguration(snapshot) };
}
export function registerValidateSettings(server: McpServer, service: ConfigurationService) {
  const outputSchema = toolResultObjectSchema(dataSchema);
  server.registerTool("validate_settings", { description: "Validate typed global configuration changes against a resolved snapshot SHA-256, then the native slicer. Returns the versioned catalog (unknown GUI locations are null); percent values use strings such as 25%, extruder indexes are zero-based. No changes are applied or published. An empty changes list inspects the catalog and validates the snapshot.",
    inputSchema: { snapshot_revision: z.string().regex(/^[a-f0-9]{64}$/), changes: z.array(changeSchema) }, outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  async ({ snapshot_revision, changes }) => {
    let result;
    try {
      const data = await validateSettings(service, snapshot_revision, changes);
      result = toolResultSchema(dataSchema).parse({ source: "cli", coverage: "complete", status: "confirmed", warnings: [],
        summary: data.valid ? "Settings passed native validation; no changes applied." : "Settings rejected; no changes applied.", data });
    } catch {
      result = toolResultSchema(dataSchema).parse({ source: "cli", coverage: "unsupported", status: "failed", warnings: [], summary: "Resolve a supported configuration snapshot before validation.",
        data: null, error: {code: "snapshot_unavailable", message: "Resolve a supported configuration snapshot before validation."} });
    }
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, ...(result.status === "failed" ? {isError: true} : {}) };
  });
}
