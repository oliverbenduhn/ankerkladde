chrome.runtime.onInstalled.addListener(() => {
  chrome.runtime.setUninstallURL('https://ankerkladde.benduhn.de');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'share') {
    handleIncomingShare(message.data);
  }
});

async function handleIncomingShare(data) {
  const { apiUrl } = await getSettings();
  
  const categoryId = data.files?.length > 0 
    ? (data.files[0].type.startsWith('image/') ? 'images' : 'files')
    : 'links';

  const formData = new FormData();
  formData.append('name', data.title || 'Geteilt');
  formData.append('category_id', categoryId);
  formData.append('content', data.text || data.url || '');
  
  if (data.files?.length > 0) {
    formData.append('file', data.files[0]);
  }

  try {
    const response = await fetch(`${apiUrl}/api.php?action=upload`, {
      method: 'POST',
      body: formData
    });
    return await response.json();
  } catch (err) {
    return { error: err.message };
  }
}

async function getSettings() {
  const result = await chrome.storage.local.get('apiUrl');
  return {
    apiUrl: result.apiUrl || 'https://ankerkladde.benduhn.de'
  };
}