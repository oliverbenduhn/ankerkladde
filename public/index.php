<?php
declare(strict_types=1);

require dirname(__DIR__) . '/security.php';

enforceCanonicalRequest();

$csrfToken = getCsrfToken();
$scriptName = $_SERVER['SCRIPT_NAME'] ?? '/index.php';
if (!is_string($scriptName) || $scriptName === '') {
    $scriptName = '/index.php';
}

$appBasePath = dirname(str_replace('\\', '/', $scriptName));
if ($appBasePath === '' || $appBasePath === '.') {
    $appBasePath = '/';
} else {
    $appBasePath = rtrim($appBasePath, '/') . '/';
}
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#f5f0eb">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="app-base-path" content="<?= htmlspecialchars($appBasePath, ENT_QUOTES, 'UTF-8') ?>">
    <meta name="csrf-token" content="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
    <link rel="manifest" href="manifest.php">
    <link rel="stylesheet" href="style.css">
    <title>Zettel</title>
</head>
<body>
<div class="app" id="app" data-mode="einkaufen">

    <div class="install-banner" id="installBanner" hidden>
        <span class="install-text">App installieren?</span>
        <button type="button" id="installBtn" class="btn-install">Installieren</button>
        <button type="button" id="installDismiss" class="btn-install-dismiss" aria-label="Schließen">✕</button>
    </div>

    <div class="status-banner" id="networkStatus" hidden aria-live="polite"></div>

    <div class="update-banner" id="updateBanner" hidden>
        <span class="update-text">Neue Version verfügbar.</span>
        <button type="button" id="updateReloadBtn" class="btn-update-reload">Neu laden</button>
    </div>

    <nav class="section-tabs" id="sectionTabs" aria-label="Bereich wählen">
        <button class="section-tab" data-section="shopping" aria-current="page">
            <span class="section-icon" aria-hidden="true">🛒</span>
            <span class="section-label">Einkauf</span>
        </button>
        <button class="section-tab" data-section="meds">
            <span class="section-icon" aria-hidden="true">💊</span>
            <span class="section-label">Medizin</span>
        </button>
        <button class="section-tab" data-section="todo_private">
            <span class="section-icon" aria-hidden="true">✅</span>
            <span class="section-label">Privat</span>
        </button>
        <button class="section-tab" data-section="todo_work">
            <span class="section-icon" aria-hidden="true">💼</span>
            <span class="section-label">Arbeit</span>
        </button>
        <button class="section-tab" data-section="notes">
            <span class="section-icon" aria-hidden="true">📝</span>
            <span class="section-label">Notizen</span>
        </button>
        <button class="section-tab" data-section="images">
            <span class="section-icon" aria-hidden="true">🖼️</span>
            <span class="section-label">Bilder</span>
        </button>
        <button class="section-tab" data-section="files">
            <span class="section-icon" aria-hidden="true">📁</span>
            <span class="section-label">Dateien</span>
        </button>
    </nav>

    <header class="app-header liste-only">
        <h1 class="app-title" id="titleListe">Einkaufsliste</h1>
        <button type="button" class="btn-mode-toggle" data-nav="einkaufen" aria-label="Einkaufs-Modus starten">🛒</button>
    </header>

    <header class="app-header shopping-only">
        <h1 class="app-title" id="titleShopping">Einkaufen</h1>
        <span class="progress" id="progress" aria-live="polite">0 / 0</span>
        <button type="button" class="btn-mode-toggle" data-nav="liste" aria-label="Liste bearbeiten">✏️</button>
    </header>

    <section class="input-area liste-only" id="inputArea">
        <form id="itemForm" novalidate>
            <input type="text" id="itemInput" name="name"
                   placeholder="Artikel..." maxlength="120"
                   autocomplete="off" enterkeyhint="done" required>
            <input type="text" id="quantityInput" name="quantity"
                   placeholder="Menge" maxlength="40" autocomplete="off" enterkeyhint="done">
            <button type="submit" class="btn-add" aria-label="Artikel hinzufügen">+</button>
        </form>
    </section>

    <main class="list-area">
        <ul id="list" aria-label="Einkaufsliste"></ul>
        <button type="button" class="btn-clear liste-only"
                id="clearDoneBtn" disabled>Erledigte löschen</button>
    </main>

    <div class="message" id="message" role="status" aria-live="polite"></div>

</div>

<script src="app.js"></script>
</body>
</html>
