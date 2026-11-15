/* Apply the saved reading size before painting the page. */
try {
  const preference = JSON.parse(localStorage.getItem('isolate.preferences.v1') || '{}');
  document.documentElement.dataset.theme = ['rose','night','sakura'].includes(preference?.theme) ? preference.theme : 'rose';
  document.documentElement.dataset.textSize = ['default', 'large', 'extra'].includes(preference?.textSize) ? preference.textSize : 'default';
} catch { document.documentElement.dataset.theme = ['rose','night','sakura'].includes(preference?.theme) ? preference.theme : 'rose';
  document.documentElement.dataset.textSize = 'default'; }
