<?php declare(strict_types=1); ?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover">
    <title>Einkaufsliste</title>
    <style>
        :root {
            color-scheme: light;
            --primary: #2f855a;
            --primary-dark: #276749;
            --secondary: #3182ce;
            --danger: #c53030;
            --surface: #ffffff;
            --bg: linear-gradient(180deg, #f7fafc 0%, #edf2f7 100%);
            --text: #1a202c;
            --muted: #718096;
            --border: #e2e8f0;
            --shadow: 0 18px 40px rgba(15, 23, 42, 0.12);
            --radius: 18px;
        }

        * { box-sizing: border-box; }
        body {
            margin: 0;
            min-height: 100vh;
            font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: var(--bg);
            color: var(--text);
            padding: 20px 14px 28px;
        }

        .app {
            max-width: 560px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.92);
            backdrop-filter: blur(10px);
            border-radius: 28px;
            box-shadow: var(--shadow);
            padding: 20px;
        }

        .hero { margin-bottom: 20px; }
        h1 { margin: 0 0 8px; font-size: clamp(1.8rem, 6vw, 2.3rem); }
        .subtitle { margin: 0; color: var(--muted); line-height: 1.5; }

        form {
            display: grid;
            grid-template-columns: 1fr;
            gap: 12px;
            margin-bottom: 18px;
        }

        .row {
            display: grid;
            grid-template-columns: 2fr 1fr;
            gap: 10px;
        }

        input, button {
            border-radius: 14px;
            border: 1px solid var(--border);
            font-size: 16px;
            min-height: 52px;
        }

        input {
            width: 100%;
            padding: 0 14px;
            background: #fff;
        }

        button {
            padding: 0 16px;
            font-weight: 700;
            cursor: pointer;
            transition: transform 0.15s ease, background 0.15s ease, color 0.15s ease;
        }

        button:hover, button:focus-visible { transform: translateY(-1px); }

        .primary-btn {
            border: none;
            background: var(--primary);
            color: #fff;
        }

        .primary-btn:hover, .primary-btn:focus-visible { background: var(--primary-dark); }
        .ghost-btn { background: #fff; color: var(--muted); }
        .ghost-btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }

        .toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            margin-bottom: 14px;
            flex-wrap: wrap;
        }

        .stats {
            font-size: 0.95rem;
            color: var(--muted);
        }

        .message {
            min-height: 24px;
            margin-bottom: 8px;
            color: var(--secondary);
            font-weight: 600;
        }

        ul {
            list-style: none;
            padding: 0;
            margin: 0;
            display: grid;
            gap: 10px;
        }

        li {
            display: grid;
            grid-template-columns: auto 1fr auto;
            gap: 12px;
            align-items: center;
            padding: 14px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 18px;
        }

        li.done { background: #f7fafc; }
        .toggle {
            appearance: none;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            border: 2px solid var(--primary);
            display: inline-grid;
            place-items: center;
            cursor: pointer;
            margin: 0;
        }

        .toggle:checked {
            background: var(--primary);
        }

        .toggle:checked::after {
            content: "";
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #fff;
        }

        .item-name { font-weight: 700; }
        .item-meta { font-size: 0.92rem; color: var(--muted); margin-top: 4px; }
        li.done .item-name { text-decoration: line-through; color: #718096; }
        .delete-btn {
            border: none;
            background: #fff5f5;
            color: var(--danger);
            min-height: 42px;
            padding: 0 12px;
        }

        .empty {
            text-align: center;
            padding: 26px 12px;
            color: var(--muted);
            border: 1px dashed var(--border);
            border-radius: 18px;
            background: rgba(255,255,255,0.7);
        }

        @media (max-width: 420px) {
            .row { grid-template-columns: 1fr; }
            .app { padding: 18px 14px; }
            li { grid-template-columns: auto 1fr; }
            .delete-btn { grid-column: 1 / -1; }
        }
    </style>
</head>
<body>
<main class="app">
    <section class="hero">
        <p class="subtitle">Praktisch für Handy und Desktop: Artikel hinzufügen, abhaken und erledigte Einträge gesammelt entfernen.</p>
        <h1>🛒 Einkaufsliste</h1>
    </section>

    <form id="itemForm">
        <input type="text" id="itemInput" name="name" placeholder="z. B. Milch" maxlength="120" autocomplete="off" autofocus required>
        <div class="row">
            <input type="text" id="quantityInput" name="quantity" placeholder="Menge, z. B. 2x oder 500 g" maxlength="40" autocomplete="off">
            <button type="submit" class="primary-btn">Hinzufügen</button>
        </div>
    </form>

    <div class="toolbar">
        <div class="stats" id="stats">0 offen · 0 erledigt</div>
        <button type="button" class="ghost-btn" id="clearDoneBtn">Erledigte löschen</button>
    </div>

    <div class="message" id="message" aria-live="polite"></div>
    <ul id="list" aria-live="polite"></ul>
</main>

<script>
    const listEl = document.getElementById('list');
    const itemForm = document.getElementById('itemForm');
    const itemInput = document.getElementById('itemInput');
    const quantityInput = document.getElementById('quantityInput');
    const statsEl = document.getElementById('stats');
    const messageEl = document.getElementById('message');
    const clearDoneBtn = document.getElementById('clearDoneBtn');

    const state = { items: [] };

    function setMessage(text = '', isError = false) {
        messageEl.textContent = text;
        messageEl.style.color = isError ? '#c53030' : '#3182ce';
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    function renderItems() {
        const openCount = state.items.filter(item => Number(item.done) !== 1).length;
        const doneCount = state.items.length - openCount;
        statsEl.textContent = `${openCount} offen · ${doneCount} erledigt`;
        clearDoneBtn.disabled = doneCount === 0;

        if (state.items.length === 0) {
            listEl.innerHTML = '<li class="empty">Noch nichts auf der Liste. Füge oben deinen ersten Artikel hinzu.</li>';
            return;
        }

        listEl.innerHTML = state.items.map(item => `
            <li class="${Number(item.done) === 1 ? 'done' : ''}">
                <input
                    class="toggle"
                    type="checkbox"
                    aria-label="${escapeHtml(item.name)} umschalten"
                    ${Number(item.done) === 1 ? 'checked' : ''}
                    onchange="toggleItem(${item.id}, ${Number(item.done) === 1 ? 0 : 1})"
                >
                <div>
                    <div class="item-name">${escapeHtml(item.name)}</div>
                    <div class="item-meta">${item.quantity ? `Menge: ${escapeHtml(item.quantity)}` : 'Ohne Mengenangabe'}</div>
                </div>
                <button type="button" class="delete-btn" onclick="deleteItem(${item.id})">Löschen</button>
            </li>
        `).join('');
    }

    async function api(action, options = {}) {
        const response = await fetch(`api.php?action=${encodeURIComponent(action)}`, options);
        const payload = await response.json();

        if (!response.ok) {
            throw new Error(payload.error || 'Unbekannter Fehler');
        }

        return payload;
    }

    async function loadItems() {
        try {
            const payload = await api('list');
            state.items = payload.items || [];
            renderItems();
        } catch (error) {
            setMessage(error.message, true);
        }
    }

    async function addItem(event) {
        event.preventDefault();
        const formData = new FormData(itemForm);

        try {
            await api('add', {
                method: 'POST',
                body: new URLSearchParams(formData),
            });
            itemForm.reset();
            itemInput.focus();
            setMessage('Artikel gespeichert.');
            await loadItems();
        } catch (error) {
            setMessage(error.message, true);
        }
    }

    async function toggleItem(id, done) {
        try {
            await api(`toggle&id=${id}&done=${done}`);
            setMessage('Status aktualisiert.');
            await loadItems();
        } catch (error) {
            setMessage(error.message, true);
        }
    }

    async function deleteItem(id) {
        try {
            await api(`delete&id=${id}`);
            setMessage('Artikel gelöscht.');
            await loadItems();
        } catch (error) {
            setMessage(error.message, true);
        }
    }

    async function clearDone() {
        try {
            await api('clear');
            setMessage('Erledigte Artikel entfernt.');
            await loadItems();
        } catch (error) {
            setMessage(error.message, true);
        }
    }

    itemForm.addEventListener('submit', addItem);
    clearDoneBtn.addEventListener('click', clearDone);
    loadItems();

    window.toggleItem = toggleItem;
    window.deleteItem = deleteItem;
</script>
</body>
</html>
