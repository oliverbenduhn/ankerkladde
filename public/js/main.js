import { startApp } from './app-entry.js?v=5.1.11';

const assetVersion = new URL(import.meta.url).searchParams.get('v') || '5.1.11';

startApp(assetVersion);
