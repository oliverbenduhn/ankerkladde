<?php
declare(strict_types=1);

function normalizeContent(?string $content): string
{
    return sanitizeRichTextHtml(truncateText(trim((string) $content), 102400));
}

function normalizeSketchJson(?string $rawJson): string
{
    $raw = (string) $rawJson;
    if ($raw === '') {
        return '';
    }
    $size = strlen($raw);
    if ($size > 2 * 1024 * 1024) {
        respond(413, ['error' => t('error.sketch_too_large'), 'error_key' => 'error.sketch_too_large']);
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        respond(422, ['error' => t('error.sketch_invalid_json'), 'error_key' => 'error.sketch_invalid_json']);
    }
    if (!isset($decoded['elements']) || !is_array($decoded['elements'])) {
        respond(422, ['error' => t('error.sketch_invalid_structure'), 'error_key' => 'error.sketch_invalid_structure']);
    }
    if (sketchSceneContainsFilesKey($decoded)) {
        respond(422, ['error' => t('error.sketch_files_not_allowed'), 'error_key' => 'error.sketch_files_not_allowed']);
    }
    $elements = array_values(array_filter(
        $decoded['elements'],
        static fn($element): bool => is_array($element)
    ));
    if ($elements === []) {
        return '';
    }

    return json_encode(
        ['elements' => $elements] + $decoded,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );
}

function sketchSceneContainsFilesKey(array $scene): bool
{
    foreach ($scene as $key => $value) {
        if ($key === 'files' && is_array($value)) {
            return true;
        }
        if (is_array($value) && sketchSceneContainsFilesKey($value)) {
            return true;
        }
    }
    return false;
}

function normalizePlainTextContent(?string $content): string
{
    return truncateText(trim((string) $content), 8000);
}

function sanitizeRichTextHref(string $href): ?string
{
    $href = trim($href);
    if ($href === '') {
        return null;
    }

    if (preg_match('/^(https?:|mailto:|tel:)/i', $href) !== 1) {
        return null;
    }

    return $href;
}

function sanitizeRichTextHtmlFallback(string $html): string
{
    $html = preg_replace('#<(script|style)\b[^>]*>.*?</\1>#is', '', $html) ?? '';
    $html = preg_replace('/\son[a-z]+\s*=\s*(".*?"|\'.*?\'|[^\s>]+)/is', '', $html) ?? '';
    $html = preg_replace('/\sstyle\s*=\s*(".*?"|\'.*?\')/is', '', $html) ?? '';

    return strip_tags($html, '<p><br><strong><b><em><i><s><u><mark><ul><ol><li><blockquote><pre><code><h1><h2><h3><a>');
}

function cleanNonElementNode(DOMNode $node, DOMDocument $document): bool
{
    if ($node instanceof DOMComment) {
        $node->parentNode?->removeChild($node);
        return true;
    }

    if (!($node instanceof DOMElement)) {
        foreach (iterator_to_array($node->childNodes) as $childNode) {
            sanitizeRichTextNode($childNode, $document);
        }
        return true;
    }

    return false;
}

function cleanElementNode(DOMElement $node, DOMDocument $document): bool
{
    $allowedTags = ['p', 'br', 'strong', 'b', 'em', 'i', 's', 'u', 'mark', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'a'];
    $tagName = strtolower($node->tagName);

    if (!in_array($tagName, $allowedTags, true)) {
        $parentNode = $node->parentNode;
        if ($parentNode !== null) {
            while ($node->firstChild !== null) {
                $parentNode->insertBefore($node->firstChild, $node);
            }
            $parentNode->removeChild($node);
        }
        return true;
    }

    return false;
}

function cleanElementAttributes(DOMElement $node): void
{
    $tagName = strtolower($node->tagName);

    foreach (iterator_to_array($node->attributes) as $attribute) {
        $attributeName = strtolower($attribute->nodeName);

        if ($tagName !== 'a' || !in_array($attributeName, ['href', 'target', 'rel'], true)) {
            $node->removeAttributeNode($attribute);
            continue;
        }

        if ($attributeName === 'href') {
            $sanitizedHref = sanitizeRichTextHref($attribute->nodeValue);
            if ($sanitizedHref === null) {
                $node->removeAttribute('href');
            } else {
                $node->setAttribute('href', $sanitizedHref);
            }
        }

        if ($attributeName === 'target' && strtolower($attribute->nodeValue) !== '_blank') {
            $node->removeAttribute('target');
        }
    }

    if ($tagName === 'a') {
        if ($node->hasAttribute('target')) {
            $node->setAttribute('rel', 'noopener noreferrer');
        } else {
            $node->removeAttribute('rel');
        }
    }
}

function sanitizeRichTextNode(DOMNode $node, DOMDocument $document): void
{
    if (cleanNonElementNode($node, $document)) {
        return;
    }

    if ($node instanceof DOMElement) {
        if (cleanElementNode($node, $document)) {
            return;
        }

        cleanElementAttributes($node);
    }

    foreach (iterator_to_array($node->childNodes) as $childNode) {
        sanitizeRichTextNode($childNode, $document);
    }
}

function sanitizeRichTextHtml(string $html): string
{
    if ($html === '') {
        return '';
    }

    if (!class_exists(DOMDocument::class)) {
        return sanitizeRichTextHtmlFallback($html);
    }

    $document = new DOMDocument('1.0', 'UTF-8');
    $previousUseInternalErrors = libxml_use_internal_errors(true);
    $loaded = $document->loadHTML(
        '<?xml encoding="UTF-8"><!DOCTYPE html><html><body>' . $html . '</body></html>',
        LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
    );
    libxml_clear_errors();
    libxml_use_internal_errors($previousUseInternalErrors);

    if (!$loaded) {
        return sanitizeRichTextHtmlFallback($html);
    }

    $body = $document->getElementsByTagName('body')->item(0);
    if (!$body instanceof DOMElement) {
        return sanitizeRichTextHtmlFallback($html);
    }

    foreach (iterator_to_array($body->childNodes) as $childNode) {
        sanitizeRichTextNode($childNode, $document);
    }

    $sanitized = '';
    foreach ($body->childNodes as $childNode) {
        $sanitized .= $document->saveHTML($childNode);
    }

    return trim($sanitized);
}
