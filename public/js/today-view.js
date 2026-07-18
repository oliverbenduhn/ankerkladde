import { api, normalizeItem } from './api.js?v=5.1.20';
import {
    AGENDA_GROUPS,
    AGENDA_GROUP_OVERDUE,
    AGENDA_GROUP_SCHEDULED,
    state,
} from './state.js?v=5.1.20';
import { t } from './i18n.js?v=5.1.20';

function formatDay(value) {
    const parts = String(value).split('-');
    return parts.length === 3 ? `${parts[2]}.${parts[1]}.` : value;
}

// Ponytail: shared helper used by journal + WebSocket — replace when a dedicated agenda controller appears.
export async function loadAgenda(date = null) {
    const params = date ? `&date=${encodeURIComponent(date)}` : '';
    const payload = await api(`today${params}`);
    const resolvedDate = typeof payload.date === 'string' ? payload.date : (date || '');
    if (typeof payload.today === 'string' && payload.today !== '') {
        state.serverToday = payload.today;
    }
    return {
        date: resolvedDate,
        items: Array.isArray(payload.items) ? payload.items.map(normalizeItem) : [],
    };
}

export async function updateAppBadge(count) {
    if (typeof navigator.setAppBadge !== 'function') return;
    try {
        await navigator.setAppBadge(count);
    } catch {
        // Badging is optional and must never affect normal app startup.
    }
}

export function buildAgendaItem(item, onOpenItem) {
    const overdue = item.agenda_group === AGENDA_GROUP_OVERDUE;
    const entry = document.createElement('li');
    entry.className = `agenda-item${overdue ? ' is-overdue' : ''}`;
    entry.dataset.itemId = String(item.id);
    entry.dataset.agendaGroup = item.agenda_group;

    const checkbox = document.createElement('button');
    checkbox.type = 'button';
    checkbox.className = 'agenda-item-checkbox';
    checkbox.setAttribute('aria-label', t('agenda.toggle', { name: item.name }));
    checkbox.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'agenda-item-body';
    button.setAttribute('aria-label', `${item.name} in ${item.category_name} öffnen`);

    const name = document.createElement('span');
    name.className = 'agenda-item-name';
    name.textContent = item.name;

    const meta = document.createElement('span');
    meta.className = 'agenda-item-meta';
    const category = document.createElement('span');
    category.className = 'agenda-category-label';
    category.textContent = item.category_name;
    meta.appendChild(category);

    if (item.agenda_group === AGENDA_GROUP_SCHEDULED) {
        const time = document.createElement('span');
        time.className = 'agenda-time-label';
        time.textContent = t('today.at_time', { time: item.due_time });
        meta.appendChild(time);
    } else if (overdue) {
        const since = document.createElement('span');
        since.className = 'agenda-overdue-label';
        since.textContent = t('today.since', { date: formatDay(item.due_date) });
        meta.appendChild(since);
    }

    button.append(name, meta);
    button.addEventListener('click', () => void onOpenItem(item.category_id, item.id));

    entry.append(checkbox, button);
    return entry;
}

// Backwards-compatible export — the old controller only delegated to buildAgendaItem.
// Kept as a thin namespace so the journal module can keep its single import path.
export function createAgendaController(deps) {
    return {
        buildAgendaItem: item => buildAgendaItem(item, deps.openSourceItem),
        loadAgenda,
        updateAppBadge,
    };
}

export function renderGroupedAgenda(list, items, buildItem) {
    const fragment = document.createDocumentFragment();
    AGENDA_GROUPS.forEach(([group, labelKey]) => {
        const groupItems = items.filter(item => item.agenda_group === group);
        if (groupItems.length === 0) return;
        const heading = document.createElement('li');
        heading.className = 'agenda-section-heading';
        heading.textContent = t(labelKey);
        fragment.appendChild(heading);
        groupItems.forEach(item => fragment.appendChild(buildItem(item)));
    });
    list.replaceChildren(fragment);
}