"use strict";

(() => {
  const region = document.getElementById("contacts-region");
  const list = document.getElementById("contact-list");
  const state = document.getElementById("directory-state");
  const title = document.getElementById("state-title");
  const description = document.getElementById("state-description");
  const count = document.getElementById("contact-count");
  const retry = document.getElementById("retry-button");
  const searchInput = document.getElementById("contact-search");
  const searchForm = document.getElementById("search-form");
  const clearSearch = document.getElementById("clear-search");
  const searchResults = document.getElementById("search-results");
  const countLabel = document.getElementById("count-label");
  let activeQuery = "";
  let searchTimer = null;
  let loadVersion = 0;
  const editButtons = new Map();

  // User values are always text, never HTML markup.
  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function contactCard(contact) {
    const item = document.createElement("li");
    const card = element("article", "contact-card");
    const top = element("div", "card-top");
    const words = contact.name.trim().split(/\s+/u);
    const initials = [words[0], ...(words.length > 1 ? [words[words.length - 1]] : [])]
      .map((word) => Array.from(word)[0]).join("").toLocaleUpperCase();
    const avatar = element("span", "avatar", initials);
    avatar.setAttribute("aria-hidden", "true");
    top.append(avatar);
    if (contact.favorite) {
      const favorite = element("span", "favorite", "★");
      favorite.setAttribute("role", "img");
      favorite.setAttribute("aria-label", "Favorite contact");
      top.append(favorite);
    }
    card.append(top, element("h3", "contact-name", contact.name),
      element("p", "contact-company", contact.company || "No company listed"));
    const details = element("dl", "contact-details");
    for (const [label, value] of [["Phone", contact.phone], ["Email", contact.email]]) {
      const row = element("div", "detail");
      row.append(element("dt", "", label), element("dd", "", value || "Not provided"));
      details.append(row);
    }
    card.append(details);
    const editButton = element("button", "edit-button", "Edit");
    editButton.type = "button";
    editButton.setAttribute("aria-label", `Edit ${contact.name}`);
    editButton.addEventListener("click", () => openForm(contact, editButton));
    editButtons.set(contact.id, editButton);
    card.append(editButton);
    const deleteButton = element("button", "delete-button", "Delete");
    deleteButton.type = "button";
    deleteButton.setAttribute("aria-label", `Delete ${contact.name}`);
    deleteButton.addEventListener("click", () => openDelete(contact, deleteButton));
    card.append(deleteButton);
    item.append(card);
    return item;
  }

  function showState(heading, message, isError = false) {
    state.hidden = false;
    list.hidden = true;
    title.textContent = heading;
    description.textContent = message;
    retry.hidden = !isError;
  }

  async function loadContacts() {
    clearTimeout(searchTimer);
    searchTimer = null;
    const query = activeQuery;
    // A newer refresh wins if two GET requests finish out of order.
    const version = ++loadVersion;
    region.setAttribute("aria-label", "Contact directory");
    region.setAttribute("aria-busy", "true");
    count.textContent = "—";
    countLabel.textContent = query ? "Matching contacts" : "Total contacts";
    searchResults.textContent = query ? "Searching contacts…" : "Loading contacts…";
    list.replaceChildren();
    showState("Loading your contacts…", "Getting your connections ready.");
    try {
      const contacts = await window.ContactHubAPI.getContacts(query);
      if (version !== loadVersion) return false;
      editButtons.clear();
      contacts.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id - b.id);
      count.textContent = String(contacts.length);
      searchResults.textContent = query
        ? `${contacts.length} ${contacts.length === 1 ? "result" : "results"} for “${query}”`
        : `${contacts.length} ${contacts.length === 1 ? "contact" : "contacts"}`;
      if (contacts.length === 0) {
        if (query) showState("No matching contacts", `No contacts match “${query}”. Try another search or clear the search.`);
        else showState("Your connections start here", "No contacts yet. Saved contacts will appear here when they’re available.");
      } else {
        const cards = document.createDocumentFragment();
        contacts.forEach((contact) => cards.append(contactCard(contact)));
        list.append(cards);
        list.hidden = false;
        state.hidden = true;
        // Keep a useful announcement in the live region after loading finishes.
        region.setAttribute("aria-label", `Contact directory, ${contacts.length} contacts`);
      }
      return true;
    } catch {
      if (version !== loadVersion) return false;
      searchResults.textContent = "Unable to load results. Try again.";
      // Never expose raw server errors or contact values in error messages/logs.
      showState("We couldn’t load your contacts", "Check your connection and try loading your contacts again.", true);
      return false;
    } finally {
      if (version === loadVersion) region.setAttribute("aria-busy", "false");
    }
  }

  function changeSearch(immediate = false) {
    clearSearch.hidden = searchInput.value.length === 0;
    const query = searchInput.value.trim();
    if (query === activeQuery) {
      if (immediate && searchTimer !== null) loadContacts();
      return;
    }
    activeQuery = query;
    // Invalidate older results now, even before the debounce sends the next GET.
    ++loadVersion;
    clearTimeout(searchTimer);
    searchTimer = null;
    count.textContent = "—";
    countLabel.textContent = query ? "Matching contacts" : "Total contacts";
    searchResults.textContent = "Waiting for search…";
    region.setAttribute("aria-busy", "true");
    region.setAttribute("aria-label", "Contact directory");
    showState("Searching your contacts…", "Getting the latest matches.");
    if (immediate) loadContacts();
    else searchTimer = setTimeout(() => { searchTimer = null; loadContacts(); }, 300);
  }
  searchInput.addEventListener("input", () => changeSearch());
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    changeSearch(true);
  });
  clearSearch.addEventListener("click", () => {
    searchInput.value = "";
    changeSearch(true);
    searchInput.focus();
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && searchInput.value) {
      event.preventDefault();
      searchInput.value = "";
      changeSearch(true);
    }
  });

  retry.addEventListener("click", async () => {
    const refreshed = await loadContacts();
    if (refreshed && notice.textContent.startsWith("Contact deleted successfully, but")) {
      notice.textContent = "Contact deleted successfully. Your connections are up to date.";
    }
  });

  const dialog = document.getElementById("contact-dialog");
  const form = document.getElementById("contact-form");
  const addButton = document.getElementById("add-contact");
  const cancelButton = document.getElementById("cancel-contact");
  const saveButton = document.getElementById("save-contact");
  const formError = document.getElementById("form-error");
  const progress = document.getElementById("save-progress");
  const notice = document.getElementById("save-notice");
  const discardConfirmation = document.getElementById("discard-confirmation");
  const keepEditing = document.getElementById("keep-editing");
  const discardButton = document.getElementById("discard-contact");
  const limits = { name: 200, phone: 50, email: 254, company: 200, notes: 5000 };
  const fields = Object.fromEntries(Object.keys(limits).map((key) => [key, document.getElementById(`contact-${key}`)]));
  const favorite = document.getElementById("contact-favorite");
  const formTitle = document.getElementById("form-title");
  let saving = false;
  let editingId = null;
  let returnFocus = addButton;
  let originalValues = "";

  function valuesSnapshot() {
    return JSON.stringify({ ...Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value])), favorite: favorite.checked });
  }

  function dirty() {
    return valuesSnapshot() !== originalValues;
  }

  function clearErrors() {
    formError.hidden = true;
    formError.textContent = "";
    for (const key of Object.keys(fields)) {
      fields[key].setAttribute("aria-invalid", "false");
      const error = document.getElementById(`error-${key}`);
      error.textContent = "";
      error.hidden = true;
    }
  }

  function closeForm() {
    if (saving) return;
    if (dirty()) {
      discardConfirmation.hidden = false;
      keepEditing.focus();
      return;
    }
    dialog.close();
  }

  keepEditing.addEventListener("click", () => {
    discardConfirmation.hidden = true;
    fields.name.focus();
  });
  discardButton.addEventListener("click", () => {
    if (!saving) dialog.close();
  });

  function openForm(contact = null, trigger = addButton) {
    editingId = contact ? contact.id : null;
    returnFocus = trigger;
    for (const [key, field] of Object.entries(fields)) field.value = contact ? contact[key] : "";
    favorite.checked = contact ? contact.favorite : false;
    originalValues = valuesSnapshot();
    formTitle.textContent = contact ? "Edit Contact" : "Add a contact";
    saveButton.textContent = contact ? "Save Changes" : "Save Contact";
    clearErrors();
    discardConfirmation.hidden = true;
    progress.textContent = "";
    dialog.showModal(); // Native dialog traps keyboard focus and makes the background inert.
    fields.name.focus();
  }
  addButton.addEventListener("click", () => openForm());
  cancelButton.addEventListener("click", closeForm);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault(); // Escape follows the same unsaved-change and saving rules.
    if (!discardConfirmation.hidden) {
      discardConfirmation.hidden = true;
      fields.name.focus();
      return;
    }
    closeForm();
  });
  dialog.addEventListener("close", () => {
    form.reset();
    discardConfirmation.hidden = true;
    clearErrors();
    editingId = null;
    (returnFocus.isConnected === false ? addButton : returnFocus).focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving) return;
    clearErrors();
    discardConfirmation.hidden = true;
    const data = {};
    let firstInvalid = null;
    for (const [key, limit] of Object.entries(limits)) {
      data[key] = fields[key].value.trim();
      let message = "";
      if (data[key].length > limit) message = `Use ${limit} characters or fewer.`;
      else if (key === "name" && !data.name) message = "Enter a full name.";
      else if (key === "email" && data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        message = "Enter an email address such as name@example.com.";
      } else if (key === "phone" && data.phone && (!/\d/u.test(data.phone) || /[\u0000-\u001f\u007f]/u.test(data.phone))) {
        // Avoid country-specific lengths or formatting restrictions; extensions are allowed.
        message = "Include a phone number with at least one digit and no control characters.";
      }
      if (message) {
        const error = document.getElementById(`error-${key}`);
        error.textContent = message;
        error.hidden = false;
        fields[key].setAttribute("aria-invalid", "true");
        firstInvalid ||= fields[key];
      }
    }
    if (firstInvalid) { firstInvalid.focus(); return; }
    data.favorite = favorite.checked;
    const updatingId = editingId;
    saving = true;
    saveButton.disabled = true;
    cancelButton.disabled = true;
    Object.values(fields).forEach((field) => { field.disabled = true; });
    favorite.disabled = true;
    progress.textContent = updatingId === null ? "Saving contact…" : "Updating contact…";
    try {
      if (updatingId === null) await window.ContactHubAPI.createContact(data);
      else await window.ContactHubAPI.updateContact(updatingId, data);
    } catch (error) {
      formError.textContent = error.validation || error.missing ? error.message
        : updatingId === null
          ? "We couldn’t confirm the save. Your details are still here. Check the contact list before trying again to avoid a duplicate."
          : "We couldn’t confirm the update. Your edits are still here. Reload the list before retrying; the changes may already have been saved.";
      formError.hidden = false;
      formError.focus();
      return;
    } finally {
      saving = false;
      saveButton.disabled = false;
      cancelButton.disabled = false;
      Object.values(fields).forEach((field) => { field.disabled = false; });
      favorite.disabled = false;
      progress.textContent = "";
    }
    // Only a confirmed POST 201 or PUT 200 closes the form and announces success.
    form.reset();
    dialog.close();
    const action = updatingId === null ? "saved" : "updated";
    notice.textContent = `Contact ${action}. Refreshing your connections…`;
    notice.hidden = false;
    const refreshed = await loadContacts();
    notice.textContent = refreshed ? `Contact ${action} successfully. Your connections are up to date.`
      : `Contact ${action} successfully, but the list couldn’t refresh. Use Try again to reload your connections; don’t submit the contact again.`;
    if (updatingId !== null) {
      // Refresh replaces card nodes; focus the replacement Edit button, or a safe fallback.
      ((refreshed && editButtons.get(updatingId)) || addButton).focus();
    }
  });
  const deleteDialog = document.getElementById("delete-dialog");
  const deleteName = document.getElementById("delete-name");
  const deleteError = document.getElementById("delete-error");
  const deleteProgress = document.getElementById("delete-progress");
  const cancelDelete = document.getElementById("cancel-delete");
  const confirmDelete = document.getElementById("confirm-delete");
  let deleteTarget = null;
  let deleteTrigger = addButton;
  let deleting = false;

  function openDelete(contact, trigger) {
    deleteTarget = contact.id;
    deleteTrigger = trigger;
    deleteName.textContent = contact.name;
    deleteError.hidden = true;
    deleteError.textContent = "";
    deleteProgress.textContent = "";
    deleteDialog.showModal();
    cancelDelete.focus(); // Make the safe action the keyboard default.
  }

  cancelDelete.addEventListener("click", () => {
    if (!deleting) deleteDialog.close();
  });
  deleteDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!deleting) deleteDialog.close();
  });
  deleteDialog.addEventListener("close", () => {
    deleteTarget = null;
    (deleteTrigger.isConnected === false ? addButton : deleteTrigger).focus();
  });
  confirmDelete.addEventListener("click", async () => {
    if (deleting || deleteTarget === null) return;
    deleting = true;
    confirmDelete.disabled = true;
    cancelDelete.disabled = true;
    deleteDialog.setAttribute("aria-busy", "true");
    deleteError.hidden = true;
    deleteProgress.textContent = "Deleting contact…";
    try {
      await window.ContactHubAPI.deleteContact(deleteTarget);
    } catch (error) {
      deleteError.textContent = error.missing ? error.message
        : "We couldn’t confirm the deletion; it may have succeeded. Cancel and reload the list before trying again.";
      deleteError.hidden = false;
      deleteError.focus();
      return;
    } finally {
      deleting = false;
      confirmDelete.disabled = false;
      cancelDelete.disabled = false;
      deleteDialog.setAttribute("aria-busy", "false");
      deleteProgress.textContent = "";
    }
    deleteDialog.close();
    notice.textContent = "Contact deleted. Refreshing your connections…";
    notice.hidden = false;
    const refreshed = await loadContacts();
    notice.textContent = refreshed ? "Contact deleted successfully. Your connections are up to date."
      : "Contact deleted successfully, but the list couldn’t refresh. Use Try again to reload your connections; don’t repeat the deletion.";
    addButton.focus(); // The deleted card no longer has a button to return to.
  });
  loadContacts();
})();
