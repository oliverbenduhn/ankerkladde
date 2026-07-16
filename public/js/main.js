import { startApp } from './app-entry.js?v=4.4.5';

const assetVersion = new URL(import.meta.url).searchParams.get('v') || '4.4.5';

startApp(assetVersion);
