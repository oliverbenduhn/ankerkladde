// Content Script: Intelligent Page Content Clipper for Ankerkladde

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'clip-page') {
    try {
      const result = extractMainArticle();
      sendResponse({ success: true, ...result });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }
  return true; // Keep message channel open for async response if needed
});

function extractMainArticle() {
  const title = document.title || 'Extrahierter Artikel';
  const url = window.location.href;

  // 1. Check if there is an <article> or <main> tag
  let rootCandidates = Array.from(document.querySelectorAll('article, [role="main"], main'));
  
  if (rootCandidates.length === 0) {
    // If no main/article tag, fallback to checking divs, sections
    rootCandidates = Array.from(document.querySelectorAll('div, section, td'));
  }

  let bestCandidate = document.body;
  let maxScore = -1;

  // Helper to score nodes based on text density and content signals
  rootCandidates.forEach(node => {
    // Skip tiny nodes or hidden ones
    if (node.offsetWidth === 0 || node.offsetHeight === 0) return;
    
    const text = node.innerText || '';
    if (text.trim().length < 150) return;

    // Density of paragraph children
    const paragraphs = node.querySelectorAll('p');
    let score = paragraphs.length * 20;

    // Bonus for text length
    score += Math.floor(text.trim().length / 100);

    // Filter by class/id matching positive/negative keyword signals
    const classIdStr = (String(node.className || '') + ' ' + String(node.id || '')).toLowerCase();
    
    const positiveKeywords = ['article', 'content', 'story', 'post', 'text', 'body', 'news'];
    const negativeKeywords = ['comment', 'sidebar', 'footer', 'nav', 'menu', 'ad', 'share', 'header', 'social', 'widget'];

    positiveKeywords.forEach(word => {
      if (classIdStr.includes(word)) score += 50;
    });

    negativeKeywords.forEach(word => {
      if (classIdStr.includes(word)) score -= 100;
    });

    if (score > maxScore) {
      maxScore = score;
      bestCandidate = node;
    }
  });

  // 2. Clean the selected best node
  const cleanClone = bestCandidate.cloneNode(true);

  // Remove unwanted elements
  const tagsToRemove = [
    'script', 'style', 'iframe', 'noscript', 'canvas', 'video', 'audio',
    'svg', 'form', 'button', 'input', 'select', 'textarea', 'nav', 'footer',
    'header', 'aside', '[role="banner"]', '.sidebar', '.menu', '.nav',
    '.comments', '.comment', '.ad', '.ads', '.share', '.social', '.widget'
  ];

  tagsToRemove.forEach(selector => {
    try {
      cleanClone.querySelectorAll(selector).forEach(el => el.remove());
    } catch (e) {}
  });

  // 3. Remove inline scripts, event handlers, and styles
  const allElements = cleanClone.querySelectorAll('*');
  allElements.forEach(el => {
    // Strip style, events, and script attributes
    Array.from(el.attributes).forEach(attr => {
      if (attr.name.startsWith('on') || ['style', 'class', 'id'].includes(attr.name)) {
        el.removeAttribute(attr.name);
      }
    });
  });

  // 4. Wrap remaining text paragraphs and headers into clean structure
  let htmlContent = '';
  const blockElements = cleanClone.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote');
  
  if (blockElements.length > 0) {
    blockElements.forEach(el => {
      const text = (el.textContent || '').trim();
      if (text.length > 10) {
        const tag = el.tagName.toLowerCase();
        htmlContent += `<${tag}>${escapeHtml(text)}</${tag}>\n`;
      }
    });
  } else {
    // Fallback: chunk by linebreaks if no paragraphs
    const lines = (cleanClone.innerText || '').split('\n');
    lines.forEach(line => {
      const cleanLine = line.trim();
      if (cleanLine.length > 20) {
        htmlContent += `<p>${escapeHtml(cleanLine)}</p>\n`;
      }
    });
  }

  // Fallback if empty
  if (htmlContent.trim() === '') {
    htmlContent = `<p>Kein Haupttext extrahierbar.</p>`;
  }

  // Prepend source link
  htmlContent = `<p><strong>Quelle:</strong> <a href="${url}" target="_blank">${escapeHtml(url)}</a></p>\n` + htmlContent;

  return {
    title: title.slice(0, 120),
    html: htmlContent
  };
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
