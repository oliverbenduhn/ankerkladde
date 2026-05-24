import { startApp } from './app-entry.js?v=4.4.3';

const assetVersion = new URL(import.meta.url).searchParams.get('v') || '4.4.3';

startApp(assetVersion);
