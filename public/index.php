<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';
require __DIR__ . '/theme.php';

enforceCanonicalRequest();
sendHtmlPageSecurityHeaders(allowEsmSh: true); // TipTap is loaded from esm.sh
$userId = requireAuth();

$db = getDatabase();
$csrfToken = getCsrfToken();
$userPreferences = getExtendedUserPreferences($db, $userId);
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
$assetVersion = require __DIR__ . '/version.php';

function getIconPaths(): array
{
    static $paths = [
        'menu' => '<g fill="none"><path d="M2.753 18h18.5a.75.75 0 0 1 .101 1.493l-.101.007h-18.5a.75.75 0 0 1-.102-1.494L2.753 18h18.5h-18.5zm0-6.497h18.5a.75.75 0 0 1 .101 1.493l-.101.007h-18.5a.75.75 0 0 1-.102-1.494l.102-.006h18.5h-18.5zm-.001-6.5h18.5a.75.75 0 0 1 .102 1.493l-.102.007h-18.5A.75.75 0 0 1 2.65 5.01l.102-.007h18.5h-18.5z" fill="currentColor" /></g>',
        'search' => '<g fill="none"><path d="M10 2.75a7.25 7.25 0 0 1 5.63 11.819l4.9 4.9a.75.75 0 0 1-.976 1.134l-.084-.073l-4.901-4.9A7.25 7.25 0 1 1 10 2.75zm0 1.5a5.75 5.75 0 1 0 0 11.5a5.75 5.75 0 0 0 0-11.5z" fill="currentColor" /></g>',
        'settings' => '<g fill="none"><path d="M12.013 2.25c.734.008 1.465.093 2.181.253a.75.75 0 0 1 .582.649l.17 1.527a1.384 1.384 0 0 0 1.928 1.116l1.4-.615a.75.75 0 0 1 .85.174a9.793 9.793 0 0 1 2.204 3.792a.75.75 0 0 1-.271.825l-1.242.916a1.38 1.38 0 0 0 .001 2.226l1.243.915a.75.75 0 0 1 .271.826a9.798 9.798 0 0 1-2.203 3.792a.75.75 0 0 1-.849.175l-1.406-.617a1.38 1.38 0 0 0-1.927 1.114l-.169 1.526a.75.75 0 0 1-.572.647a9.518 9.518 0 0 1-4.405 0a.75.75 0 0 1-.572-.647l-.17-1.524a1.382 1.382 0 0 0-1.924-1.11l-1.407.616a.75.75 0 0 1-.849-.175a9.798 9.798 0 0 1-2.203-3.796a.75.75 0 0 1 .271-.826l1.244-.916a1.38 1.38 0 0 0 0-2.226l-1.243-.914a.75.75 0 0 1-.272-.826a9.793 9.793 0 0 1 2.205-3.792a.75.75 0 0 1 .849-.174l1.4.615a1.387 1.387 0 0 0 1.93-1.118l.17-1.526a.75.75 0 0 1 .583-.65c.718-.159 1.45-.243 2.202-.252zm0 1.5a9.135 9.135 0 0 0-1.355.117l-.109.977A2.886 2.886 0 0 1 6.525 7.17l-.898-.394a8.293 8.293 0 0 0-1.348 2.317l.798.587a2.881 2.881 0 0 1 0 4.643l-.798.588c.32.842.775 1.626 1.347 2.322l.906-.397a2.882 2.882 0 0 1 4.017 2.318l.108.984c.89.15 1.799.15 2.689 0l.108-.984a2.88 2.88 0 0 1 4.02-2.322l.904.396a8.299 8.299 0 0 0 1.347-2.318l-.798-.588a2.88 2.88 0 0 1 0-4.643l.796-.587a8.293 8.293 0 0 0-1.348-2.317l-.896.393a2.884 2.884 0 0 1-4.023-2.324l-.11-.976a8.99 8.99 0 0 0-1.333-.117zM12 8.25a3.75 3.75 0 1 1 0 7.5a3.75 3.75 0 0 1 0-7.5zm0 1.5a2.25 2.25 0 1 0 0 4.5a2.25 2.25 0 0 0 0-4.5z" fill="currentColor" /></g>',
        'theme-auto' => '<g fill="none"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12s4.477 10 10 10zm0-1.5v-17a8.5 8.5 0 0 1 0 17z" fill="currentColor" /></g>',
        'theme-light' => '<g fill="none"><path d="M12 2a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 12 2zm0 15a5 5 0 1 0 0-10a5 5 0 0 0 0 10zm0-1.5a3.5 3.5 0 1 1 0-7a3.5 3.5 0 0 1 0 7zm9.25-2.75a.75.75 0 0 0 0-1.5h-1.5a.75.75 0 0 0 0 1.5h1.5zM12 19a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 12 19zm-7.75-6.25a.75.75 0 0 0 0-1.5h-1.5a.75.75 0 0 0 0 1.5h1.5zm-.03-8.53a.75.75 0 0 1 1.06 0l1.5 1.5a.75.75 0 0 1-1.06 1.06l-1.5-1.5a.75.75 0 0 1 0-1.06zm1.06 15.56a.75.75 0 1 1-1.06-1.06l1.5-1.5a.75.75 0 1 1 1.06 1.06l-1.5 1.5zm14.5-15.56a.75.75 0 0 0-1.06 0l-1.5 1.5a.75.75 0 0 0 1.06 1.06l1.5-1.5a.75.75 0 0 0 0-1.06zm-1.06 15.56a.75.75 0 1 0 1.06-1.06l-1.5-1.5a.75.75 0 1 0-1.06 1.06l1.5 1.5z" fill="currentColor" /></g>',
        'theme-dark' => '<g fill="none"><path d="M20.026 17.001c-2.762 4.784-8.879 6.423-13.663 3.661A9.965 9.965 0 0 1 3.13 17.68a.75.75 0 0 1 .365-1.132c3.767-1.348 5.785-2.91 6.956-5.146c1.232-2.353 1.551-4.93.689-8.463a.75.75 0 0 1 .769-.927a9.961 9.961 0 0 1 4.457 1.327c4.784 2.762 6.423 8.879 3.66 13.662zm-8.248-4.903c-1.25 2.389-3.31 4.1-6.817 5.499a8.49 8.49 0 0 0 2.152 1.766a8.502 8.502 0 0 0 8.502-14.725a8.484 8.484 0 0 0-2.792-1.015c.647 3.384.23 6.043-1.045 8.475z" fill="currentColor" /></g>',
        'eye' => '<g fill="none"><path d="M12 9.005a4 4 0 1 1 0 8a4 4 0 0 1 0-8zm0 1.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5zM12 5.5c4.613 0 8.596 3.15 9.701 7.564a.75.75 0 1 1-1.455.365a8.504 8.504 0 0 0-16.493.004a.75.75 0 0 1-1.456-.363A10.003 10.003 0 0 1 12 5.5z" fill="currentColor" /></g>',
        'pencil' => '<g fill="none"><path d="M21.03 2.97a3.578 3.578 0 0 1 0 5.06L9.062 20a2.25 2.25 0 0 1-.999.58l-5.116 1.395a.75.75 0 0 1-.92-.921l1.395-5.116a2.25 2.25 0 0 1 .58-.999L15.97 2.97a3.578 3.578 0 0 1 5.06 0zM15 6.06L5.062 16a.75.75 0 0 0-.193.333l-1.05 3.85l3.85-1.05A.75.75 0 0 0 8 18.938L17.94 9L15 6.06zm2.03-2.03l-.97.97L19 7.94l.97-.97a2.079 2.079 0 0 0-2.94-2.94z" fill="currentColor" /></g>',
        'camera' => '<g fill="none"><path d="M13.925 2.504a2.25 2.25 0 0 1 1.94 1.11l.814 1.387h2.071A3.25 3.25 0 0 1 22 8.25v9.5A3.25 3.25 0 0 1 18.75 21H5.25A3.25 3.25 0 0 1 2 17.75v-9.5A3.25 3.25 0 0 1 5.25 5h2.08l.875-1.424a2.25 2.25 0 0 1 1.917-1.073h3.803zm0 1.5h-3.803a.75.75 0 0 0-.574.268l-.065.09L8.39 6.142a.75.75 0 0 1-.639.358h-2.5A1.75 1.75 0 0 0 3.5 8.25v9.5c0 .966.784 1.75 1.75 1.75h13.5a1.75 1.75 0 0 0 1.75-1.75v-9.5a1.75 1.75 0 0 0-1.75-1.75h-2.5a.75.75 0 0 1-.647-.37l-1.032-1.757a.75.75 0 0 0-.646-.37zM12 8a4.5 4.5 0 1 1 0 9a4.5 4.5 0 0 1 0-9zm0 1.5a3 3 0 1 0 0 6a3 3 0 0 0 0-6z" fill="currentColor" /></g>',
        'scan' => '<g fill="none"><path d="M3 6.25A3.25 3.25 0 0 1 6.25 3h2a.75.75 0 0 1 0 1.5h-2A1.75 1.75 0 0 0 4.5 6.25v2a.75.75 0 0 1-1.5 0v-2zm12-2.5a.75.75 0 0 1 .75-.75h2A3.25 3.25 0 0 1 21 6.25v2a.75.75 0 0 1-1.5 0v-2a1.75 1.75 0 0 0-1.75-1.75h-2a.75.75 0 0 1-.75-.75zM3.75 15a.75.75 0 0 1 .75.75v2c0 .966.784 1.75 1.75 1.75h2a.75.75 0 0 1 0 1.5h-2A3.25 3.25 0 0 1 3 17.75v-2a.75.75 0 0 1 .75-.75zm16.5 0a.75.75 0 0 1 .75.75v2A3.25 3.25 0 0 1 17.75 21h-2a.75.75 0 0 1 0-1.5h2a1.75 1.75 0 0 0 1.75-1.75v-2a.75.75 0 0 1 .75-.75zM12 13a1 1 0 1 0 0-2a1 1 0 0 0 0 2zm-1.152-6c-.473 0-.906.263-1.118.678L9.242 9h-.575C7.747 9 7 9.596 7 10.5v3.864C7 15.267 7.746 16 8.667 16h6.666c.92 0 1.667-.733 1.667-1.636V10.5c0-.904-.746-1.5-1.667-1.5h-.575l-.488-1.322A1.253 1.253 0 0 0 13.152 7h-2.304zM12 14a2 2 0 1 1 0-4a2 2 0 0 1 0 4z" fill="currentColor" /></g>',
        'scan-info' => '<g fill="none"><path d="M2 5.75A2.75 2.75 0 0 1 4.75 3h1.5a.75.75 0 0 1 0 1.5h-1.5c-.69 0-1.25.56-1.25 1.25v1.5a.75.75 0 0 1-1.5 0v-1.5zm15-2a.75.75 0 0 1 .75-.75h1.5A2.75 2.75 0 0 1 22 5.75v1.5a.75.75 0 0 1-1.5 0v-1.5c0-.69-.56-1.25-1.25-1.25h-1.5a.75.75 0 0 1-.75-.75zM2.75 16a.75.75 0 0 1 .75.75v1.5c0 .69.56 1.25 1.25 1.25h1.5a.75.75 0 0 1 0 1.5h-1.5A2.75 2.75 0 0 1 2 18.25v-1.5a.75.75 0 0 1 .75-.75zm18.5 0a.75.75 0 0 1 .75.75v1.5A2.75 2.75 0 0 1 19.25 21h-1.5a.75.75 0 0 1 0-1.5h1.5c.69 0 1.25-.56 1.25-1.25v-1.5a.75.75 0 0 1 .75-.75zM5.75 7a.75.75 0 0 1 .75.75v8.5a.75.75 0 0 1-1.5 0v-8.5A.75.75 0 0 1 5.75 7zm4.75.75a.75.75 0 0 0-1.5 0v8.5a.75.75 0 0 0 1.5 0v-8.5zM13.75 7a.75.75 0 0 1 .75.75v8.5a.75.75 0 0 1-1.5 0v-8.5a.75.75 0 0 1 .75-.75zm4.75.75a.75.75 0 0 0-1.5 0v8.5a.75.75 0 0 0 1.5 0v-8.5z" fill="currentColor" /></g>',
        'x' => '<g fill="none"><path d="M4.397 4.554l.073-.084a.75.75 0 0 1 .976-.073l.084.073L12 10.939l6.47-6.47a.75.75 0 1 1 1.06 1.061L13.061 12l6.47 6.47a.75.75 0 0 1 .072.976l-.073.084a.75.75 0 0 1-.976.073l-.084-.073L12 13.061l-6.47 6.47a.75.75 0 0 1-1.06-1.061L10.939 12l-6.47-6.47a.75.75 0 0 1-.072-.976l.073-.084l-.073.084z" fill="currentColor" /></g>',
        'plus' => '<g fill="none"><path d="M11.75 3a.75.75 0 0 1 .743.648l.007.102l.001 7.25h7.253a.75.75 0 0 1 .102 1.493l-.102.007h-7.253l.002 7.25a.75.75 0 0 1-1.493.101l-.007-.102l-.002-7.249H3.752a.75.75 0 0 1-.102-1.493L3.752 11h7.25L11 3.75a.75.75 0 0 1 .75-.75z" fill="currentColor" /></g>',
        'link' => '<g fill="none"><path d="M9.25 7a.75.75 0 0 1 .11 1.492l-.11.008H7a3.5 3.5 0 0 0-.206 6.994L7 15.5h2.25a.75.75 0 0 1 .11 1.492L9.25 17H7a5 5 0 0 1-.25-9.994L7 7h2.25zM17 7a5 5 0 0 1 .25 9.994L17 17h-2.25a.75.75 0 0 1-.11-1.492l.11-.008H17a3.5 3.5 0 0 0 .206-6.994L17 8.5h-2.25a.75.75 0 0 1-.11-1.492L14.75 7H17zM7 11.25h10a.75.75 0 0 1 .102 1.493L17 12.75H7a.75.75 0 0 1-.102-1.493L7 11.25h10H7z" fill="currentColor" /></g>',
        'arrow-left' => '<g fill="none"><path d="M10.733 19.79a.75.75 0 0 0 1.034-1.086L5.516 12.75H20.25a.75.75 0 0 0 0-1.5H5.516l6.251-5.955a.75.75 0 0 0-1.034-1.086l-7.42 7.067a.995.995 0 0 0-.3.58a.754.754 0 0 0 .001.289a.995.995 0 0 0 .3.579l7.419 7.067z" fill="currentColor" /></g>',
        'panel-bottom' => '<g fill="none"><path d="M6.25 3A3.25 3.25 0 0 0 3 6.25v11.5A3.25 3.25 0 0 0 6.25 21h11.5A3.25 3.25 0 0 0 21 17.75V6.25A3.25 3.25 0 0 0 17.75 3H6.25zM4.5 6.25c0-.966.784-1.75 1.75-1.75h11.5c.966 0 1.75.784 1.75 1.75v11.5a1.75 1.75 0 0 1-1.75 1.75H14.5v-1.75a2.25 2.25 0 0 0-2.25-2.25H4.5V6.25zM4.5 17h7.75a.75.75 0 0 1 .75.75v1.75H6.25a1.75 1.75 0 0 1-1.75-1.75V17z" fill="currentColor" /></g>',
        'sparkles' => '<g fill="none"><path d="M8.664 15.735c.245.173.537.265.836.264v-.004a1.442 1.442 0 0 0 1.327-.872l.613-1.864a2.872 2.872 0 0 1 1.817-1.812l1.778-.578a1.442 1.442 0 0 0-.052-2.74l-1.755-.57a2.876 2.876 0 0 1-1.822-1.823l-.578-1.777a1.446 1.446 0 0 0-2.732.022l-.583 1.792a2.877 2.877 0 0 1-1.77 1.786l-1.777.57a1.444 1.444 0 0 0 .017 2.735l1.754.569a2.887 2.887 0 0 1 1.822 1.826l.578 1.775c.099.283.283.527.527.7zm-.374-4.25a4.054 4.054 0 0 0-.363-.413h.003a4.393 4.393 0 0 0-1.72-1.063L4.61 9.5l1.611-.524a4.4 4.4 0 0 0 1.69-1.065a4.448 4.448 0 0 0 1.041-1.708l.515-1.582l.516 1.587a4.374 4.374 0 0 0 2.781 2.773l1.62.522l-1.59.515a4.379 4.379 0 0 0-2.774 2.775l-.515 1.582l-.515-1.585a4.368 4.368 0 0 0-.7-1.306zm8.041 9.297a1.123 1.123 0 0 1-.41-.55l-.328-1.006a1.292 1.292 0 0 0-.821-.823l-.991-.323A1.148 1.148 0 0 1 13 16.997a1.143 1.143 0 0 1 .771-1.08l1.006-.326a1.3 1.3 0 0 0 .8-.82l.324-.991a1.143 1.143 0 0 1 2.157-.021l.329 1.014a1.3 1.3 0 0 0 .82.816l.992.323a1.141 1.141 0 0 1 .039 2.165l-1.014.329a1.3 1.3 0 0 0-.818.822l-.322.989c-.078.23-.226.43-.425.57a1.14 1.14 0 0 1-1.328-.005zm-1.03-3.783A2.79 2.79 0 0 1 17 18.708a2.793 2.793 0 0 1 1.7-1.7a2.813 2.813 0 0 1-1.718-1.708a2.808 2.808 0 0 1-1.682 1.699z" fill="currentColor" /></g>',
        'mic' => '<g fill="none"><path d="M18.25 11a.75.75 0 0 1 .743.648l.007.102v.5a6.75 6.75 0 0 1-6.249 6.732l-.001 2.268a.75.75 0 0 1-1.493.102l-.007-.102v-2.268a6.75 6.75 0 0 1-6.246-6.496L5 12.25v-.5a.75.75 0 0 1 1.493-.102l.007.102v.5a5.25 5.25 0 0 0 5.034 5.246l.216.004h.5a5.25 5.25 0 0 0 5.246-5.034l.004-.216v-.5a.75.75 0 0 1 .75-.75zM12 2a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4zm0 1.5A2.5 2.5 0 0 0 9.5 6v6a2.5 2.5 0 0 0 5 0V6A2.5 2.5 0 0 0 12 3.5z" fill="currentColor" /></g>',
        'pin' => '<g fill="none"><path d="M16.242 2.932l4.826 4.826a2.75 2.75 0 0 1-.715 4.404l-4.87 2.435a.75.75 0 0 0-.374.426l-1.44 4.166a1.25 1.25 0 0 1-2.065.476L8.5 16.561L4.06 21H3v-1.062L7.44 15.5l-3.105-3.104a1.25 1.25 0 0 1 .476-2.066l4.166-1.439a.75.75 0 0 0 .426-.374l2.435-4.87a2.75 2.75 0 0 1 4.405-.715zm3.766 5.886l-4.826-4.825a1.25 1.25 0 0 0-2.002.324l-2.435 4.871a2.25 2.25 0 0 1-1.278 1.12l-3.789 1.31l6.705 6.704l1.308-3.788a2.25 2.25 0 0 1 1.12-1.278l4.872-2.436a1.25 1.25 0 0 0 .325-2.002z" fill="currentColor" /></g>',
        'check' => '<g fill="none"><path d="M4.53 12.97a.75.75 0 0 0-1.06 1.06l4.5 4.5a.75.75 0 0 0 1.06 0l11-11a.75.75 0 0 0-1.06-1.06L8.5 16.94l-3.97-3.97z" fill="currentColor" /></g>',
        'rotate-ccw' => '<g fill="none"><path d="M12 4.5a7.5 7.5 0 1 1-7.419 6.392c.067-.454-.265-.892-.724-.892a.749.749 0 0 0-.752.623A9 9 0 1 0 6 5.292V4.25a.75.75 0 0 0-1.5 0v3c0 .414.336.75.75.75h3a.75.75 0 0 0 0-1.5H6.9a7.473 7.473 0 0 1 5.1-2z" fill="currentColor" /></g>',
        'grip' => '<g fill="none"><path d="M15.5 17a1.5 1.5 0 1 1 0 3a1.5 1.5 0 0 1 0-3zm-7 0a1.5 1.5 0 1 1 0 3a1.5 1.5 0 0 1 0-3zm7-7a1.5 1.5 0 1 1 0 3a1.5 1.5 0 0 1 0-3zm-7 0a1.5 1.5 0 1 1 0 3a1.5 1.5 0 0 1 0-3zm7-7a1.5 1.5 0 1 1 0 3a1.5 1.5 0 0 1 0-3zm-7 0a1.5 1.5 0 1 1 0 3a1.5 1.5 0 0 1 0-3z" fill="currentColor" /></g>',
        'more-horizontal' => '<g fill="none"><path d="M7.75 12a1.75 1.75 0 1 1-3.5 0a1.75 1.75 0 0 1 3.5 0zm6 0a1.75 1.75 0 1 1-3.5 0a1.75 1.75 0 0 1 3.5 0zM18 13.75a1.75 1.75 0 1 0 0-3.5a1.75 1.75 0 0 0 0 3.5z" fill="currentColor" /></g>',
        'circle' => '<g fill="none"><path d="M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 0 0 0-17zM2 12C2 6.477 6.477 2 12 2s10 4.477 10 10s-4.477 10-10 10S2 17.523 2 12z" fill="currentColor" /></g>',
        'play' => '<g fill="none"><path d="M7.608 4.615a.75.75 0 0 0-1.108.659v13.452a.75.75 0 0 0 1.108.659l12.362-6.726a.75.75 0 0 0 0-1.318L7.608 4.615zM5 5.274c0-1.707 1.826-2.792 3.325-1.977l12.362 6.726c1.566.853 1.566 3.101 0 3.953L8.325 20.702C6.826 21.518 5 20.432 5 18.726V5.274z" fill="currentColor" /></g>',
        'clock' => '<g fill="none"><path d="M12 2c5.523 0 10 4.478 10 10s-4.477 10-10 10S2 17.522 2 12S6.477 2 12 2zm0 1.667c-4.595 0-8.333 3.738-8.333 8.333c0 4.595 3.738 8.333 8.333 8.333c4.595 0 8.333-3.738 8.333-8.333c0-4.595-3.738-8.333-8.333-8.333zM11.25 6a.75.75 0 0 1 .743.648L12 6.75V12h3.25a.75.75 0 0 1 .102 1.493l-.102.007h-4a.75.75 0 0 1-.743-.648l-.007-.102v-6a.75.75 0 0 1 .75-.75z" fill="currentColor" /></g>',
    ];

    return $paths;
}

function icon(string $name): string {
    $path = getIconPaths()[$name] ?? '';

    return '<svg class="icon icon-filled" viewBox="0 0 24 24" aria-hidden="true">' . $path . '</svg>';
}
?>
<?php
$effectiveTheme = resolveEffectiveTheme($userPreferences);
$themeColor = getThemeColor($effectiveTheme);
$brandMarkSrc = 'icon.php?size=96&theme=' . rawurlencode($effectiveTheme) . '&v=' . rawurlencode($assetVersion);
$productScannerEnabled = !array_key_exists('product_scanner_enabled', $userPreferences) || !empty($userPreferences['product_scanner_enabled']);
$shoppingListScannerEnabled = !array_key_exists('shopping_list_scanner_enabled', $userPreferences) || !empty($userPreferences['shopping_list_scanner_enabled']);
$magicButtonEnabled = !array_key_exists('magic_button_enabled', $userPreferences) || !empty($userPreferences['magic_button_enabled']);
$initialMode = ($userPreferences['mode'] ?? 'liste') === 'einkaufen' ? 'einkaufen' : 'liste';
$clientWebSocketUrl = getenv('ANKERKLADDE_WS_CLIENT_URL');
$clientWebSocketUrl = is_string($clientWebSocketUrl) ? trim($clientWebSocketUrl) : '';
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="<?= htmlspecialchars($themeColor, ENT_QUOTES, 'UTF-8') ?>">
    <?= renderThemeBootScript($userPreferences) ?>
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="apple-mobile-web-app-title" content="Ankerkladde">
    <meta name="app-base-path" content="<?= htmlspecialchars($appBasePath, ENT_QUOTES, 'UTF-8') ?>">
    <meta name="csrf-token" content="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
    <meta name="user-id" content="<?= htmlspecialchars((string)$userId, ENT_QUOTES, 'UTF-8') ?>">
    <?php if ($clientWebSocketUrl !== ''): ?>
    <meta name="websocket-url" content="<?= htmlspecialchars($clientWebSocketUrl, ENT_QUOTES, 'UTF-8') ?>">
    <?php endif; ?>
    <link rel="manifest" href="manifest.php?v=<?= urlencode($assetVersion) ?>">
    <link rel="icon" type="image/png" href="icon.php?size=96&v=<?= urlencode($assetVersion) ?>">
    <link rel="apple-touch-icon" href="icon.php?size=180&v=<?= urlencode($assetVersion) ?>">
    <link rel="stylesheet" href="theme-css.php">
    <link rel="stylesheet" href="style.css?v=<?= urlencode($assetVersion) ?>">
    <title>Ankerkladde</title>
</head>
<body data-theme="<?= htmlspecialchars($effectiveTheme, ENT_QUOTES, 'UTF-8') ?>">
<div class="app" id="app" data-mode="<?= htmlspecialchars($initialMode, ENT_QUOTES, 'UTF-8') ?>">

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

    <header class="app-header liste-only">
        <div class="app-title-group clickable-brand">
            <img src="<?= htmlspecialchars($brandMarkSrc, ENT_QUOTES, 'UTF-8') ?>" alt="" class="brand-mark brand-mark-app" aria-hidden="true">
            <div class="app-title-stack">
                <h1 class="app-title">Ankerkladde</h1>
                <div class="app-subtitle" id="titleListe">Listen</div>
            </div>
        </div>
        <div class="header-actions">
            <button type="button" id="tabsToggleBtn" class="header-icon-btn btn-tabs-toggle" aria-label="Kategorienleiste ein-/ausblenden"><?= icon('panel-bottom') ?></button>
            <a href="<?= htmlspecialchars(appPath('barcode.php'), ENT_QUOTES, 'UTF-8') ?>" class="header-icon-btn" aria-label="Produktinfos per Scan öffnen"<?= !$productScannerEnabled ? ' hidden' : '' ?>><?= icon('scan-info') ?></a>
            <button type="button" id="searchBtn" class="header-icon-btn btn-search" aria-label="Suchen"><?= icon('search') ?></button>
            <button type="button" id="magicBtn" class="header-icon-btn btn-magic" aria-label="KI-Assistent"<?= !$magicButtonEnabled ? ' hidden' : '' ?>><?= icon('sparkles') ?></button>
            <a href="<?= htmlspecialchars(appPath('index.php?view=settings'), ENT_QUOTES, 'UTF-8') ?>" class="header-icon-btn btn-settings" data-settings-tab="app" aria-label="Einstellungen"><?= icon('settings') ?></a>
            <button type="button" class="header-icon-btn btn-mode-toggle" data-nav="einkaufen" aria-label="Einkaufs-Modus starten"><?= icon('eye') ?></button>
        </div>
    </header>

    <div class="search-bar liste-only" id="searchBar" hidden>
        <input type="search" id="searchInput" class="search-input"
               placeholder="In allen Bereichen suchen…" aria-label="In allen Bereichen suchen"
               autocomplete="off" enterkeyhint="search" maxlength="120">
    </div>

    <div class="magic-bar" id="magicBar" hidden>
        <div class="magic-bar-inner">
            <button type="button" id="magicVoiceBtn" class="btn-magic-voice" aria-label="Spracheingabe"><?= icon('mic') ?></button>
            <input type="text" id="magicInput" class="magic-input"
                   placeholder="KI-Befehl (z.B. 'Zutaten für Lasagne')" aria-label="KI-Befehl"
                   autocomplete="off" enterkeyhint="go">
            <button type="button" id="magicSubmit" class="btn-magic-submit" aria-label="KI ausführen"><?= icon('sparkles') ?></button>
        </div>
        <button type="button" id="magicClose" class="btn-search-close" aria-label="Schließen"><?= icon('x') ?></button>
    </div>

    <header class="app-header shopping-only">
        <div class="app-title-group clickable-brand">
            <img src="<?= htmlspecialchars($brandMarkSrc, ENT_QUOTES, 'UTF-8') ?>" alt="" class="brand-mark brand-mark-app" aria-hidden="true">
            <div class="app-title-stack">
                <h1 class="app-title">Ankerkladde</h1>
                <div class="app-subtitle" id="titleShopping">Einkaufen</div>
            </div>
        </div>
        <div class="header-actions">
            <span class="progress" id="progress" aria-live="polite">0 / 0</span>
            <button type="button" class="header-icon-btn btn-tabs-toggle" aria-label="Kategorienleiste ein-/ausblenden"><?= icon('panel-bottom') ?></button>
            <a href="<?= htmlspecialchars(appPath('barcode.php'), ENT_QUOTES, 'UTF-8') ?>" class="header-icon-btn" aria-label="Produktinfos per Scan öffnen"<?= !$productScannerEnabled ? ' hidden' : '' ?>><?= icon('scan-info') ?></a>
            <button type="button" id="scanShoppingBtn" class="header-icon-btn btn-scan shopping-only" aria-label="Barcode scannen"<?= !$shoppingListScannerEnabled ? ' hidden' : '' ?>><?= icon('scan') ?></button>
            <button type="button" class="header-icon-btn btn-magic" id="magicBtnShopping" aria-label="KI-Assistent"<?= !$magicButtonEnabled ? ' hidden' : '' ?>><?= icon('sparkles') ?></button>
            <a href="<?= htmlspecialchars(appPath('index.php?view=settings'), ENT_QUOTES, 'UTF-8') ?>" class="header-icon-btn btn-settings" data-settings-tab="app" aria-label="Einstellungen"><?= icon('settings') ?></a>
            <button type="button" class="header-icon-btn btn-mode-toggle" data-nav="liste" aria-label="Liste bearbeiten"><?= icon('pencil') ?></button>
        </div>
    </header>

    <section class="input-area liste-only" id="inputArea">
        <form id="itemForm" novalidate>
            <textarea id="itemInput" name="name"
                      placeholder="Artikel..." aria-label="Artikel" maxlength="120"
                      autocomplete="off" enterkeyhint="done" rows="3" required></textarea>
            <textarea id="linkDescriptionInput" name="content"
                      class="link-description-input" placeholder="Beschreibung optional" aria-label="Beschreibung"
                      autocomplete="off" enterkeyhint="done" rows="2" hidden></textarea>
            <div class="file-input-group" id="fileInputGroup" hidden>
                <div class="upload-mode-toggle" id="uploadModeToggle" hidden>
                    <button type="button" class="upload-mode-btn is-active" id="uploadModeFile" aria-pressed="true">Datei wählen</button>
                    <button type="button" class="upload-mode-btn" id="uploadModeUrl" aria-pressed="false">Von URL laden</button>
                </div>
                <div class="file-picker-area" id="filePickerArea">
                    <label for="fileInput" class="file-picker-button" id="filePickerButton">Datei wählen</label>
                    <input type="file" id="fileInput" name="attachment" hidden>
                    <button type="button" id="cameraBtn" class="file-picker-button btn-camera" hidden aria-label="Foto aufnehmen"><?= icon('camera') ?></button>
                    <input type="file" id="cameraInput" accept="image/*" capture="environment" hidden>
                    <span class="file-picker-name" id="filePickerName">Keine Datei ausgewählt</span>
                </div>
                <div class="url-import-area" id="urlImportArea" hidden>
                    <input type="url" id="urlImportInput" placeholder="https://example.com/datei.pdf"
                           inputmode="url" autocomplete="off" autocorrect="off"
                           class="url-import-input" aria-label="Datei-URL">
                </div>
                <span class="disk-free-display" id="diskFreeDisplay" hidden></span>
            </div>
            <input type="text" id="quantityInput" name="quantity"
                   placeholder="Menge" aria-label="Menge" maxlength="40" autocomplete="off" enterkeyhint="done">
            <button type="button" class="btn-add btn-scan-input" id="scanAddBtn" aria-label="Barcode scannen"<?= !$shoppingListScannerEnabled ? ' hidden' : '' ?>><?= icon('scan') ?></button>
            <button type="submit" class="btn-add" aria-label="Artikel hinzufügen"><?= icon('plus') ?></button>
        </form>
        <p class="input-hint" id="inputHint" hidden></p>
        <div class="drop-zone" id="dropZone" hidden aria-hidden="true">
            <span class="drop-zone-label">Bild hierher ziehen oder aus Zwischenablage einfügen</span>
        </div>
    </section>

    <main class="list-area">
        <div class="list-swipe-stage" id="listSwipeStage">
            <ul id="list" aria-label="Ankerkladde"></ul>
            <button type="button" class="btn-clear liste-only"
                    id="clearDoneBtn" disabled>Erledigte löschen</button>
        </div>
        <div class="list-swipe-preview" id="listSwipePreview" aria-hidden="true" hidden>
            <div class="list-swipe-preview-header" id="listSwipePreviewHeader"></div>
            <ul class="list-swipe-preview-list" id="listSwipePreviewList"></ul>
        </div>
        <section class="settings-embed" id="settingsEmbed" hidden aria-label="Einstellungen">
            <iframe
                id="settingsFrame"
                class="settings-embed-frame"
                title="Einstellungen"
                loading="lazy"
                referrerpolicy="same-origin"
            ></iframe>
        </section>
    </main>

    <nav class="section-tabs" id="sectionTabs" aria-label="Bereich wählen"></nav>

    <div class="message" id="message" role="status" aria-live="polite"></div>

    <div class="upload-progress" id="uploadProgress" hidden>
        <div class="upload-progress-bar" id="uploadProgressBar"></div>
    </div>

    <?php if ($shoppingListScannerEnabled): ?>
    <div class="scanner-overlay" id="scannerOverlay" hidden>
        <div class="scanner-sheet" role="dialog" aria-modal="true" aria-labelledby="scannerTitle">
            <div class="scanner-header">
                <div>
                    <h2 class="scanner-title" id="scannerTitle">Barcode scannen</h2>
                    <p class="scanner-subtitle" id="scannerSubtitle">Kamera wird vorbereitet…</p>
                </div>
                <button type="button" id="scannerCloseBtn" class="header-icon-btn" aria-label="Scanner schließen"><?= icon('x') ?></button>
            </div>
            <div class="scanner-viewport">
                <video id="scannerVideo" class="scanner-video" autoplay playsinline muted></video>
                <div class="scanner-frame" aria-hidden="true"></div>
            </div>
            <div class="scanner-status" id="scannerStatus" aria-live="polite"></div>
            <form class="scanner-manual-form" id="scannerManualForm" novalidate>
                <input type="text" id="scannerManualInput" inputmode="numeric" autocomplete="off" placeholder="Barcode manuell eingeben" aria-label="Barcode manuell eingeben" maxlength="64">
                <button type="submit" class="btn-add" aria-label="Barcode übernehmen"><?= icon('check') ?></button>
            </form>
        </div>
    </div>
    <?php endif; ?>

    <div class="note-editor" id="noteEditor" hidden>
        <div class="note-editor-top">
            <button type="button" id="noteEditorBack" class="btn-note-back" aria-label="Zurück"><?= icon('arrow-left') ?></button>
            <input type="text" id="noteTitleInput" class="note-title-input"
                   placeholder="Titel..." aria-label="Notiz Titel" maxlength="120" autocomplete="off">
            <span class="note-save-status" id="noteSaveStatus" aria-live="polite"></span>
        </div>
        <div class="note-toolbar" id="noteToolbar" role="toolbar" aria-label="Formatierung">
            <button type="button" data-cmd="heading" data-level="1" title="Überschrift 1" aria-label="Überschrift 1">H1</button>
            <button type="button" data-cmd="heading" data-level="2" title="Überschrift 2" aria-label="Überschrift 2">H2</button>
            <button type="button" data-cmd="heading" data-level="3" title="Überschrift 3" aria-label="Überschrift 3">H3</button>
            <span class="toolbar-sep" aria-hidden="true"></span>
            <button type="button" data-cmd="bold" title="Fett" aria-label="Fett"><b aria-hidden="true">B</b></button>
            <button type="button" data-cmd="italic" title="Kursiv" aria-label="Kursiv"><i aria-hidden="true">I</i></button>
            <button type="button" data-cmd="strike" title="Durchgestrichen" aria-label="Durchgestrichen"><s aria-hidden="true">S</s></button>
            <span class="toolbar-sep" aria-hidden="true"></span>
            <button type="button" data-cmd="bulletList" title="Liste" aria-label="Liste">≡</button>
            <button type="button" data-cmd="orderedList" title="Nummerierte Liste" aria-label="Nummerierte Liste">1.</button>
            <span class="toolbar-sep" aria-hidden="true"></span>
            <button type="button" data-cmd="blockquote" title="Zitat" aria-label="Zitat">❝</button>
            <button type="button" data-cmd="codeBlock" title="Code" aria-label="Code-Block">&lt;/&gt;</button>
            <span class="toolbar-sep" aria-hidden="true"></span>
            <button type="button" data-cmd="link" title="Link" aria-label="Link einfügen"><?= icon('link') ?></button>
            <span class="toolbar-sep" aria-hidden="true"></span>
            <button type="button" data-cmd="undo" title="Rückgängig" aria-label="Rückgängig">↩</button>
            <button type="button" data-cmd="redo" title="Wiederholen" aria-label="Wiederholen">↪</button>
        </div>
        <div class="note-editor-body" id="noteEditorEl"></div>
    </div>

    <div class="todo-editor" id="todoEditor" hidden>
        <div class="todo-editor-top">
            <button type="button" id="todoEditorBack" class="btn-note-back" aria-label="Zurück"><?= icon('arrow-left') ?></button>
            <input type="text" id="todoTitleInput" class="note-title-input" placeholder="Aufgabe..." aria-label="Aufgabentitel" maxlength="120" autocomplete="off">
        </div>
        <div class="todo-editor-body" id="todoEditorBody">
            <div class="todo-editor-section">
                <label class="todo-editor-label" for="todoDateInput">Fälligkeitsdatum</label>
                <input type="date" id="todoDateInput" class="todo-editor-date-input">
            </div>
            <div class="todo-editor-section">
                <span class="todo-editor-label">Status</span>
                <div class="todo-status-selector" id="todoStatusSelector" role="group" aria-label="Status">
                    <button type="button" class="todo-status-btn" data-status="">Offen</button>
                    <button type="button" class="todo-status-btn" data-status="in_progress">In Arbeit</button>
                    <button type="button" class="todo-status-btn" data-status="waiting">Wartet</button>
                </div>
            </div>
            <div class="todo-editor-section todo-editor-section--note">
                <label class="todo-editor-label" for="todoNoteInput">Notiz</label>
                <textarea id="todoNoteInput" class="todo-note-input" placeholder="Notizen zur Aufgabe..." maxlength="8000"></textarea>
            </div>
        </div>
    </div>

</div>

<script id="userPreferences" type="application/json"><?= json_encode($userPreferences, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?></script>
<script src="<?= htmlspecialchars(appPath('vendor/zxing/browser-0.1.5.js?v=' . $assetVersion), ENT_QUOTES, 'UTF-8') ?>"></script>
<script type="module" src="js/main.js?v=<?= urlencode($assetVersion) ?>"></script>
<script type="module" src="js/tiptap-init.js?v=<?= urlencode($assetVersion) ?>"></script>
</body>
</html>
