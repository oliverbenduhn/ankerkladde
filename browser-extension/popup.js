// popup.js: UI Logic for Ankerkladde Browser Extension (v5.0)

const DEFAULT_API_URL = 'https://ankerkladde.benduhn.de';

const THEME_FALLBACK = {
  hafenblau: {
    tokens: {
      '--bg': '#dce8f0',
      '--surface': '#eaf3f8',
      '--border': '#b8d0e0',
      '--text-primary': '#0d3a5c',
      '--text-secondary': '#3a7090',
      '--text-muted': '#7aaac0',
      '--accent': '#1a6090',
      '--done-bg': '#d0e5f0',
      '--error': '#c0392b',
      '--button-active-bg': '#1a6090',
      '--button-active-text': '#ffffff',
      '--toast-success-bg': 'rgba(26, 144, 112, 0.12)',
      '--toast-success-text': '#0d3a2e',
      '--toast-error-bg': 'rgba(192, 57, 43, 0.12)',
      '--toast-error-text': '#6e1a10',
      '--brand-mark-surface': 'rgba(236, 246, 252, 0.94)',
      '--brand-mark-border': 'rgba(25, 96, 144, 0.2)',
      '--brand-mark-shadow': '0 14px 28px rgba(16, 72, 112, 0.2)',
      '--brand-mark-filter': 'saturate(1) contrast(1)',
      '--font-family': 'system-ui, -apple-system, sans-serif',
    },
  },
};

const THEMES = globalThis.ANKERKLADDE_THEMES || THEME_FALLBACK;

const state = {
  apiUrl: DEFAULT_API_URL,
  apiKey: '',
  categories: [],
  preferences: {},
  currentTab: null,
  busy: false,
  defaults: {},
  recentSaves: [],
  theme: 'hafenblau',
  magicPreviewItems: [],
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

function applyTheme(themeName) {
  const theme = THEMES[themeName] || THEMES.hafenblau || THEME_FALLBACK.hafenblau;
  const tokens = theme.tokens || {};
  const root = document.documentElement;

  Object.entries(tokens).forEach(([token, value]) => {
    root.style.setProperty(token, value);
  });

  root.style.setProperty('--accent-contrast', tokens['--accent-contrast'] || '#ffffff');
  root.style.setProperty('--surface-strong', tokens['--surface'] || '#ffffff');
  root.style.setProperty('--surface-soft', tokens['--done-bg'] || tokens['--surface'] || '#ffffff');
  root.style.setProperty('--overlay-shadow', tokens['--brand-mark-shadow'] || '0 18px 40px rgba(0,0,0,0.16)');
  root.style.setProperty('--font-family', tokens['--font-family'] || 'system-ui, -apple-system, sans-serif');

  state.theme = themeName;
  document.body.dataset.theme = themeName;
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

function isMaskedApiKeyValue(value) {
  return /^\*+$/.test(String(value || '').trim());
}

function getStoredOrEditedApiKey() {
  const apiKeyEditInput = document.getElementById('apiKeyEdit');
  const apiKeySetupInput = document.getElementById('apiKey');
  const editValue = apiKeyEditInput?.value.trim() || '';
  const setupValue = apiKeySetupInput?.value.trim() || '';

  if (apiKeyEditInput?.dataset.hasKey === 'true' && (editValue === '' || isMaskedApiKeyValue(editValue))) {
    return state.apiKey || setupValue || '';
  }

  return editValue || setupValue || '';
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
  await chrome.storage.local.set({ preferences: state.preferences });
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

  const prefs = state.preferences || {};
  const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effectiveTheme = (prefs.theme_mode === 'dark') || (prefs.theme_mode === 'auto' && isDark)
    ? (prefs.dark_theme || 'nachtwache')
    : (prefs.light_theme || 'hafenblau');
  applyTheme(effectiveTheme);

  const apiUrlInput = document.getElementById('apiUrlEdit');
  const apiKeyInput = document.getElementById('apiKeyEdit');
  const apiUrlSetup = document.getElementById('apiUrl');
  const apiKeySetup = document.getElementById('apiKey');
  
  if (apiUrlInput) apiUrlInput.value = state.apiUrl;
  if (apiKeyInput) {
    apiKeyInput.value = state.apiKey ? '*'.repeat(Math.min(32, state.apiKey.length)) : '';
    apiKeyInput.dataset.hasKey = state.apiKey ? 'true' : 'false';
  }
  if (apiUrlSetup) apiUrlSetup.value = state.apiUrl;
  if (apiKeySetup) apiKeySetup.value = state.apiKey;
  
  populateCategorySelect();
  renderRecentSaves();
  updateOfflineBanner();
}

async function saveSettings() {
  const nextApiUrl = document.getElementById('apiUrlEdit')?.value.trim().replace(/\/$/, '') 
    || document.getElementById('apiUrl')?.value.trim().replace(/\/$/, '') 
    || DEFAULT_API_URL;
  const nextApiKey = getStoredOrEditedApiKey();
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

  const apiKeyEditInput = document.getElementById('apiKeyEdit');
  if (apiKeyEditInput) {
    apiKeyEditInput.value = state.apiKey ? '*'.repeat(Math.min(32, state.apiKey.length)) : '';
    apiKeyEditInput.dataset.hasKey = state.apiKey ? 'true' : 'false';
  }

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
  const apiKeyInput = document.getElementById('apiKeyEdit');
  let apiKey = getStoredOrEditedApiKey();
  
  if (!apiKey) {
    setStatus('Bitte API-Key eingeben.', 'err');
    return;
  }

  const apiUrlInput = document.getElementById('apiUrlEdit');
  const apiUrl = (apiUrlInput?.value.trim().replace(/\/$/, '') || DEFAULT_API_URL);

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
    state.preferences = { ...(payload.preferences || {}), last_category_id: state.preferences?.last_category_id };

    await chrome.storage.local.set({
      apiUrl: state.apiUrl,
      apiKey: state.apiKey,
      categories: state.categories,
      preferences: state.preferences,
      defaults: state.defaults,
      recentSaves: state.recentSaves,
    });

    if (apiKeyInput) {
      apiKeyInput.value = '*'.repeat(Math.min(32, state.apiKey.length));
      apiKeyInput.dataset.hasKey = 'true';
    }

    setStatus('API-Key funktioniert!', 'ok');
    populateCategorySelect();
    
    // Notify Background Service Worker to update Context Menus
    chrome.runtime.sendMessage({ action: 'update-context-menus', categories: state.categories });
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
    state.preferences = { ...(data.preferences || {}), last_category_id: state.preferences?.last_category_id };

    await chrome.storage.local.set({
      categories: state.categories,
      preferences: state.preferences,
      defaults: state.defaults,
      recentSaves: state.recentSaves,
    });

    const prefs = state.preferences || {};
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const effectiveTheme = (prefs.theme_mode === 'dark') || (prefs.theme_mode === 'auto' && isDark)
      ? (prefs.dark_theme || 'nachtwache')
      : (prefs.light_theme || 'hafenblau');
    applyTheme(effectiveTheme);

    populateCategorySelect();
    
    // Re-build Context Menus dynamically
    chrome.runtime.sendMessage({ action: 'update-context-menus', categories: state.categories });
  } catch (error) {
    console.error('Kategorien konnten nicht geladen werden:', error);
    setStatus(error.message || 'Kategorien konnten nicht geladen werden.', 'err');
  }
}

function clearManualFields() {
  ['name', 'content', 'quantity', 'dueDate', 'fileInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
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

  const title = getTabTitle();
  const url = getTabUrl();

  if (entry.actionType === 'link') {
    await addItem(category, { name: url, content: '', quantity: '', dueDate: '' });
  } else if (entry.actionType === 'note') {
    await addItem(category, { name: title, content: url, quantity: '', dueDate: '' });
  } else {
    await addItem(category, { name: title, content: '', quantity: '', dueDate: '' });
  }
}

async function addItem(category, values) {
  setBusy(true);
  try {
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({
        action: 'save-item',
        category: category,
        values: values
      }, resolve);
    });

    if (!response || !response.success) {
      throw new Error(response?.error || 'Verbindung zum Ankerkladde-Server fehlgeschlagen.');
    }

    if (response.offline) {
      setStatus('Offline gesichert — wird automatisch synchronisiert.', 'ok');
    } else {
      setStatus('Eintrag gespeichert.', 'ok');
      await recordRecentSave({
        kind: category.type === 'links' ? 'Link' : category.type === 'notes' ? 'Notiz' : 'Eintrag',
        actionType: category.type === 'links' ? 'link' : category.type === 'notes' ? 'note' : 'item',
        title: values.name,
        categoryId: category.id,
        categoryName: category.name,
      });
    }

    clearManualFields();
    applyCurrentTabDefaults();
    updateOfflineBanner();
  } catch (error) {
    setStatus(error.message, 'err');
  } finally {
    setBusy(false);
  }
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
      clearManualFields();
      applyCurrentTabDefaults();
    } else {
      await addItem(category, {
        name: name || content.slice(0, 120),
        content: isNotesCategory ? content : '',
        quantity: isShoppingCategory ? quantity.slice(0, 40) : '',
        dueDate: isTodoCategory ? dueDate : '',
      });
    }
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

  const title = getTabTitle();
  const isLinksCategory = category.type === 'links';
  const isNotesCategory = category.type === 'notes';

  await addItem(category, {
    name: isNotesCategory ? title : (isLinksCategory ? getTabUrl() : title),
    content: isNotesCategory ? getTabUrl() : '',
    quantity: '',
    dueDate: '',
  });
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

  const title = getTabTitle();
  const url = getTabUrl();

  if (category.type === 'links') {
    await addItem(category, { name: url, content: '', quantity: '', dueDate: '' });
  } else if (category.type === 'notes') {
    await addItem(category, { name: title, content: url, quantity: '', dueDate: '' });
  } else {
    await addItem(category, { name: title, content: '', quantity: '', dueDate: '' });
  }
  
  document.getElementById('section').value = String(category.id);
  updateFieldVisibility();
}

// ── ARTICLE PAGE CLIPPER ──

function clipPage() {
  if (!state.currentTab || !state.currentTab.id) {
    setStatus('Aktiver Tab steht nicht bereit.', 'err');
    return;
  }

  setBusy(true);
  chrome.tabs.sendMessage(state.currentTab.id, { action: 'clip-page' }, (response) => {
    setBusy(false);
    
    if (chrome.runtime.lastError) {
      setStatus('Clipping nicht möglich auf dieser Seite. Bitte Seite neu laden.', 'err');
      return;
    }

    if (response && response.success) {
      const notesCat = getVisibleCategoryByType('notes');
      if (notesCat) {
        document.getElementById('section').value = String(notesCat.id);
        updateFieldVisibility();
        document.getElementById('name').value = response.title;
        document.getElementById('content').value = response.html;
        setStatus('Hauptinhalt extrahiert und als Notiz eingefügt.', 'ok');
      } else {
        setStatus('Keine sichtbare Notiz-Kategorie zum Einfügen vorhanden.', 'err');
      }
    } else {
      setStatus('Text-Extraktion fehlgeschlagen: ' + (response?.error || 'Unbekannter Fehler'), 'err');
    }
  });
}

// ── AI MAGIC BAR LOGIC ──

async function submitMagicInput() {
  const inputEl = document.getElementById('magicInput');
  const userInput = inputEl.value.trim();
  
  if (!userInput) {
    setStatus('Bitte Text in die AI Magic Bar eingeben.', 'err');
    return;
  }

  setBusy(true);
  try {
    const payload = await requestJson(`${state.apiUrl}/public/ai.php`, {
      method: 'POST',
      body: JSON.stringify({
        input: userInput,
        mode: 'preview',
        active_category_id: getSelectedCategory()?.id || 0
      })
    });

    if (payload.success && Array.isArray(payload.items) && payload.items.length > 0) {
      state.magicPreviewItems = payload.items;
      renderMagicPreview(payload.items);
      setStatus('KI-Vorschau geladen.', 'ok');
    } else if (payload.success && payload.clarification) {
      setStatus(`KI-Rückfrage: ${payload.clarification}`, 'err');
    } else {
      setStatus('Keine Einträge erkannt.', 'err');
    }
  } catch (error) {
    setStatus(error.message || 'KI-Anfrage fehlgeschlagen.', 'err');
  } finally {
    setBusy(false);
  }
}

function renderMagicPreview(items) {
  const panel = document.getElementById('magicPreviewPanel');
  const list = document.getElementById('magicPreviewList');
  list.innerHTML = '';
  
  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'magic-preview-item';
    
    const nameSpan = document.createElement('span');
    nameSpan.style.flex = '1';
    nameSpan.style.fontWeight = '600';
    nameSpan.textContent = item.name + (item.quantity ? ` (${item.quantity})` : '');
    
    const tag = document.createElement('span');
    tag.className = 'magic-preview-tag';
    tag.textContent = item.category_name || 'Eintrag';
    
    div.appendChild(nameSpan);
    div.appendChild(tag);
    list.appendChild(div);
  });
  
  panel.style.display = 'flex';
}

async function confirmMagicInput() {
  if (state.magicPreviewItems.length === 0) return;

  setBusy(true);
  try {
    const payload = await requestJson(`${state.apiUrl}/public/ai.php`, {
      method: 'POST',
      body: JSON.stringify({
        items: state.magicPreviewItems,
        mode: 'confirm'
      })
    });

    if (payload.success) {
      setStatus(payload.toast_message || `${payload.added_count} Einträge hinzugefügt.`, 'ok');
      document.getElementById('magicInput').value = '';
      cancelMagicPreview();
      
      // Update recent history
      for (const item of state.magicPreviewItems) {
        await recordRecentSave({
          kind: 'Magic Eintrag',
          actionType: 'item',
          title: item.name,
          categoryId: item.category_id,
          categoryName: item.category_name || 'Automatisch'
        });
      }
    } else {
      setStatus('Einträge konnten nicht bestätigt werden.', 'err');
    }
  } catch (error) {
    setStatus(error.message || 'KI-Bestätigung fehlgeschlagen.', 'err');
  } finally {
    setBusy(false);
  }
}

function cancelMagicPreview() {
  state.magicPreviewItems = [];
  document.getElementById('magicPreviewPanel').style.display = 'none';
  document.getElementById('magicPreviewList').innerHTML = '';
}

// ── OFFLINE STATUS & CONTROL PANEL ──

async function updateOfflineBanner() {
  const result = await chrome.storage.local.get(['offlineQueue']);
  const queue = Array.isArray(result.offlineQueue) ? result.offlineQueue : [];
  const banner = document.getElementById('offlineBanner');
  const bannerText = document.getElementById('offlineBannerText');

  if (queue.length > 0) {
    banner.style.display = 'block';
    bannerText.textContent = `${queue.length} Aktionen offline gesichert.`;
  } else {
    banner.style.display = 'none';
  }
  
  renderOfflineQueueDetails();
}

function renderOfflineQueueDetails() {
  const list = document.getElementById('offlineQueueList');
  if (!list) return;
  
  chrome.storage.local.get(['offlineQueue'], (result) => {
    const queue = Array.isArray(result.offlineQueue) ? result.offlineQueue : [];
    list.innerHTML = '';
    
    if (queue.length === 0) {
      list.innerHTML = '<p class="hint">Keine ausstehenden Offline-Einträge.</p>';
      return;
    }
    
    queue.forEach(item => {
      const div = document.createElement('div');
      div.className = 'history-item';
      div.style.gridTemplateColumns = '1fr auto';
      div.style.display = 'grid';
      div.style.alignItems = 'center';
      
      const textDiv = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = item.title;
      const details = document.createElement('span');
      details.className = 'hint';
      details.textContent = `${item.kind} in ${item.categoryName}`;
      textDiv.appendChild(title);
      textDiv.appendChild(details);
      
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn small secondary';
      deleteBtn.style.padding = '6px';
      deleteBtn.style.minHeight = 'auto';
      deleteBtn.innerHTML = '<svg class="icon" style="width:16px; height:16px; margin:0;"><use href="#i-trash"></use></svg>';
      deleteBtn.addEventListener('click', async () => {
        await removeOfflineItem(item.id);
      });
      
      div.appendChild(textDiv);
      div.appendChild(deleteBtn);
      list.appendChild(div);
    });
  });
}

async function removeOfflineItem(itemId) {
  const result = await chrome.storage.local.get(['offlineQueue']);
  const queue = Array.isArray(result.offlineQueue) ? result.offlineQueue : [];
  const nextQueue = queue.filter(item => item.id !== itemId);
  
  await chrome.storage.local.set({ offlineQueue: nextQueue });
  await updateOfflineBanner();
  setStatus('Offline-Eintrag verworfen.', 'ok');
}

async function syncOfflineQueue() {
  setBusy(true);
  setStatus('Synchronisiere offline gespeicherte Einträge...', 'ok');
  
  chrome.runtime.sendMessage({ action: 'sync-offline-queue' }, async (response) => {
    setBusy(false);
    if (response && response.success) {
      await updateOfflineBanner();
      if (response.synced > 0) {
        setStatus(`${response.synced} Einträge erfolgreich synchronisiert.`, 'ok');
      } else {
        setStatus('Keine Verbindung zum Server möglich.', 'err');
      }
    } else {
      setStatus(response?.error || 'Synchronisierung fehlgeschlagen.', 'err');
    }
  });
}

// ── DROPZONE ENGNE ──

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

// ── APP EVENT BINDINGS ──

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
      state.preferences = { ...(data.preferences || {}), last_category_id: state.preferences?.last_category_id };
      await chrome.storage.local.set({
        apiUrl: state.apiUrl,
        apiKey: state.apiKey,
        categories: state.categories,
        preferences: state.preferences,
      });
      
      const apiKeyEditInput = document.getElementById('apiKeyEdit');
      if (apiKeyEditInput) {
        apiKeyEditInput.value = '*'.repeat(Math.min(32, state.apiKey.length));
        apiKeyEditInput.dataset.hasKey = 'true';
      }
      
      setAuthenticatedView(true);
      document.querySelector('[data-tab="save"]').classList.add('active');
      document.querySelector('[data-tab="settings"]').classList.remove('active');
      document.getElementById('tab-save').classList.add('active');
      document.getElementById('tab-settings').classList.remove('active');
      populateCategorySelect();
      setStatus('Verbunden!', 'ok');
      
      // Notify Background script to setup Context Menus
      chrome.runtime.sendMessage({ action: 'update-context-menus', categories: state.categories });
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
document.getElementById('clipPageBtn').addEventListener('click', () => {
  clipPage();
});

// AI Magic Bar bindings
document.getElementById('magicSubmitBtn').addEventListener('click', submitMagicInput);
document.getElementById('magicInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void submitMagicInput();
  }
});
document.getElementById('magicConfirmBtn').addEventListener('click', confirmMagicInput);
document.getElementById('magicCancelBtn').addEventListener('click', cancelMagicPreview);

// Offline sync bindings
document.getElementById('syncOfflineBtn').addEventListener('click', syncOfflineQueue);

['apiUrlEdit', 'apiKeyEdit'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', () => {
    void saveSettings();
  });
});

const setupScreen = document.getElementById('setupScreen');
const mainContent = document.querySelector('.content');
const topTabs = document.getElementById('topTabs');

function setAuthenticatedView(isAuthenticated) {
  if (setupScreen) {
    setupScreen.classList.toggle('visible', !isAuthenticated);
    setupScreen.style.display = isAuthenticated ? 'none' : '';
  }

  if (mainContent) {
    mainContent.style.display = isAuthenticated ? 'grid' : 'none';
  }

  if (topTabs) {
    topTabs.classList.toggle('hidden', !isAuthenticated);
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const content = document.getElementById('tab-' + btn.dataset.tab);
    if (content) content.classList.add('active');
    
    // Rerender Offline details in Settings if clicked
    if (btn.dataset.tab === 'settings') {
      renderOfflineQueueDetails();
    }
  });
});

Object.entries(DEFAULT_CATEGORY_KEYS).forEach(([type, elementId]) => {
  document.getElementById(elementId).addEventListener('change', event => {
    void saveDefaultCategory(type, event.target.value);
  });
});

(async () => {
  const manifest = chrome.runtime.getManifest();
  const versionText = document.getElementById('versionText');
  if (versionText) versionText.textContent = manifest.version;

  await loadCurrentTab();
  await loadSettings();
  
  if (!state.apiKey) {
    setAuthenticatedView(false);
    setStatus('Bitte Ankerkladde verbinden.', 'err');
  } else {
    await loadCategories();
    setAuthenticatedView(true);
  }
  
  setupDropzone();
  applyCurrentTabDefaults();

  document.getElementById('topbarHome')?.addEventListener('click', async () => {
    const url = (state.apiUrl || DEFAULT_API_URL).replace(/\/$/, '');
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find(t => t.url && (t.url === url || t.url === url + '/' || t.url.startsWith(url + '/')));
    if (existing) {
      await chrome.tabs.update(existing.id, { active: true });
      if (existing.windowId) {
        await chrome.windows.update(existing.windowId, { focused: true });
      }
    } else {
      await chrome.tabs.create({ url });
    }
    window.close();
  });
})();
