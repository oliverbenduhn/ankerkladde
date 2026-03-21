<?php
declare(strict_types=1);

require dirname(__DIR__) . '/security.php';

startAppSession();
$csrfToken = getCsrfToken();
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#f5f0eb">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="csrf-token" content="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
    <link rel="manifest" href="/manifest.json">
    <link rel="stylesheet" href="/style.css">
    <title>Einkaufsliste</title>
</head>
<body>
<div class="app" id="app" data-mode="liste">

    <header class="app-header liste-only">
        <h1 class="app-title">Einkaufsliste</h1>
    </header>

    <header class="app-header shopping-only">
        <h1 class="app-title">Einkaufen</h1>
        <span class="progress" id="progress" aria-live="polite">0 / 0</span>
    </header>

    <section class="input-area liste-only" id="inputArea">
        <form id="itemForm" novalidate>
            <input type="text" id="itemInput" name="name"
                   placeholder="Artikel..." maxlength="120"
                   autocomplete="off" required>
            <input type="text" id="quantityInput" name="quantity"
                   placeholder="Menge" maxlength="40" autocomplete="off">
            <button type="submit" class="btn-add" aria-label="Artikel hinzufügen">+</button>
        </form>
    </section>

    <main class="list-area">
        <ul id="list" aria-live="polite" aria-label="Einkaufsliste"></ul>
        <button type="button" class="btn-clear liste-only"
                id="clearDoneBtn" disabled>Erledigte löschen</button>
    </main>

    <div class="message" id="message" role="status" aria-live="polite"></div>

    <nav class="bottom-nav" aria-label="Hauptnavigation">
        <button class="nav-btn" data-nav="liste"
                aria-current="page" aria-label="Listen-Modus">
            <span class="nav-icon" aria-hidden="true">✏️</span>
            <span class="nav-label">Liste</span>
        </button>
        <button class="nav-btn" data-nav="einkaufen"
                aria-label="Einkaufs-Modus">
            <span class="nav-icon" aria-hidden="true">🛒</span>
            <span class="nav-label">Einkaufen</span>
        </button>
    </nav>
</div>

<script src="/app.js"></script>
<script>
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }
</script>
</body>
</html>
