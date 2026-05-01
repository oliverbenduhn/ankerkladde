const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const indexPath = path.join(rootDir, 'public', 'index.php');
const spritePath = path.join(rootDir, 'public', 'icons', 'ui-sprite.svg');

function fail(message) {
    console.error(message);
    process.exitCode = 1;
}

const indexSource = fs.readFileSync(indexPath, 'utf8');
const spriteSource = fs.readFileSync(spritePath, 'utf8');

if (!/^<svg\b[^>]*>[\s\S]*<\/svg>\s*$/.test(spriteSource)) {
    fail('ui-sprite.svg must contain one root <svg> element.');
}

if (/<(?:script|foreignObject)\b/i.test(spriteSource)) {
    fail('ui-sprite.svg must not contain executable or embedded-document elements.');
}

const symbolMatches = [...spriteSource.matchAll(/<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/g)];
if (symbolMatches.length === 0) {
    fail('ui-sprite.svg does not contain any <symbol> elements.');
}

const symbolIds = new Set();
for (const match of symbolMatches) {
    const attrs = match[1];
    const id = attrs.match(/\bid="([^"]+)"/)?.[1] || '';
    if (!/^icon-[a-z0-9-]+$/.test(id)) {
        fail(`Invalid sprite symbol id: ${id || '(missing)'}`);
        continue;
    }

    if (symbolIds.has(id)) {
        fail(`Duplicate sprite symbol id: ${id}`);
    }
    symbolIds.add(id);

    if (!/\bviewBox="0 0 24 24"/.test(attrs)) {
        fail(`Sprite symbol ${id} must use viewBox="0 0 24 24".`);
    }
}

const referencedIconNames = [...indexSource.matchAll(/icon\('([a-z0-9-]+)'\)/g)]
    .map(match => match[1]);

for (const name of referencedIconNames) {
    if (!symbolIds.has(`icon-${name}`)) {
        fail(`index.php references missing sprite icon: ${name}`);
    }
}

if (/function getIconPaths\(\)|static \$paths\s*=|<path d=/.test(indexSource)) {
    fail('index.php should not contain the old inline SVG path table.');
}

if (!indexSource.includes('ui-sprite.php?v=')) {
    fail('index.php icon() helper must reference the UI sprite endpoint.');
}

if (process.exitCode) {
    process.exit(process.exitCode);
}

console.log(`${symbolIds.size} sprite symbols checked; ${referencedIconNames.length} index.php icon references covered.`);
