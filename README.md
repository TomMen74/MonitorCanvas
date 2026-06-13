# MonitorCanvas

MonitorCanvas erstellt ein zusammenhängendes Hintergrundbild für bis zu vier
Windows-Monitore. Die Browser-Oberfläche berücksichtigt Auflösung, Position,
Ausrichtung sowie manuell eingetragene Monitorrahmen und Abstände.

## Start

1. Unter Windows `start.bat` doppelt anklicken.
2. Die Anwendung öffnet `http://127.0.0.1:8765` im Standardbrowser.
3. Ein Quellbild wählen, Rahmenabstände einstellen und die Vorschau prüfen.
4. Das Ergebnis herunterladen oder direkt als Hintergrund übernehmen.

Es muss nichts installiert werden. Die Anwendung verwendet das in Windows
enthaltene PowerShell.

## Funktionsumfang

- automatische Erkennung von bis zu vier Windows-Monitoren
- Unterstützung für Querformat, Hochformat und negative Bildschirmkoordinaten
- zusätzlicher vertikaler Versatz für die reale Höhe jedes Monitors
- eigene Rahmenbreiten für oben, rechts, unten und links an jedem Monitor
- frei wählbare Kopplung von einer, zwei, drei oder vier Rahmenseiten
- ein gemeinsames Panoramabild über die gesamte Monitorwand
- mehrere Quellbilder automatisch nebeneinander anordnen und frei zusammenfügen
- Bilder direkt in der Vorschau verschieben und an beliebigen Kanten einrasten
- Korrektur physischer Unterbrechungen in Millimetern
- Echtzeitvorschau mit realer und technischer Ansicht
- PNG-Export in der Größe des virtuellen Windows-Desktops
- direkte Übernahme im Windows-Hintergrundmodus „Spannen“
- Speichern und Öffnen der Projekteinstellungen
- automatische Wiederherstellung der letzten Sitzung inklusive Quellbildern

## Berechnung

Die exportierte Datei bleibt exakt so groß wie der virtuelle Windows-Desktop.
Für jeden Monitor wird jedoch ein eigener Ausschnitt aus einer erweiterten
physischen Panoramaebene übernommen. Zwischen diesen Ausschnitten liegen die
eingestellten Rahmen- und Abstandswerte. Dadurch setzt sich das Motiv hinter
den Monitorrahmen so fort, als läge dort tatsächlich Bildfläche.

Die Umrechnung von Millimetern in Pixel verwendet die eingetragene
Bildschirmdiagonale. In der ersten Version gilt sie als gemeinsame
Referenzgröße für alle angeschlossenen Monitore.

Bei horizontal benachbarten Monitoren addiert MonitorCanvas den rechten
Rahmen des linken Monitors und den linken Rahmen des rechten Monitors. Bei
übereinander angeordneten Geräten werden entsprechend unterer und oberer
Rahmen addiert. Hochformat-Monitore werden anhand ihrer erkannten Ausrichtung
mit denselben vier unabhängigen Seitenwerten behandelt.

## Datenschutz

Alle Bilder bleiben auf dem eigenen Computer. Die Anwendung bindet keine
externen Dienste ein und lädt keine Dateien hoch.

Die letzte Sitzung wird lokal im Browser gespeichert. Dazu gehören die
Quellbilder, ihre Positionen, Größen, Rahmenabstände und Höhenversätze. Beim
Neuladen der Seite wird dieser Stand automatisch wiederhergestellt.
