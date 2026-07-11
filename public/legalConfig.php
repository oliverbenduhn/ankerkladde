<?php
declare(strict_types=1);

/**
 * Zentrale Anbieter-Konfiguration fuer Impressum und Datenschutz in
 * Ankerkladde. Spiegelt legalConfig.{js,ts,php} in nextPOI, uttt und
 * yttrans. Bei einem Wechsel auf eine Firma obxy genuegt die Aenderung
 * hier (und in den Spiegeldateien der anderen Apps).
 *
 * Adressdaten sind identisch fuer alle vier Apps, weil sie vom selben
 * Anbieter betrieben werden.
 *
 * Rueckgabe: assoc array, das von Impressum- und Datenschutz-PHP
 * ausgelesen wird.
 */
function getLegalAnbieter(): array
{
    return [
        'natuerlichePerson' => true,
        'name' => 'Oliver Benduhn',
        'rechtsform_name' => null,
        'rechtsform_hrb' => null,
        'adresse' => [
            'Dahlienplatz 5',
            '38368 Mariental',
            'Deutschland',
        ],
        'email' => 'oliverbenduhn@gmail.com',
        'telefon' => '',
        'app_name' => 'Ankerkladde',
        'app_domain' => 'ankerkladde.benduhn.de',
    ];
}
