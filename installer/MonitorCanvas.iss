#define MyAppName "MonitorCanvas"
#ifndef MyAppVersion
  #define MyAppVersion "1.1.0"
#endif
#define MyAppPublisher "TomMen74"
#define MyAppURL "https://github.com/TomMen74/MonitorCanvas"
#define MyAppExeName "MonitorCanvas.exe"

[Setup]
AppId={{B6AD4B72-B8FE-4D45-90B9-0A50362C247A}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\release
OutputBaseFilename=MonitorCanvas-{#MyAppVersion}-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"

[Tasks]
Name: "desktopicon"; Description: "Desktop-Verknüpfung erstellen"; GroupDescription: "Zusätzliche Symbole:"

[Files]
Source: "..\dist\MonitorCanvas.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\server.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\index.html"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\app.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\styles.css"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\MonitorCanvas"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\MonitorCanvas"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "MonitorCanvas starten"; Flags: nowait postinstall skipifsilent
