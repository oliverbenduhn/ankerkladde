# Excalidraw-Szenen liegen am Item

**Status**: accepted

Excalidraw-Szenen werden als JSON in `items.sketch_json` gespeichert und ausschließlich über den lazy Sketch-Endpunkt `sketch` geladen (`sketch_load` bleibt als kompatibler Alias erhalten); Listen liefern nur `has_sketch`. Der explizite Name kennzeichnet das Speicherformat und die bestehenden Spaltenlisten vermeiden unbeabsichtigte Szenen-Transfers, während Dateiablage und Attachment-Lebenszyklus entfallen; pro Szene gilt ein Limit von 2 MB.
