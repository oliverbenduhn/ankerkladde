const DEFAULT_API_URL = 'https://ankerkladde.benduhn.de';

const state = {
  apiUrl: DEFAULT_API_URL,
  apiKey: '',
  targetSection: 'links',
};

function setStatus(message, type = 'ok') {
  const el = document.getElementById('status');
  el.textContent = message;
  el.className = `status ${type}`;
}

async function loadSettings() {
  const saved = await chrome.storage.local.get(['apiUrl', 'apiKey', 'targetSection']);
  state.apiUrl = (saved.apiUrl || DEFAULT_API_URL).replace(/\/$/, '');
  state.apiKey = saved.apiKey || '';
  state.targetSection = saved.targetSection || 'links';

  document.getElementById('apiUrl').value = state.apiUrl;
  document.getElementById('apiKey').value = state.apiKey;
  document.getElementById('targetSection').value = state.targetSection;
}

async function saveSettings() {
  state.apiUrl = document.getElementById('apiUrl').value.trim().replace(/\/$/, '') || DEFAULT_API_URL;
  state.apiKey = document.getElementById('apiKey').value.trim();
  state.targetSection = document.getElementById('targetSection').value;

  await chrome.storage.local.set({
    apiUrl: state.apiUrl,
    apiKey: state.apiKey,
    targetSection: state.targetSection,
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

async function saveCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  const title = (tab.title || 'Unbenannte Seite').slice(0, 120);
  const formData = new FormData();
  if (state.targetSection === 'notes') {
    formData.append('name', title);
    formData.append('content', tab.url);
  } else {
    formData.append('name', tab.url);
  }
  formData.append('section', state.targetSection);

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

document.getElementById('savePageBtn').addEventListener('click', async () => {
  await saveSettings();
  await saveCurrentPage();
});

['apiUrl', 'apiKey', 'targetSection'].forEach(id => {
  document.getElementById(id).addEventListener('change', saveSettings);
});

(async () => {
  await loadSettings();
  setupDropzone();
  setupShareButton();
})();
