import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL_PS1 = join(ROOT, "install.ps1");
const BODY = () => readFileSync(INSTALL_PS1, "utf8");

// Locate a PowerShell host (pwsh on Linux/CI + PS7, powershell on stock Windows).
function pwshBin() {
  for (const bin of ["pwsh", "powershell"]) {
    try {
      execFileSync(bin, ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" });
      return bin;
    } catch {
      /* not available */
    }
  }
  return null;
}
const PWSH = pwshBin();

// ---- structural checks (run everywhere; no PowerShell needed) ----------------

test("install.ps1 is a param-driven script with a -DryRun switch", () => {
  const body = BODY();
  assert.match(body, /param\s*\(/i);
  assert.match(body, /\[switch\]\s*\$DryRun/i);
});

test("install.ps1 documents itself with a synopsis", () => {
  assert.match(BODY(), /\.SYNOPSIS/);
});

test("install.ps1 requires Node >= 20", () => {
  const body = BODY();
  assert.match(body, /\bnode\b/i);
  assert.match(body, /20/); // minimum Node major (package.json engines: node >= 20)
});

test("install.ps1 checks for the GitHub CLI", () => {
  assert.match(BODY(), /\bgh\b/);
});

test("install.ps1 launches the published package via npx", () => {
  assert.match(BODY(), /npx @archonvii\/archon-setup/);
});

test("install.ps1 guards the npx launch behind the -DryRun switch", () => {
  assert.match(BODY(), /if\s*\(\s*\$DryRun\s*\)/i);
});

test("install.ps1 prints actionable guidance and exits non-zero when a prereq is missing", () => {
  const body = BODY();
  assert.match(body, /exit 1/);
  assert.match(body, /nodejs\.org|cli\.github\.com/); // install guidance links
});

// ---- execution checks (gated on a PowerShell host being present) -------------

test(
  "install.ps1 -DryRun reports the checks and the dry run without launching the wizard",
  { skip: PWSH ? false : "no PowerShell host (pwsh/powershell) available" },
  () => {
    // GitHub-hosted runners (and the dev box) have Node >= 20 + gh, so -DryRun
    // reaches the dry-run branch and exits 0 WITHOUT invoking npx (which would
    // hang on the not-yet-published package).
    const out = execFileSync(PWSH, ["-NoProfile", "-File", INSTALL_PS1, "-DryRun"], {
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.match(out, /dry run/i);
    assert.match(out, /prerequisites ok/i);
  }
);

test(
  "install.ps1 -DryRun does not reach the live launch path",
  { skip: PWSH ? false : "no PowerShell host (pwsh/powershell) available" },
  () => {
    const out = execFileSync(PWSH, ["-NoProfile", "-File", INSTALL_PS1, "-DryRun"], {
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.doesNotMatch(out, /Launching archon-setup/i); // the non-dry-run message
  }
);
