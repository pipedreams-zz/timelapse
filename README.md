# Zeitraffer

Kleine Desktop-App für Windows, die aus Screencasts per Drag & Drop Zeitraffer erzeugt. Die App steuert **ffmpeg**, liest die Originale direkt und legt das Ergebnis standardmäßig daneben ab:

```
D:\OBS\aufnahme.mkv  →  D:\OBS\aufnahme_4x.mp4
```

## Download

Unter **[Releases](https://github.com/pipedreams-zz/timelapse/releases/latest)** gibt es zwei Varianten, beide mit ffmpeg an Bord – es muss nichts weiter installiert werden:

- **`Zeitraffer-Setup-x.y.z.exe`** – Installer ohne Adminrechte. Legt Startmenü- und Desktop-Verknüpfung an sowie **Rechtsklick → Senden an → Zeitraffer**. Deinstallation über die Windows-Einstellungen.
- **`Zeitraffer-x.y.z-portable.exe`** – eine einzelne Datei, startet ohne Installation.

Die Dateien sind nicht signiert. Windows SmartScreen zeigt deshalb beim ersten Start „Der Computer wurde durch Windows geschützt“ – über **Weitere Informationen → Trotzdem ausführen** geht es weiter.

## Aus dem Quellcode starten

- `npm run setup` (installiert Electron samt Programmdatei), dann `npm start` oder Doppelklick auf **`Zeitraffer starten.cmd`**.
- Optional **`Verknuepfungen anlegen.ps1`** ausführen (Rechtsklick → „Mit PowerShell ausführen“) für Desktop-Verknüpfung und „Senden an“.
- ffmpeg/ffprobe werden dabei aus dem PATH genommen (oder Ordner unter „Erweitert“ eintragen).

## Neue Version veröffentlichen

```
git tag v1.0.1
git push origin v1.0.1
```

Der Workflow `.github/workflows/release.yml` übernimmt die Version aus dem Tag, lädt ffmpeg (`scripts/fetch-ffmpeg.ps1`), baut Installer und portable EXE und hängt beide an das Release. Lokal bauen: `npm run ffmpeg`, dann `npm run dist` (Ausgabe in `dist/`).

## Optionen

| Bereich | Möglichkeiten |
|---|---|
| Geschwindigkeit | Faktor 2× … 64× oder frei (z. B. 1,5 / 10); alternativ **Zieldauer** (z. B. `1:00`), dann wird der Faktor je Video berechnet |
| Dateiname | Vorlage mit `{name}`, `{speed}`, `{date}`, Standard `{name}_{speed}x`. Vorhandene Dateien werden nicht überschrieben (`… (2).mp4`), außer per Häkchen |
| Speicherort | neben dem Original oder fester Ordner |
| Bildrate | wie Original / 30 / 60 fps (konstante Bildrate, überzählige Frames werden verworfen) |
| Qualität | Ausgewogen / Hoch / Kleine Datei |
| Encoder | Automatisch (NVENC über die NVIDIA-Karte, falls verfügbar) oder CPU (x264) |
| Ton | entfernen (wie `-an`) oder beschleunigt behalten (Tonhöhe bleibt) |
| Ablauf | sofort nach dem Ablegen starten oder erst sammeln und „Alle starten“ |

Einstellungen bleiben zwischen den Sitzungen erhalten. Videos werden nacheinander verarbeitet; unfertige Dateien heißen `*.part.mp4` und werden bei Abbruch oder Fehler gelöscht.

## Entspricht in etwa

```
ffmpeg -i input.mp4 -map 0:v:0 -vf "setpts=PTS/4" -fps_mode cfr -r 60/1 ^
  -c:v h264_nvenc -preset p5 -tune hq -rc vbr -cq 23 -b:v 0 -pix_fmt yuv420p ^
  -an -movflags +faststart output_4x.mp4
```

## Gestaltung

Ruhig und monochrom: Papier und Tinte, Haarlinien, keine Radien und Schatten. Ein dunkles Grün für Primäraktion und Fortschritt, ein Holzton für Hinweise. Überschriften in Space Grotesk, Text und Bedienung in Supreme.
Darstellung oben rechts umschaltbar: **Auto** (folgt Windows), **Hell**, **Dunkel**.

### Schriften

- **Space Grotesk** liegt unter `assets/fonts/` (SIL Open Font License, siehe `assets/fonts/OFL.txt`).
- **Supreme** (Indian Type Foundry, über [Fontshare](https://www.fontshare.com/fonts/supreme)) ist nicht im Repository enthalten. Ohne die Datei nutzt die App Segoe UI. Wer Supreme verwenden möchte, legt `Supreme-Variable.woff2` von Fontshare unter `assets/fonts/` ab.

## Dateien

- `main.js`: Fenster, ffmpeg/ffprobe-Aufrufe, Dateinamen, Warteschlangen-Prozesse
- `preload.js`: sichere Brücke zur Oberfläche
- `index.html`, `styles.css`, `renderer.js`: Oberfläche

Hinweis: `node_modules` ist rund 250 MB groß. Liegt der App-Ordner in einem synchronisierten Cloud-Ordner, wird das mitsynchronisiert – dann den Ordner besser an einen lokalen Ort verschieben und `Verknuepfungen anlegen.ps1` erneut ausführen.

## Lizenz

Code unter der [MIT-Lizenz](LICENSE). Die Schrift Space Grotesk unter `assets/fonts/` steht unter der SIL Open Font License ([OFL.txt](assets/fonts/OFL.txt)).

Die Release-Pakete enthalten einen unveränderten ffmpeg-Build von [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) unter der GPL v3. Lizenztext und Quellenangaben liegen im installierten Programm unter `resources/ffmpeg/`. Zeitraffer ruft ffmpeg als eigenständiges Programm auf.
