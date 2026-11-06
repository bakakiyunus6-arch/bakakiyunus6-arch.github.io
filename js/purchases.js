"use strict";

const DB_NAME = "BakSnacksDatabase";
const DB_VERSION = 6;

let db;
let materials = [];
let suppliers = [];
let purchases = [];
let payments = [];

const $ = (id) => document.getElementById(id);
const money = (value) =>
  "UGX " + Math.round(Number(value) || 0).toLocaleString("en-UG");
const makeId = () =>
  window.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);

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
      resolve(db);
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
    const request = db.transaction(storeName, "readonly")
      .objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function showMessage(id, message, type) {
  const element = $(id);
  element.textContent = message;
  element.className = "message " + (type || "");
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

function dateToday() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function calculatePurchaseTotal() {
  let total = 0;

  document.querySelectorAll(".material-line").forEach((line) => {
    const quantity = Number(line.querySelector(".item-quantity").value);
    const unitCost = Number(line.querySelector(".item-cost").value);

    if (quantity > 0 && unitCost >= 0) {
      total += quantity * unitCost;
    }
  });

  $("purchaseTotal").textContent = money(total);
  return Math.round(total);
}

function createMaterialRow() {
  const line = document.createElement("div");
  line.className = "material-line";

  const options = materials.map((material) =>
    `<option value="${escapeHTML(material.id)}">${escapeHTML(material.name)} (${escapeHTML(material.unit)})</option>`
  ).join("");

  line.innerHTML = `
    <label>
      Raw material
      <select class="item-material" required>
        <option value="">Select material</option>
        ${options}
      </select>
    </label>
    <label>
      Quantity received
      <input class="item-quantity" type="number" min="0.001" step="any" required placeholder="0">
    </label>
    <label>
      Cost per unit (UGX)
      <input class="item-cost" type="number" min="0" step="1" required placeholder="0">
    </label>
    <button type="button" class="remove-item">Remove</button>
  `;

  line.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", calculatePurchaseTotal);
    input.addEventListener("change", calculatePurchaseTotal);
  });

  line.querySelector(".remove-item").addEventListener("click", () => {
    line.remove();
    calculatePurchaseTotal();
  });

  $("purchaseItems").appendChild(line);
}

function readPurchaseItems() {
  const rows = [...document.querySelectorAll(".material-line")];
  const items = [];
  const usedMaterials = new Set();

  for (const row of rows) {
    const materialId = row.querySelector(".item-material").value;
    const quantity = Number(row.querySelector(".item-quantity").value);
    const unitCost = Number(row.querySelector(".item-cost").value);

    if (!materialId || !Number.isFinite(quantity) || quantity <= 0 ||
        !Number.isFinite(unitCost) || unitCost < 0) {
      throw new Error("Complete every material row with a valid quantity and unit cost.");
    }

    if (usedMaterials.has(materialId)) {
      throw new Error("A material appears more than once. Combine its quantity into one row.");
    }

    usedMaterials.add(materialId);

    const material = materials.find((item) => item.id === materialId);
    if (!material) throw new Error("A selected material no longer exists.");

    items.push({
      materialId,
      name: material.name,
      unit: material.unit,
      quantity,
      unitCost: Math.round(unitCost),
      lineTotal: Math.round(quantity * unitCost)
    });
  }

  if (!items.length) throw new Error("Add at least one raw material.");

  return items;
}

async function refreshData() {
  [materials, suppliers, purchases, payments] = await Promise.all([
    getAll("rawMaterials"),
    getAll("suppliers"),
    getAll("purchases"),
    getAll("supplierPayments")
  ]);

  renderSuppliers();
  renderSupplierOptions();
  renderPaymentOptions();
  renderPurchaseHistory();
  renderStats();
}

function renderSuppliers() {
  const container = $("supplierList");

  if (!suppliers.length) {
    container.textContent = "No suppliers registered yet.";
    return;
  }

  container.innerHTML = suppliers.map((supplier) => `
    <div class="supplier-row">
      <div>
        <strong>${escapeHTML(supplier.name)}</strong>
        <small>${escapeHTML(supplier.phone || "No phone number")} · ${escapeHTML(supplier.notes || "No notes")}</small>
      </div>
    </div>
  `).join("");
}

function renderSupplierOptions() {
  const select = $("purchaseSupplier");
  const selected = select.value;

  select.innerHTML = '<option value="">No supplier selected</option>' +
    suppliers.map((supplier) =>
      `<option value="${escapeHTML(supplier.id)}">${escapeHTML(supplier.name)}</option>`
    ).join("");

  if (suppliers.some((supplier) => supplier.id === selected)) {
    select.value = selected;
  }
}

function paidForPurchase(purchaseId) {
  return payments
    .filter((payment) => payment.purchaseId === purchaseId)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function balanceForPurchase(purchase) {
  return Math.max(0, Number(purchase.totalAmount || 0) - paidForPurchase(purchase.id));
}

function renderPaymentOptions() {
  const select = $("paymentPurchase");
  const selected = select.value;

  const unpaid = purchases.filter((purchase) => balanceForPurchase(purchase) > 0);

  select.innerHTML = '<option value="">Select an unpaid purchase</option>' +
    unpaid.map((purchase) => {
      const balance = balanceForPurchase(purchase);
      return `<option value="${escapeHTML(purchase.id)}">${escapeHTML(purchase.purchaseNumber)} — ${escapeHTML(purchase.supplierName || "Unspecified supplier")} — ${money(balance)} due</option>`;
    }).join("");

  if (unpaid.some((purchase) => purchase.id === selected)) {
    select.value = selected;
  }
}

function renderPurchaseHistory() {
  const body = $("purchaseHistory");

  if (!purchases.length) {
    body.innerHTML = '<tr><td colspan="6">No purchases recorded yet.</td></tr>';
    return;
  }

  const sorted = [...purchases].sort((a, b) =>
    String(b.date).localeCompare(String(a.date))
  );

  body.innerHTML = sorted.map((purchase) => {
    const paid = paidForPurchase(purchase.id);
    const balance = balanceForPurchase(purchase);

    return `
      <tr>
        <td>${escapeHTML(purchase.purchaseNumber)}</td>
        <td>${escapeHTML(purchase.date)}</td>
        <td>${escapeHTML(purchase.supplierName || "—")}</td>
        <td>${money(purchase.totalAmount)}</td>
        <td>${money(paid)}</td>
        <td class="${balance > 0 ? "balance-due" : ""}">${money(balance)}</td>
      </tr>
    `;
  }).join("");
}

function renderStats() {
  const total = purchases.reduce((sum, purchase) =>
    sum + Number(purchase.totalAmount || 0), 0);

  const paid = payments.reduce((sum, payment) =>
    sum + Number(payment.amount || 0), 0);

  $("totalPurchases").textContent = money(total);
  $("totalPaid").textContent = money(paid);
  $("totalOutstanding").textContent = money(Math.max(0, total - paid));
  $("supplierCount").textContent = suppliers.length;
}

async function saveSupplier(event) {
  event.preventDefault();

  const name = $("supplierName").value.trim();
  const phone = $("supplierPhone").value.trim();
  const notes = $("supplierNotes").value.trim();

  if (!name) return;

  if (suppliers.some((supplier) =>
    supplier.name.trim().toLowerCase() === name.toLowerCase()
  )) {
    showMessage("supplierMessage", "A supplier with this name already exists.", "error");
    return;
  }

  const supplier = {
    id: makeId(),
    name,
    phone,
    notes,
    createdAt: new Date().toISOString()
  };

  try {
    const transaction = db.transaction("suppliers", "readwrite");
    transaction.objectStore("suppliers").add(supplier);
    await transactionFinished(transaction);

    $("supplierForm").reset();
    showMessage("supplierMessage", "Supplier saved successfully.", "success");
    await refreshData();
  } catch (error) {
    showMessage("supplierMessage", error.message || "Could not save supplier.", "error");
  }
}

async function savePurchase(event) {
  event.preventDefault();

  const button = $("purchaseForm").querySelector('button[type="submit"]');
  button.disabled = true;

  try {
    const items = readPurchaseItems();
    const totalAmount = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const paidAmount = Number($("purchasePaid").value);
    const supplierId = $("purchaseSupplier").value;
    const supplier = suppliers.find((item) => item.id === supplierId);

    if (!Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > totalAmount) {
      throw new Error("The amount paid must be between zero and the purchase total.");
    }

    const method = $("purchaseMethod").value;
    if (paidAmount > 0 && !method) {
      throw new Error("Select a payment method for the amount paid.");
    }

    const date = $("purchaseDate").value;
    if (!date) throw new Error("Select the purchase date.");

    // Read the latest inventory quantities and costs before calculating weighted averages.
    const latestMaterials = await getAll("rawMaterials");
    const materialMap = new Map(latestMaterials.map((item) => [item.id, item]));

    for (const item of items) {
      if (!materialMap.has(item.materialId)) {
        throw new Error(`Material "${item.name}" was not found in inventory.`);
      }
    }

    const purchase = {
      id: makeId(),
      purchaseNumber: "PUR-" + Date.now().toString().slice(-9),
      date,
      supplierId: supplier ? supplier.id : "",
      supplierName: supplier ? supplier.name : "",
      items,
      totalAmount,
      notes: $("purchaseNotes").value.trim(),
      createdAt: new Date().toISOString()
    };

    const transaction = db.transaction(
      ["rawMaterials", "rawMaterialMovements", "purchases", "supplierPayments"],
      "readwrite"
    );

    const materialStore = transaction.objectStore("rawMaterials");
    const movementStore = transaction.objectStore("rawMaterialMovements");

    for (const item of items) {
      const material = materialMap.get(item.materialId);
      const oldQuantity = Number(material.quantity || 0);
      const oldCost = Number(material.costPerUnit || 0);
      const newQuantity = oldQuantity + item.quantity;

      // Weighted-average cost: existing stock value plus newly purchased stock value.
      const newAverageCost = newQuantity > 0
        ? Math.round(((oldQuantity * oldCost) + (item.quantity * item.unitCost)) / newQuantity)
        : item.unitCost;

      material.quantity = newQuantity;
      material.costPerUnit = newAverageCost;
      material.updatedAt = new Date().toISOString();

      materialStore.put(material);

      movementStore.add({
        id: makeId(),
        materialId: material.id,
        materialName: material.name,
        movement: "Purchase received",
        quantity: item.quantity,
        note: `${purchase.purchaseNumber} · ${purchase.supplierName || "No supplier recorded"}`,
        date,
        createdAt: new Date().toISOString()
      });
    }

    transaction.objectStore("purchases").add(purchase);

    if (paidAmount > 0) {
      transaction.objectStore("supplierPayments").add({
        id: makeId(),
        purchaseId: purchase.id,
        supplierId: purchase.supplierId,
        supplierName: purchase.supplierName,
        amount: paidAmount,
        paymentMethod: method,
        reference: $("purchaseReference").value.trim(),
        date,
        createdAt: new Date().toISOString()
      });
    }

    await transactionFinished(transaction);

    $("purchaseForm").reset();
    $("purchaseDate").value = dateToday();
    $("purchasePaid").value = "0";
    $("purchaseItems").innerHTML = "";
    createMaterialRow();
    calculatePurchaseTotal();

    showMessage(
      "purchaseMessage",
      `Purchase ${purchase.purchaseNumber} saved. Raw-material stock has been updated.`,
      "success"
    );

    await refreshData();
  } catch (error) {
    showMessage("purchaseMessage", error.message || "Could not save purchase.", "error");
  } finally {
    button.disabled = false;
  }
}

async function saveSupplierPayment(event) {
  event.preventDefault();

  const purchaseId = $("paymentPurchase").value;
  const amount = Number($("paymentAmount").value);
  const method = $("paymentMethod").value;
  const purchase = purchases.find((item) => item.id === purchaseId);

  if (!purchase) {
    showMessage("paymentMessage", "Select a valid purchase.", "error");
    return;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    showMessage("paymentMessage", "Enter a valid payment amount.", "error");
    return;
  }

  if (!method) {
    showMessage("paymentMessage", "Select a payment method.", "error");
    return;
  }

  const balance = balanceForPurchase(purchase);
  if (amount > balance) {
    showMessage("paymentMessage", `Payment exceeds the outstanding balance of ${money(balance)}.`, "error");
    return;
  }

  const payment = {
    id: makeId(),
    purchaseId: purchase.id,
    supplierId: purchase.supplierId,
    supplierName: purchase.supplierName,
    amount: Math.round(amount),
    paymentMethod: method,
    reference: $("paymentReference").value.trim(),
    date: dateToday(),
    createdAt: new Date().toISOString()
  };

  try {
    const transaction = db.transaction("supplierPayments", "readwrite");
    transaction.objectStore("supplierPayments").add(payment);
    await transactionFinished(transaction);

    $("paymentForm").reset();
    showMessage("paymentMessage", "Supplier payment recorded successfully.", "success");
    await refreshData();
  } catch (error) {
    showMessage("paymentMessage", error.message || "Could not record payment.", "error");
  }
}

function setupEvents() {
  $("supplierForm").addEventListener("submit", saveSupplier);
  $("purchaseForm").addEventListener("submit", savePurchase);
  $("paymentForm").addEventListener("submit", saveSupplierPayment);

  $("addItemButton").addEventListener("click", createMaterialRow);

  $("paymentPurchase").addEventListener("change", () => {
    const purchase = purchases.find((item) => item.id === $("paymentPurchase").value);
    if (purchase) {
      $("paymentAmount").max = balanceForPurchase(purchase);
      $("paymentAmount").value = balanceForPurchase(purchase);
    } else {
      $("paymentAmount").removeAttribute("max");
      $("paymentAmount").value = "";
    }
  });

  $("purchasePaid").addEventListener("input", () => {
    const total = calculatePurchaseTotal();
    $("purchasePaid").max = total;
  });
}

async function startApp() {
  try {
    await openDatabase();
    $("purchaseDate").value = dateToday();

    await refreshData();
    setupEvents();

    if (!materials.length) {
      $("purchaseItems").innerHTML =
        '<p class="help-text">Register raw materials in the Raw Materials section before recording purchases.</p>';
    } else {
      createMaterialRow();
    }
  } catch (error) {
    document.querySelector(".purchases-page").insertAdjacentHTML(
      "afterbegin",
      `<p class="message error">Database error: ${escapeHTML(error.message)}</p>`
    );
  }
}

startApp();
