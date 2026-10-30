// Run with: node --test tests/frontend.test.cjs (no npm packages required).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const apiSource = readFileSync('frontend/js/api.js', 'utf8');
const appSource = readFileSync('frontend/js/app.js', 'utf8');
const contact = (changes = {}) => ({ id: 1, name: 'Synthetic Example', phone: '',
  email: 'synthetic@example.invalid', company: '', notes: '', favorite: false, ...changes });

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
  ['missing notes', response({ contacts: [contact({ notes: undefined })] })],
  ['invalid JSON', response({}, { json: async () => { throw new SyntaxError(); } })],
]) {
  test(`API rejects ${label}`, async () => {
    await assert.rejects(apiContext(async () => reply).getContacts());
  });
}

test('a late initial GET cannot overwrite the post-save refresh', async () => {
  let resolveInitial;
  let reads = 0;
  const elements = render(() => {
    if (++reads === 1) return new Promise((resolve) => { resolveInitial = resolve; });
    return Promise.resolve([contact()]);
  });
  openForm(elements);
  elements['contact-name'].value = 'Synthetic Example';
  await submit(elements);
  resolveInitial([]);
  await settle();
  assert.equal(elements['contact-count'].textContent, '1');
  assert.equal(elements['contact-list'].hidden, false);
});
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
    this.textContent = ''; this.attributes = {}; this.listeners = {};
    this.value = ''; this.checked = false; this.disabled = false; this.open = false; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; this.listeners.close?.(); }
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
function render(fetchContacts, createContact = async () => contact(), updateContact = async (id, data) => contact({ ...data, id })) {
  const elements = {};
  const document = {
    getElementById(id) { return elements[id] ||= new Element('div'); },
    createElement: (tag) => new Element(tag),
    createDocumentFragment: () => new Element('#fragment'),
  };
  document.getElementById('contact-form').reset = () => {
    for (const node of Object.values(elements)) { node.value = ''; node.checked = false; }
  };
  vm.runInNewContext(appSource, { document, window: {
    ContactHubAPI: { getContacts: fetchContacts, createContact, updateContact } } });
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
const submit = (elements) => elements['contact-form'].listeners.submit({ preventDefault() {} });
const openForm = (elements) => elements['add-contact'].listeners.click();

test('form opens with name focused; clean cancel and Escape close and restore focus', () => {
  const elements = render(async () => []);
  openForm(elements);
  assert.equal(elements['contact-dialog'].open, true);
  assert.equal(elements['contact-name'].focused, true);
  assert.equal(elements['contact-favorite'].checked, false);
  elements['cancel-contact'].listeners.click();
  assert.equal(elements['contact-dialog'].open, false);
  assert.equal(elements['add-contact'].focused, true);
  openForm(elements);
  let prevented = false;
  elements['contact-dialog'].listeners.cancel({ preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.equal(elements['contact-dialog'].open, false);
});

for (const name of ['', '   ']) {
  test(`rejects blank name ${JSON.stringify(name)} without requesting a save`, async () => {
    let calls = 0;
    const elements = render(async () => [], async () => { calls++; });
    openForm(elements);
    elements['contact-name'].value = name;
    await submit(elements);
    assert.equal(calls, 0);
    assert.match(elements['error-name'].textContent, /full name/);
    assert.equal(elements['contact-name'].value, name);
    assert.equal(elements['contact-dialog'].open, true);
  });
}
for (const [field, value] of [['email', 'bad@address'], ['phone', 'no digits'],
  ['name', 'x'.repeat(201)], ['phone', '1'.repeat(51)], ['email', 'a'.repeat(255)],
  ['company', 'x'.repeat(201)], ['notes', 'x'.repeat(5001)]]) {
  test(`validates ${field} inline and preserves entered values`, async () => {
    let calls = 0;
    const elements = render(async () => [], async () => { calls++; });
    openForm(elements);
    elements['contact-name'].value = 'Synthetic Example';
    elements[`contact-${field}`].value = value;
    await submit(elements);
    assert.equal(calls, 0);
    assert.equal(elements[`error-${field}`].hidden, false);
    assert.equal(elements[`contact-${field}`].value, value);
  });
}
for (const favorite of [false, true]) {
  test(`valid submission trims values and sends favorite=${favorite}, then refreshes count/order`, async () => {
    let records = [contact({ id: 2, name: 'Zeta Example' })];
    let submitted;
    const elements = render(async () => records.slice(), async (data) => {
      submitted = data;
      const saved = contact({ ...data, id: 3 });
      records.push(saved);
      return saved;
    });
    await settle();
    openForm(elements);
    elements['contact-name'].value = '  Alpha Example  ';
    elements['contact-phone'].value = ' +44 (0) 20 0000 0000 ext 12 ';
    elements['contact-favorite'].checked = favorite;
    await submit(elements);
    assert.equal(submitted.name, 'Alpha Example');
    assert.equal(submitted.phone, '+44 (0) 20 0000 0000 ext 12');
    assert.equal(submitted.email, '');
    assert.equal(submitted.notes, '');
    assert.equal(submitted.favorite, favorite);
    assert.equal(elements['contact-dialog'].open, false);
    assert.equal(elements['contact-name'].value, '');
    assert.equal(elements['contact-count'].textContent, '2');
    assert.equal(elements['contact-list'].children[0].children[0].children[1].textContent, 'Alpha Example');
    assert.match(elements['save-notice'].textContent, /saved successfully/);
  });
}

test('pending save blocks duplicates, cancel and Escape until confirmed', async () => {
  let resolveSave;
  let calls = 0;
  const elements = render(async () => [], () => {
    calls++;
    return new Promise((resolve) => { resolveSave = resolve; });
  });
  openForm(elements);
  elements['contact-name'].value = 'Synthetic Example';
  const pending = submit(elements);
  await submit(elements);
  elements['cancel-contact'].listeners.click();
  elements['contact-dialog'].listeners.cancel({ preventDefault() {} });
  assert.equal(calls, 1);
  assert.equal(elements['save-contact'].disabled, true);
  assert.equal(elements['contact-dialog'].open, true);
  resolveSave(contact());
  await pending;
  assert.equal(elements['save-contact'].disabled, false);
});

for (const validation of [false, true]) {
  test(`${validation ? 'server validation' : 'network'} error preserves form and never announces success`, async () => {
    const elements = render(async () => [], async () => {
      const error = new Error('The server rejected these details.');
      error.validation = validation;
      throw error;
    });
    openForm(elements);
    elements['contact-name'].value = 'Synthetic Example';
    await submit(elements);
    assert.equal(elements['contact-dialog'].open, true);
    assert.equal(elements['contact-name'].value, 'Synthetic Example');
    assert.equal(elements['form-error'].hidden, false);
    assert.equal(elements['form-error'].focused, true);
    assert.match(elements['form-error'].textContent, validation ? /rejected/ : /couldn’t confirm/);
    assert.equal(elements['save-contact'].disabled, false);
    assert.equal(elements['save-notice'].textContent, '');
  });
}

test('successful save followed by failed GET clearly reports saved contact', async () => {
  let reads = 0;
  const elements = render(async () => {
    if (++reads > 1) throw new Error('offline');
    return [];
  });
  await settle();
  openForm(elements);
  elements['contact-name'].value = 'Synthetic Example';
  await submit(elements);
  assert.equal(elements['contact-dialog'].open, false);
  assert.match(elements['save-notice'].textContent, /saved successfully, but the list couldn’t refresh/);
  assert.equal(elements['retry-button'].hidden, false);
});

test('unsaved Cancel and Escape require confirmation; keep editing preserves values and discard resets', () => {
  const elements = render(async () => []);
  openForm(elements);
  elements['contact-name'].value = 'Unsaved Example';
  elements['cancel-contact'].listeners.click();
  assert.equal(elements['contact-dialog'].open, true);
  assert.equal(elements['discard-confirmation'].hidden, false);
  assert.equal(elements['keep-editing'].focused, true);
  elements['keep-editing'].listeners.click();
  assert.equal(elements['discard-confirmation'].hidden, true);
  assert.equal(elements['contact-name'].value, 'Unsaved Example');
  elements['contact-dialog'].listeners.cancel({ preventDefault() {} });
  assert.equal(elements['discard-confirmation'].hidden, false);
  elements['contact-dialog'].listeners.cancel({ preventDefault() {} });
  assert.equal(elements['discard-confirmation'].hidden, true);
  assert.equal(elements['contact-dialog'].open, true);
  elements['cancel-contact'].listeners.click();
  elements['discard-contact'].listeners.click();
  assert.equal(elements['contact-dialog'].open, false);
  assert.equal(elements['contact-name'].value, '');
});

test('POST sends JSON and requires a confirmed 201 contact response', async () => {
  const data = { name: 'Synthetic Example', favorite: true };
  const api = apiContext(async (url, options) => {
    assert.equal(url, '/api/contacts');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), data);
    return response({ contact: contact() }, { status: 201 });
  });
  assert.equal((await api.createContact(data)).name, 'Synthetic Example');
});
for (const [label, reply] of [
  ['validation', response({ error: { code: 'validation_error', message: 'raw private details' } }, { status: 400, ok: false })],
  ['server error', response({}, { status: 500, ok: false })],
  ['unexpected success status', response({ contact: contact() }, { status: 200 })],
  ['missing saved contact', response({}, { status: 201 })],
]) {
  test(`POST rejects ${label} safely`, async () => {
    await assert.rejects(apiContext(async () => reply).createContact({ name: 'Example' }),
      (error) => !error.message.includes('raw private details'));
  });
}
// Edit uses the same form and validation; locate buttons from the rendered cards.
const editButton = (elements, index = 0) => {
  const card = elements['contact-list'].children[index].children[0];
  return card.children[card.children.length - 1];
};

test('Edit prepopulates every field and unchanged Cancel restores the triggering button without confirmation', async () => {
  const existing = contact({ notes: 'Synthetic notes', phone: '+44 0000', company: 'Example', favorite: true });
  const elements = render(async () => [existing]);
  await settle();
  const button = editButton(elements);
  assert.equal(button.attributes['aria-label'], 'Edit Synthetic Example');
  button.listeners.click();
  assert.equal(elements['form-title'].textContent, 'Edit Contact');
  assert.equal(elements['save-contact'].textContent, 'Save Changes');
  for (const field of ['name', 'phone', 'email', 'company', 'notes']) {
    assert.equal(elements[`contact-${field}`].value, existing[field]);
  }
  assert.equal(elements['contact-favorite'].checked, true);
  elements['cancel-contact'].listeners.click();
  assert.equal(elements['contact-dialog'].open, false);
  assert.equal(elements['discard-confirmation'].hidden, true);
  assert.equal(button.focused, true);
});

test('valid Edit sends only selected ID and full data, reorders cards and preserves other contacts/count', async () => {
  const untouched = contact({ id: 2, name: 'Beta Example', notes: 'Unchanged' });
  let records = [contact({ name: 'Zeta Example', notes: 'Existing notes', favorite: true }), untouched];
  let sent;
  const elements = render(async () => records.slice(), undefined, async (id, data) => {
    sent = { id, data };
    records = records.map((record) => record.id === id ? { ...record, ...data } : record);
    return records.find((record) => record.id === id);
  });
  await settle();
  editButton(elements, 1).listeners.click();
  elements['contact-name'].value = '  Alpha Updated  ';
  elements['contact-phone'].value = '+49 (0) 0000 ext 12';
  elements['contact-email'].value = '';
  elements['contact-company'].value = ' New Example Lab ';
  elements['contact-notes'].value = '';
  elements['contact-favorite'].checked = false;
  await submit(elements);
  assert.equal(sent.id, 1);
  assert.equal(sent.data.name, 'Alpha Updated');
  assert.equal(sent.data.notes, '');
  assert.equal(sent.data.email, '');
  assert.equal(sent.data.company, 'New Example Lab');
  assert.equal(sent.data.favorite, false);
  assert.deepEqual(records[1], untouched);
  assert.equal(elements['contact-count'].textContent, '2');
  const firstCard = elements['contact-list'].children[0].children[0];
  assert.equal(firstCard.children[1].textContent, 'Alpha Updated');
  assert.equal(firstCard.children[0].children.length, 1);
  assert.match(elements['save-notice'].textContent, /updated successfully/);
  assert.equal(elements['contact-dialog'].open, false);
  assert.equal(editButton(elements).focused, true);
});

for (const [field, value] of [['name', '  '], ['email', 'bad-address']]) {
  test(`Edit rejects invalid ${field} without PUT and preserves input`, async () => {
    let writes = 0;
    const elements = render(async () => [contact()], undefined, async () => { writes++; });
    await settle();
    editButton(elements).listeners.click();
    elements[`contact-${field}`].value = value;
    await submit(elements);
    assert.equal(writes, 0);
    assert.equal(elements[`error-${field}`].hidden, false);
    assert.equal(elements[`contact-${field}`].value, value);
  });
}

test('Edit dirty checks compare against the original, including favorite; Add subsequently starts blank', async () => {
  const elements = render(async () => [contact({ favorite: true })]);
  await settle();
  editButton(elements).listeners.click();
  elements['contact-favorite'].checked = false;
  elements['cancel-contact'].listeners.click();
  assert.equal(elements['discard-confirmation'].hidden, false);
  elements['keep-editing'].listeners.click();
  elements['contact-favorite'].checked = true;
  elements['cancel-contact'].listeners.click();
  assert.equal(elements['contact-dialog'].open, false);
  openForm(elements);
  assert.equal(elements['form-title'].textContent, 'Add a contact');
  assert.equal(elements['contact-name'].value, '');
  assert.equal(elements['contact-favorite'].checked, false);
});

for (const failure of ['missing', 'validation', 'network', 'server']) {
  test(`Edit ${failure} failure preserves input and never claims success`, async () => {
    const elements = render(async () => [contact()], undefined, async () => {
      const error = new Error(failure === 'missing' ? 'This contact no longer exists.' : 'Review these details.');
      if (failure === 'missing') error.missing = true;
      if (failure === 'validation') error.validation = true;
      throw error;
    });
    await settle();
    editButton(elements).listeners.click();
    elements['contact-name'].value = 'Edited Synthetic Example';
    await submit(elements);
    assert.equal(elements['contact-dialog'].open, true);
    assert.equal(elements['contact-name'].value, 'Edited Synthetic Example');
    assert.equal(elements['form-error'].hidden, false);
    assert.equal(elements['save-contact'].disabled, false);
    assert.equal(elements['save-notice'].textContent, '');
    if (failure === 'missing') assert.match(elements['form-error'].textContent, /no longer exists/);
    if (failure === 'network' || failure === 'server') assert.match(elements['form-error'].textContent, /couldn’t confirm the update/);
  });
}

test('Edit prevents concurrent PUT requests and blocks closing while saving', async () => {
  let finish;
  let writes = 0;
  const elements = render(async () => [contact()], undefined, () => {
    writes++;
    return new Promise((resolve) => { finish = resolve; });
  });
  await settle();
  editButton(elements).listeners.click();
  const pending = submit(elements);
  await submit(elements);
  elements['cancel-contact'].listeners.click();
  assert.equal(writes, 1);
  assert.equal(elements['contact-dialog'].open, true);
  assert.equal(elements['save-contact'].disabled, true);
  finish(contact());
  await pending;
});

test('Edit reports confirmed update separately when the list refresh fails', async () => {
  let reads = 0;
  const elements = render(async () => {
    if (++reads > 1) throw new Error('offline');
    return [contact()];
  });
  await settle();
  editButton(elements).listeners.click();
  await submit(elements);
  assert.match(elements['save-notice'].textContent, /updated successfully, but the list couldn’t refresh/);
  assert.equal(elements['retry-button'].hidden, false);
  assert.equal(elements['contact-dialog'].open, false);
  assert.equal(elements['add-contact'].focused, true);
});

test('PUT sends the full JSON record to the selected ID and accepts 200', async () => {
  const { id, ...data } = contact({ id: 42 });
  const api = apiContext(async (url, options) => {
    assert.equal(url, '/api/contacts/42');
    assert.equal(options.method, 'PUT');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), data);
    return response({ contact: { ...data, id } }, { status: 200 });
  });
  assert.equal((await api.updateContact(42, data)).id, 42);
});

for (const id of [null, undefined, 0, -1, '1']) {
  test(`PUT rejects invalid ID ${String(id)} before fetching`, async () => {
    let calls = 0;
    const api = apiContext(async () => { calls++; });
    await assert.rejects(api.updateContact(id, contact()), (error) => error.missing === true);
    assert.equal(calls, 0);
  });
}
for (const [label, reply] of [
  ['missing contact', response({}, { status: 404, ok: false })],
  ['validation', response({ error: { code: 'validation_error', message: 'private data' } }, { status: 400, ok: false })],
  ['server failure', response({}, { status: 500, ok: false })],
  ['HTML', response({}, { status: 200, headers: { get: () => 'text/html' } })],
  ['malformed JSON', response({}, { status: 200, json: async () => { throw new SyntaxError(); } })],
  ['missing envelope', response({}, { status: 200 })],
  ['wrong contact ID', response({ contact: contact({ id: 2 }) }, { status: 200 })],
  ['missing notes', response({ contact: contact({ notes: null }) }, { status: 200 })],
]) {
  test(`PUT handles ${label} without leaking server details`, async () => {
    await assert.rejects(apiContext(async () => reply).updateContact(1, contact()), (error) => {
      assert.ok(!error.message.includes('private data'));
      if (label === 'missing contact') assert.equal(error.missing, true);
      if (label === 'validation') assert.equal(error.validation, true);
      return true;
    });
  });
}
test('PUT propagates network failure', async () => {
  await assert.rejects(apiContext(async () => { throw new TypeError('offline'); }).updateContact(1, contact()));
});
