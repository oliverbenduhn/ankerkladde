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
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleContextMenuClick(info, tab);
});

chrome.commands.onCommand.addListener(command => {
  if (command === 'save-current-page') {
    void saveCurrentPageFromActiveTab();
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

async function handleContextMenuClick(info, tab) {
  try {
    const context = await loadContext();
    context.preferences = { ...context.preferences, __defaults: context.defaults };

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
      const category = chooseCategory(context.visibleCategories, context.preferences, 'links');
      if (!category || !info.linkUrl) {
        throw new Error('Keine sichtbare Link-Kategorie vorhanden.');
      }

      await addItem(context.apiUrl, context.apiKey, category.id, {
        name: normalizeUrl(info.linkUrl),
        content: '',
      });
      await rememberLastCategory(context.apiUrl, context.apiKey, category.id);
      await recordRecentSave(context, {
        kind: 'Link',
        actionType: 'link',
        title: normalizeUrl(info.linkUrl),
        categoryId: category.id,
        categoryName: category.name,
      });
      notify('Ankerkladde', 'Link gespeichert.');
      return;
    }

    if (info.menuItemId === MENU_IDS.saveImage) {
      const category = chooseCategory(context.visibleCategories, context.preferences, 'images');
      if (!category || !info.srcUrl) {
        throw new Error('Keine sichtbare Bilder-Kategorie vorhanden.');
      }

      await uploadRemoteFile(context.apiUrl, context.apiKey, category.id, info.srcUrl, 'bild');
      await rememberLastCategory(context.apiUrl, context.apiKey, category.id);
      await recordRecentSave(context, {
        kind: 'Bild',
        actionType: 'image',
        title: 'Bild aus Browser',
        categoryId: category.id,
        categoryName: category.name,
      });
      notify('Ankerkladde', 'Bild gespeichert.');
      return;
    }

    if (info.menuItemId === MENU_IDS.saveSelection) {
      const category = chooseCategory(context.visibleCategories, context.preferences, 'notes');
      if (!category || !info.selectionText) {
        throw new Error('Keine sichtbare Notiz-Kategorie vorhanden.');
      }

      const pageUrl = tab?.url || '';
      const normalizedPageUrl = normalizeUrl(pageUrl);
      const selectionText = fixEncoding(info.selectionText);
      const content = normalizedPageUrl ? `${selectionText}\n\nQuelle: ${normalizedPageUrl}` : selectionText;
      await addItem(context.apiUrl, context.apiKey, category.id, {
        name: fixEncoding(tab?.title || 'Markierter Text').slice(0, 120),
        content,
      });
      await rememberLastCategory(context.apiUrl, context.apiKey, category.id);
      await recordRecentSave(context, {
        kind: 'Notiz',
        actionType: 'note',
        title: (tab?.title || 'Markierter Text').slice(0, 120),
        categoryId: category.id,
        categoryName: category.name,
      });
      notify('Ankerkladde', 'Notiz gespeichert.');
      return;
    }

    if (info.menuItemId === MENU_IDS.saveFile) {
      const category = chooseCategory(context.visibleCategories, context.preferences, 'files');
      if (!category || !info.linkUrl) {
        throw new Error('Keine sichtbare Datei-Kategorie vorhanden.');
      }

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
      notify('Ankerkladde', 'Datei gespeichert.');
    }
  } catch (error) {
    console.error('Kontextmenü-Aktion fehlgeschlagen:', error);
    notify('Ankerkladde', error instanceof Error ? error.message : 'Speichern fehlgeschlagen.');
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

  await addItem(context.apiUrl, context.apiKey, category.id, {
    name: isNotesCategory ? title : (isLinksCategory ? normalizeUrl(targetTab.url) : title),
    content: isNotesCategory ? normalizeUrl(targetTab.url) : '',
  });
  await rememberLastCategory(context.apiUrl, context.apiKey, category.id);
}

async function saveCurrentPageFromActiveTab() {
  try {
    const context = await loadContext();
    context.preferences = { ...context.preferences, __defaults: context.defaults };
    const targetCategory = chooseCategory(context.visibleCategories, context.preferences, null);
    await saveCurrentPage(context, null);
    await recordRecentSave(context, {
      kind: 'Seite',
      actionType: 'page',
      title: 'Aktuelle Seite',
      categoryId: targetCategory?.id || null,
      categoryName: targetCategory?.name || '',
    });
    notify('Ankerkladde', 'Seite gespeichert.');
  } catch (error) {
    console.error('Shortcut-Speicherung fehlgeschlagen:', error);
    notify('Ankerkladde', error instanceof Error ? error.message : 'Speichern fehlgeschlagen.');
  }
}
