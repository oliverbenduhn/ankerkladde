import { startApp } from './app-entry.js?v=4.2.53';

const assetVersion = new URL(import.meta.url).searchParams.get('v') || '4.2.48';

startApp(assetVersion);
