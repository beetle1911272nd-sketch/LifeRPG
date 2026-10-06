# REAL LIFE RPG Sandbox

## Start

Double-click `run-sandbox.cmd`, or run this in PowerShell:

```powershell
cd C:\rpg-life\sandbox
.\run-sandbox.ps1
```

Then open `http://localhost:5173/` in a browser.

## Environment diagnostic

```powershell
cd C:\rpg-life\sandbox
.\diagnose.ps1
```

The diagnostic checks Node.js, npm, required files, installed dependencies,
and whether Vite's default port 5173 is available.

## Production build

```powershell
npm run build
```

The app imports `app.generated.jsx` from the parent directory.

## PowerShell execution policy error

If PowerShell blocks `npm.ps1`, use `npm.cmd`:

```powershell
npm.cmd --version
```

The sandbox scripts already use `npm.cmd` on Windows. You can also allow
locally created PowerShell scripts for your user account:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```
