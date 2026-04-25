import { state } from './state.js?v=4.2.79';
import { listAreaEl, listEl, progressEl, clearDoneBtn } from './ui.js?v=4.2.79';

const COLUMNS = [
    { key: 'offen',      label: 'Offen',      icon: '○' },
    { key: 'in_arbeit',  label: 'In Arbeit',  icon: '▶' },
    { key: 'wartet_auf', label: 'Wartet auf', icon: '⏱' },
    { key: 'erledigt',   label: 'Erledigt',   icon: '✓' },
];

function itemColumn(item) {
    if (item.done) return 'erledigt';
    if (item.status === 'in_progress') return 'in_arbeit';
    if (item.status === 'waiting') return 'wartet_auf';
    return 'offen';
}

export function createKanbanViewController({ buildItemNode, getVisibleItems, handleKanbanDrop }) {
    let boardEl = null;

    function getOrCreateBoard() {
        if (!boardEl) {
            boardEl = document.createElement('div');
            boardEl.className = 'kanban-board';
            boardEl.id = 'kanbanBoard';
        }
        return boardEl;
    }

    function renderKanban() {
        const items = getVisibleItems();

        // progress bar / clear-done button (same as list mode)
        const doneCount = items.filter(i => i.done === 1).length;
        progressEl.textContent = `${doneCount} / ${items.length}`;
        clearDoneBtn.disabled = doneCount === 0;

        const board = getOrCreateBoard();

        // Group items into columns
        const groups = { offen: [], in_arbeit: [], wartet_auf: [], erledigt: [] };
        items.forEach(item => groups[itemColumn(item)].push(item));

        // Build columns
        const fragment = document.createDocumentFragment();
        COLUMNS.forEach(({ key, label, icon }) => {
            const col = document.createElement('div');
            col.className = 'kanban-column';
            col.dataset.status = key;

            const header = document.createElement('div');
            header.className = 'kanban-column-header';
            header.innerHTML = `<span class="kanban-col-icon">${icon}</span> ${label} <span class="kanban-col-count">${groups[key].length}</span>`;
            col.appendChild(header);

            const ul = document.createElement('ul');
            ul.className = 'kanban-column-list';
            ul.dataset.status = key;

            if (groups[key].length === 0) {
                const empty = document.createElement('li');
                empty.className = 'kanban-empty';
                empty.textContent = 'Leer';
                ul.appendChild(empty);
            } else {
                groups[key].forEach(item => {
                    const node = buildItemNode(item);
                    node.draggable = true;
                    node.addEventListener('dragstart', event => {
                        event.dataTransfer.setData('text/plain', String(item.id));
                        event.dataTransfer.effectAllowed = 'move';
                        node.classList.add('is-kanban-dragging');
                    });
                    node.addEventListener('dragend', () => {
                        node.classList.remove('is-kanban-dragging');
                    });
                    ul.appendChild(node);
                });
            }

            // Drop target
            ul.addEventListener('dragover', event => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                ul.classList.add('kanban-drop-active');
            });
            ul.addEventListener('dragleave', () => ul.classList.remove('kanban-drop-active'));
            ul.addEventListener('drop', event => {
                event.preventDefault();
                ul.classList.remove('kanban-drop-active');
                const itemId = parseInt(event.dataTransfer.getData('text/plain'), 10);
                if (itemId) handleKanbanDrop(itemId, key);
            });

            col.appendChild(ul);
            fragment.appendChild(col);
        });

        board.replaceChildren(fragment);

        // Swap swipe stage for kanban board in DOM
        const swipeStage = listEl?.parentElement;
        if (swipeStage) swipeStage.hidden = true;
        if (!board.parentElement) {
            listAreaEl.appendChild(board);
        }
        board.hidden = false;
    }

    function hideKanban() {
        if (boardEl) boardEl.hidden = true;
        const swipeStage = listEl?.parentElement;
        if (swipeStage) swipeStage.hidden = false;
    }

    return { renderKanban, hideKanban };
}
