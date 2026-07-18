# Excalidraw-Szenen liegen am Item

**Status**: accepted

Excalidraw-Szenen werden als JSON in `items.sketch` gespeichert und ausschließlich über einen lazy Sketch-Endpunkt geladen; Listen liefern nur `has_sketch`. Die bestehenden expliziten Spaltenlisten vermeiden unbeabsichtigte Szenen-Transfers, während Dateiablage und Attachment-Lebenszyklus entfallen; pro Szene gilt ein Limit von 2 MB.
