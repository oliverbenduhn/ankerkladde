import { startApp } from './app-entry.js?v=4.3.11';

const assetVersion = new URL(import.meta.url).searchParams.get('v') || '4.3.11';

startApp(assetVersion);
