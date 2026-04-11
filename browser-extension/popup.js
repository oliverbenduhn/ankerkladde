const DEFAULT_API_URL = 'https://ankerkladde.benduhn.de';

const state = {
  apiUrl: DEFAULT_API_URL,
  apiKey: '',
  categories: [],
};

function setStatus(message, type = 'ok') {
  const el = document.getElementById('status');
  el.textContent = message;
  el.className = `status ${type}`;
}

async function loadSettings() {
  const saved = await chrome.storage.local.get(['apiUrl', 'apiKey', 'categories']);
  state.apiUrl = (saved.apiUrl || DEFAULT_API_URL).replace(/\/$/, '');
  state.apiKey = saved.apiKey || '';
  state.categories = saved.categories || [];

  document.getElementById('apiUrl').value = state.apiUrl;
  document.getElementById('apiKey').value = state.apiKey;
  populateCategorySelect();

  if (state.apiKey) {
    await loadCategories();
  }
}

async function saveSettings() {
  state.apiUrl = document.getElementById('apiUrl').value.trim().replace(/\/$/, '') || DEFAULT_API_URL;
  state.apiKey = document.getElementById('apiKey').value.trim();
  const newKey = state.apiKey !== document.getElementById('apiKey').value.trim();
  state.apiKey = document.getElementById('apiKey').value.trim();

  await chrome.storage.local.set({
    apiUrl: state.apiUrl,
    apiKey: state.apiKey,
    categories: state.categories,
  });

  if (newKey && state.apiKey) {
    await loadCategories();
  }
}

function authHeaders() {
  return state.apiKey ? { 'X-API-Key': state.apiKey } : {};
}

async function verifyKey() {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) {
    setStatus('Bitte API-Key eingeben.', 'err');
    return;
  }

  const apiUrl = document.getElementById('apiUrl').value.trim().replace(/\/$/, '') || DEFAULT_API_URL;
  const testHeaders = { 'X-API-Key': apiKey };

  try {
    const response = await fetch(`${apiUrl}/api.php?action=categories_list`, {
      credentials: 'omit',
      headers: testHeaders,
    });

    if (response.ok) {
      setStatus('API-Key funktioniert!', 'ok');
      state.apiKey = apiKey;
      state.apiUrl = apiUrl;
      await chrome.storage.local.set({ apiUrl: state.apiUrl, apiKey: state.apiKey, categories: [] });
      await loadCategories();
    } else {
      const payload = await response.json().catch(() => ({}));
      setStatus(payload.error || 'API-Key ungültig.', 'err');
    }
  } catch (error) {
    setStatus('Verbindung fehlgeschlagen.', 'err');
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
    throw new Error(payload.error || `HTTP ${response.status}`);
  }

  return payload;
}

async function loadCategories() {
  if (!state.apiKey) return;

  try {
    const data = await requestJson(`${state.apiUrl}/api.php?action=categories_list`);
    if (data.categories) {
      state.categories = data.categories;
      await chrome.storage.local.set({ categories: state.categories });
      populateCategorySelect();
    }
  } catch (error) {
    console.error('Kategorien konnten nicht geladen werden:', error);
  }
}

function populateCategorySelect() {
  const select = document.getElementById('section');
  select.innerHTML = '';

  if (state.categories.length === 0) {
    select.innerHTML = '<option value="">Keine Kategorien (API-Key fehlt?)</option>';
    return;
  }

  state.categories.forEach(cat => {
    const option = document.createElement('option');
    option.value = cat.id;
    const icon = cat.icon || '';
    option.textContent = `${icon} ${cat.name}`.trim();
    select.appendChild(option);
  });
}

function getCurrentSectionFields() {
  const sectionId = document.getElementById('section').value;
  const category = state.categories.find(c => String(c.id) === String(sectionId));
  if (!category) return ['name'];

  const type = category.type;
  const fieldMap = {
    'list_quantity': ['name', 'quantity'],
    'list_due_date': ['name', 'due'],
    'notes': ['name', 'content'],
    'images': ['file'],
    'files': ['file'],
    'links': ['name'],
  };

  return fieldMap[type] || ['name'];
}

function updateFieldVisibility() {
  const visibleFields = getCurrentSectionFields();

  document.querySelectorAll('.section-fields').forEach(el => {
    el.classList.remove('visible');
  });

  visibleFields.forEach(field => {
    const el = document.getElementById(`field-${field}`);
    if (el) el.classList.add('visible');
  });
}

async function saveManual() {
  const sectionId = document.getElementById('section').value;
  const name = document.getElementById('name').value.trim();
  const content = document.getElementById('content').value.trim();
  const quantity = document.getElementById('quantity').value.trim();
  const dueDate = document.getElementById('dueDate').value;
  const fileInput = document.getElementById('fileInput');

  const category = state.categories.find(c => String(c.id) === String(sectionId));
  if (!category) {
    setStatus('Bitte Kategorie auswählen.', 'err');
    return;
  }

  const isFileCategory = category.type === 'images' || category.type === 'files';
  const isNotesCategory = category.type === 'notes';
  const isShoppingCategory = category.type === 'list_quantity';
  const isTodoCategory = category.type === 'list_due_date';

  if (isFileCategory) {
    if (!fileInput.files.length) {
      setStatus('Bitte eine Datei auswählen.', 'err');
      return;
    }

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('name', file.name.slice(0, 120));
    formData.append('category_id', sectionId);
    formData.append('file', file);

    try {
      await requestJson(`${state.apiUrl}/api.php?action=upload`, {
        method: 'POST',
        body: formData,
      });
      setStatus('Datei gespeichert.', 'ok');
      fileInput.value = '';
    } catch (error) {
      setStatus(error.message, 'err');
    }
    return;
  }

  if (!name && !content) {
    setStatus('Bitte einen Namen eingeben.', 'err');
    return;
  }

  const formData = new FormData();
  formData.append('name', name || content.slice(0, 120));

  if (isNotesCategory && content) {
    formData.append('content', content);
  }
  if (isShoppingCategory && quantity) {
    formData.append('quantity', quantity.slice(0, 40));
  }
  if (isTodoCategory && dueDate) {
    formData.append('due_date', dueDate);
  }

  formData.append('category_id', sectionId);

  try {
    await requestJson(`${state.apiUrl}/api.php?action=add`, {
      method: 'POST',
      body: formData,
    });
    setStatus('Eintrag gespeichert.', 'ok');
    document.getElementById('name').value = '';
    document.getElementById('content').value = '';
    document.getElementById('quantity').value = '';
    document.getElementById('dueDate').value = '';
    document.getElementById('fileInput').value = '';
  } catch (error) {
    setStatus(error.message, 'err');
  }
}

async function saveCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  const sectionId = document.getElementById('section').value;
  const category = state.categories.find(c => String(c.id) === String(sectionId));
  if (!category) {
    setStatus('Bitte Kategorie auswählen.', 'err');
    return;
  }

  const title = (tab.title || 'Unbenannte Seite').slice(0, 120);
  const isLinksCategory = category.type === 'links';
  const isNotesCategory = category.type === 'notes';

  const formData = new FormData();
  if (isNotesCategory) {
    formData.append('name', title);
    formData.append('content', tab.url);
  } else {
    formData.append('name', isLinksCategory ? tab.url : title);
    if (!isLinksCategory) formData.append('content', tab.url);
  }
  formData.append('category_id', sectionId);

  try {
    await requestJson(`${state.apiUrl}/api.php?action=add`, {
      method: 'POST',
      body: formData,
    });
    setStatus('Seite gespeichert.', 'ok');
  } catch (error) {
    setStatus(error.message, 'err');
  }
}

async function uploadFile(file) {
  const category = state.categories.find(c => c.type === 'images' || c.type === 'files');
  if (!category) {
    setStatus('Keine Bilder/Dateien-Kategorie vorhanden.', 'err');
    return;
  }

  const section = file.type.startsWith('image/') ? 'images' : 'files';
  const targetCat = state.categories.find(c => c.type === section);
  if (!targetCat) {
    setStatus(`${section}-Kategorie nicht vorhanden.`, 'err');
    return;
  }

  const formData = new FormData();
  formData.append('name', file.name.slice(0, 120));
  formData.append('category_id', targetCat.id);
  formData.append('file', file);

  try {
    await requestJson(`${state.apiUrl}/api.php?action=upload`, {
      method: 'POST',
      body: formData,
    });
    setStatus(`${file.name} gespeichert.`, 'ok');
  } catch (error) {
    setStatus(`${file.name}: ${error.message}`, 'err');
  }
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
    for (const file of files) {
      await uploadFile(file);
    }
  });
}

async function setupShareButton() {
  const btn = document.getElementById('shareBtn');
  if (!navigator.share) {
    btn.style.display = 'none';
    return;
  }

  btn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;

    try {
      await navigator.share({ title: tab.title, url: tab.url });
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setStatus('Teilen fehlgeschlagen.', 'err');
      }
    }
  });
}

document.getElementById('section').addEventListener('change', updateFieldVisibility);
document.getElementById('verifyBtn').addEventListener('click', verifyKey);

document.getElementById('saveManualBtn').addEventListener('click', saveManual);
document.getElementById('savePageBtn').addEventListener('click', async () => {
  await saveSettings();
  await saveCurrentPage();
});

['apiUrl', 'apiKey'].forEach(id => {
  document.getElementById(id).addEventListener('change', saveSettings);
});

(async () => {
  await loadSettings();
  if (state.apiKey) {
    await loadCategories();
  }
  setupDropzone();
  setupShareButton();
})();