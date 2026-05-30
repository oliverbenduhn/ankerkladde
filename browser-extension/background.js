// background.js: Background Service Worker for Ankerkladde Browser Extension (v5.0)

const DEFAULT_API_URL = 'https://ankerkladde.benduhn.de';

const MENU_IDS = {
  savePage: 'ankerkladde-save-page',
  saveLink: 'ankerkladde-save-link',
  saveImage: 'ankerkladde-save-image',
  saveSelection: 'ankerkladde-save-selection',
  saveFile: 'ankerkladde-save-file',
};

const FILE_EXTENSIONS = /\.(pdf|zip|mp3|mp4|m4a|ogg|wav|flac|webm|avi|mov|mkv|docx?|xlsx?|pptx?|odt|ods|odp|csv|epub|tar|gz|bz2|xz|rar|7z|apk|dmg|exe|msi|deb|rpm|iso|pkg)(\?|#|$)/i;

chrome.runtime.onInstalled.addListener(() => {
  chrome.runtime.setUninstallURL('https://ankerkladde.benduhn.de');
  createContextMenus();
  
  // Set up periodic sync alarm (every 3 minutes)
  chrome.alarms.create('offline-sync-alarm', { periodInMinutes: 3 });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleContextMenuClick(info, tab);
});

chrome.commands.onCommand.addListener(command => {
  if (command === 'save-current-page') {
    void saveCurrentPageFromActiveTab();
  }
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'offline-sync-alarm') {
    void triggerOfflineSync();
  }
});

// Communication from popup.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'update-context-menus') {
    updateDynamicContextMenus(message.categories);
    sendResponse({ success: true });
  } else if (message.action === 'sync-offline-queue') {
    triggerOfflineSync().then(result => sendResponse(result));
    return true; // Keep message channel open for async response
  } else if (message.action === 'save-item') {
    handleSaveItemMessage(message.category, message.values).then(result => sendResponse(result));
    return true;
  }
});

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_IDS.savePage,
      title: 'Zu Ankerkladde speichern',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.saveLink,
      title: 'Link zu Ankerkladde speichern',
      contexts: ['link'],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.saveImage,
      title: 'Bild zu Ankerkladde speichern',
      contexts: ['image'],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.saveSelection,
      title: 'Markierten Text als Notiz speichern',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.saveFile,
      title: 'Datei zu Ankerkladde speichern',
      contexts: ['link'],
    });
  });
}

function updateDynamicContextMenus(categories) {
  chrome.contextMenus.removeAll(() => {
    const parentId = 'ankerkladde-parent';
    
    // Parent context menu
    chrome.contextMenus.create({
      id: parentId,
      title: 'Zu Ankerkladde speichern...',
      contexts: ['all']
    });

    const visibleCategories = Array.isArray(categories)
      ? categories.filter(category => Number(category.is_hidden) !== 1)
      : [];

    if (visibleCategories.length > 0) {
      visibleCategories.forEach(cat => {
        const icon = cat.icon ? `${cat.icon} ` : '';
        chrome.contextMenus.create({
          id: `ankerkladde-cat-${cat.id}`,
          parentId: parentId,
          title: `${icon}${cat.name}`,
          contexts: ['all']
        });
      });
    } else {
      // Fallback
      createContextMenus();
    }
  });
}

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
  });
}

function normalizeUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!/^https?:\/\//i.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);
    const trackingParams = [
      'fbclid',
      'gclid',
      'mc_cid',
      'mc_eid',
      'ref',
      'ref_src',
      'si',
    ];

    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || trackingParams.includes(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }

    url.hash = '';

    const normalized = url.toString();
    return normalized.endsWith('/') && url.pathname === '/' && !url.search ? normalized.slice(0, -1) : normalized;
  } catch (error) {
    return value;
  }
}

function fixEncoding(text) {
  try {
    const bytes = Uint8Array.from(String(text || ''), c => c.charCodeAt(0));
    if (bytes.some(b => b > 0x7f)) {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
  } catch {}
  return text;
}

async function getSettings() {
  const result = await chrome.storage.local.get(['apiUrl', 'apiKey', 'defaults', 'recentSaves']);
  return {
    apiUrl: (result.apiUrl || DEFAULT_API_URL).replace(/\/$/, ''),
    apiKey: result.apiKey || '',
    defaults: result.defaults || {},
    recentSaves: Array.isArray(result.recentSaves) ? result.recentSaves : [],
  };
}

function requireAuthHeaders(apiKey) {
  if (!apiKey) {
    throw new Error('API-Key fehlt. Bitte Extension-Konfiguration prüfen.');
  }

  return { 'X-API-Key': apiKey };
}

async function requestJson(apiUrl, apiKey, action, options = {}) {
  const response = await fetch(`${apiUrl}/api.php?action=${action}`, {
    credentials: 'omit',
    ...options,
    headers: {
      ...(options.headers || {}),
      ...requireAuthHeaders(apiKey),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }

  return payload;
}

async function loadContext() {
  const { apiUrl, apiKey, defaults, recentSaves } = await getSettings();
  const saved = await chrome.storage.local.get(['preferences']);
  const payload = await requestJson(apiUrl, apiKey, 'categories_list');
  const categories = Array.isArray(payload.categories) ? payload.categories : [];
  const visibleCategories = categories.filter(category => Number(category.is_hidden) !== 1);

  return {
    apiUrl,
    apiKey,
    categories,
    visibleCategories,
    preferences: { ...(payload.preferences || {}), last_category_id: saved.preferences?.last_category_id },
    defaults,
    recentSaves,
  };
}

function chooseCategory(categories, preferences, type) {
  if (categories.length === 0) {
    return null;
  }

  const preferredId = Number(preferences?.last_category_id);
  if (Number.isInteger(preferredId) && preferredId > 0) {
    const preferred = categories.find(category => Number(category.id) === preferredId);
    if (preferred && (!type || preferred.type === type)) {
      return preferred;
    }
  }

  if (type) {
    const defaults = preferences.__defaults || {};
    const configuredId = Number(defaults[type]);
    if (Number.isInteger(configuredId) && configuredId > 0) {
      const configured = categories.find(category => Number(category.id) === configuredId && category.type === type);
      if (configured) {
        return configured;
      }
    }

    return categories.find(category => category.type === type) || null;
  }

  return categories[0] || null;
}

async function recordRecentSave(context, entry) {
  const stampedEntry = {
    ...entry,
    at: new Date().toISOString(),
  };

  const nextRecent = [stampedEntry, ...(context.recentSaves || [])].slice(0, 5);
  await chrome.storage.local.set({ recentSaves: nextRecent });
  context.recentSaves = nextRecent;
}

async function rememberLastCategory(apiUrl, apiKey, categoryId) {
  const normalizedId = Number(categoryId);
  if (!Number.isInteger(normalizedId) || normalizedId < 1) return;

  const saved = await chrome.storage.local.get(['preferences']);
  await chrome.storage.local.set({
    preferences: { ...(saved.preferences || {}), last_category_id: normalizedId },
  });
}

async function addItem(apiUrl, apiKey, categoryId, values) {
  const normalizedName = /^https?:\/\//i.test(String(values.name || ''))
    ? normalizeUrl(values.name)
    : values.name;

  if (/^https?:\/\//i.test(String(normalizedName || ''))) {
    const duplicate = await findDuplicateLink(apiUrl, apiKey, categoryId, normalizedName);
    if (duplicate) {
      throw new Error('Link ist in dieser Kategorie bereits vorhanden.');
    }
  }

  const formData = new FormData();
  formData.append('category_id', String(categoryId));
  formData.append('name', normalizedName);

  if (values.content) {
    formData.append('content', values.content);
  }
  if (values.quantity) {
    formData.append('quantity', values.quantity);
  }
  if (values.dueDate) {
    formData.append('due_date', values.dueDate);
  }

  await requestJson(apiUrl, apiKey, 'add', {
    method: 'POST',
    body: formData,
  });
}

async function findDuplicateLink(apiUrl, apiKey, categoryId, url) {
  const normalizedUrl = String(url || '').trim();
  if (normalizedUrl.length < 8) {
    return null;
  }

  const payload = await requestJson(apiUrl, apiKey, `search&q=${encodeURIComponent(normalizedUrl)}`);
  const items = Array.isArray(payload.items) ? payload.items : [];
  return items.find(item =>
    Number(item.category_id) === Number(categoryId) &&
    String(item.name || '').trim() === normalizedUrl
  ) || null;
}

async function uploadRemoteFile(apiUrl, apiKey, categoryId, url, fallbackName) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Datei konnte nicht geladen werden.');
  }

  const blob = await response.blob();
  const contentType = blob.type || response.headers.get('Content-Type') || 'application/octet-stream';
  const file = new File([blob], fallbackName, { type: contentType });

  const formData = new FormData();
  formData.append('category_id', String(categoryId));
  formData.append('name', file.name.slice(0, 120));
  formData.append('file', file);

  await requestJson(apiUrl, apiKey, 'upload', {
    method: 'POST',
    body: formData,
  });
}

// ── OFFLINE STORAGE SYNC ENGINE ──

function isNetworkError(error) {
  return error instanceof TypeError || (error.message && (
    error.message.includes('fetch') ||
    error.message.includes('Network') ||
    error.message.includes('Failed') ||
    error.message.includes('Failed to fetch') ||
    error.message.includes('HTTP 502') ||
    error.message.includes('HTTP 503') ||
    error.message.includes('HTTP 504')
  ));
}

async function enqueueOfflineItem(item) {
  const result = await chrome.storage.local.get(['offlineQueue']);
  const queue = Array.isArray(result.offlineQueue) ? result.offlineQueue : [];
  
  // Prevent duplicate additions in the queue
  if (queue.some(q => q.type === item.type && q.categoryId === item.categoryId && q.title === item.title)) {
    return;
  }

  queue.push({
    ...item,
    id: Math.random().toString(36).substring(2),
    at: new Date().toISOString()
  });
  
  await chrome.storage.local.set({ offlineQueue: queue });
  notify('Offline gesichert', `"${item.title}" wird synchronisiert, sobald eine Verbindung besteht.`);
}

async function triggerOfflineSync() {
  const result = await chrome.storage.local.get(['offlineQueue']);
  const queue = Array.isArray(result.offlineQueue) ? result.offlineQueue : [];
  if (queue.length === 0) return { success: true, synced: 0 };

  const { apiUrl, apiKey, defaults, recentSaves } = await getSettings();
  if (!apiKey || !apiUrl) return { success: false, error: 'Keine Verbindung konfiguriert.' };

  const context = { apiUrl, apiKey, defaults, recentSaves };
  const failed = [];
  let syncedCount = 0;

  for (const item of queue) {
    try {
      if (item.type === 'add') {
        await addItem(apiUrl, apiKey, item.categoryId, item.values);
      } else if (item.type === 'upload_remote') {
        await uploadRemoteFile(apiUrl, apiKey, item.categoryId, item.url, item.filename);
      }
      syncedCount++;
      
      await recordRecentSave(context, {
        kind: item.kind,
        actionType: item.actionType,
        title: item.title,
        categoryId: item.categoryId,
        categoryName: item.categoryName
      });
    } catch (error) {
      if (isNetworkError(error)) {
        failed.push(item);
      } else {
        // Validation / duplicate link errors: notify and drop
        notify('Synchronisierungsfehler', `"${item.title}" verworfen: ${error.message}`);
      }
    }
  }

  await chrome.storage.local.set({ offlineQueue: failed });
  
  if (syncedCount > 0) {
    notify('Synchronisierung abgeschlossen', `${syncedCount} Eintrag/Einträge erfolgreich synchronisiert.`);
  }

  return { success: true, synced: syncedCount, remaining: failed.length };
}

async function handleSaveItemMessage(category, values) {
  const { apiUrl, apiKey, defaults, recentSaves } = await getSettings();
  const context = { apiUrl, apiKey, defaults, recentSaves };
  
  try {
    await addItem(apiUrl, apiKey, category.id, values);
    return { success: true };
  } catch (error) {
    if (isNetworkError(error)) {
      await enqueueOfflineItem({
        type: 'add',
        categoryId: category.id,
        categoryName: category.name,
        values: values,
        title: values.name,
        kind: category.type === 'links' ? 'Link' : category.type === 'notes' ? 'Notiz' : 'Eintrag',
        actionType: category.type === 'links' ? 'link' : category.type === 'notes' ? 'note' : 'item'
      });
      return { success: true, offline: true };
    }
    return { success: false, error: error.message };
  }
}

// ── DYNAMIC CONTEXT MENUS & CLICKS ──

async function handleContextMenuClick(info, tab) {
  try {
    const context = await loadContext();
    context.preferences = { ...context.preferences, __defaults: context.defaults };

    let category = null;

    if (String(info.menuItemId).startsWith('ankerkladde-cat-')) {
      const targetCategoryId = Number(info.menuItemId.replace('ankerkladde-cat-', ''));
      category = context.categories.find(c => Number(c.id) === targetCategoryId);
    }

    if (category) {
      await saveContentToSpecificCategory(context, category, info, tab);
      return;
    }

    // Fallbacks for standard static context menus
    if (info.menuItemId === MENU_IDS.savePage) {
      await saveCurrentPage(context, tab);
      await recordRecentSave(context, {
        kind: 'Seite',
        actionType: 'page',
        title: (tab?.title || 'Unbenannte Seite').slice(0, 120),
        categoryId: chooseCategory(context.visibleCategories, context.preferences, null)?.id || null,
        categoryName: chooseCategory(context.visibleCategories, context.preferences, null)?.name || '',
      });
      notify('Ankerkladde', 'Seite gespeichert.');
      return;
    }

    if (info.menuItemId === MENU_IDS.saveLink) {
      const cat = chooseCategory(context.visibleCategories, context.preferences, 'links');
      if (!cat || !info.linkUrl) throw new Error('Keine sichtbare Link-Kategorie vorhanden.');

      await addItem(context.apiUrl, context.apiKey, cat.id, { name: normalizeUrl(info.linkUrl), content: '' });
      await rememberLastCategory(context.apiUrl, context.apiKey, cat.id);
      await recordRecentSave(context, {
        kind: 'Link',
        actionType: 'link',
        title: normalizeUrl(info.linkUrl),
        categoryId: cat.id,
        categoryName: cat.name,
      });
      notify('Ankerkladde', 'Link gespeichert.');
      return;
    }

    if (info.menuItemId === MENU_IDS.saveImage) {
      const cat = chooseCategory(context.visibleCategories, context.preferences, 'images');
      if (!cat || !info.srcUrl) throw new Error('Keine sichtbare Bilder-Kategorie vorhanden.');

      await uploadRemoteFile(context.apiUrl, context.apiKey, cat.id, info.srcUrl, 'bild');
      await rememberLastCategory(context.apiUrl, context.apiKey, cat.id);
      await recordRecentSave(context, {
        kind: 'Bild',
        actionType: 'image',
        title: 'Bild aus Browser',
        categoryId: cat.id,
        categoryName: cat.name,
      });
      notify('Ankerkladde', 'Bild gespeichert.');
      return;
    }

    if (info.menuItemId === MENU_IDS.saveSelection) {
      const cat = chooseCategory(context.visibleCategories, context.preferences, 'notes');
      if (!cat || !info.selectionText) throw new Error('Keine sichtbare Notiz-Kategorie vorhanden.');

      const pageUrl = tab?.url || '';
      const normalizedPageUrl = normalizeUrl(pageUrl);
      const selectionText = fixEncoding(info.selectionText);
      const content = normalizedPageUrl ? `${selectionText}\n\nQuelle: ${normalizedPageUrl}` : selectionText;
      const noteTitle = (tab?.title || 'Markierter Text').slice(0, 120);
      
      await addItem(context.apiUrl, context.apiKey, cat.id, { name: noteTitle, content });
      await rememberLastCategory(context.apiUrl, context.apiKey, cat.id);
      await recordRecentSave(context, {
        kind: 'Notiz',
        actionType: 'note',
        title: noteTitle,
        categoryId: cat.id,
        categoryName: cat.name,
      });
      notify('Ankerkladde', 'Notiz gespeichert.');
      return;
    }

    if (info.menuItemId === MENU_IDS.saveFile) {
      const cat = chooseCategory(context.visibleCategories, context.preferences, 'files');
      if (!cat || !info.linkUrl) throw new Error('Keine sichtbare Datei-Kategorie vorhanden.');

      let filename = 'datei';
      try {
        const parsed = new URL(info.linkUrl);
        const last = parsed.pathname.split('/').pop();
        if (last) filename = decodeURIComponent(last).slice(0, 120);
      } catch {}

      await uploadRemoteFile(context.apiUrl, context.apiKey, cat.id, info.linkUrl, filename);
      await rememberLastCategory(context.apiUrl, context.apiKey, cat.id);
      await recordRecentSave(context, {
        kind: 'Datei',
        actionType: 'file',
        title: filename,
        categoryId: cat.id,
        categoryName: cat.name,
      });
      notify('Ankerkladde', 'Datei gespeichert.');
    }
  } catch (error) {
    console.error('Kontextmenü-Aktion fehlgeschlagen:', error);
    notify('Ankerkladde Fehler', error instanceof Error ? error.message : 'Speichern fehlgeschlagen.');
  }
}

async function saveContentToSpecificCategory(context, category, info, tab) {
  const title = fixEncoding(tab?.title || 'Eintrag aus Browser').slice(0, 120);
  const url = normalizeUrl(tab?.url || '');

  try {
    if (category.type === 'images' && info.srcUrl) {
      await uploadRemoteFile(context.apiUrl, context.apiKey, category.id, info.srcUrl, 'bild');
      await rememberLastCategory(context.apiUrl, context.apiKey, category.id);
      await recordRecentSave(context, {
        kind: 'Bild',
        actionType: 'image',
        title: 'Bild aus Browser',
        categoryId: category.id,
        categoryName: category.name,
      });
      notify('Ankerkladde', `Bild in "${category.name}" gespeichert.`);
      return;
    }

    if (category.type === 'files' && info.linkUrl) {
      let filename = 'datei';
      try {
        const parsed = new URL(info.linkUrl);
        const last = parsed.pathname.split('/').pop();
        if (last) filename = decodeURIComponent(last).slice(0, 120);
      } catch {}
      await uploadRemoteFile(context.apiUrl, context.apiKey, category.id, info.linkUrl, filename);
      await rememberLastCategory(context.apiUrl, context.apiKey, category.id);
      await recordRecentSave(context, {
        kind: 'Datei',
        actionType: 'file',
        title: filename,
        categoryId: category.id,
        categoryName: category.name,
      });
      notify('Ankerkladde', `Datei in "${category.name}" gespeichert.`);
      return;
    }

    if (category.type === 'links') {
      const targetUrl = info.linkUrl || info.pageUrl || url;
      await addItem(context.apiUrl, context.apiKey, category.id, {
        name: normalizeUrl(targetUrl),
        content: '',
      });
      await rememberLastCategory(context.apiUrl, context.apiKey, category.id);
      await recordRecentSave(context, {
        kind: 'Link',
        actionType: 'link',
        title: normalizeUrl(targetUrl),
        categoryId: category.id,
        categoryName: category.name,
      });
      notify('Ankerkladde', `Link in "${category.name}" gespeichert.`);
      return;
    }

    if (category.type === 'notes') {
      const pageUrl = info.pageUrl || url;
      const selectionText = info.selectionText ? fixEncoding(info.selectionText) : '';
      const content = pageUrl ? (selectionText ? `${selectionText}\n\nQuelle: ${pageUrl}` : pageUrl) : selectionText;
      const noteName = info.selectionText ? (fixEncoding(info.selectionText).slice(0, 30) + '...') : title;
      
      await addItem(context.apiUrl, context.apiKey, category.id, {
        name: noteName,
        content: content,
      });
      await rememberLastCategory(context.apiUrl, context.apiKey, category.id);
      await recordRecentSave(context, {
        kind: 'Notiz',
        actionType: 'note',
        title: noteName,
        categoryId: category.id,
        categoryName: category.name,
      });
      notify('Ankerkladde', `Notiz in "${category.name}" gespeichert.`);
      return;
    }

    // Default lists (shopping, todo)
    const itemName = info.selectionText ? fixEncoding(info.selectionText).slice(0, 120) : title;
    await addItem(context.apiUrl, context.apiKey, category.id, {
      name: itemName,
      content: '',
    });
    await rememberLastCategory(context.apiUrl, context.apiKey, category.id);
    await recordRecentSave(context, {
      kind: 'Eintrag',
      actionType: 'item',
      title: itemName,
      categoryId: category.id,
      categoryName: category.name,
    });
    notify('Ankerkladde', `Eintrag in "${category.name}" gespeichert.`);
  } catch (error) {
    if (isNetworkError(error)) {
      const targetUrl = info.linkUrl || info.srcUrl || info.pageUrl || url;
      const itemName = info.selectionText ? fixEncoding(info.selectionText).slice(0, 120) : title;
      
      await enqueueOfflineItem({
        type: category.type === 'images' || category.type === 'files' ? 'upload_remote' : 'add',
        categoryId: category.id,
        categoryName: category.name,
        url: targetUrl,
        filename: 'bild_datei',
        values: {
          name: category.type === 'links' ? normalizeUrl(targetUrl) : itemName,
          content: category.type === 'notes' ? (info.selectionText ? `${fixEncoding(info.selectionText)}\n\nQuelle: ${targetUrl}` : targetUrl) : ''
        },
        title: category.type === 'links' ? normalizeUrl(targetUrl) : itemName,
        kind: category.type === 'links' ? 'Link' : category.type === 'notes' ? 'Notiz' : 'Eintrag',
        actionType: category.type === 'links' ? 'link' : category.type === 'notes' ? 'note' : 'item'
      });
    } else {
      throw error;
    }
  }
}

async function saveCurrentPage(context, tab) {
  const targetTab = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!targetTab?.url) {
    throw new Error('Aktiver Tab konnte nicht gelesen werden.');
  }

  const category = chooseCategory(context.visibleCategories, context.preferences, null);
  if (!category) {
    throw new Error('Keine sichtbare Kategorie vorhanden.');
  }

  const title = (targetTab.title || 'Unbenannte Seite').slice(0, 120);
  const isNotesCategory = category.type === 'notes';
  const isLinksCategory = category.type === 'links';

  try {
    await addItem(context.apiUrl, context.apiKey, category.id, {
      name: isNotesCategory ? title : (isLinksCategory ? normalizeUrl(targetTab.url) : title),
      content: isNotesCategory ? normalizeUrl(targetTab.url) : '',
    });
    await rememberLastCategory(context.apiUrl, context.apiKey, category.id);
  } catch (error) {
    if (isNetworkError(error)) {
      await enqueueOfflineItem({
        type: 'add',
        categoryId: category.id,
        categoryName: category.name,
        values: {
          name: isNotesCategory ? title : (isLinksCategory ? normalizeUrl(targetTab.url) : title),
          content: isNotesCategory ? normalizeUrl(targetTab.url) : '',
        },
        title: title,
        kind: 'Seite',
        actionType: 'page'
      });
    } else {
      throw error;
    }
  }
}

async function saveCurrentPageFromActiveTab() {
  try {
    const context = await loadContext();
    context.preferences = { ...context.preferences, __defaults: context.defaults };
    const targetCategory = chooseCategory(context.visibleCategories, context.preferences, null);
    
    await saveCurrentPage(context, null);
    
    const result = await chrome.storage.local.get(['offlineQueue']);
    const isOffline = Array.isArray(result.offlineQueue) && result.offlineQueue.some(q => q.title === 'Aktuelle Seite');
    
    if (!isOffline) {
      await recordRecentSave(context, {
        kind: 'Seite',
        actionType: 'page',
        title: 'Aktuelle Seite',
        categoryId: targetCategory?.id || null,
        categoryName: targetCategory?.name || '',
      });
      notify('Ankerkladde', 'Seite gespeichert.');
    }
  } catch (error) {
    console.error('Shortcut-Speicherung fehlgeschlagen:', error);
    notify('Ankerkladde Fehler', error instanceof Error ? error.message : 'Speichern fehlgeschlagen.');
  }
}

// ── OMNIBOX INTEGRATION ──

chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  try {
    const { apiUrl, apiKey, categories } = await getSettings();
    if (!apiKey || !text.trim()) return;

    // Call search API
    const payload = await requestJson(apiUrl, apiKey, `search&q=${encodeURIComponent(text)}`);
    const items = Array.isArray(payload.items) ? payload.items : [];

    const suggestions = items.slice(0, 5).map(item => {
      const category = categories.find(c => Number(c.id) === Number(item.category_id));
      const catName = category ? `[${category.name}]` : '';
      return {
        content: `${apiUrl}/#item-${item.id}`,
        description: `<dim>${catName}</dim> <match>${escapeXml(item.name)}</match>`
      };
    });

    // Add a "quick add" fallback option
    suggestions.push({
      content: `add:${text}`,
      description: `Eintrag <match>${escapeXml(text)}</match> schnell hinzufügen`
    });

    suggest(suggestions);
  } catch (e) {
    console.error('Omnibox search error:', e);
  }
});

chrome.omnibox.onInputEntered.addListener(async (text) => {
  try {
    if (text.startsWith('http://') || text.startsWith('https://')) {
      chrome.tabs.create({ url: text });
      return;
    }

    let itemText = text;
    if (text.startsWith('add:')) {
      itemText = text.substring(4);
    }

    const context = await loadContext();
    context.preferences = { ...context.preferences, __defaults: context.defaults };
    const category = chooseCategory(context.visibleCategories, context.preferences, null);

    if (!category) {
      throw new Error('Keine sichtbare Kategorie gefunden.');
    }

    await addItem(context.apiUrl, context.apiKey, category.id, {
      name: itemText,
      content: ''
    });

    notify('Ankerkladde Quick-Add', `"${itemText}" in ${category.name} gespeichert.`);
  } catch (error) {
    notify('Ankerkladde Fehler', error.message);
  }
});

function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}
