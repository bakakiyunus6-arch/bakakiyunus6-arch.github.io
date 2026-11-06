"use strict";

const DB_NAME = "BakSnacksDatabase";
const DB_VERSION = 6;

let db;
let entries = [];
let supplierPayments = [];

const $ = (id) => document.getElementById(id);

const money = (value) =>
  "UGX " + Math.round(Number(value) || 0).toLocaleString("en-UG");

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
            const database = request.result;
            const upgrade = request.transaction;

            const definitions = [
                { name: "products", keyPath: "id", autoIncrement: true },
                { name: "transactions", keyPath: "id", autoIncrement: true },
                { name: "rawMaterials", keyPath: "id", autoIncrement: true },
                { name: "rawMaterialMovements", keyPath: "id", autoIncrement: true },
                { name: "productionBatches", keyPath: "id", autoIncrement: true },
                { name: "suppliers", keyPath: "id", autoIncrement: false },
                { name: "purchases", keyPath: "id", autoIncrement: false },
                { name: "supplierPayments", keyPath: "id", autoIncrement: false },
                { name: "cashbookEntries", keyPath: "id", autoIncrement: false }
            ];

            for (const definition of definitions) {
                if (!database.objectStoreNames.contains(definition.name)) {
                    database.createObjectStore(definition.name, {
                        keyPath: definition.keyPath,
                        autoIncrement: definition.autoIncrement
                    });
                }
            }

            const indexes = [
                ["transactions", "date", "date"],
                ["rawMaterialMovements", "materialId", "materialId"],
                ["rawMaterialMovements", "date", "date"],
                ["productionBatches", "date", "date"]
            ];

            for (const [storeName, indexName, keyPath] of indexes) {
                const store = upgrade.objectStore(storeName);
                if (!store.indexNames.contains(indexName)) {
                    store.createIndex(indexName, keyPath, { unique: false });
                }
            }
        };

    request.onsuccess = () => {
      db = request.result;
      db.onversionchange = () => db.close();
      resolve();
    };

    request.onerror = () => reject(request.error);
  });
}

function transactionFinished(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error || new Error("Database transaction aborted."));
  });
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
      resolve([]);
      return;
    }

    const request = db.transaction(storeName, "readonly")
      .objectStore(storeName).getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function localDate() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
}

function makeId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : "entry-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function showMessage(message, type) {
  $("entryMessage").textContent = message;
  $("entryMessage").className = type || "";
}

async function loadData() {
  entries = await getAll("cashbookEntries");
  supplierPayments = await getAll("supplierPayments");

  render();
}

function normaliseRecords() {
  const manual = entries.map((entry) => ({
    id: entry.id,
    date: entry.date,
    type: entry.type,
    category: entry.category || "",
    description: entry.description || "",
    method: entry.paymentMethod || "",
    amount: Number(entry.amount || 0),
    reference: entry.reference || ""
  }));

  const suppliers = supplierPayments.map((payment) => ({
    id: payment.id,
    date: payment.date,
    type: "supplier",
    category: "Inventory payment",
    description: "Supplier payment — " + (payment.supplierName || "Supplier"),
    method: payment.paymentMethod || "",
    amount: Number(payment.amount || 0),
    reference: payment.reference || ""
  }));

  return [...manual, ...suppliers].filter((entry) =>
    Number.isFinite(entry.amount) && entry.amount > 0
  );
}

function getFilteredRecords() {
  const type = $("filterType").value;
  const from = $("filterFrom").value;
  const to = $("filterTo").value;

  return normaliseRecords()
    .filter((entry) => type === "all" || entry.type === type)
    .filter((entry) => !from || entry.date >= from)
    .filter((entry) => !to || entry.date <= to)
    .sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || ""))
    );
}

function renderSummary() {
  const records = normaliseRecords();

  const income = records
    .filter((entry) => entry.type === "income")
    .reduce((sum, entry) => sum + entry.amount, 0);

  const expenses = records
    .filter((entry) => entry.type === "expense")
    .reduce((sum, entry) => sum + entry.amount, 0);

  const supplierOutflow = records
    .filter((entry) => entry.type === "supplier")
    .reduce((sum, entry) => sum + entry.amount, 0);

  const totalOut = expenses + supplierOutflow;

  $("moneyIn").textContent = money(income);
  $("moneyOut").textContent = money(totalOut);
  $("expenseTotal").textContent = money(expenses);
  $("netMovement").textContent = money(income - totalOut);
}

function renderRows() {
  const records = getFilteredRecords();
  const body = $("cashbookRows");

  if (!records.length) {
    body.innerHTML = '<tr><td colspan="6">No cashbook records found.</td></tr>';
    return;
  }

  body.innerHTML = records.map((entry) => {
    const isIncome = entry.type === "income";
    const typeLabel = entry.type === "supplier"
      ? "Supplier payment"
      : isIncome ? "Other income" : "Expense";

    return `
      <tr>
        <td>${escapeHTML(entry.date || "—")}</td>
        <td>${typeLabel}</td>
        <td>
          ${escapeHTML(entry.description)}
          ${entry.reference ? `<br><small>Ref: ${escapeHTML(entry.reference)}</small>` : ""}
        </td>
        <td>${escapeHTML(entry.method || "—")}</td>
        <td class="${isIncome ? "cash-in" : ""}">${isIncome ? money(entry.amount) : "—"}</td>
        <td class="${!isIncome ? "cash-out" : ""}">${!isIncome ? money(entry.amount) : "—"}</td>
      </tr>
    `;
  }).join("");
}

function render() {
  renderSummary();
  renderRows();
}

async function saveEntry(event) {
  event.preventDefault();

  const type = $("entryType").value;
  const date = $("entryDate").value;
  const amount = Number($("entryAmount").value);
  const description = $("entryDescription").value.trim();

  if (!date || !description || !Number.isSafeInteger(amount) || amount <= 0) {
    showMessage("Enter a valid date, description and whole-number UGX amount.", "error");
    return;
  }

  const entry = {
    id: makeId(),
    type,
    date,
    category: $("entryCategory").value,
    amount,
    description,
    paymentMethod: $("entryMethod").value,
    reference: $("entryReference").value.trim(),
    createdAt: new Date().toISOString()
  };

  try {
    const transaction = db.transaction("cashbookEntries", "readwrite");
    transaction.objectStore("cashbookEntries").add(entry);
    await transactionFinished(transaction);

    $("entryForm").reset();
    $("entryDate").value = localDate();
    showMessage("Cashbook entry saved successfully.", "success");
    await loadData();
  } catch (error) {
    showMessage(error.message || "Could not save the entry.", "error");
  }
}

function setupEvents() {
  $("entryForm").addEventListener("submit", saveEntry);

  ["filterType", "filterFrom", "filterTo"].forEach((id) => {
    $(id).addEventListener("change", renderRows);
  });

  $("resetFilters").addEventListener("click", () => {
    $("filterType").value = "all";
    $("filterFrom").value = "";
    $("filterTo").value = "";
    renderRows();
  });

  $("entryType").addEventListener("change", () => {
    const isExpense = $("entryType").value === "expense";
    $("entryCategory").value = isExpense ? "Rent" : "Other";
  });
}

async function start() {
  try {
    await openDatabase();
    $("entryDate").value = localDate();
    setupEvents();
    await loadData();
  } catch (error) {
    showMessage("Database error: " + error.message, "error");
  }
}

start();
