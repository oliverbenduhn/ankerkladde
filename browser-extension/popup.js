const DEFAULT_API_URL = 'https://ankerkladde.benduhn.de';

const SECTION_CONFIG = {
  links: {
    name: 'Links',
    fields: ['name'],
  },
  shopping: {
    name: 'Einkaufen',
    fields: ['name', 'quantity'],
  },
  todo: {
    name: 'Aufgaben',
    fields: ['name', 'due'],
  },
  notes: {
    name: 'Notizen',
    fields: ['name', 'content'],
  },
  images: {
    name: 'Bilder',
    fields: ['file'],
  },
  files: {
    name: 'Dateien',
    fields: ['file'],
  },
};

const state = {
  apiUrl: DEFAULT_API_URL,
  apiKey: '',
  section: 'links',
};

function setStatus(message, type = 'ok') {
  const el = document.getElementById('status');
  el.textContent = message;
  el.className = `status ${type}`;
}

async function loadSettings() {
  const saved = await chrome.storage.local.get(['apiUrl', 'apiKey', 'section']);
  state.apiUrl = (saved.apiUrl || DEFAULT_API_URL).replace(/\/$/, '');
  state.apiKey = saved.apiKey || '';
  state.section = saved.section || 'links';

  document.getElementById('apiUrl').value = state.apiUrl;
  document.getElementById('apiKey').value = state.apiKey;
  document.getElementById('section').value = state.section;
  updateFieldVisibility();
}

async function saveSettings() {
  state.apiUrl = document.getElementById('apiUrl').value.trim().replace(/\/$/, '') || DEFAULT_API_URL;
  state.apiKey = document.getElementById('apiKey').value.trim();
  state.section = document.getElementById('section').value;

  await chrome.storage.local.set({
    apiUrl: state.apiUrl,
    apiKey: state.apiKey,
    section: state.section,
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
    throw new Error(payload.error || `HTTP ${response.status}`);
  }

  return payload;
}

function updateFieldVisibility() {
  const config = SECTION_CONFIG[state.section] || SECTION_CONFIG.links;
  const visibleFields = config.fields;

  document.querySelectorAll('.section-fields').forEach(el => {
    el.classList.remove('visible');
  });

  visibleFields.forEach(field => {
    const el = document.getElementById(`field-${field}`);
    if (el) el.classList.add('visible');
  });
}

async function saveManual() {
  const name = document.getElementById('name').value.trim();
  const content = document.getElementById('content').value.trim();
  const quantity = document.getElementById('quantity').value.trim();
  const dueDate = document.getElementById('dueDate').value;
  const fileInput = document.getElementById('fileInput');

  const isFileCategory = state.section === 'images' || state.section === 'files';
  const isNotesCategory = state.section === 'notes';
  const isTodoCategory = state.section === 'todo';
  const isShoppingCategory = state.section === 'shopping';

  if (isFileCategory) {
    if (!fileInput.files.length) {
      setStatus('Bitte eine Datei auswählen.', 'err');
      return;
    }

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('name', file.name.slice(0, 120));
    formData.append('section', state.section);
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

  formData.append('section', state.section);

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

  const title = (tab.title || 'Unbenannte Seite').slice(0, 120);
  const isLinksCategory = state.section === 'links';
  const isNotesCategory = state.section === 'notes';

  const formData = new FormData();
  if (isNotesCategory) {
    formData.append('name', title);
    formData.append('content', tab.url);
  } else {
    formData.append('name', isLinksCategory ? tab.url : title);
    if (!isLinksCategory) formData.append('content', tab.url);
  }
  formData.append('section', state.section);

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
  const section = file.type.startsWith('image/') ? 'images' : 'files';
  const formData = new FormData();
  formData.append('name', file.name.slice(0, 120));
  formData.append('section', section);
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

document.getElementById('section').addEventListener('change', () => {
  state.section = document.getElementById('section').value;
  saveSettings();
  updateFieldVisibility();
});

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
  setupDropzone();
  setupShareButton();
})();