import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PrusaConfig } from "../types.js";
import { getCapabilities } from "../capabilities.js";
import { registerContractTool } from "../register-tool.js";

export function registerCapabilities(server: McpServer, config: PrusaConfig) {
  registerContractTool(server, "get_capabilities", {
    description:"Read CLI version/options and non-prompting host permission diagnostics. Does not activate a project, slice, capture, or request permission. Unknown is not granted or denied.",
    inputSchema:{},
  }, async () => ({data:await getCapabilities(config.executablePath),content:[{type:"text",text:"Capabilities describe CLI help and host preflight observations, not verification of every slicer operation."}]}));
}
