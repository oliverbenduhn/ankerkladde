// Shared conflict-UI helpers for note + journal editors (both use note-conflict-* CSS).
// Sketch editor intentionally keeps its own builder: different CSS scope + SVG preview.

export function formatConflictTime(value) {
    if (!value) return '';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString();
}

export function buildNoteConflictVersion({
    className,
    label,
    version,
    actionLabel,
    onAction,
    headingTag = 'h3',
    includeTitle = false,
}) {
    const section = document.createElement('section');
    section.className = `note-conflict-version ${className}`;

    const heading = document.createElement(headingTag);
    heading.textContent = label;

    const timestamp = document.createElement('p');
    timestamp.className = 'note-conflict-timestamp';
    timestamp.textContent = formatConflictTime(version.updatedAt);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-add';
    button.textContent = actionLabel;
    button.addEventListener('click', () => void onAction());

    section.append(heading, timestamp);
    if (includeTitle) {
        const title = document.createElement('div');
        title.className = 'note-conflict-title';
        title.textContent = version.title || 'Ohne Titel';
        section.append(title);
    }
    const content = document.createElement('div');
    content.className = 'note-conflict-content';
    content.innerHTML = version.content || '';
    section.append(content, button);
    return section;
}
