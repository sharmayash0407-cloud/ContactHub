"use strict";

(() => {
  const region = document.getElementById("contacts-region");
  const list = document.getElementById("contact-list");
  const state = document.getElementById("directory-state");
  const title = document.getElementById("state-title");
  const description = document.getElementById("state-description");
  const count = document.getElementById("contact-count");
  const retry = document.getElementById("retry-button");
  let loadVersion = 0;

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
    // A newer refresh wins if two GET requests finish out of order.
    const version = ++loadVersion;
    region.setAttribute("aria-busy", "true");
    count.textContent = "—";
    list.replaceChildren();
    showState("Loading your contacts…", "Getting your connections ready.");
    try {
      const contacts = await window.ContactHubAPI.getContacts();
      if (version !== loadVersion) return false;
      contacts.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id - b.id);
      count.textContent = String(contacts.length);
      if (contacts.length === 0) {
        showState("Your connections start here", "No contacts yet. Saved contacts will appear here when they’re available.");
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
      // Never expose raw server errors or contact values in error messages/logs.
      showState("We couldn’t load your contacts", "Check your connection and try again. Your saved contacts haven’t been changed.", true);
      return false;
    } finally {
      if (version === loadVersion) region.setAttribute("aria-busy", "false");
    }
  }

  retry.addEventListener("click", loadContacts);

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
  let saving = false;

  function dirty() {
    return favorite.checked || Object.values(fields).some((field) => field.value !== "");
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

  addButton.addEventListener("click", () => {
    clearErrors();
    discardConfirmation.hidden = true;
    progress.textContent = "";
    dialog.showModal(); // Native dialog traps keyboard focus and makes the background inert.
    fields.name.focus();
  });
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
    addButton.focus();
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
    saving = true;
    saveButton.disabled = true;
    cancelButton.disabled = true;
    Object.values(fields).forEach((field) => { field.disabled = true; });
    favorite.disabled = true;
    progress.textContent = "Saving contact…";
    try {
      await window.ContactHubAPI.createContact(data);
    } catch (error) {
      formError.textContent = error.validation ? error.message
        : "We couldn’t confirm the save. Your details are still here. Check the contact list before trying again to avoid a duplicate.";
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
    // Only a confirmed 201 response closes the form and announces success.
    form.reset();
    dialog.close();
    notice.textContent = "Contact saved. Refreshing your connections…";
    notice.hidden = false;
    const refreshed = await loadContacts();
    notice.textContent = refreshed ? "Contact saved successfully. Your connections are up to date."
      : "Contact saved successfully, but the list couldn’t refresh. Use Try again to reload your connections; don’t submit the contact again.";
  });
  loadContacts();
})();
