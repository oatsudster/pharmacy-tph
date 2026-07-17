/**
 * escHtml — escape a value for safe insertion into HTML text nodes and
 * double-quoted attribute values. Escapes & < > " '.
 *
 * For values passed as a JS string argument inside an inline event-handler
 * attribute (e.g. onclick="fn('${id}')"), use escHtml(JSON.stringify(id))
 * and drop the surrounding manual quotes — JSON.stringify handles JS-string
 * escaping, escHtml then handles the outer HTML-attribute escaping.
 */
window.escHtml = function (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};
