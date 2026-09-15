import { registerContractTool } from "../register-tool.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getMacWindow } from "../macos.js";

const execute = promisify(execFile);

export function numericFieldValue(value: string): boolean {
  return /^-?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(value);
}

// AXHelp includes PrusaSlicer's own parameter name. No coordinates or OCR.
export const GUI_SCRIPT = String.raw`
ObjC.import("Foundation");
function run(argv) {
  var request = JSON.parse(argv[0]);
  var se = Application("System Events");
  var process = se.applicationProcesses.whose({unixId: request.window.pid})[0];
  if (request.tab) {
    process.menuBars[0].menuBarItems.byName("Window").menus[0].menuItems.byName(request.tab).click();
    $.NSThread.sleepForTimeInterval(0.3);
  }
  var windows = process.windows.whose({name: request.window.title})();
  if (windows.length !== 1) throw new Error("The selected project window changed or is ambiguous. Refresh the window ID.");
  var windowCountBefore = process.windows().length;
  var fields = [], controls = [];
  function visit(element, section, depth) {
    if (depth > 8) return;
    var role = element.role();
    if (role === "AXGroup") section = element.name() || section;
    if (["AXTextField", "AXCheckBox", "AXPopUpButton", "AXComboBox"].indexOf(role) !== -1) {
      var help = element.attributes.byName("AXHelp").value() || "";
      var match = help.match(/parameter name\s*:\s*([a-zA-Z0-9_]+)/);
      if (match) {
        fields.push({parameter: match[1], value: element.value(), enabled: element.enabled(), role: role, section: section});
        controls.push(element);
      }
    }
    if (role === "AXWindow" || role === "AXGroup" || role === "AXScrollArea") {
      element.uiElements().forEach(function(child) { visit(child, section, depth + 1); });
    }
  }
  visit(windows[0], null, 0);
  if (request.parameter) {
    var matches = fields.map(function(f,i){return f.parameter === request.parameter ? i : -1;}).filter(function(i){return i >= 0;});
    if (matches.length !== 1) throw new Error("Parameter must identify exactly one currently exposed control; found " + matches.length + ". Open its settings category first.");
    var index = matches[0], field = fields[index];
    if (!field.enabled) throw new Error("Field is disabled or inherited; no override was enabled.");
    if (field.role !== "AXTextField") throw new Error("Only numeric text fields are writable. Checkboxes and dropdowns are read-only.");
    if (String(field.value) !== request.expected_value) throw new Error("Current value differs from expected_value; nothing changed.");
    if (String(field.value) === request.value) return JSON.stringify({changed:false, saved:false, field:field});
    process.frontmost = true;
    $.NSThread.sleepForTimeInterval(0.2);
    if (!process.frontmost()) throw new Error("Could not focus the selected PrusaSlicer process; nothing changed.");
    controls[index].focused = true;
    try {
    controls[index].value = request.value;
    // Tab commits the text edit using the application's own validation.
    se.keyCode(48);
    $.NSThread.sleepForTimeInterval(0.3);
    var afterWindows = process.windows();
    var hasSheet = afterWindows.some(function(w) {
      return w.uiElements().some(function(e) { return e.role() === "AXSheet"; });
    });
    if (afterWindows.length > windowCountBefore || hasSheet) {
      return JSON.stringify({editor_changed:true, committed:null, saved:false, parameter:request.parameter,
        verification:"validation_pending", message:"PrusaSlicer opened a dialog or sheet. The value is not confirmed. Inspect validation before continuing; no dialog was accepted automatically."});
    }
    var freshWindows = afterWindows.filter(function(w) {
      return w.name().replace(/^\*/, "") === request.window.title.replace(/^\*/, "");
    });
    if (freshWindows.length !== 1) return JSON.stringify({editor_changed:true,committed:null,saved:false,parameter:request.parameter,verification:"validation_pending",message:"Project window changed before verification; refresh the selected window before continuing."});
    fields = []; controls = [];
    visit(freshWindows[0], null, 0);
    var freshFields = fields.filter(function(f) { return f.parameter === request.parameter; });
    if (freshFields.length !== 1) return JSON.stringify({editor_changed:true,committed:null,saved:false,parameter:request.parameter,verification:"validation_pending",message:"Field unavailable for fresh readback; refresh before continuing."});
    var actual = freshFields[0].value;
    return JSON.stringify({editor_changed:true, saved:false, requested:request.value, actual:actual, parameter:request.parameter,
      verification: String(actual) === request.value ? "readback_matches" : "application_normalized_or_rejected_value"});
    } catch (error) {
      return JSON.stringify({editor_changed:null,committed:null,saved:false,parameter:request.parameter,
        verification:"validation_pending",message:"The write was attempted but verification failed; refresh before continuing. " + String(error)});
    }
  }
  return JSON.stringify({source:"live_gui", coverage:"currently_exposed_controls_only", window_id:request.window.id,
    title:request.window.title, fields:fields});
}
`;

async function query(request: Record<string, unknown>, windowId?: number) {
  if (process.platform !== "darwin") throw new Error("Structured GUI access currently supports macOS only.");
  const window = await getMacWindow(windowId);
  try {
    const { stdout } = await execute("/usr/bin/osascript", ["-l", "JavaScript", "-e", GUI_SCRIPT, JSON.stringify({ ...request, window })], {timeout:30000, maxBuffer:1024 * 1024});
    return JSON.parse(stdout);
  } catch (error) {
    const failure = error as Error & {stderr?:string};
    throw new Error("PrusaSlicer accessibility operation failed: " + (failure.stderr?.trim() || failure.message));
  }
}

export function registerGuiFields(server: McpServer) {
  const windowId = z.number().int().positive().optional();
  registerContractTool(server,"read_prusaslicer_fields", {
    description: "Read live PrusaSlicer numeric/checkbox fields as JSON using native parameter names, without screenshots. macOS only. Includes unsaved values but only controls exposed in the current settings category and UI mode. Disabled/inherited fields are not effective values. No project changes.",
    inputSchema: {window_id: windowId},
    annotations: {readOnlyHint:true},
  }, async ({window_id}) => guiResult(() => query({}, window_id)));
  registerContractTool(server,"open_prusaslicer_tab", {
    description: "Navigate to a named PrusaSlicer tab through the macOS menu and return currently exposed fields. Does not edit parameters or save. Categories within tabs are not automatically traversed.",
    inputSchema: {window_id:windowId, tab:z.enum(["Plater Tab","Print Settings Tab","Filament Settings Tab","Printer Settings Tab"])},
  }, async ({window_id,tab}) => guiResult(() => query({tab}, window_id)));
  registerContractTool(server,"set_prusaslicer_field", {
    description: "Change ONE currently exposed numeric text field by exact PrusaSlicer parameter name, only when the user explicitly authorizes that parameter change. Requires expected_value from a fresh read. Rejects disabled/inherited, ambiguous, missing, non-numeric and non-text fields. Activates the selected app to commit via Tab; returns readback. NEVER saves the project or presets. Do not use to change parameters during a read-only audit.",
    inputSchema:{window_id:windowId, parameter:z.string().regex(/^[a-zA-Z0-9_]+$/), expected_value:z.string(), value:z.string().refine(numericFieldValue,"A numeric value, optionally with %, is required")},
    annotations:{readOnlyHint:false,destructiveHint:true},
  }, async ({window_id,...request}) => guiResult(() => query(request, window_id)));
}

export async function guiResult(action: () => Promise<Record<string, unknown>>) {
  try {
    const data = await action();
    const resultStatus = data.verification === "validation_pending" ? "needs_user_action" as const
      : data.verification === "application_normalized_or_rejected_value" || data.coverage ? "partial" as const : "confirmed" as const;
    return {data,resultStatus,warnings: data.coverage ? ["Only controls exposed in the current category and UI mode were read; effective inherited values are unknown."] : [],content:[{type:"text" as const,text:JSON.stringify(data)}]};
  }
  catch(error) { return {isError:true,content:[{type:"text" as const,text:error instanceof Error ? error.message : String(error)}]}; }
}
