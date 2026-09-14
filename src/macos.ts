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
