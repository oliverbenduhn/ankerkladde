import sys

with open('/home/oliver/Dokumente/ankerkladde/public/index.php', 'r') as f:
    lines = f.readlines()

out = []
for i, line in enumerate(lines):
    if '<div class="header-actions">' in line:
        out.append(line)
        out.append('            <button type="button" id="conflictAlertBtn" class="header-icon-btn btn-conflict-alert" aria-label="Konflikte anzeigen" hidden><?= icon(\'alert-triangle\') ?></button>\n')
        continue
        
    if '    <?php if ($shoppingListScannerEnabled): ?>' in line:
        out.append("""    <div class="conflict-overlay" id="conflictOverlay" hidden>
        <div class="conflict-sheet" role="dialog" aria-modal="true" aria-labelledby="conflictTitle">
            <div class="conflict-header">
                <div>
                    <h2 class="conflict-title" id="conflictTitle">Konflikte</h2>
                    <p class="conflict-subtitle">Diese Einträge konnten nicht gespeichert werden.</p>
                </div>
                <button type="button" id="conflictCloseBtn" class="header-icon-btn" aria-label="Schließen"><?= icon('x') ?></button>
            </div>
            <div class="conflict-list-container" id="conflictListContainer"></div>
            <div class="conflict-actions" id="conflictGlobalActions" hidden>
                <button type="button" id="conflictClearAllBtn" class="btn-clear" style="width:100%; border-radius: var(--radius);">Alle verwerfen</button>
            </div>
        </div>
    </div>

""")
        out.append(line)
        continue

    out.append(line)

with open('/home/oliver/Dokumente/ankerkladde/public/index.php', 'w') as f:
    f.writelines(out)
print("Done index.php")
