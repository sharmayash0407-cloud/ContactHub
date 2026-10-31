"use strict";

// Every read/save response needs the fields the dashboard and shared form use.
function isContact(contact) {
  return contact !== null && typeof contact === "object"
    && Number.isSafeInteger(contact.id) && contact.id > 0
    && ["name", "phone", "email", "company", "notes"].every((field) => typeof contact[field] === "string")
    && ["city", "locality"].every((field) => contact[field] == null || typeof contact[field] === "string")
    && contact.name.trim().length > 0 && typeof contact.favorite === "boolean";
}

// This file owns network requests; app.js owns what appears on the page.
window.ContactHubAPI = {
  async setFavorite(id, favorite) {
    if (!Number.isSafeInteger(id) || id <= 0 || typeof favorite !== "boolean") throw new Error("Invalid favorite request.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`/api/contacts/${id}/favorite`, {
        method: "PATCH",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ favorite }),
        signal: controller.signal,
      });
      if (response.status === 404) {
        const error = new Error("This contact no longer exists. Reload your contacts.");
        error.missing = true;
        throw error;
      }
      if (!response.ok || response.status !== 200 || !(response.headers.get("content-type") || "").includes("application/json")) {
        throw new Error("Unconfirmed favorite update.");
      }
      const data = await response.json();
      if (!isContact(data?.contact) || data.contact.id !== id || data.contact.favorite !== favorite) throw new Error("Unconfirmed favorite update.");
      return data.contact;
    } finally { clearTimeout(timeout); }
  },
  async deleteContact(id) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid contact ID.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`/api/contacts/${id}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (response.status === 404) {
        const error = new Error("This contact no longer exists. Cancel and reload the list to see the latest contacts.");
        error.missing = true;
        throw error;
      }
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || response.status !== 200 || !contentType.includes("application/json")) {
        throw new Error("Unconfirmed deletion.");
      }
      const data = await response.json();
      if (data?.message !== "Contact deleted.") throw new Error("Unconfirmed deletion.");
    } finally {
      clearTimeout(timeout);
    }
  },
  async updateContact(id, contact) {
    if (!Number.isInteger(id) || id <= 0) {
      const error = new Error("This contact is no longer available. Reload the list.");
      error.missing = true;
      throw error;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`/api/contacts/${id}`, {
        method: "PUT",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(contact),
        signal: controller.signal,
      });
      if (response.status === 404) {
        const error = new Error("This contact no longer exists. Your edits are still here; cancel and reload the list.");
        error.missing = true;
        throw error;
      }
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) throw new Error("Unconfirmed update.");
      const data = await response.json();
      if (response.status === 400 && data?.error?.code === "validation_error") {
        const error = new Error("The server rejected these details. Review the fields and try again.");
        error.validation = true;
        throw error;
      }
      const saved = data?.contact;
      if (!response.ok || response.status !== 200 || !isContact(saved) || saved.id !== id) {
        throw new Error("Unconfirmed update.");
      }
      return saved;
    } finally {
      clearTimeout(timeout);
    }
  },
  async createContact(contact) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch("/api/contacts", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(contact),
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) throw new Error("Unconfirmed save.");
      const data = await response.json();
      if (response.status === 400 && data?.error?.code === "validation_error") {
        const error = new Error("The server rejected these details. Review the fields and try again.");
        error.validation = true;
        throw error;
      }
      const saved = data?.contact;
      if (!response.ok || response.status !== 201 || !isContact(saved)) {
        throw new Error("Unconfirmed save.");
      }
      return saved;
    } finally {
      clearTimeout(timeout);
    }
  },
  async getContacts(search = "", favoritesOnly = false, pagination = null, field = "all", sort = "name_asc") {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const query = search.trim();
      const parameters = [];
      if (query) parameters.push(`search=${encodeURIComponent(query)}`);
      if (favoritesOnly) parameters.push("favorite=true");
      if (field !== "all") parameters.push(`field=${encodeURIComponent(field)}`);
      if (sort !== "name_asc") parameters.push(`sort=${encodeURIComponent(sort)}`);
      if (pagination) parameters.push(`page=${pagination.page}`, `page_size=${pagination.page_size}`);
      const url = "/api/contacts" + (parameters.length ? `?${parameters.join("&")}` : "");
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Unable to load contacts.");
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) throw new Error("Unexpected response format.");
      const data = await response.json();
      if (!data || !Array.isArray(data.contacts) || !data.contacts.every(isContact)) {
        throw new Error("Unexpected contact data.");
      }
      if (pagination) {
        const meta = data.pagination;
        if (!meta || ![meta.page, meta.page_size, meta.total, meta.total_pages].every(Number.isSafeInteger)
          || meta.page < 1 || meta.page > Math.max(1, meta.total_pages)
          || meta.page_size !== pagination.page_size || ![25, 50].includes(meta.page_size)
          || meta.total < 0 || meta.total_pages !== Math.ceil(meta.total / meta.page_size)
          || data.contacts.length !== Math.min(meta.page_size, Math.max(0, meta.total - (meta.page - 1) * meta.page_size))) {
          throw new Error("Unexpected pagination data.");
        }
        return data;
      }
      return data.contacts;
    } finally {
      clearTimeout(timeout);
    }
  },
};
