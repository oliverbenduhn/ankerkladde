# Einstellungsansicht als nativer modaler Drawer

Die Einstellungsansicht läuft im selben DOM wie die Haupt-App statt in einem iframe. Sie wird beim ersten Öffnen als HTML-Fragment geladen, danach im DOM behalten und mit einem nativen `<dialog>` dargestellt: rechts als maximal 640 px breiter Drawer, auf schmalen Bildschirmen als Vollbildansicht. Dadurch bleiben App-Zustand und Browser-History erhalten, Änderungen können ohne Seitenreload wirksam werden, und die Webplattform übernimmt Fokusbindung sowie den inerten Hintergrund.

Reversible Einzeländerungen speichern sofort; Kategorienamen beim Verlassen des Feldes oder mit Enter. Zusammengesetzte oder folgenreiche Vorgänge wie AI-Zugangsdaten, Passwortwechsel, Erstellen, Löschen und API-Key-Erneuerung bleiben ausdrückliche Aktionen. Ein erzwungener Passwortwechsel macht den Dialog nicht schließbar.

`index.php?screen=settings` ist die kanonische Route; direkte Aufrufe von `settings.php` leiten dorthin um. Ein Dialog-Polyfill und eine zweite eigenständige Settings-Oberfläche werden bewusst nicht gepflegt.
