; Inno Setup Skript für den Mindmap Editor (Windows-Installer)
; Erzeugt dist\Mindmap-Editor-Setup.exe
; Aufruf:  iscc packaging\mindmap_editor.iss   (nach dem PyInstaller-Build)
; Quelle ist der PyInstaller-Ausgabeordner build\windows\dist\Mindmap-Editor.

[Setup]
AppName=Mindmap Editor
AppVersion=1.1.0
AppPublisher=GDG Stuttgart
DefaultDirName={autopf}\Mindmap Editor
DefaultGroupName=Mindmap Editor
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=Mindmap-Editor-Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\Mindmap-Editor.exe

[Languages]
Name: "de"; MessagesFile: "compiler:Languages\German.isl"

[Files]
; der komplette PyInstaller-Ausgabeordner
Source: "..\build\windows\dist\Mindmap-Editor\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Mindmap Editor"; Filename: "{app}\Mindmap-Editor.exe"
Name: "{autodesktop}\Mindmap Editor"; Filename: "{app}\Mindmap-Editor.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Desktop-Verknüpfung erstellen"; GroupDescription: "Zusätzliche Symbole:"

[Run]
Filename: "{app}\Mindmap-Editor.exe"; Description: "Mindmap Editor starten"; Flags: nowait postinstall skipifsilent
