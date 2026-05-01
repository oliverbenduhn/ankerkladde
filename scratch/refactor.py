import sys

def refactor():
    with open('/home/oliver/Dokumente/ankerkladde/public/settings.php', 'r') as f:
        lines = f.readlines()

    out = []
    for i, line in enumerate(lines):
        if line.startswith("require __DIR__ . '/theme.php';"):
            out.append(line)
            out.append("require dirname(__DIR__) . '/src/SettingsController.php';\n")
            continue
        
        # We replace the functions and the POST block
        if 26 <= i <= 529:
            if i == 26:
                replacement = """if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $controller = new SettingsController($db, $userId);
    $result = $controller->handlePostRequest($_POST, $passwordChangeRequired, $geminiModels);
    
    $flash = $result['flash'];
    $flashType = $result['flashType'];
    $aiKeyStatus = $result['aiKeyStatus'];
    $aiKeyStatusType = $result['aiKeyStatusType'];

    if (wantsJsonResponse()) {
        $jsonPreferences = getExtendedUserPreferences($db, $userId);
        sendJsonResponse([
            'ok' => $flashType !== 'err',
            'flash' => $flash,
            'flash_type' => $flashType,
            'preferences' => [
                'theme_mode' => $jsonPreferences['theme_mode'] ?? 'auto',
                'light_theme' => $jsonPreferences['light_theme'] ?? 'hafenblau',
                'dark_theme' => $jsonPreferences['dark_theme'] ?? 'nachtwache',
                'product_scanner_enabled' => !array_key_exists('product_scanner_enabled', $jsonPreferences) || !empty($jsonPreferences['product_scanner_enabled']),
                'shopping_list_scanner_enabled' => !array_key_exists('shopping_list_scanner_enabled', $jsonPreferences) || !empty($jsonPreferences['shopping_list_scanner_enabled']),
                'magic_button_enabled' => !array_key_exists('magic_button_enabled', $jsonPreferences) || !empty($jsonPreferences['magic_button_enabled']),
                'category_swipe_enabled' => !array_key_exists('category_swipe_enabled', $jsonPreferences) || !empty($jsonPreferences['category_swipe_enabled']),
            ],
        ], $flashType === 'err' ? 400 : 200);
    } else {
        $_SESSION['settings_flash'] = $flash;
        $_SESSION['settings_flash_type'] = $flashType;

        $redirectTab = $_GET['tab'] ?? ($passwordChangeRequired ? 'password' : 'app');
        $redirectEmbedded = isset($_GET['embed']) && $_GET['embed'] === '1';
        $redirectUrl = appPath('settings.php' . ($redirectEmbedded ? '?embed=1&tab=' . rawurlencode((string) $redirectTab) : ''));
        header('Location: ' . $redirectUrl);
        exit;
    }
}
"""
                out.append(replacement)
            continue
            
        out.append(line)

    with open('/home/oliver/Dokumente/ankerkladde/public/settings.php', 'w') as f:
        f.writelines(out)

if __name__ == '__main__':
    refactor()
