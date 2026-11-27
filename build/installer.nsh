; Windows installer additions (electron-builder NSIS "include"): a Windows Firewall rule, so phones and tablets on
; the network can open yargDash and YARG's data stream reaches it.
;
;  * Install: one inbound rule for yargDash.exe (TCP and UDP, any port: the web server and YARG's stream), on private
;    and work (domain) networks only, not public ones (a café's Wi-Fi). It first removes any other rule for
;    yargDash.exe: a "Block" saved when Windows' own "allow access?" prompt was dismissed beats an "Allow", and would
;    keep phones out whatever we add. Changing the firewall needs an administrator: Windows asks once (UAC).
;    Skipped when the rule's already there, so updates (silent) don't ask again.
;  * Uninstall: the rule goes too (not on an update, which uninstalls the old version first).
;
; If the network is set to Public in Windows, the rule doesn't apply: set it to Private (README, Troubleshooting).

!macro yargDashHasRule
  nsExec::ExecToStack '"$SYSDIR\netsh.exe" advfirewall firewall show rule name="yargDash"'
  Pop $0 ; exit code: 0 = the rule exists
  Pop $1
!macroend

!macro customInstall
  !insertmacro yargDashHasRule
  ${If} $0 != 0
    DetailPrint "Allowing yargDash through Windows Firewall (private networks)…"
    ExecShellWait "runas" "$SYSDIR\cmd.exe" '/c ""$SYSDIR\netsh.exe" advfirewall firewall delete rule name=all program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" & "$SYSDIR\netsh.exe" advfirewall firewall add rule name="yargDash" description="Phones and tablets on this network can open yargDash, and YARG can send it its data stream." dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes profile=private,domain"' SW_HIDE
  ${EndIf}
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    !insertmacro yargDashHasRule
    ${If} $0 == 0
      ExecShellWait "runas" "$SYSDIR\netsh.exe" 'advfirewall firewall delete rule name="yargDash"' SW_HIDE
    ${EndIf}
  ${EndIf}
!macroend
