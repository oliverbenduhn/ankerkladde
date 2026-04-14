export function createItemMenuController(deps) {
    const {
        getAttachmentTitle,
        openNoteEditorWithNavigation,
        handlePin,
        handleDelete,
        handleEditStart,
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

        function appendAction(label, onClick, className = '') {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `item-menu-action${className ? ` ${className}` : ''}`;
            button.textContent = label;
            button.addEventListener('click', async event => {
                event.stopPropagation();
                close();
                await onClick();
            });
            actions.appendChild(button);
        }

        if (item.category_type === 'notes') {
            appendAction('Notiz öffnen', () => openNoteEditorWithNavigation(item));
        } else {
            appendAction('Bearbeiten', () => handleEditStart(item));
        }

        appendAction(item.is_pinned ? 'Lösen' : 'Anheften', () => handlePin(item.id, item.is_pinned ? 0 : 1));
        appendAction('Löschen', () => handleDelete(item.id), 'is-danger');
        appendAction('Abbrechen', async () => {}, 'is-secondary');

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