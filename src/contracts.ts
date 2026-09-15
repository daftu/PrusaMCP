import { z } from "zod";
import { createHash } from "node:crypto";

export const sourceSchema = z.enum(["file", "live_gui", "cli", "estimate", "printer"]);
export const coverageSchema = z.enum(["complete", "partial", "unsupported"]);
export const statusSchema = z.enum(["confirmed", "partial", "needs_user_action", "failed"]);
export const errorSchema = z.object({ code: z.string().min(1), message: z.string(), refresh_required: z.boolean().optional() });
export const revisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.object({ kind: z.literal("live"), session_id: z.string().min(1), observed_revision: z.string().min(1) }),
]);
export function fileRevision(contents: Uint8Array | string) {
  return { kind: "file" as const, sha256: createHash("sha256").update(contents).digest("hex") };
}
export const artifactRefSchema = z.object({ path: z.string(), media_type: z.string(), revision: revisionSchema.optional() });
const addressFields = { key: z.string().min(1), extruder_index: z.number().int().nonnegative().optional() };
export const settingAddressSchema = z.discriminatedUnion("scope", [
  z.object({ ...addressFields, scope: z.literal("global"), target_id: z.string().optional() }),
  z.object({ ...addressFields, scope: z.literal("object"), target_id: z.string().min(1) }),
  z.object({ ...addressFields, scope: z.literal("volume"), target_id: z.string().min(1) }),
  z.object({ ...addressFields, scope: z.literal("height_range"), target_id: z.string().min(1) }),
]);
export const settingValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number(), z.boolean()]))]);
export const typedSettingSchema = z.discriminatedUnion("effective_known", [
  z.object({ address: settingAddressSchema, displayed: z.string().nullable(), value: settingValueSchema.nullable(), inherited: z.boolean(), effective_known: z.literal(true), effective_value: settingValueSchema }),
  z.object({ address: settingAddressSchema, displayed: z.string().nullable(), value: settingValueSchema.nullable(), inherited: z.boolean(), effective_known: z.literal(false), effective_value: z.null() }),
]);

/** Object root required by MCP SDK tools/list; cross-field invariants are enforced by toolResultSchema. */
export function toolResultObjectSchema<D extends z.ZodTypeAny>(data: D) {
  return z.object({source:sourceSchema,coverage:coverageSchema,status:statusSchema,revision:revisionSchema.optional(),warnings:z.array(z.string()),summary:z.string(),data:data.nullable(),error:errorSchema.optional()});
}
export function toolResultSchema<D extends z.ZodTypeAny>(data: D) {
  const common = toolResultObjectSchema(data).omit({status:true,coverage:true,data:true,error:true}).shape;
  return z.discriminatedUnion("status", [
    z.object({ ...common, status: z.literal("confirmed"), coverage: z.literal("complete"), data, error: z.never().optional() }),
    z.object({ ...common, status: z.literal("partial"), coverage: z.literal("partial"), data, error: errorSchema.optional() }),
    z.object({ ...common, status: z.literal("needs_user_action"), coverage: z.enum(["partial", "unsupported"]), data: data.nullable(), error: errorSchema.optional() }),
    z.object({ ...common, status: z.literal("failed"), coverage: z.enum(["partial", "unsupported"]), data: data.nullable(), error: errorSchema }),
  ]);
}
export type ArtifactRef = z.infer<typeof artifactRefSchema>;
export type SettingAddress = z.infer<typeof settingAddressSchema>;
export type TypedSetting = z.infer<typeof typedSettingSchema>;
export type Revision = z.infer<typeof revisionSchema>;
export type ToolResult<D> = { source: z.infer<typeof sourceSchema>; coverage: z.infer<typeof coverageSchema>; status: z.infer<typeof statusSchema>; revision?: Revision; warnings: string[]; summary: string; data: D | null; error?: z.infer<typeof errorSchema> };
