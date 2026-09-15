import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { toolResultSchema, toolResultObjectSchema, type ToolResult } from "./contracts.js";
import { domains, type ToolName } from "./tool-domains.js";

type HandlerResult = CallToolResult & { data?: unknown; resultStatus?: ToolResult<unknown>["status"]; warnings?: string[]; errorCode?: string };
const sources: Record<ToolName, ToolResult<unknown>["source"]> = {
  analyze_mesh:"file",recommend_profile:"estimate",generate_prusaslicer_config:"file",check_printability:"estimate",suggest_orientation:"estimate",estimate_cost:"estimate",print_wizard:"estimate",search_filament:"file",diagnose_print:"estimate",submit_feedback:"file",feedback_stats:"file",export_feedback:"file",slice_prusaslicer:"cli",get_current_model:"file",read_prusaslicer_fields:"live_gui",open_prusaslicer_tab:"live_gui",set_prusaslicer_field:"live_gui",screenshot_prusaslicer:"live_gui",postprocess_gcode:"file",upload_print:"printer",get_capabilities:"cli",
};
const writes = new Set<ToolName>(["generate_prusaslicer_config","submit_feedback","slice_prusaslicer","open_prusaslicer_tab","set_prusaslicer_field","screenshot_prusaslicer","postprocess_gcode","upload_print"]);

/** Adapt existing handlers at the registration boundary; domain values come from the handler, never parsed from prose. */
type Input<I> = I extends z.AnyZodObject ? z.infer<I> : I extends z.ZodRawShape ? z.infer<z.ZodObject<I>> : never;
export function registerContractTool<I extends z.ZodRawShape | z.AnyZodObject>(server: McpServer, name: ToolName,
  config: {title?:string;description?:string;inputSchema:I;annotations?:ToolAnnotations},
  handler: (args:Input<I>) => Promise<HandlerResult>) {
  const schema = toolResultSchema(domains[name]);
  const outputSchema = toolResultObjectSchema(domains[name]);
  return server.registerTool<typeof outputSchema, z.AnyZodObject>(name, {
    ...config, inputSchema: config.inputSchema instanceof z.ZodObject ? config.inputSchema : z.object(config.inputSchema), outputSchema,
    annotations: {readOnlyHint:!writes.has(name),destructiveHint:["set_prusaslicer_field","upload_print","generate_prusaslicer_config"].includes(name),idempotentHint:!writes.has(name),openWorldHint:name === "upload_print",...config.annotations},
  }, async (args): Promise<CallToolResult> => {
    let result: HandlerResult;
    try { result = await handler(args as Input<I>); }
    catch(error) { result = {isError:true,content:[{type:"text",text:error instanceof Error ? error.message : String(error)}]}; }
    const summary = result.content.filter(c => c.type === "text").map(c => c.text).join("\n");
    const existing = result.structuredContent as ToolResult<unknown> | undefined;
    const status = result.resultStatus ?? existing?.status ?? (result.isError ? "failed" : "confirmed");
    const structured = schema.parse({
      source:sources[name], coverage:status === "confirmed" ? "complete" : status === "partial" || (status === "needs_user_action" && result.data != null) ? "partial" : "unsupported",
      warnings:result.warnings ?? [], ...existing, status, summary,
      data:result.data ?? existing?.data ?? null,
      ...(result.isError ? {error:{code:result.errorCode ?? "tool_failed",message:summary}} : {}),
    });
    return {content:[...result.content.filter(c => c.type !== "text"), {type:"text" as const,text:JSON.stringify(structured)}],
      structuredContent:structured, ...(result.isError || status === "failed" ? {isError:true} : {})};
  });
}
