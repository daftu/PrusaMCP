import { registerContractTool } from "../register-tool.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { recommendProfileDelta } from "../profile-engine.js";
import { analyzeModel } from "../model-analysis.js";
import type { ConfigurationService } from "../config-resolver.js";

export function registerRecommendProfile(server: McpServer, service: ConfigurationService) {
  registerContractTool(server, "recommend_profile", {
    description: "Propose before/after changes to a resolved FFF configuration. Material IDs select heuristic rules (PLA, PETG, ABS, ASA, TPU, NYLON, PC), not native preset IDs. No settings are applied; validate_settings and a separate configuration write are required. Optional model_ref is a saved STL/3MF path, not live GUI state.",
    inputSchema: {
      snapshot_id: z.string(), goal: z.string().describe("draft, standard, quality, strong, vase or speed"),
      material_id: z.string(), model_ref: z.string().optional(),
    },
  }, async ({snapshot_id, goal, material_id, model_ref}) => {
    const snapshot = service.getSnapshot(snapshot_id);
    const model = model_ref ? await analyzeModel(model_ref) : undefined;
    const proposal = recommendProfileDelta(snapshot, goal, material_id, model?.analysis);
    return {data: {...proposal, analysis: model?.analysis, evidence: model?.evidence},
      warnings: [...proposal.warnings, ...(model?.evidence.warnings ?? [])],
      resultStatus: model?.evidence.coverage === "partial" ? "partial" : "confirmed",
      content: [{type: "text", text: "Estimated profile delta; no settings applied. Validate changes separately before writing."}]};
  });
}
