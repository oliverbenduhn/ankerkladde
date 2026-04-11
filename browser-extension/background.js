const DEFAULT_API_URL = 'https://ankerkladde.benduhn.de';

const MENU_IDS = {
  savePage: 'ankerkladde-save-page',
  saveLink: 'ankerkladde-save-link',
  saveImage: 'ankerkladde-save-image',
  saveSelection: 'ankerkladde-save-selection',
};

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
  });
}

async function getSettings() {
  const result = await chrome.storage.local.get(['apiUrl', 'apiKey']);
  return {
    apiUrl: (result.apiUrl || DEFAULT_API_URL).replace(/\/$/, ''),
    apiKey: result.apiKey || '',
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
  const { apiUrl, apiKey } = await getSettings();
  const payload = await requestJson(apiUrl, apiKey, 'categories_list');
  const categories = Array.isArray(payload.categories) ? payload.categories : [];
  const visibleCategories = categories.filter(category => Number(category.is_hidden) !== 1);

  return {
    apiUrl,
    apiKey,
    categories,
    visibleCategories,
    preferences: payload.preferences || {},
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
    return categories.find(category => category.type === type) || null;
  }

  return categories[0] || null;
}

async function rememberLastCategory(apiUrl, apiKey, categoryId) {
  await requestJson(apiUrl, apiKey, 'preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ last_category_id: Number(categoryId) }),
  });
}

async function addItem(apiUrl, apiKey, categoryId, values) {
  const formData = new FormData();
  formData.append('category_id', String(categoryId));
  formData.append('name', values.name);

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

    if (info.menuItemId === MENU_IDS.savePage) {
      await saveCurrentPage(context, tab);
      return;
    }

    if (info.menuItemId === MENU_IDS.saveLink) {
      const category = chooseCategory(context.visibleCategories, context.preferences, 'links');
      if (!category || !info.linkUrl) {
        throw new Error('Keine sichtbare Link-Kategorie vorhanden.');
      }

      await addItem(context.apiUrl, context.apiKey, category.id, {
        name: info.linkUrl,
        content: '',
      });
      await rememberLastCategory(context.apiUrl, context.apiKey, category.id);
      return;
    }

    if (info.menuItemId === MENU_IDS.saveImage) {
      const category = chooseCategory(context.visibleCategories, context.preferences, 'images');
      if (!category || !info.srcUrl) {
        throw new Error('Keine sichtbare Bilder-Kategorie vorhanden.');
      }

      await uploadRemoteFile(context.apiUrl, context.apiKey, category.id, info.srcUrl, 'bild');
      await rememberLastCategory(context.apiUrl, context.apiKey, category.id);
      return;
    }

    if (info.menuItemId === MENU_IDS.saveSelection) {
      const category = chooseCategory(context.visibleCategories, context.preferences, 'notes');
      if (!category || !info.selectionText) {
        throw new Error('Keine sichtbare Notiz-Kategorie vorhanden.');
      }

      const pageUrl = tab?.url || '';
      const content = pageUrl ? `${info.selectionText}\n\nQuelle: ${pageUrl}` : info.selectionText;
      await addItem(context.apiUrl, context.apiKey, category.id, {
        name: (tab?.title || 'Markierter Text').slice(0, 120),
        content,
      });
      await rememberLastCategory(context.apiUrl, context.apiKey, category.id);
    }
  } catch (error) {
    console.error('Kontextmenü-Aktion fehlgeschlagen:', error);
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
    name: isNotesCategory ? title : (isLinksCategory ? targetTab.url : title),
    content: isNotesCategory ? targetTab.url : '',
  });
  await rememberLastCategory(context.apiUrl, context.apiKey, category.id);
}

async function saveCurrentPageFromActiveTab() {
  try {
    const context = await loadContext();
    await saveCurrentPage(context, null);
  } catch (error) {
    console.error('Shortcut-Speicherung fehlgeschlagen:', error);
  }
}
