// Run with: node --test tests/frontend.test.cjs (no npm packages required).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const apiSource = readFileSync('frontend/js/api.js', 'utf8');
const appSource = readFileSync('frontend/js/app.js', 'utf8');
const contact = (changes = {}) => ({ id: 1, name: 'Synthetic Example', phone: '',
  email: 'synthetic@example.invalid', company: '', favorite: false, ...changes });

function apiContext(fetch) {
  const context = { window: {}, fetch, AbortController, setTimeout, clearTimeout };
  vm.runInNewContext(apiSource, context);
  return context.window.ContactHubAPI;
}
function response(body, options = {}) {
  return { ok: true, headers: { get: () => 'application/json' },
    json: async () => body, ...options };
}

test('API reads the real endpoint and accepts the contacts envelope', async () => {
  const records = [contact()];
  const api = apiContext(async (url, options) => {
    assert.equal(url, '/api/contacts');
    assert.equal(options.headers.Accept, 'application/json');
    assert.equal(options.cache, 'no-store');
    return response({ contacts: records });
  });
  assert.equal(await api.getContacts(), records);
});

for (const [label, reply] of [
  ['HTTP error', response({}, { ok: false })],
  ['HTML instead of JSON', response({}, { headers: { get: () => 'text/html' } })],
  ['missing envelope', response([])],
  ['null body', response(null)],
  ['invalid favorite', response({ contacts: [contact({ favorite: 1 })] })],
  ['invalid name', response({ contacts: [contact({ name: null })] })],
  ['invalid JSON', response({}, { json: async () => { throw new SyntaxError(); } })],
]) {
  test(`API rejects ${label}`, async () => {
    await assert.rejects(apiContext(async () => reply).getContacts());
  });
}
test('API propagates network failure', async () => {
  await assert.rejects(apiContext(async () => { throw new TypeError('offline'); }).getContacts());
});
test('API aborts requests that exceed its timeout', async () => {
  let timeoutCallback;
  let cleared = false;
  const context = { window: {}, AbortController,
    setTimeout(callback) { timeoutCallback = callback; return 1; },
    clearTimeout() { cleared = true; },
    fetch: (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }),
  };
  vm.runInNewContext(apiSource, context);
  const pending = context.window.ContactHubAPI.getContacts();
  timeoutCallback();
  await assert.rejects(pending);
  assert.ok(cleared);
});

// A small DOM stand-in tests state transitions; browser QA checks actual layout.
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.hidden = false;
    this.textContent = ''; this.attributes = {}; this.listeners = {}; }
  append(...nodes) {
    for (const node of nodes) {
      if (node.tagName === '#fragment') this.children.push(...node.children);
      else this.children.push(node);
    }
  }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  set innerHTML(value) { throw new Error('Unsafe HTML insertion'); }
}
function render(fetchContacts) {
  const elements = {};
  const document = {
    getElementById(id) { return elements[id] ||= new Element('div'); },
    createElement: (tag) => new Element(tag),
    createDocumentFragment: () => new Element('#fragment'),
  };
  vm.runInNewContext(appSource, { document, window: { ContactHubAPI: { getContacts: fetchContacts } } });
  return elements;
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('loading is shown until the request completes, then empty state and zero count', async () => {
  let complete;
  const elements = render(() => new Promise((resolve) => { complete = resolve; }));
  assert.match(elements['state-title'].textContent, /Loading/);
  assert.equal(elements['contacts-region'].attributes['aria-busy'], 'true');
  assert.equal(elements['contact-list'].hidden, true);
  complete([]);
  await settle();
  assert.equal(elements['contact-count'].textContent, '0');
  assert.match(elements['state-description'].textContent, /No contacts yet/);
  assert.equal(elements['retry-button'].hidden, true);
  assert.equal(elements['contacts-region'].attributes['aria-busy'], 'false');
});

test('cards sort by name, use literal text, show initials, fallback values and favorite indicators', async () => {
  const unsafe = '<img src=x onerror=alert(1)>';
  const elements = render(async () => [contact({ id: 2, name: 'Zeta Example' }),
    contact({ name: 'Alpha Example', company: unsafe, favorite: true })]);
  await settle();
  assert.equal(elements['contact-count'].textContent, '2');
  assert.equal(elements['directory-state'].hidden, true);
  const cards = elements['contact-list'].children.map((item) => item.children[0]);
  assert.equal(cards[0].children[1].textContent, 'Alpha Example');
  assert.equal(cards[1].children[1].textContent, 'Zeta Example');
  assert.equal(cards[0].children[2].textContent, unsafe);
  assert.equal(cards[0].children[0].children[0].textContent, 'AE');
  assert.equal(cards[0].children[0].children[1].attributes['aria-label'], 'Favorite contact');
  assert.equal(cards[1].children[0].children.length, 1);
  assert.equal(cards[1].children[2].textContent, 'No company listed');
  assert.equal(cards[0].children[3].children[0].children[1].textContent, 'Not provided');
});

test('error state does not disclose raw errors and retry fetches successfully', async () => {
  let attempts = 0;
  const elements = render(async () => {
    if (++attempts === 1) throw new Error('private backend details');
    return [contact()];
  });
  await settle();
  assert.match(elements['state-title'].textContent, /couldn’t load/);
  assert.equal(elements['retry-button'].hidden, false);
  assert.equal(elements['contact-count'].textContent, '—');
  assert.doesNotMatch(elements['state-description'].textContent, /private/);
  await elements['retry-button'].listeners.click();
  assert.equal(attempts, 2);
  assert.equal(elements['directory-state'].hidden, true);
  assert.equal(elements['contact-list'].hidden, false);
});
