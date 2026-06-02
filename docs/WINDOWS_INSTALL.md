# Windows install

The fastest way onto archon-setup on Windows is the thin PowerShell bootstrap,
which checks prerequisites and then launches the published package via `npx`.
This is a deliberately thin slice — native installers (winget/scoop) are
deferred (see below).

## One-liner

```powershell
iwr -useb https://raw.githubusercontent.com/ArchonVII/archon-setup/main/install.ps1 | iex
```

> The one-liner needs the package published to npm (tracked in #82). Until then,
> clone the repo and run it from source: `npm start`.

## What `install.ps1` does

1. Verifies **Node.js >= 20** and the **GitHub CLI (`gh`)** are installed,
   printing install links (nodejs.org / cli.github.com) if either is missing,
   and exiting non-zero so you notice.
2. Runs `npx @archonvii/archon-setup`, which opens the local browser wizard.

Run only the checks, without launching the wizard:

```powershell
./install.ps1 -DryRun
```

## Native installers (deferred)

winget and scoop manifests are **designed but not submitted** —
[`docs/installer/winget-stub.yaml`](installer/winget-stub.yaml) and
[`docs/installer/scoop-stub.json`](installer/scoop-stub.json) are reference
stubs only. archon-setup currently ships as an `npx` package, so a native
manifest is deferred until a standalone binary exists; the thin `npx` bootstrap
above is the supported path.
