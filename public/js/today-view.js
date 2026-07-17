import { api, normalizeItem } from './api.js?v=4.3.4';
import { state } from './state.js?v=4.3.4';
import { clearDoneBtn, listEl, progressEl } from './ui.js?v=4.3.4';

function formatDay(value) {
    const parts = String(value).split('-');
    return parts.length === 3 ? `${parts[2]}.${parts[1]}.` : value;
}

export function createTodayViewController({ openSourceItem }) {
    async function loadToday() {
        const payload = await api('today');
        state.today = {
            date: typeof payload.today === 'string' ? payload.today : '',
            items: Array.isArray(payload.items) ? payload.items.map(normalizeItem) : [],
        };
        renderToday();
    }

    function buildHeading(label) {
        const heading = document.createElement('li');
        heading.className = 'today-section-heading';
        heading.textContent = label;
        return heading;
    }

    function buildItem(item, overdue) {
        const entry = document.createElement('li');
        entry.className = `today-item${overdue ? ' is-overdue' : ''}`;
        entry.dataset.itemId = String(item.id);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'today-item-button';
        button.setAttribute('aria-label', `${item.name} in ${item.category_name} öffnen`);

        const name = document.createElement('span');
        name.className = 'today-item-name';
        name.textContent = item.name;

        const meta = document.createElement('span');
        meta.className = 'today-item-meta';

        const category = document.createElement('span');
        category.className = 'today-category-label';
        category.textContent = item.category_name;
        meta.appendChild(category);

        if (overdue) {
            const since = document.createElement('span');
            since.className = 'today-overdue-label';
            since.textContent = `seit ${formatDay(item.due_date)}`;
            meta.appendChild(since);
        }

        button.append(name, meta);
        button.addEventListener('click', () => void openSourceItem(item.category_id, item.id));
        entry.appendChild(button);
        return entry;
    }

    function renderToday() {
        if (state.screen !== 'today') return;
        clearDoneBtn.disabled = true;
        progressEl.textContent = '';

        if (state.today.items.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'empty-state today-empty-state';
            empty.textContent = 'Nichts heute';
            listEl.replaceChildren(empty);
            return;
        }

        const overdue = state.today.items.filter(item => item.due_date < state.today.date);
        const dueToday = state.today.items.filter(item => item.due_date === state.today.date);
        const fragment = document.createDocumentFragment();

        if (overdue.length > 0) {
            fragment.appendChild(buildHeading('Überfällig'));
            overdue.forEach(item => fragment.appendChild(buildItem(item, true)));
        }
        if (dueToday.length > 0) {
            fragment.appendChild(buildHeading('Heute'));
            dueToday.forEach(item => fragment.appendChild(buildItem(item, false)));
        }

        listEl.replaceChildren(fragment);
    }

    return { loadToday, renderToday };
}
