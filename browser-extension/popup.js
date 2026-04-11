const DEFAULT_API_URL = 'https://ankerkladde.benduhn.de';

const state = {
  apiUrl: DEFAULT_API_URL,
  apiKey: '',
  categories: [],
  preferences: {},
  currentTab: null,
  busy: false,
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
  return state.currentTab?.url || '';
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
  const saved = await chrome.storage.local.get(['apiUrl', 'apiKey', 'categories', 'preferences']);
  state.apiUrl = (saved.apiUrl || DEFAULT_API_URL).replace(/\/$/, '');
  state.apiKey = saved.apiKey || '';
  state.categories = Array.isArray(saved.categories) ? saved.categories : [];
  state.preferences = saved.preferences || {};

  document.getElementById('apiUrl').value = state.apiUrl;
  document.getElementById('apiKey').value = state.apiKey;
  populateCategorySelect();
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

async function addItem(category, values) {
  const formData = new FormData();
  formData.append('name', values.name);
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

(async () => {
  await loadCurrentTab();
  await loadSettings();
  if (state.apiKey) {
    await loadCategories();
  }
  setupDropzone();
  applyCurrentTabDefaults();
})();
