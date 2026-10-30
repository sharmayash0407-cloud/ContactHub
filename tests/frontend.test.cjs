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
function render(fetchContacts, createContact = async () => contact(), updateContact = async (id, data) => contact({ ...data, id }), deleteContact = async () => {}, timers = { setTimeout, clearTimeout }) {
  const elements = {};
  const document = {
    getElementById(id) { return elements[id] ||= new Element('div'); },
    createElement: (tag) => new Element(tag),
    createDocumentFragment: () => new Element('#fragment'),
  };
  document.getElementById('contact-form').reset = () => {
    for (const [id, node] of Object.entries(elements)) {
      if (['contact-name', 'contact-phone', 'contact-email', 'contact-company', 'contact-notes', 'contact-favorite'].includes(id)) {
        node.value = ''; node.checked = false;
      }
    }
  };
  vm.runInNewContext(appSource, { document, ...timers, window: {
    ContactHubAPI: { getContacts: fetchContacts, createContact, updateContact, deleteContact } } });
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
  return card.children.find((node) => node.className === 'edit-button');
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
const deleteCardButton = (elements, index = 0) => elements['contact-list'].children[index].children[0].children
  .find((node) => node.className === 'delete-button');
const confirmDeletion = (elements) => elements['confirm-delete'].listeners.click();

test('Delete opens a named confirmation with Cancel focused and never requests deletion on open', async () => {
  let calls = 0;
  const name = '<img src=x onerror=alert(1)>';
  const elements = render(async () => [contact({ name })], undefined, undefined, async () => { calls++; });
  await settle();
  const trigger = deleteCardButton(elements);
  assert.equal(trigger.attributes['aria-label'], `Delete ${name}`);
  trigger.listeners.click();
  assert.equal(elements['delete-dialog'].open, true);
  assert.equal(elements['delete-name'].textContent, name);
  assert.equal(elements['cancel-delete'].focused, true);
  assert.equal(calls, 0);
});

for (const action of ['Cancel', 'Escape']) {
  test(`${action} closes deletion dialog and restores focus without a DELETE`, async () => {
    let calls = 0;
    const elements = render(async () => [contact()], undefined, undefined, async () => { calls++; });
    await settle();
    const trigger = deleteCardButton(elements);
    trigger.listeners.click();
    if (action === 'Cancel') elements['cancel-delete'].listeners.click();
    else elements['delete-dialog'].listeners.cancel({ preventDefault() {} });
    assert.equal(calls, 0);
    assert.equal(elements['delete-dialog'].open, false);
    assert.equal(trigger.focused, true);
    // A stray action after closing has no selected record to delete.
    await confirmDeletion(elements);
    assert.equal(calls, 0);
  });
}

test('confirmed deletion uses the selected database ID, refreshes count and preserves other contacts', async () => {
  const remaining = contact({ id: 23, name: 'Same Name', notes: 'Keep this record' });
  let records = [contact({ id: 8, name: 'Same Name' }), remaining];
  let deletedId;
  const elements = render(async () => records.slice(), undefined, undefined, async (id) => {
    deletedId = id;
    records = records.filter((item) => item.id !== id);
  });
  await settle();
  deleteCardButton(elements).listeners.click();
  await confirmDeletion(elements);
  assert.equal(deletedId, 8);
  assert.deepEqual(records, [remaining]);
  assert.equal(elements['contact-count'].textContent, '1');
  assert.equal(elements['contact-list'].children.length, 1);
  assert.equal(elements['delete-dialog'].open, false);
  assert.equal(elements['add-contact'].focused, true);
  assert.match(elements['save-notice'].textContent, /deleted successfully/);
});

test('deleting the last contact displays the existing empty state and zero count', async () => {
  let records = [contact()];
  const elements = render(async () => records, undefined, undefined, async () => { records = []; });
  await settle();
  deleteCardButton(elements).listeners.click();
  await confirmDeletion(elements);
  assert.equal(elements['contact-count'].textContent, '0');
  assert.equal(elements['directory-state'].hidden, false);
  assert.equal(elements['contact-list'].hidden, true);
  assert.match(elements['state-description'].textContent, /No contacts yet/);
});

test('pending deletion blocks duplicates and prevents Cancel/Escape from closing', async () => {
  let resolveDelete;
  let calls = 0;
  const elements = render(async () => [contact()], undefined, undefined, () => {
    calls++;
    return new Promise((resolve) => { resolveDelete = resolve; });
  });
  await settle();
  deleteCardButton(elements).listeners.click();
  const pending = confirmDeletion(elements);
  await confirmDeletion(elements);
  elements['cancel-delete'].listeners.click();
  elements['delete-dialog'].listeners.cancel({ preventDefault() {} });
  assert.equal(calls, 1);
  assert.equal(elements['confirm-delete'].disabled, true);
  assert.equal(elements['cancel-delete'].disabled, true);
  assert.equal(elements['delete-dialog'].open, true);
  resolveDelete();
  await pending;
  assert.equal(elements['confirm-delete'].disabled, false);
  assert.equal(elements['cancel-delete'].disabled, false);
});

for (const kind of ['404', 'server', 'network']) {
  test(`deletion ${kind} failure keeps confirmation open with safe feedback`, async () => {
    const elements = render(async () => [contact()], undefined, undefined, async () => {
      const error = new Error(kind === '404' ? 'This contact no longer exists.' : 'private traceback');
      error.missing = kind === '404';
      throw error;
    });
    await settle();
    deleteCardButton(elements).listeners.click();
    await confirmDeletion(elements);
    assert.equal(elements['delete-dialog'].open, true);
    assert.equal(elements['delete-error'].hidden, false);
    assert.equal(elements['delete-error'].focused, true);
    assert.equal(elements['contact-count'].textContent, '1');
    assert.equal(elements['confirm-delete'].disabled, false);
    assert.equal(elements['save-notice'].textContent, '');
    assert.match(elements['delete-error'].textContent, kind === '404' ? /no longer exists/ : /may have succeeded/);
    assert.doesNotMatch(elements['delete-error'].textContent, /private traceback/);
    elements['cancel-delete'].listeners.click();
    assert.equal(elements['delete-dialog'].open, false);
  });
}

test('confirmed deletion followed by failed refresh clearly distinguishes the two results', async () => {
  let reads = 0;
  const elements = render(async () => {
    if (++reads > 1) throw new Error('offline');
    return [contact()];
  });
  await settle();
  deleteCardButton(elements).listeners.click();
  await confirmDeletion(elements);
  assert.equal(elements['delete-dialog'].open, false);
  assert.match(elements['save-notice'].textContent, /deleted successfully, but the list couldn’t refresh/);
  assert.equal(elements['retry-button'].hidden, false);
  assert.equal(elements['add-contact'].focused, true);
});

test('API DELETE uses the contact ID and validates the existing 200 JSON contract', async () => {
  let calls = 0;
  const api = apiContext(async (url, options) => {
    calls++;
    assert.equal(url, '/api/contacts/23');
    assert.equal(options.method, 'DELETE');
    assert.equal(options.body, undefined);
    assert.equal(options.headers.Accept, 'application/json');
    return response({ message: 'Contact deleted.' }, { status: 200 });
  });
  await api.deleteContact(23);
  assert.equal(calls, 1);
});
for (const id of [null, undefined, 0, -1, '23', Number.MAX_SAFE_INTEGER + 1]) {
  test(`DELETE rejects invalid ID ${String(id)} before requesting`, async () => {
    let calls = 0;
    const api = apiContext(async () => { calls++; });
    await assert.rejects(api.deleteContact(id));
    assert.equal(calls, 0);
  });
}
for (const [label, reply] of [
  ['404', response({}, { status: 404, ok: false })],
  ['server error', response({ message: 'private traceback' }, { status: 500, ok: false })],
  ['HTML', response({}, { status: 200, headers: { get: () => 'text/html' } })],
  ['malformed JSON', response({}, { status: 200, json: async () => { throw new SyntaxError(); } })],
  ['missing confirmation', response({}, { status: 200 })],
  ['unexpected status', response({ message: 'Contact deleted.' }, { status: 201 })],
]) {
  test(`API DELETE handles ${label} without falsely confirming deletion`, async () => {
    await assert.rejects(apiContext(async () => reply).deleteContact(23), (error) => {
      if (label === '404') assert.equal(error.missing, true);
      assert.doesNotMatch(error.message, /private traceback/);
      return true;
    });
  });
}
test('API DELETE propagates network failure', async () => {
  await assert.rejects(apiContext(async () => { throw new TypeError('offline'); }).deleteContact(23));
});

test('retry after a failed post-delete refresh clears the stale failure notice', async () => {
  let reads = 0;
  const elements = render(async () => {
    reads++;
    if (reads === 1) return [contact()];
    if (reads === 2) throw new Error('offline');
    return [];
  });
  await settle();
  deleteCardButton(elements).listeners.click();
  await confirmDeletion(elements);
  assert.match(elements['save-notice'].textContent, /couldn’t refresh/);
  assert.doesNotMatch(elements['state-description'].textContent, /haven’t been changed/);
  await elements['retry-button'].listeners.click();
  assert.equal(elements['contact-count'].textContent, '0');
  assert.equal(elements['contacts-region'].attributes['aria-label'], 'Contact directory');
  assert.equal(elements['save-notice'].textContent, 'Contact deleted successfully. Your connections are up to date.');
});
// Deterministic clock: test debounce behavior without waiting in real time.
function searchClock() {
  let next = 0;
  const pending = new Map();
  return {
    setTimeout(callback, delay) { assert.equal(delay, 300); pending.set(++next, callback); return next; },
    clearTimeout(id) { pending.delete(id); },
    run() { const jobs = [...pending.values()]; pending.clear(); jobs.forEach((job) => job()); },
    size() { return pending.size; },
  };
}
function typeSearch(elements, query) {
  elements['contact-search'].value = query;
  elements['contact-search'].listeners.input();
}

test('API URL-encodes search text and omits blank queries', async () => {
  const urls = [];
  const api = apiContext(async (url) => { urls.push(url); return response({ contacts: [] }); });
  const query = 'नमस्ते & + # ? % _';
  await api.getContacts(`  ${query}  `);
  await api.getContacts('   ');
  assert.deepEqual(urls, ['/api/contacts?search=' + encodeURIComponent(query), '/api/contacts']);
});

test('rapid typing debounces into one backend query and ignores equivalent surrounding whitespace', async () => {
  const clock = searchClock();
  const queries = [];
  const elements = render(async (query) => { queries.push(query); return []; }, undefined, undefined, undefined, clock);
  await settle();
  typeSearch(elements, 'a');
  typeSearch(elements, 'al');
  typeSearch(elements, 'alpha');
  assert.deepEqual(queries, ['']);
  assert.equal(clock.size(), 1);
  clock.run();
  await settle();
  assert.deepEqual(queries, ['', 'alpha']);
  typeSearch(elements, '  alpha  ');
  clock.run();
  await settle();
  assert.deepEqual(queries, ['', 'alpha']);
});

test('older success cannot replace current query even during the debounce gap', async () => {
  const clock = searchClock();
  let finishOld;
  const elements = render((query) => query === '' ? new Promise((resolve) => { finishOld = resolve; })
    : Promise.resolve([contact({ name: 'Alpha Synthetic' })]), undefined, undefined, undefined, clock);
  typeSearch(elements, 'alpha');
  finishOld([contact({ name: 'Stale Synthetic' })]);
  await settle();
  assert.equal(elements['contact-list'].hidden, true);
  assert.equal(elements['contact-count'].textContent, '—');
  clock.run();
  await settle();
  assert.equal(elements['contact-count'].textContent, '1');
  assert.equal(elements['contact-list'].children[0].children[0].children[1].textContent, 'Alpha Synthetic');
});

test('out-of-order search responses keep the latest results and count', async () => {
  const clock = searchClock();
  const waiting = {};
  const elements = render((query) => query ? new Promise((resolve) => { waiting[query] = resolve; })
    : Promise.resolve([]), undefined, undefined, undefined, clock);
  await settle();
  typeSearch(elements, 'old'); clock.run();
  typeSearch(elements, 'new'); clock.run();
  waiting.new([contact({ name: 'New Example' })]);
  await settle();
  waiting.old([contact({ name: 'Old Example' }), contact({ id: 2 })]);
  await settle();
  assert.equal(elements['contact-count'].textContent, '1');
  assert.equal(elements['search-results'].textContent, '1 result for “new”');
});

test('search results sort alphabetically and use backend results rather than filtering cached records', async () => {
  const clock = searchClock();
  const elements = render(async (query) => query ? [contact({ name: 'Zeta Remote' }), contact({ id: 2, name: 'Alpha Remote' })]
    : [contact({ name: 'Initial Example' })], undefined, undefined, undefined, clock);
  await settle();
  typeSearch(elements, 'remote'); clock.run();
  await settle();
  assert.equal(elements['contact-count'].textContent, '2');
  assert.equal(elements['count-label'].textContent, 'Matching contacts');
  assert.equal(elements['search-results'].textContent, '2 results for “remote”');
  assert.equal(elements['contact-list'].children[0].children[0].children[1].textContent, 'Alpha Remote');
});

test('no search matches differs from empty database and query text remains literal', async () => {
  const clock = searchClock();
  const elements = render(async () => [], undefined, undefined, undefined, clock);
  await settle();
  assert.match(elements['state-description'].textContent, /No contacts yet/);
  const query = '<img src=x onerror=alert(1)>';
  typeSearch(elements, query); clock.run();
  await settle();
  assert.equal(elements['state-title'].textContent, 'No matching contacts');
  assert.ok(elements['state-description'].textContent.includes(query));
  assert.equal(elements['contact-count'].textContent, '0');
  assert.equal(elements['clear-search'].hidden, false);
});

for (const method of ['button', 'Escape']) {
  test(`clear via ${method} cancels pending debounce and reloads the unfiltered backend list`, async () => {
    const clock = searchClock();
    const queries = [];
    const elements = render(async (query) => { queries.push(query); return [contact()]; }, undefined, undefined, undefined, clock);
    await settle();
    typeSearch(elements, 'pending');
    if (method === 'button') elements['clear-search'].listeners.click();
    else elements['contact-search'].listeners.keydown({ key: 'Escape', preventDefault() {} });
    clock.run();
    await settle();
    assert.deepEqual(queries, ['', '']);
    assert.equal(elements['contact-search'].value, '');
    assert.equal(elements['clear-search'].hidden, true);
    assert.equal(elements['count-label'].textContent, 'Total contacts');
    assert.equal(elements['contact-count'].textContent, '1');
  });
}

test('search Enter flushes the debounce once without a duplicate request', async () => {
  const clock = searchClock();
  const queries = [];
  const elements = render(async (query) => { queries.push(query); return []; }, undefined, undefined, undefined, clock);
  await settle();
  typeSearch(elements, 'alpha');
  elements['search-form'].listeners.submit({ preventDefault() {} });
  clock.run();
  await settle();
  elements['search-form'].listeners.submit({ preventDefault() {} });
  assert.deepEqual(queries, ['', 'alpha']);
});

test('failed search retries the same query and preserves entered text', async () => {
  const clock = searchClock();
  const queries = [];
  let fail = true;
  const elements = render(async (query) => {
    queries.push(query);
    if (query && fail) throw new Error('offline');
    return [];
  }, undefined, undefined, undefined, clock);
  await settle();
  typeSearch(elements, 'alpha'); clock.run();
  await settle();
  assert.equal(elements['retry-button'].hidden, false);
  assert.equal(elements['contact-search'].value, 'alpha');
  assert.match(elements['search-results'].textContent, /Unable to load/);
  fail = false;
  await elements['retry-button'].listeners.click();
  assert.deepEqual(queries, ['', 'alpha', 'alpha']);
  assert.equal(elements['search-results'].textContent, '0 results for “alpha”');
});

test('CRUD refresh preserves current search and result count', async () => {
  const clock = searchClock();
  const queries = [];
  const elements = render(async (query) => { queries.push(query); return [contact()]; }, undefined, undefined, undefined, clock);
  await settle();
  typeSearch(elements, 'synthetic'); clock.run();
  await settle();
  openForm(elements);
  elements['contact-name'].value = 'Synthetic Created Example';
  await submit(elements);
  assert.deepEqual(queries, ['', 'synthetic', 'synthetic']);
  assert.equal(elements['contact-search'].value, 'synthetic');
  assert.equal(elements['contact-count'].textContent, '1');
});

test('a stale search failure cannot replace a newer successful result', async () => {
  const clock = searchClock();
  let failOld;
  const elements = render((query) => query === 'old' ? new Promise((resolve, reject) => { failOld = reject; })
    : Promise.resolve([contact()]), undefined, undefined, undefined, clock);
  await settle();
  typeSearch(elements, 'old'); clock.run();
  typeSearch(elements, 'new'); clock.run();
  await settle();
  failOld(new Error('late failure'));
  await settle();
  assert.equal(elements['contact-count'].textContent, '1');
  assert.equal(elements['search-results'].textContent, '1 result for “new”');
  assert.equal(elements['contact-list'].hidden, false);
});

for (const operation of ['edit', 'delete']) {
  test(`${operation} refresh keeps search when the record leaves the matching results`, async () => {
    const clock = searchClock();
    const queries = [];
    let records = [contact()];
    const elements = render(async (query) => { queries.push(query); return records; }, undefined,
      async () => { records = []; return contact({ name: 'No longer matches' }); },
      async () => { records = []; }, clock);
    await settle();
    typeSearch(elements, 'synthetic'); clock.run();
    await settle();
    if (operation === 'edit') {
      editButton(elements).listeners.click();
      elements['contact-name'].value = 'No longer matches';
      await submit(elements);
    } else {
      deleteCardButton(elements).listeners.click();
      await confirmDeletion(elements);
    }
    assert.deepEqual(queries, ['', 'synthetic', 'synthetic']);
    assert.equal(elements['contact-search'].value, 'synthetic');
    assert.equal(elements['contact-count'].textContent, '0');
    assert.equal(elements['state-title'].textContent, 'No matching contacts');
  });
}
