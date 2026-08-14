; Tagify NSIS Installer
; Version 1.0

!include "MUI2.nsh"
!include "LogicLib.nsh"

; Installer settings
Name "Tagify for Spotify"
OutFile "TagifyInstaller.exe"
InstallDir "$LOCALAPPDATA\TagifyInstaller"
RequestExecutionLevel admin

; Modern UI configuration
!define MUI_ICON "assets\icon.ico"  ; Add your icon file
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "assets\header.bmp"  ; 150x57 pixels
!define MUI_WELCOMEFINISHPAGE_BITMAP "assets\welcome.bmp"  ; 164x314 pixels
!define MUI_ABORTWARNING

; Welcome page
!insertmacro MUI_PAGE_WELCOME

; Installation directory page (hidden - we use LOCALAPPDATA)
; !insertmacro MUI_PAGE_DIRECTORY

; Installation page with progress
!insertmacro MUI_PAGE_INSTFILES

; Finish page
!define MUI_FINISHPAGE_TITLE "Tagify Installation Complete"
!define MUI_FINISHPAGE_TEXT "Tagify has been installed successfully.$\r$\n$\r$\nPlease restart Spotify to use Tagify."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open installation log"
!define MUI_FINISHPAGE_RUN_FUNCTION "OpenLog"
!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Languages
!insertmacro MUI_LANGUAGE "English"

; Version Information
VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName" "Tagify for Spotify"
VIAddVersionKey "CompanyName" "alexk218"
VIAddVersionKey "FileDescription" "Tagify Installer"
VIAddVersionKey "FileVersion" "1.0.0.0"
VIAddVersionKey "LegalCopyright" "© 2024 alexk218"

; Installer sections
Section "Install"
    SetOutPath "$INSTDIR"
    
    ; Extract PowerShell script to temp location
    File "tagify-installer.ps1"
    
    ; Show details
    DetailPrint "Starting Tagify installation..."
    DetailPrint "This may take a few minutes..."
    
    ; Execute PowerShell script with elevated privileges
    nsExec::ExecToLog 'powershell.exe -ExecutionPolicy Bypass -NoProfile -File "$INSTDIR\tagify-installer.ps1"'
    Pop $0
    
    ; Check exit code
    ${If} $0 != 0
        DetailPrint "Installation failed with error code: $0"
        MessageBox MB_OK|MB_ICONEXCLAMATION "Installation failed. Please check the log file on your Desktop."
        Abort
    ${Else}
        DetailPrint "Installation completed successfully!"
    ${EndIf}
    
    ; Create uninstaller
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    
    ; Write uninstall information to registry
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Tagify" \
                     "DisplayName" "Tagify for Spotify"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Tagify" \
                     "UninstallString" "$INSTDIR\Uninstall.exe"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Tagify" \
                     "DisplayIcon" "$INSTDIR\Uninstall.exe"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Tagify" \
                     "Publisher" "alexk218"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Tagify" \
                     "DisplayVersion" "1.0.0"
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Tagify" \
                       "NoModify" 1
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Tagify" \
                       "NoRepair" 1
    
SectionEnd

; Uninstaller section
Section "Uninstall"
    ; Run Spicetify restore
    DetailPrint "Restoring Spotify to original state..."
    nsExec::ExecToLog '"$PROFILE\.spicetify\spicetify.exe" restore'
    
    ; Remove Tagify files
    RMDir /r "$APPDATA\spicetify\CustomApps\tagify"
    
    ; Remove uninstaller
    Delete "$INSTDIR\Uninstall.exe"
    Delete "$INSTDIR\tagify-installer.ps1"
    RMDir "$INSTDIR"
    
    ; Remove registry keys
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Tagify"
    
    MessageBox MB_OK "Tagify has been uninstalled. Please restart Spotify."
SectionEnd

; Function to open log file
Function OpenLog
    ExecShell "open" "$DESKTOP\tagify-install.log"
FunctionEnd