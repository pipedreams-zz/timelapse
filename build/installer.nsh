; Zusaetzlicher Eintrag unter Rechtsklick > Senden an > Zeitraffer
!macro customInstall
  CreateShortCut "$SENDTO\Zeitraffer.lnk" "$INSTDIR\Zeitraffer.exe"
!macroend

!macro customUnInstall
  Delete "$SENDTO\Zeitraffer.lnk"
!macroend
