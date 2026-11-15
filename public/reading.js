/* Apply the saved reading size before painting the page. */
try {
  const preference = JSON.parse(localStorage.getItem('isolate.preferences.v1') || '{}');
  document.documentElement.dataset.textSize = ['default', 'large', 'extra'].includes(preference?.textSize) ? preference.textSize : 'default';
} catch { document.documentElement.dataset.textSize = 'default'; }
