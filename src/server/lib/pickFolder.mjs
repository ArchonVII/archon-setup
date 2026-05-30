import { spawn } from "node:child_process";
import { resolve } from "node:path";

const PICK_FOLDER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select a folder for archon-setup'
$dialog.ShowNewFolderButton = $true
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK -and -not [string]::IsNullOrWhiteSpace($dialog.SelectedPath)) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  [Console]::Out.WriteLine($dialog.SelectedPath)
  exit 0
}
exit 2
`;

const POWERSHELL_ARGS = [
  "-STA",
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  PICK_FOLDER_SCRIPT,
];

export async function pickFolder({
  platform = process.platform,
  spawnImpl = spawn,
  timeoutMs = 120_000,
} = {}) {
  if (platform !== "win32") return { unsupported: true };

  return new Promise((resolveResult) => {
    let child;
    try {
      child = spawnImpl("powershell.exe", POWERSHELL_ARGS, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: false,
      });
    } catch (err) {
      resolveResult({ error: err.message });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      child.kill?.("SIGKILL");
      finish({ error: "dialog timed out" });
    }, timeoutMs);

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult(result);
    }

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      finish({ error: err.message });
    });
    child.on("close", (code) => {
      if (code === 0) {
        const selectedPath = stdout.trim();
        finish(selectedPath ? { path: resolve(selectedPath) } : { error: "folder picker returned no path" });
        return;
      }
      if (code === 2) {
        finish({ cancelled: true });
        return;
      }
      finish({ error: stderr.trim() || `folder picker exited with code ${code}` });
    });
  });
}
