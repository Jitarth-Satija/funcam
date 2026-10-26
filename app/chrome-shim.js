// Minimal stand-in for the chrome.* APIs the extension code used.
(function () {
  if (window.chrome && window.chrome.storage && window.chrome.runtime && window.chrome.runtime.getURL) return;
  const PREFIX = 'snapfx:';
  const listeners = [];
  const parse = (raw) => { try { return JSON.parse(raw); } catch (e) { return undefined; } };
  const fire = (changes) => listeners.slice().forEach((fn) => { try { fn(changes, 'local'); } catch (e) { console.error(e); } });
  const local = {
    get(defaults, cb) {
      const isObj = defaults && typeof defaults === 'object' && !Array.isArray(defaults);
      const keys = typeof defaults === 'string' ? [defaults] : Array.isArray(defaults) ? defaults : isObj ? Object.keys(defaults) : [];
      const out = {};
      for (const k of keys) {
        const raw = localStorage.getItem(PREFIX + k);
        if (raw === null) { if (isObj) out[k] = defaults[k]; }
        else out[k] = parse(raw);
      }
      if (cb) { cb(out); return undefined; }
      return Promise.resolve(out);
    },
    set(obj, cb) {
      const changes = {};
      for (const k of Object.keys(obj)) {
        const raw = localStorage.getItem(PREFIX + k);
        try { localStorage.setItem(PREFIX + k, JSON.stringify(obj[k])); } catch (e) { console.warn('storage full', e); }
        changes[k] = { oldValue: raw === null ? undefined : parse(raw), newValue: obj[k] };
      }
      fire(changes);
      if (cb) cb();
      return Promise.resolve();
    },
  };
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith(PREFIX)) return;
    fire({ [e.key.slice(PREFIX.length)]: { oldValue: e.oldValue === null ? undefined : parse(e.oldValue), newValue: e.newValue === null ? undefined : parse(e.newValue) } });
  });
  window.chrome = window.chrome || {};
  window.chrome.runtime = { getURL: (p) => new URL(p, document.baseURI).href };
  window.chrome.storage = { local, onChanged: { addListener: (fn) => listeners.push(fn) } };
})();
