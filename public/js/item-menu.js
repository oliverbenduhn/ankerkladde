export function createItemMenuController(deps) {
    const {
        getAttachmentTitle,
        getMoveTargetCategories,
        openNoteEditorWithNavigation,
        openTodoEditor,
        handlePin,
        handleDelete,
        handleEditStart,
        handleMove,
        onActionError = () => {},
    } = deps;

    function open(item) {
        const overlay = document.createElement('div');
        overlay.className = 'item-menu-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', `${item.name || 'Eintrag'} Aktionen`);

        const sheet = document.createElement('div');
        sheet.className = 'item-menu-sheet';

        const title = document.createElement('div');
        title.className = 'item-menu-title';
        title.textContent = item.name || getAttachmentTitle(item);
        sheet.appendChild(title);

        const actions = document.createElement('div');
        actions.className = 'item-menu-actions';

        function close() {
            overlay.remove();
            document.removeEventListener('keydown', onKey);
        }

        function onKey(event) {
            if (event.key === 'Escape') close();
        }

        function appendAction(label, onClick, className = '', closeOnClick = true) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `item-menu-action${className ? ` ${className}` : ''}`;
            button.textContent = label;
            button.addEventListener('click', async event => {
                event.stopPropagation();
                if (closeOnClick) close();
                button.disabled = true;
                try {
                    await onClick();
                } catch (error) {
                    console.error('Item menu action failed:', error);
                    onActionError(error);
                } finally {
                    button.disabled = false;
                }
            });
            actions.appendChild(button);
        }

        function showMoveTargets() {
            actions.replaceChildren();

            const targets = getMoveTargetCategories(item);
            if (targets.length === 0) {
                appendAction('Keine passende Zielkategorie', async () => {}, 'is-secondary');
                appendAction('Zurück', async () => showMainActions(), 'is-secondary', false);
                return;
            }

            targets.forEach(category => {
                appendAction(category.name, () => handleMove(item, category.id));
            });
            appendAction('Zurück', async () => showMainActions(), 'is-secondary', false);
        }

        function showMainActions() {
            actions.replaceChildren();

            if (item.category_type === 'notes') {
                appendAction('Notiz öffnen', () => openNoteEditorWithNavigation(item));
            } else if (item.category_type === 'list_due_date') {
                appendAction('Bearbeiten', () => openTodoEditor(item));
            } else {
                appendAction('Bearbeiten', () => handleEditStart(item));
            }

            if (getMoveTargetCategories(item).length > 0) {
                appendAction('Verschieben', async () => showMoveTargets(), '', false);
            }

            appendAction(item.is_pinned ? 'Lösen' : 'Anheften', () => handlePin(item.id, item.is_pinned ? 0 : 1));
            appendAction('Löschen', () => handleDelete(item.id), 'is-danger');
            appendAction('Abbrechen', async () => {}, 'is-secondary');
        }

        showMainActions();

        sheet.appendChild(actions);
        overlay.appendChild(sheet);

        overlay.addEventListener('click', event => {
            if (event.target === overlay) close();
        });
        document.addEventListener('keydown', onKey);
        document.body.appendChild(overlay);
    }

    return { open };
}
