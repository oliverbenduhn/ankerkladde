<?php
$wsUrl = 'http://127.0.0.1:3000/notify';
$ch = curl_init($wsUrl);
curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => 'POST',
    CURLOPT_POSTFIELDS => json_encode(['action' => 'update']),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT_MS => 150,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json']
]);
$result = curl_exec($ch);
echo "Error: " . curl_error($ch) . "\n";
echo "Result: " . $result . "\n";
curl_close($ch);
