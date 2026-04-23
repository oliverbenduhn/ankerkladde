import { startApp } from './app-entry.js';

const assetVersion = new URL(import.meta.url).searchParams.get('v') || '4.2.47';

startApp(assetVersion);
