import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { captureMacWindow } from "../macos.js";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";

/**
 * PowerShell script that captures PrusaSlicer's window using PrintWindow API.
 * Works even when PrusaSlicer is in the background.
 */
const CAPTURE_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$proc = Get-Process -Name 'prusa-slicer' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) {
    Write-Error "NOT_RUNNING"
    exit 1
}

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;

public class WindowCapture {
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left, Top, Right, Bottom;
    }

    public static Bitmap CaptureWindow(IntPtr hwnd) {
        RECT rect;
        GetWindowRect(hwnd, out rect);
        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        if (width <= 0 || height <= 0) {
            width = 1920; height = 1080;
        }
        Bitmap bmp = new Bitmap(width, height);
        using (Graphics g = Graphics.FromImage(bmp)) {
            IntPtr hdc = g.GetHdc();
            PrintWindow(hwnd, hdc, 2);
            g.ReleaseHdc(hdc);
        }
        return bmp;
    }
}
'@

$hwnd = $proc.MainWindowHandle
$bitmap = [WindowCapture]::CaptureWindow($hwnd)
$bitmap.Save($args[0])
$bitmap.Dispose()
Write-Host "OK"
`;

function capturePrusaSlicerWindow(outputPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Write script to temp file and execute
    const scriptPath = join(tmpdir(), `prusa-capture-${Date.now()}.ps1`);
    writeFileSync(scriptPath, CAPTURE_SCRIPT, "utf-8");

    execFile(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, outputPath],
      { timeout: 15000, windowsHide: true },
      (error, stdout, stderr) => {
        // Cleanup script
        try { unlinkSync(scriptPath); } catch { /* ignore */ }

        if (error || stderr?.includes("NOT_RUNNING")) {
          console.error(`[screenshot] Capture failed: ${stderr || error?.message}`);
          resolve(false);
          return;
        }
        resolve(stdout.trim().includes("OK"));
      },
    );
  });
}

export function registerScreenshotPrusaSlicer(server: McpServer) {
  server.registerTool(
    "screenshot_prusaslicer",
    {
      title: "Capturer l'écran de PrusaSlicer",
      description:
        "Prend un screenshot de la fenêtre PrusaSlicer (même en arrière-plan) " +
        "et retourne l'image. Le fichier temporaire est automatiquement supprimé après lecture.",
      inputSchema: {
        window_id: z.number().int().positive().optional().describe("macOS window ID; required when multiple PrusaSlicer project windows are open"),
      },
    },
    async ({ window_id }) => {
      let directory: string | undefined;
      try {
        directory = await mkdtemp(join(tmpdir(), "prusa-screenshot-"));
        const screenshotPath = join(directory, "window.png");

        console.error("[screenshot] Capturing PrusaSlicer window...");
        let success: boolean;
        if (process.platform === "darwin") {
          await captureMacWindow(screenshotPath, window_id);
          success = true;
        } else if (process.platform === "win32") {
          success = await capturePrusaSlicerWindow(screenshotPath);
        } else {
          throw new Error("Window capture is supported on macOS and Windows only.");
        }

        if (!success || !existsSync(screenshotPath)) {
          return {
            isError: true,
            content: [{
              type: "text" as const,
              text: "Impossible de capturer PrusaSlicer. Vérifie qu'il est ouvert.",
            }],
          };
        }

        // Read the image as base64
        const imageBuffer = await readFile(screenshotPath);
        const base64 = imageBuffer.toString("base64");

        return {
          content: [
            {
              type: "image" as const,
              data: base64,
              mimeType: "image/png" as const,
            },
            {
              type: "text" as const,
              text: "Screenshot de PrusaSlicer capturé. Je peux voir le modèle sur le plateau, les paramètres d'impression, et l'état général du slicer.",
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Erreur de capture : ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
