<?php
declare(strict_types=1);

function handlePreferencesApiAction(PDO $db, int $userId, string $action): never
{
    switch ($action) {
        case 'preferences':
            if ($_SERVER['REQUEST_METHOD'] === 'GET') {
                $prefs = getExtendedUserPreferences($db, $userId);
                unset($prefs['gemini_api_key'], $prefs['openai_compatible_api_key']);
                respond(200, ['preferences' => $prefs]);
            }

            $data = requireWriteRequest();

            $patch = [];

            if (array_key_exists('product_scanner_enabled', $data)) {
                $patch['product_scanner_enabled'] = filter_var($data['product_scanner_enabled'], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? false;
            }

            if (array_key_exists('shopping_list_scanner_enabled', $data)) {
                $patch['shopping_list_scanner_enabled'] = filter_var($data['shopping_list_scanner_enabled'], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? false;
            }

            if (array_key_exists('magic_button_enabled', $data)) {
                $patch['magic_button_enabled'] = filter_var($data['magic_button_enabled'], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? false;
            }

            $preferences = updateExtendedUserPreferences($db, $userId, $patch);
            unset($preferences['gemini_api_key'], $preferences['openai_compatible_api_key']);
            respond(200, ['preferences' => $preferences]);
    }
    throw new LogicException('Unsupported preferences API action.');
}
