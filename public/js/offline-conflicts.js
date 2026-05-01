import { getConflicts, setConflicts, clearConflicts, getConflictCount } from './offline-queue.js?v=4.3.11';
import { api } from './api.js?v=4.3.4';

export function initConflictUI(deps) {
    const { loadItems, invalidateCategoryCache, setMessage } = deps;

    const conflictAlertBtn = document.getElementById('conflictAlertBtn');
    const conflictOverlay = document.getElementById('conflictOverlay');
    const conflictCloseBtn = document.getElementById('conflictCloseBtn');
    const conflictListContainer = document.getElementById('conflictListContainer');
    const conflictGlobalActions = document.getElementById('conflictGlobalActions');
    const conflictClearAllBtn = document.getElementById('conflictClearAllBtn');

    if (!conflictAlertBtn || !conflictOverlay || !conflictCloseBtn || !conflictListContainer) {
        return;
    }

    function updateAlertBadge() {
        const count = getConflictCount();
        if (count > 0) {
            conflictAlertBtn.hidden = false;
            // Pulse animation is in CSS
        } else {
            conflictAlertBtn.hidden = true;
            conflictOverlay.hidden = true;
        }
    }

    function renderConflicts() {
        const conflicts = getConflicts();
        conflictListContainer.innerHTML = '';

        if (conflicts.length === 0) {
            conflictListContainer.innerHTML = '<p style="text-align:center; color: var(--text-muted); padding: 2rem 0;">Keine Konflikte gefunden.</p>';
            if (conflictGlobalActions) conflictGlobalActions.hidden = true;
            return;
        }

        if (conflictGlobalActions) conflictGlobalActions.hidden = false;

        conflicts.forEach((conflict, index) => {
            const itemEl = document.createElement('div');
            itemEl.className = 'conflict-item';

            const header = document.createElement('div');
            header.className = 'conflict-item-header';
            
            const typeBadge = document.createElement('span');
            typeBadge.className = 'conflict-item-type';
            typeBadge.textContent = conflict.type;
            
            const errorText = document.createElement('span');
            errorText.className = 'conflict-item-error';
            errorText.textContent = conflict.message || 'Serverfehler';

            header.appendChild(typeBadge);
            header.appendChild(errorText);

            const payloadEl = document.createElement('div');
            payloadEl.className = 'conflict-item-payload';
            payloadEl.textContent = JSON.stringify(conflict.payload, null, 2);

            const actionsEl = document.createElement('div');
            actionsEl.className = 'conflict-item-actions';

            const retryBtn = document.createElement('button');
            retryBtn.className = 'btn-add';
            retryBtn.textContent = 'Erneut versuchen';
            retryBtn.onclick = async () => {
                retryBtn.disabled = true;
                try {
                    await api(conflict.type, {
                        method: 'POST',
                        body: new URLSearchParams(conflict.payload)
                    });
                    
                    // Success, remove from list
                    const currentConflicts = getConflicts();
                    currentConflicts.splice(index, 1);
                    setConflicts(currentConflicts);
                    
                    if (conflict.payload.category_id) {
                        invalidateCategoryCache(conflict.payload.category_id);
                        await loadItems(undefined, { useCache: false });
                    }
                    
                    renderConflicts();
                    updateAlertBadge();
                    setMessage('Aktion erfolgreich wiederholt.');
                } catch (error) {
                    retryBtn.disabled = false;
                    const errorMsg = error instanceof Error ? error.message : 'Wiederholung fehlgeschlagen.';
                    alert('Fehler: ' + errorMsg);
                }
            };

            const discardBtn = document.createElement('button');
            discardBtn.className = 'btn-clear';
            discardBtn.textContent = 'Verwerfen';
            discardBtn.onclick = () => {
                const currentConflicts = getConflicts();
                currentConflicts.splice(index, 1);
                setConflicts(currentConflicts);
                renderConflicts();
                updateAlertBadge();
            };

            actionsEl.appendChild(discardBtn);
            actionsEl.appendChild(retryBtn);

            itemEl.appendChild(header);
            itemEl.appendChild(payloadEl);
            itemEl.appendChild(actionsEl);

            conflictListContainer.appendChild(itemEl);
        });
    }

    conflictAlertBtn.addEventListener('click', () => {
        renderConflicts();
        conflictOverlay.hidden = false;
    });

    conflictCloseBtn.addEventListener('click', () => {
        conflictOverlay.hidden = true;
    });

    conflictOverlay.addEventListener('click', (e) => {
        if (e.target === conflictOverlay) {
            conflictOverlay.hidden = true;
        }
    });

    if (conflictClearAllBtn) {
        conflictClearAllBtn.addEventListener('click', () => {
            if (confirm('Wirklich alle Konflikte verwerfen? Diese Daten gehen unwiderruflich verloren.')) {
                clearConflicts();
                renderConflicts();
                updateAlertBadge();
                conflictOverlay.hidden = true;
            }
        });
    }

    // Export function so it can be called when new conflicts occur
    window.addEventListener('ankerkladde-conflicts-updated', () => {
        updateAlertBadge();
    });

    // Initial check
    updateAlertBadge();
}
