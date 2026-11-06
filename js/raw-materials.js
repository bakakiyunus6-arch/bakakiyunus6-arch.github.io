"use strict";

const DB_NAME = "BakSnacksDatabase";
const DB_VERSION = 6;
let db;

const $ = id => document.getElementById(id);

const money = amount => new Intl.NumberFormat("en-UG", {
    style: "currency",
    currency: "UGX",
    maximumFractionDigits: 0
}).format(amount || 0);

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}

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

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

function getAll(storeName) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveMaterial(event) {
    event.preventDefault();

    const name = $("material-name").value.trim();
    const unit = $("material-unit").value;
    const quantity = Number($("material-quantity").value);
    const reorderLevel = Number($("material-reorder").value);
    const costPerUnit = Number($("material-cost").value);

    if (!name || !Number.isFinite(quantity) || quantity < 0 ||
        !Number.isFinite(reorderLevel) || reorderLevel < 0 ||
        !Number.isInteger(costPerUnit) || costPerUnit < 0) {
        $("material-message").textContent = "Please check all entered values.";
        return;
    }

    const existing = await getAll("rawMaterials");

    if (existing.some(item => item.name.toLowerCase() === name.toLowerCase())) {
        $("material-message").textContent = "This material is already registered.";
        return;
    }

    const databaseTransaction = db.transaction(
        ["rawMaterials", "rawMaterialMovements"], "readwrite"
    );

    const materialStore = databaseTransaction.objectStore("rawMaterials");
    const movementStore = databaseTransaction.objectStore("rawMaterialMovements");

    const request = materialStore.add({
        name,
        unit,
        quantity,
        reorderLevel,
        costPerUnit,
        createdAt: Date.now(),
        updatedAt: Date.now()
    });

    request.onsuccess = () => {
        if (quantity > 0) {
            movementStore.add({
                materialId: request.result,
                materialName: name,
                movement: "Opening stock",
                quantity,
                note: "Initial inventory registration",
                date: new Date().toISOString().slice(0, 10),
                createdAt: Date.now()
            });
        }
    };

    try {
        await transactionDone(databaseTransaction);
        $("material-form").reset();
        $("material-quantity").value = 0;
        $("material-reorder").value = 1;
        $("material-cost").value = 0;
        $("material-dialog").close();
        await refreshInventory();
    } catch (error) {
        console.error(error);
        $("material-message").textContent = "Could not save material.";
    }
}

async function openRestock(materialId) {
    const materials = await getAll("rawMaterials");
    const material = materials.find(item => item.id === materialId);

    if (!material) return;

    $("restock-material-id").value = material.id;
    $("restock-material-name").value = `${material.name} (${material.unit})`;
    $("restock-cost").value = material.costPerUnit;
    $("restock-quantity").value = "";
    $("restock-note").value = "";
    $("restock-message").textContent = "";

    $("restock-dialog").showModal();
}

async function saveRestock(event) {
    event.preventDefault();

    const materialId = Number($("restock-material-id").value);
    const quantity = Number($("restock-quantity").value);
    const costPerUnit = Number($("restock-cost").value);
    const note = $("restock-note").value.trim();

    if (!Number.isFinite(quantity) || quantity <= 0 ||
        !Number.isInteger(costPerUnit) || costPerUnit < 0) {
        $("restock-message").textContent = "Enter a valid quantity and unit cost.";
        return;
    }

    const databaseTransaction = db.transaction(
        ["rawMaterials", "rawMaterialMovements"], "readwrite"
    );

    const materialStore = databaseTransaction.objectStore("rawMaterials");
    const movementStore = databaseTransaction.objectStore("rawMaterialMovements");

    const request = materialStore.get(materialId);

    request.onsuccess = () => {
        const material = request.result;

        if (!material) {
            databaseTransaction.abort();
            return;
        }

        material.quantity = Number((material.quantity + quantity).toFixed(3));
        material.costPerUnit = costPerUnit;
        material.updatedAt = Date.now();

        materialStore.put(material);

        movementStore.add({
            materialId,
            materialName: material.name,
            movement: "Stock received",
            quantity,
            note,
            date: new Date().toISOString().slice(0, 10),
            createdAt: Date.now()
        });
    };

    try {
        await transactionDone(databaseTransaction);
        $("restock-form").reset();
        $("restock-dialog").close();
        await refreshInventory();
    } catch (error) {
        console.error(error);
        $("restock-message").textContent = "Could not record the restock.";
    }
}

function renderMaterials(materials) {
    const table = $("materials-table");

    if (!materials.length) {
        table.innerHTML = `
            <tr><td colspan="7">
                No raw materials registered. Select "Add material" to begin.
            </td></tr>`;
        return;
    }

    table.innerHTML = materials.map(material => {
        const low = material.quantity <= material.reorderLevel;
        const value = material.quantity * material.costPerUnit;

        return `
            <tr>
                <td><strong>${escapeHTML(material.name)}</strong></td>
                <td>${material.quantity} ${escapeHTML(material.unit)}</td>
                <td>${material.reorderLevel} ${escapeHTML(material.unit)}</td>
                <td>${money(material.costPerUnit)}</td>
                <td>${money(value)}</td>
                <td>
                    <span class="stock-badge ${low ? "low" : ""}">
                        ${low ? "Restock needed" : "Available"}
                    </span>
                </td>
                <td>
                    <button class="material-action" data-restock="${material.id}">
                        Restock
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

function renderMovements(movements) {
    const table = $("movements-table");

    const recent = [...movements]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 15);

    if (!recent.length) {
        table.innerHTML = '<tr><td colspan="5">No stock movements yet.</td></tr>';
        return;
    }

    table.innerHTML = recent.map(item => `
        <tr>
            <td>${escapeHTML(item.date)}</td>
            <td>${escapeHTML(item.materialName)}</td>
            <td>${escapeHTML(item.movement)}</td>
            <td>${item.quantity}</td>
            <td>${escapeHTML(item.note || "—")}</td>
        </tr>
    `).join("");
}

async function refreshInventory() {
    const materials = await getAll("rawMaterials");
    const movements = await getAll("rawMaterialMovements");

    const lowStock = materials.filter(
        item => item.quantity <= item.reorderLevel
    );

    const stockValue = materials.reduce(
        (sum, item) => sum + item.quantity * item.costPerUnit, 0
    );

    $("material-count").textContent = materials.length;
    $("low-stock-count").textContent = lowStock.length;
    $("stock-value").textContent = money(stockValue);
    $("movement-count").textContent = movements.length;

    renderMaterials(materials);
    renderMovements(movements);
}

function setupEvents() {
    $("add-material-button").addEventListener("click", () => {
        $("material-message").textContent = "";
        $("material-dialog").showModal();
    });

    $("refresh-button").addEventListener("click", refreshInventory);
    $("material-form").addEventListener("submit", saveMaterial);
    $("restock-form").addEventListener("submit", saveRestock);

    $("materials-table").addEventListener("click", event => {
        const button = event.target.closest("[data-restock]");
        if (button) openRestock(Number(button.dataset.restock));
    });

    document.querySelectorAll("[data-close]").forEach(button => {
        button.addEventListener("click", () => {
            $(button.dataset.close).close();
        });
    });

    $("year").textContent = new Date().getFullYear();
}

async function startApp() {
    setupEvents();

    try {
        db = await openDatabase();
        await refreshInventory();

        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("./service-worker.js")
                .catch(error => console.error("Service worker error:", error));
        }
    } catch (error) {
        console.error("Inventory startup failed:", error);
        alert("Could not open the inventory database. Please reload the page.");
    }
}

document.addEventListener("DOMContentLoaded", startApp);
