"use strict";

// This file owns network requests; app.js owns what appears on the page.
window.ContactHubAPI = {
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
      if (!response.ok || response.status !== 201 || !saved || !Number.isInteger(saved.id)
          || saved.id <= 0 || typeof saved.name !== "string") {
        throw new Error("Unconfirmed save.");
      }
      return saved;
    } finally {
      clearTimeout(timeout);
    }
  },
  async getContacts() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch("/api/contacts", {
        headers: { Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Unable to load contacts.");
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) throw new Error("Unexpected response format.");
      const data = await response.json();
      const validContact = (contact) => contact !== null && typeof contact === "object"
        && Number.isInteger(contact.id) && contact.id > 0
        && ["name", "phone", "email", "company"].every((field) => typeof contact[field] === "string")
        && contact.name.trim().length > 0 && typeof contact.favorite === "boolean";
      if (!data || !Array.isArray(data.contacts) || !data.contacts.every(validContact)) {
        throw new Error("Unexpected contact data.");
      }
      return data.contacts;
    } finally {
      clearTimeout(timeout);
    }
  },
};
