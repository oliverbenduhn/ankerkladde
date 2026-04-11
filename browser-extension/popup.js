const DEFAULT_API_URL = 'https://ankerkladde.benduhn.de';

const state = {
  apiUrl: DEFAULT_API_URL,
  apiKey: '',
  categories: [],
  preferences: {},
  currentTab: null,
  busy: false,
  defaults: {},
  recentSaves: [],
};

const DEFAULT_CATEGORY_KEYS = {
  links: 'defaultLinksCategory',
  notes: 'defaultNotesCategory',
  images: 'defaultImagesCategory',
  files: 'defaultFilesCategory',
};

function setStatus(message, type = 'ok') {
  const el = document.getElementById('status');
  el.textContent = message;
  el.className = `status ${type}`;
}

function setBusy(isBusy) {
  state.busy = isBusy;
  document.body.classList.toggle('is-busy', isBusy);
  document.querySelectorAll('button, input, select, textarea').forEach(element => {
    element.disabled = isBusy;
  });
}

function authHeaders() {
  return state.apiKey ? { 'X-API-Key': state.apiKey } : {};
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

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'omit',
    ...options,
    headers: {
      ...(options.headers || {}),
      ...authHeaders(),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(payload.error || 'API-Key ungültig oder abgelaufen.');
    }

    throw new Error(payload.error || `HTTP ${response.status}`);
  }

  return payload;
}

function getVisibleCategories(categories = state.categories) {
  return categories.filter(category => Number(category.is_hidden) !== 1);
}

function getSelectedCategory() {
  const sectionId = document.getElementById('section').value;
  return state.categories.find(category => String(category.id) === String(sectionId)) || null;
}

function getPreferredCategory() {
  const preferredId = Number(state.preferences?.last_category_id);
  if (Number.isInteger(preferredId) && preferredId > 0) {
    const preferred = getVisibleCategories().find(category => Number(category.id) === preferredId);
    if (preferred) {
      return preferred;
    }
  }

  return getVisibleCategories()[0] || null;
}

function getVisibleCategoryByType(type) {
  const configuredId = Number(state.defaults?.[type]);
  if (Number.isInteger(configuredId) && configuredId > 0) {
    const configured = getVisibleCategories().find(category => Number(category.id) === configuredId && category.type === type);
    if (configured) {
      return configured;
    }
  }

  return getVisibleCategories().find(category => category.type === type) || null;
}

function populateCategorySelect() {
  const select = document.getElementById('section');
  const visibleCategories = getVisibleCategories();
  const previousValue = select.value;
  select.innerHTML = '';

  if (visibleCategories.length === 0) {
    select.innerHTML = '<option value="">Keine sichtbaren Kategorien verfügbar</option>';
    updateFieldVisibility();
    return;
  }

  visibleCategories.forEach(category => {
    const option = document.createElement('option');
    option.value = String(category.id);
    option.textContent = `${category.icon || ''} ${category.name}`.trim();
    select.appendChild(option);
  });

  const preferredCategory = visibleCategories.find(category => String(category.id) === previousValue) || getPreferredCategory();
  if (preferredCategory) {
    select.value = String(preferredCategory.id);
  }

  updateFieldVisibility();
  populateDefaultCategorySelects();
}

function populateDefaultCategorySelects() {
  Object.entries(DEFAULT_CATEGORY_KEYS).forEach(([type, elementId]) => {
    const select = document.getElementById(elementId);
    if (!select) {
      return;
    }

    const currentValue = String(state.defaults?.[type] || '');
    select.innerHTML = '<option value="">Automatisch</option>';

    getVisibleCategories()
      .filter(category => category.type === type)
      .forEach(category => {
        const option = document.createElement('option');
        option.value = String(category.id);
        option.textContent = `${category.icon || ''} ${category.name}`.trim();
        if (String(category.id) === currentValue) {
          option.selected = true;
        }
        select.appendChild(option);
      });
  });
}

function getCurrentSectionFields() {
  const category = getSelectedCategory();
  if (!category) return ['name'];

  const fieldMap = {
    list_quantity: ['name', 'quantity'],
    list_due_date: ['name', 'due'],
    notes: ['name', 'content'],
    images: ['file'],
    files: ['file'],
    links: ['name'],
  };

  return fieldMap[category.type] || ['name'];
}

function updateFieldVisibility() {
  const visibleFields = getCurrentSectionFields();

  document.querySelectorAll('.section-fields').forEach(element => {
    element.classList.remove('visible');
  });

  visibleFields.forEach(field => {
    const element = document.getElementById(`field-${field}`);
    if (element) {
      element.classList.add('visible');
    }
  });

  applyCurrentTabDefaults();
}

function getTabTitle() {
  return (state.currentTab?.title || 'Unbenannte Seite').slice(0, 120);
}

function getTabUrl() {
  return normalizeUrl(state.currentTab?.url || '');
}

function setInputIfEmpty(id, value) {
  const element = document.getElementById(id);
  if (!element || element.value.trim() !== '' || !value) {
    return;
  }

  element.value = value;
}

function applyCurrentTabDefaults() {
  const category = getSelectedCategory();
  if (!category || !state.currentTab?.url) {
    return;
  }

  if (category.type === 'links') {
    setInputIfEmpty('name', getTabUrl());
  } else if (category.type === 'notes') {
    setInputIfEmpty('name', getTabTitle());
    setInputIfEmpty('content', getTabUrl());
  } else if (category.type === 'list_quantity' || category.type === 'list_due_date') {
    setInputIfEmpty('name', getTabTitle());
  }
}

async function rememberLastCategory(categoryId) {
  const normalizedId = Number(categoryId);
  if (!Number.isInteger(normalizedId) || normalizedId < 1 || !state.apiKey) {
    return;
  }

  state.preferences = { ...state.preferences, last_category_id: normalizedId };

  try {
    await requestJson(`${state.apiUrl}/api.php?action=preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ last_category_id: normalizedId }),
    });
  } catch (error) {
    console.error('Letzte Kategorie konnte nicht gespeichert werden:', error);
  }
}

async function loadCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.currentTab = tab || null;
  } catch (error) {
    state.currentTab = null;
  }
}

async function loadSettings() {
  const saved = await chrome.storage.local.get(['apiUrl', 'apiKey', 'categories', 'preferences', 'defaults', 'recentSaves']);
  state.apiUrl = (saved.apiUrl || DEFAULT_API_URL).replace(/\/$/, '');
  state.apiKey = saved.apiKey || '';
  state.categories = Array.isArray(saved.categories) ? saved.categories : [];
  state.preferences = saved.preferences || {};
  state.defaults = saved.defaults || {};
  state.recentSaves = Array.isArray(saved.recentSaves) ? saved.recentSaves : [];

  document.getElementById('apiUrl').value = state.apiUrl;
  document.getElementById('apiKey').value = state.apiKey;
  populateCategorySelect();
  renderRecentSaves();
}

async function saveSettings() {
  const nextApiUrl = document.getElementById('apiUrl').value.trim().replace(/\/$/, '') || DEFAULT_API_URL;
  const nextApiKey = document.getElementById('apiKey').value.trim();
  const changed = nextApiUrl !== state.apiUrl || nextApiKey !== state.apiKey;

  state.apiUrl = nextApiUrl;
  state.apiKey = nextApiKey;

  await chrome.storage.local.set({
    apiUrl: state.apiUrl,
    apiKey: state.apiKey,
    categories: state.categories,
    preferences: state.preferences,
    defaults: state.defaults,
    recentSaves: state.recentSaves,
  });

  if (!changed) {
    return;
  }

  state.categories = [];
  state.preferences = {};
  populateCategorySelect();

  if (state.apiKey) {
    await loadCategories();
  }
}

async function verifyKey() {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) {
    setStatus('Bitte API-Key eingeben.', 'err');
    return;
  }

  const apiUrl = document.getElementById('apiUrl').value.trim().replace(/\/$/, '') || DEFAULT_API_URL;

  setBusy(true);
  try {
    const response = await fetch(`${apiUrl}/api.php?action=categories_list`, {
      credentials: 'omit',
      headers: { 'X-API-Key': apiKey },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setStatus(payload.error || 'API-Key ungültig.', 'err');
      return;
    }

    state.apiUrl = apiUrl;
    state.apiKey = apiKey;
    state.categories = Array.isArray(payload.categories) ? payload.categories : [];
    state.preferences = payload.preferences || {};

    await chrome.storage.local.set({
      apiUrl: state.apiUrl,
      apiKey: state.apiKey,
      categories: state.categories,
      preferences: state.preferences,
      defaults: state.defaults,
      recentSaves: state.recentSaves,
    });

    populateCategorySelect();
    setStatus('API-Key funktioniert.', 'ok');
  } catch (error) {
    setStatus('Server nicht erreichbar oder URL nicht erlaubt.', 'err');
  } finally {
    setBusy(false);
  }
}

async function loadCategories() {
  if (!state.apiKey) {
    return;
  }

  try {
    const data = await requestJson(`${state.apiUrl}/api.php?action=categories_list`);
    state.categories = Array.isArray(data.categories) ? data.categories : [];
    state.preferences = data.preferences || {};

    await chrome.storage.local.set({
      categories: state.categories,
      preferences: state.preferences,
      defaults: state.defaults,
      recentSaves: state.recentSaves,
    });

    populateCategorySelect();
  } catch (error) {
    console.error('Kategorien konnten nicht geladen werden:', error);
    setStatus(error.message || 'Kategorien konnten nicht geladen werden.', 'err');
  }
}

function clearManualFields() {
  ['name', 'content', 'quantity', 'dueDate', 'fileInput'].forEach(id => {
    document.getElementById(id).value = '';
  });
}

function isRepeatableRecentSave(entry) {
  return ['page', 'link', 'note', 'item'].includes(String(entry?.actionType || ''));
}

async function recordRecentSave(entry) {
  const stampedEntry = {
    ...entry,
    at: new Date().toISOString(),
  };

  state.recentSaves = [stampedEntry, ...state.recentSaves].slice(0, 5);
  await chrome.storage.local.set({ recentSaves: state.recentSaves });
  renderRecentSaves();
}

function renderRecentSaves() {
  const list = document.getElementById('recentSaves');
  if (!list) {
    return;
  }

  list.innerHTML = '';
  if (state.recentSaves.length === 0) {
    list.innerHTML = '<p class="hint">Noch keine Aktionen gespeichert.</p>';
    return;
  }

  state.recentSaves.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'history-item';
    const title = document.createElement('strong');
    title.textContent = entry.title || 'Unbenannt';
    const meta = document.createElement('div');
    meta.className = 'history-meta';
    const text = document.createElement('div');
    text.className = 'history-text';
    text.textContent = `${entry.kind || 'Eintrag'} in ${entry.categoryName || 'Unbekannt'} • ${new Date(entry.at).toLocaleString('de-DE')}`;
    meta.appendChild(text);

    if (isRepeatableRecentSave(entry)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn small secondary';
      button.textContent = 'Nochmal';
      button.addEventListener('click', () => {
        void repeatRecentSave(entry);
      });
      meta.appendChild(button);
    }

    item.appendChild(title);
    item.appendChild(meta);
    list.appendChild(item);
  });
}

async function saveDefaultCategory(type, categoryId) {
  const normalizedId = Number(categoryId);
  if (Number.isInteger(normalizedId) && normalizedId > 0) {
    state.defaults = { ...state.defaults, [type]: normalizedId };
  } else {
    const nextDefaults = { ...state.defaults };
    delete nextDefaults[type];
    state.defaults = nextDefaults;
  }

  await chrome.storage.local.set({ defaults: state.defaults });
}

function selectCategory(categoryId) {
  if (!categoryId) {
    return null;
  }

  const category = getVisibleCategories().find(entry => Number(entry.id) === Number(categoryId)) || null;
  if (!category) {
    return null;
  }

  document.getElementById('section').value = String(category.id);
  updateFieldVisibility();
  return category;
}

async function repeatRecentSave(entry) {
  const category = selectCategory(entry.categoryId);
  if (!category) {
    setStatus('Kategorie aus dem Verlauf ist nicht mehr verfügbar.', 'err');
    return;
  }

  if (!state.currentTab?.url) {
    setStatus('Aktiver Tab konnte nicht gelesen werden.', 'err');
    return;
  }

  setBusy(true);
  try {
    const title = getTabTitle();
    const url = getTabUrl();

    if (entry.actionType === 'link') {
      await addItem(category, { name: url, content: '', quantity: '', dueDate: '' });
      setStatus('Link erneut gespeichert.', 'ok');
    } else if (entry.actionType === 'note') {
      await addItem(category, { name: title, content: url, quantity: '', dueDate: '' });
      setStatus('Notiz erneut gespeichert.', 'ok');
    } else {
      await addItem(category, { name: title, content: '', quantity: '', dueDate: '' });
      setStatus('Eintrag erneut gespeichert.', 'ok');
    }
  } catch (error) {
    setStatus(error.message, 'err');
  } finally {
    setBusy(false);
  }
}

async function addItem(category, values) {
  const normalizedName = category.type === 'links' ? normalizeUrl(values.name) : values.name;

  if (category.type === 'links') {
    const duplicate = await findDuplicateLink(normalizedName, category.id);
    if (duplicate) {
      throw new Error('Link ist in dieser Kategorie bereits vorhanden.');
    }
  }

  const formData = new FormData();
  formData.append('name', normalizedName);
  formData.append('category_id', String(category.id));

  if (values.content) {
    formData.append('content', values.content);
  }
  if (values.quantity) {
    formData.append('quantity', values.quantity);
  }
  if (values.dueDate) {
    formData.append('due_date', values.dueDate);
  }

  await requestJson(`${state.apiUrl}/api.php?action=add`, {
    method: 'POST',
    body: formData,
  });

  await rememberLastCategory(category.id);
  await recordRecentSave({
    kind: category.type === 'links' ? 'Link' : category.type === 'notes' ? 'Notiz' : 'Eintrag',
    actionType: category.type === 'links' ? 'link' : category.type === 'notes' ? 'note' : 'item',
    title: normalizedName,
    categoryId: category.id,
    categoryName: category.name,
  });
}

async function findDuplicateLink(url, categoryId) {
  const normalizedUrl = String(url || '').trim();
  if (normalizedUrl.length < 8) {
    return null;
  }

  const payload = await requestJson(`${state.apiUrl}/api.php?action=search&q=${encodeURIComponent(normalizedUrl)}`);
  const items = Array.isArray(payload.items) ? payload.items : [];
  return items.find(item =>
    Number(item.category_id) === Number(categoryId) &&
    String(item.name || '').trim() === normalizedUrl
  ) || null;
}

async function uploadFiles(category, files) {
  for (const file of files) {
    const formData = new FormData();
    formData.append('name', file.name.slice(0, 120));
    formData.append('category_id', String(category.id));
    formData.append('file', file);

    await requestJson(`${state.apiUrl}/api.php?action=upload`, {
      method: 'POST',
      body: formData,
    });
  }

  await rememberLastCategory(category.id);
  await recordRecentSave({
    kind: category.type === 'images' ? 'Bild' : 'Datei',
    actionType: category.type === 'images' ? 'image' : 'file',
    title: files.length === 1 ? files[0].name : `${files.length} Dateien`,
    categoryId: category.id,
    categoryName: category.name,
  });
}

async function saveManual() {
  const category = getSelectedCategory();
  const name = document.getElementById('name').value.trim();
  const content = document.getElementById('content').value.trim();
  const quantity = document.getElementById('quantity').value.trim();
  const dueDate = document.getElementById('dueDate').value;
  const files = Array.from(document.getElementById('fileInput').files || []);

  if (!category) {
    setStatus('Bitte Kategorie auswählen.', 'err');
    return;
  }

  const isFileCategory = category.type === 'images' || category.type === 'files';
  const isNotesCategory = category.type === 'notes';
  const isShoppingCategory = category.type === 'list_quantity';
  const isTodoCategory = category.type === 'list_due_date';

  if (isFileCategory && files.length === 0) {
    setStatus('Bitte mindestens eine Datei auswählen.', 'err');
    return;
  }

  if (!isFileCategory && !name && !content) {
    setStatus('Bitte einen Namen eingeben.', 'err');
    return;
  }

  setBusy(true);
  try {
    if (isFileCategory) {
      await uploadFiles(category, files);
      setStatus(files.length === 1 ? 'Datei gespeichert.' : `${files.length} Dateien gespeichert.`, 'ok');
    } else {
      await addItem(category, {
        name: name || content.slice(0, 120),
        content: isNotesCategory ? content : '',
        quantity: isShoppingCategory ? quantity.slice(0, 40) : '',
        dueDate: isTodoCategory ? dueDate : '',
      });
      setStatus('Eintrag gespeichert.', 'ok');
    }

    clearManualFields();
    applyCurrentTabDefaults();
  } catch (error) {
    setStatus(error.message, 'err');
  } finally {
    setBusy(false);
  }
}

async function saveCurrentPage() {
  const category = getSelectedCategory();
  if (!category) {
    setStatus('Bitte Kategorie auswählen.', 'err');
    return;
  }

  if (!state.currentTab?.url) {
    setStatus('Aktiver Tab konnte nicht gelesen werden.', 'err');
    return;
  }

  setBusy(true);
  try {
    const title = getTabTitle();
    const isLinksCategory = category.type === 'links';
    const isNotesCategory = category.type === 'notes';

    await addItem(category, {
      name: isNotesCategory ? title : (isLinksCategory ? getTabUrl() : title),
      content: isNotesCategory ? getTabUrl() : '',
      quantity: '',
      dueDate: '',
    });

    setStatus('Seite gespeichert.', 'ok');
  } catch (error) {
    setStatus(error.message, 'err');
  } finally {
    setBusy(false);
  }
}

async function quickSaveToCategory(category) {
  if (!category) {
    setStatus('Keine passende sichtbare Kategorie vorhanden.', 'err');
    return;
  }

  if (!state.currentTab?.url) {
    setStatus('Aktiver Tab konnte nicht gelesen werden.', 'err');
    return;
  }

  setBusy(true);
  try {
    const title = getTabTitle();
    const url = getTabUrl();

    if (category.type === 'links') {
      await addItem(category, { name: url, content: '', quantity: '', dueDate: '' });
      setStatus('Link gespeichert.', 'ok');
    } else if (category.type === 'notes') {
      await addItem(category, { name: title, content: url, quantity: '', dueDate: '' });
      setStatus('Notiz gespeichert.', 'ok');
    } else {
      await addItem(category, { name: title, content: '', quantity: '', dueDate: '' });
      setStatus('Seite gespeichert.', 'ok');
    }

    document.getElementById('section').value = String(category.id);
    updateFieldVisibility();
  } catch (error) {
    setStatus(error.message, 'err');
  } finally {
    setBusy(false);
  }
}

async function uploadDroppedFile(file) {
  const targetType = file.type.startsWith('image/') ? 'images' : 'files';
  const category = getVisibleCategories().find(entry => entry.type === targetType);
  if (!category) {
    throw new Error(targetType === 'images' ? 'Keine sichtbare Bilder-Kategorie vorhanden.' : 'Keine sichtbare Dateien-Kategorie vorhanden.');
  }

  await uploadFiles(category, [file]);
}

function setupDropzone() {
  const dropzone = document.getElementById('dropzone');

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, event => {
      event.preventDefault();
      event.stopPropagation();
    });
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, () => dropzone.classList.add('dragover'));
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, () => dropzone.classList.remove('dragover'));
  });

  dropzone.addEventListener('drop', async event => {
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length === 0) {
      return;
    }

    setBusy(true);
    try {
      for (const file of files) {
        await uploadDroppedFile(file);
      }
      setStatus(files.length === 1 ? `${files[0].name} gespeichert.` : `${files.length} Dateien gespeichert.`, 'ok');
    } catch (error) {
      setStatus(error.message, 'err');
    } finally {
      setBusy(false);
    }
  });
}

document.getElementById('section').addEventListener('change', () => {
  updateFieldVisibility();
  const category = getSelectedCategory();
  if (category) {
    void rememberLastCategory(category.id);
  }
});

document.getElementById('verifyBtn').addEventListener('click', verifyKey);
document.getElementById('setupBtn')?.addEventListener('click', async () => {
  const apiUrlInput = document.getElementById('apiUrl');
  const apiKeyInput = document.getElementById('apiKey');
  
  if (!apiUrlInput?.value?.trim() || !apiKeyInput?.value?.trim()) {
    setStatus('Bitte URL und API-Key eingeben.', 'err');
    return;
  }

  state.apiUrl = apiUrlInput.value.trim().replace(/\/$/, '') || DEFAULT_API_URL;
  state.apiKey = apiKeyInput.value.trim();
  
  setBusy(true);
  try {
    const response = await fetch(`${state.apiUrl}/api.php?action=categories_list`, {
      credentials: 'omit',
      headers: { 'X-API-Key': state.apiKey },
    });

    if (response.ok) {
      const data = await response.json();
      state.categories = data.categories || [];
      await chrome.storage.local.set({
        apiUrl: state.apiUrl,
        apiKey: state.apiKey,
        categories: state.categories,
      });
      document.getElementById('setupScreen').classList.remove('visible');
      document.getElementById('mainScreen').classList.add('visible');
      populateCategorySelect();
      setStatus('Verbunden!', 'ok');
    } else {
      const payload = await response.json().catch(() => ({}));
      setStatus(payload.error || 'Verbindung fehlgeschlagen.', 'err');
    }
  } catch (error) {
    setStatus('Verbindung fehlgeschlagen.', 'err');
  } finally {
    setBusy(false);
  }
});

document.getElementById('quickSaveLastBtn').addEventListener('click', async () => {
  await saveSettings();
  await quickSaveToCategory(getPreferredCategory());
});
document.getElementById('quickSaveLinkBtn').addEventListener('click', async () => {
  await saveSettings();
  await quickSaveToCategory(getVisibleCategoryByType('links'));
});
document.getElementById('quickSaveNoteBtn').addEventListener('click', async () => {
  await saveSettings();
  await quickSaveToCategory(getVisibleCategoryByType('notes'));
});
document.getElementById('quickFillBtn').addEventListener('click', () => {
  applyCurrentTabDefaults();
  setStatus('Tab-Daten eingefüllt.', 'ok');
});
document.getElementById('saveManualBtn').addEventListener('click', async () => {
  await saveSettings();
  await saveManual();
});
document.getElementById('savePageBtn').addEventListener('click', async () => {
  await saveSettings();
  await saveCurrentPage();
});

['apiUrl', 'apiKey'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    void saveSettings();
  });
});

Object.entries(DEFAULT_CATEGORY_KEYS).forEach(([type, elementId]) => {
  document.getElementById(elementId).addEventListener('change', event => {
    void saveDefaultCategory(type, event.target.value);
  });
});

(async () => {
  await loadCurrentTab();
  await loadSettings();
  if (state.apiKey) {
    await loadCategories();
  }
  setupDropzone();
  applyCurrentTabDefaults();
})();
