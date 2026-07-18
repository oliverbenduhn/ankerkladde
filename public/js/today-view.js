import { api, normalizeItem } from './api.js?v=5.1.16';
import {
    AGENDA_GROUPS,
    AGENDA_GROUP_OVERDUE,
    AGENDA_GROUP_SCHEDULED,
    state,
} from './state.js?v=5.1.16';
import { clearDoneBtn, listEl, progressEl } from './ui.js?v=5.1.16';
import { t } from './i18n.js?v=5.1.16';

function formatDay(value) {
    const parts = String(value).split('-');
    return parts.length === 3 ? `${parts[2]}.${parts[1]}.` : value;
}

export function createTodayViewController({ openSourceItem }) {
    async function updateAppBadge(count) {
        if (typeof navigator.setAppBadge !== 'function') return;
        try {
            await navigator.setAppBadge(count);
        } catch {
            // Badging is optional and must never affect normal app startup.
        }
    }

    async function loadToday() {
        const payload = await api('today');
        state.today = {
            date: typeof payload.today === 'string' ? payload.today : '',
            items: Array.isArray(payload.items) ? payload.items.map(normalizeItem) : [],
        };
        state.serverToday = state.today.date;
        await updateAppBadge(state.today.items.length);
        renderToday();
    }

    function buildHeading(label) {
        const heading = document.createElement('li');
        heading.className = 'today-section-heading';
        heading.textContent = label;
        return heading;
    }

    function buildItem(item, group) {
        const overdue = group === AGENDA_GROUP_OVERDUE;
        const entry = document.createElement('li');
        entry.className = `today-item${overdue ? ' is-overdue' : ''}`;
        entry.dataset.itemId = String(item.id);
        entry.dataset.agendaGroup = group;

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

        if (group === AGENDA_GROUP_SCHEDULED) {
            const time = document.createElement('span');
            time.className = 'today-time-label';
            time.textContent = t('today.at_time', { time: item.due_time });
            meta.appendChild(time);
        } else if (overdue) {
            const since = document.createElement('span');
            since.className = 'today-overdue-label';
            since.textContent = t('today.since', { date: formatDay(item.due_date) });
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
            empty.textContent = t('today.empty');
            listEl.replaceChildren(empty);
            return;
        }

        const groups = AGENDA_GROUPS.map(([group, labelKey]) => [group, t(labelKey)]);
        const fragment = document.createDocumentFragment();

        groups.forEach(([group, label]) => {
            const items = state.today.items.filter(item => item.agenda_group === group);
            if (items.length === 0) return;
            fragment.appendChild(buildHeading(label));
            items.forEach(item => fragment.appendChild(buildItem(item, group)));
        });

        listEl.replaceChildren(fragment);
    }

    return { loadToday, renderToday };
}
