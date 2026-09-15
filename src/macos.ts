import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface MacWindow {
  id: number;
  pid: number;
  title: string;
}

// Query Quartz by owner name: some PrusaSlicer builds have inconsistent bundle IDs.
// This reads metadata only; it never activates, saves, or changes a window.
const WINDOW_SCRIPT = `
ObjC.import("CoreGraphics");
ObjC.bindFunction("CGPreflightScreenCaptureAccess", ["bool", []]);
if (!$.CGPreflightScreenCaptureAccess()) {
  throw new Error("Screen Recording permission is required for the MCP host in macOS System Settings > Privacy & Security. No permission was changed.");
}
var raw = $.CGWindowListCopyWindowInfo(0, 0);
var windows = ObjC.deepUnwrap(ObjC.castRefToObject(raw));
if (!Array.isArray(windows)) throw new Error("Cannot access the macOS window server from this session.");
JSON.stringify(windows.filter(function(w) {
  return w.kCGWindowOwnerName === "PrusaSlicer" && w.kCGWindowLayer === 0 &&
    /(?:^| - )PrusaSlicer-\\d/.test(w.kCGWindowName || "");
}).map(function(w) { return {id: w.kCGWindowNumber, pid: w.kCGWindowOwnerPID, title: w.kCGWindowName}; }));
`;

export function selectMacWindow(windows: MacWindow[], windowId?: number): MacWindow {
  if (windowId !== undefined) {
    const window = windows.find(w => w.id === windowId);
    if (!window) throw new Error(`PrusaSlicer window ${windowId} is not available. Refresh get_current_model.`);
    return window;
  }
  if (windows.length === 0) throw new Error("No PrusaSlicer project window found in this macOS session.");
  if (windows.length > 1) {
    throw new Error("Multiple PrusaSlicer project windows. Call again with window_id: " +
      windows.map(w => `${w.id}: ${w.title}`).join("; "));
  }
  return windows[0];
}

export async function getMacWindow(windowId?: number): Promise<MacWindow> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", WINDOW_SCRIPT], { timeout: 10000 }));
  } catch (error) {
    const failure = error as Error & { stderr?: string; killed?: boolean };
    throw new Error("macOS window query failed: " +
      (failure.stderr?.trim() || (failure.killed ? "timed out" : failure.message)));
  }
  return selectMacWindow(JSON.parse(stdout), windowId);
}

export async function captureMacWindow(outputPath: string, windowId?: number): Promise<MacWindow> {
  const window = await getMacWindow(windowId);
  await execFileAsync("/usr/sbin/screencapture", ["-x", "-o", "-l", String(window.id), outputPath], { timeout: 15000 });
  return window;
}

export type PermissionState = "granted" | "denied" | "unknown";
export interface MacProbeObservation {
  screen_recording: PermissionState;
  accessibility: PermissionState;
  automation: PermissionState;
  gui_session: "active" | "absent" | "unknown";
}

// Preflight only: no AX prompt option, Apple Event, activation, or capture.
// Automation cannot be safely inferred from AX trust; report it as unknown.
export const PERMISSION_PROBE_SCRIPT = `
ObjC.import("CoreGraphics");
ObjC.import("ApplicationServices");
ObjC.bindFunction("CGPreflightScreenCaptureAccess", ["bool", []]);
ObjC.bindFunction("AXIsProcessTrusted", ["bool", []]);
var screen = $.CGPreflightScreenCaptureAccess();
var session = "unknown";
if (screen) {
  var raw = $.CGWindowListCopyWindowInfo(0, 0);
  var windows = ObjC.deepUnwrap(ObjC.castRefToObject(raw));
  if (Array.isArray(windows)) session = windows.some(function(w) {
    return w.kCGWindowOwnerName === "PrusaSlicer" && w.kCGWindowLayer === 0 &&
      /(?:^| - )PrusaSlicer-\\d/.test(w.kCGWindowName || "");
  }) ? "active" : "absent";
}
JSON.stringify({screen_recording:screen ? "granted" : "denied",
  accessibility:$.AXIsProcessTrusted() ? "granted" : "denied", automation:"unknown", gui_session:session});
`;

export function macCapabilities(observation: MacProbeObservation, platform: string) {
  const supported = platform === "darwin";
  return {
    supported,
    probe_process: supported ? "/usr/bin/osascript (JXA child of MCP host)" : "none",
    permissions: observation,
    backends: {
      jxa_gui: { state: !supported ? "unsupported" : observation.screen_recording === "denied" || observation.accessibility === "denied" ? "blocked" : observation.gui_session === "absent" ? "unavailable" : "unknown",
        requires: ["screen_recording", "accessibility", "automation"],
        limitations: ["The current Quartz window selector requires Screen Recording.", "Automation is not probed because sending Apple Events may request permission."] },
      capture: { state: !supported ? "unsupported" : observation.screen_recording === "denied" ? "blocked" : observation.gui_session === "absent" ? "unavailable" : observation.screen_recording === "granted" && observation.gui_session === "active" ? "available" : "unknown",
        requires: ["screen_recording"] },
    },
  };
}

export async function probeMacCapabilities(platform: string = process.platform,
  execute: (script: string) => Promise<string> = async script => (await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], { timeout: 10000 })).stdout) {
  let observation: MacProbeObservation = { screen_recording: "unknown", accessibility: "unknown", automation: "unknown", gui_session: "unknown" };
  if (platform === "darwin") {
    try { observation = JSON.parse(await execute(PERMISSION_PROBE_SCRIPT)); } catch { /* A failed preflight establishes no permission state. */ }
  }
  return macCapabilities(observation, platform);
}
