"use strict";

(() => {
  const region = document.getElementById("contacts-region");
  const list = document.getElementById("contact-list");
  const state = document.getElementById("directory-state");
  const title = document.getElementById("state-title");
  const description = document.getElementById("state-description");
  const count = document.getElementById("contact-count");
  const retry = document.getElementById("retry-button");

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
    region.setAttribute("aria-busy", "true");
    count.textContent = "—";
    list.replaceChildren();
    showState("Loading your contacts…", "Getting your connections ready.");
    try {
      const contacts = await window.ContactHubAPI.getContacts();
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
    } catch {
      // Never expose raw server errors or contact values in error messages/logs.
      showState("We couldn’t load your contacts", "Check your connection and try again. Your saved contacts haven’t been changed.", true);
    } finally {
      region.setAttribute("aria-busy", "false");
    }
  }

  retry.addEventListener("click", loadContacts);
  loadContacts();
})();
