Prism for Windows
=================

Requirements
------------
- Windows 10 or Windows 11 (x64 or ARM64)
- Node.js 20 or newer. Node.js 24 is recommended.

Install
-------
1. Extract the entire ZIP to a normal folder.
2. Open PowerShell in the extracted folder.
3. Run:

   powershell -ExecutionPolicy Bypass -File .\install.ps1

4. Open a new PowerShell or Command Prompt window.
5. Run:

   prism

Only the `prism` command is installed. The official `claude` command and the
`.claude` directory are not changed. Prism stores its configuration in
`%USERPROFILE%\.prism`.

Upgrade
-------
Extract a newer package and run install.ps1 again. Existing `.prism`
configuration is preserved.

Uninstall
---------
Run:

   powershell -ExecutionPolicy Bypass -File .\uninstall.ps1

This preserves `%USERPROFILE%\.prism`. To remove the configuration too, run:

   powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -RemoveConfig
