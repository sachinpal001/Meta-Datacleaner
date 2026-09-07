' ============================================================
'  MetaClean - silent launcher
'
'  Starts the local server and Chrome with no console window.
'  Used by the Desktop / Start Menu shortcuts created by
'  Install-MetaClean.ps1. Optional argument: Window | App | Tab
' ============================================================
Option Explicit

Dim shell, fso, here, ps1, mode, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = fso.BuildPath(here, "Start-MetaClean.ps1")

If Not fso.FileExists(ps1) Then
    MsgBox "MetaClean could not find Start-MetaClean.ps1 next to this script." & vbCrLf & _
           "Expected at: " & ps1, 16, "MetaClean"
    WScript.Quit 1
End If

mode = "Window"
If WScript.Arguments.Count > 0 Then mode = WScript.Arguments(0)

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden" & _
      " -File """ & ps1 & """ -Mode " & mode & " -NoPrompt"

' 0 = hidden window, False = do not wait for it to finish
shell.Run cmd, 0, False
