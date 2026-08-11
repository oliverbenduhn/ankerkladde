import { t } from './i18n.js';
import { hasConflictFor } from './offline-queue.js';
import { activateModal } from './utils.js';

export function createItemMenuController(deps) {
    const {
        getAttachmentTitle,
        getMoveTargetCategories,
        openNoteEditorWithNavigation,
        openItemEdit,
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
        let modalSession = null;

        function close() {
            modalSession?.deactivate();
            modalSession = null;
            overlay.remove();
        }

        function focusFirstAction() {
            if (overlay.isConnected) actions.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
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
                appendAction(t('msg.no_move_target'), async () => {}, 'is-secondary');
                appendAction(t('ui.back'), async () => showMainActions(), 'is-secondary', false);
                focusFirstAction();
                return;
            }

            targets.forEach(category => {
                appendAction(category.name, () => handleMove(item, category.id));
            });
            appendAction(t('ui.back'), async () => showMainActions(), 'is-secondary', false);
            focusFirstAction();
        }

        function showMainActions() {
            actions.replaceChildren();

            if (item.category_type === 'notes') {
                appendAction(t('ui.open_note'), () => openNoteEditorWithNavigation(item));
            } else if (item.category_type === 'list_due_date' || item.category_type === 'list_quantity') {
                appendAction(t('ui.edit'), () => openItemEdit(item));
            } else if (item.category_type === 'drawings' || item.has_sketch) {
                appendAction(t('sketch.open'), () => openSketchEditor(item));
            } else {
                appendAction(t('ui.edit'), () => handleEditStart(item));
            }

            if (getMoveTargetCategories(item).length > 0) {
                appendAction(t('ui.move'), async () => showMoveTargets(), '', false);
            }

            appendAction(item.is_pinned ? t('ui.unpin') : t('ui.pin'), () => handlePin(item.id, item.is_pinned ? 0 : 1));
            const deleteConflict = hasConflictFor(item.id, 'delete');
            appendAction(deleteConflict ? t('ui.delete_anyway') : t('ui.delete'), () => handleDelete(item.id), 'is-danger');
            appendAction(t('ui.cancel'), async () => {}, 'is-secondary');
            focusFirstAction();
        }

        showMainActions();

        sheet.appendChild(actions);
        overlay.appendChild(sheet);

        document.body.appendChild(overlay);
        modalSession = activateModal(overlay, {
            initialFocus: () => actions.querySelector('button:not([disabled])'),
            onEscape: close,
            onBackdrop: close,
        });
    }

    return { open };
}
