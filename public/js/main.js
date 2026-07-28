import { startApp } from './app-entry.js';

const assetVersion = new URL(import.meta.url).searchParams.get('v') || '5.1.13';

startApp(assetVersion);
