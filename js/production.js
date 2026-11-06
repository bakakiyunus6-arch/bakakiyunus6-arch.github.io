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

const dateToday = () => {
    const date = new Date();
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000)
        .toISOString().slice(0, 10);
};

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

function getAll(storeName) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(
            transaction.error || new Error("Transaction aborted")
        );
    });
}

async function loadFormOptions() {
    const products = await getAll("products");

    $("production-product").innerHTML = products.length
        ? products.map(product => `
            <option value="${product.id}">
                ${escapeHTML(product.name)}
            </option>
        `).join("")
        : '<option value="">No finished products registered</option>';

    await addConsumptionRow();
}

async function addConsumptionRow() {
    const materials = await getAll("rawMaterials");
    const container = $("consumption-rows");
    const row = document.createElement("div");

    row.className = "consumption-row";

    const options = materials.map(material => `
        <option value="${material.id}">
            ${escapeHTML(material.name)} (${escapeHTML(material.unit)})
        </option>
    `).join("");

    row.innerHTML = `
        <div>
            <label>Raw material</label>
            <select class="consumption-material" ${materials.length ? "required" : "disabled"}>
                ${options || '<option value="">No materials registered</option>'}
            </select>
        </div>
        <div>
            <label>Quantity used</label>
            <input class="consumption-quantity" type="number"
                min="0.001" step="0.001" placeholder="0" required
                ${materials.length ? "" : "disabled"}>
        </div>
        <button type="button" class="remove-row" aria-label="Remove material row">×</button>
    `;

    row.querySelector(".remove-row").addEventListener("click", () => {
        row.remove();
        updateBatchCost();
    });

    row.querySelector(".consumption-material").addEventListener(
        "change", updateBatchCost
    );
    row.querySelector(".consumption-quantity").addEventListener(
        "input", updateBatchCost
    );

    container.appendChild(row);
    updateBatchCost();
}

async function updateBatchCost() {
    const materials = await getAll("rawMaterials");
    const rows = [...document.querySelectorAll(".consumption-row")];

    let total = 0;

    for (const row of rows) {
        const id = Number(row.querySelector(".consumption-material").value);
        const quantity = Number(row.querySelector(".consumption-quantity").value);
        const material = materials.find(item => item.id === id);

        if (material && Number.isFinite(quantity) && quantity > 0) {
            total += quantity * material.costPerUnit;
        }
    }

    $("batch-cost").textContent = money(total);
}

function readConsumptionRows() {
    const rows = [...document.querySelectorAll(".consumption-row")];

    return rows.map(row => ({
        materialId: Number(row.querySelector(".consumption-material").value),
        quantity: Number(row.querySelector(".consumption-quantity").value)
    })).filter(item => item.materialId && item.quantity > 0);
}

async function completeProduction(event) {
    event.preventDefault();

    const productId = Number($("production-product").value);
    const quantityProduced = Number($("production-quantity").value);
    const notes = $("production-notes").value.trim();
    const consumption = readConsumptionRows();

    if (!Number.isInteger(quantityProduced) || quantityProduced < 1) {
        $("production-message").textContent =
            "Enter a valid whole number of finished units.";
        return;
    }

    if (!consumption.length) {
        $("production-message").textContent =
            "Add at least one raw material and its quantity consumed.";
        return;
    }

    const seen = new Set();

    for (const item of consumption) {
        if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
            $("production-message").textContent =
                "Every material must have a valid quantity greater than zero.";
            return;
        }

        if (seen.has(item.materialId)) {
            $("production-message").textContent =
                "A material appears more than once. Combine its quantities into one row.";
            return;
        }

        seen.add(item.materialId);
    }

    const transaction = db.transaction(
        ["products", "rawMaterials", "rawMaterialMovements", "productionBatches"],
        "readwrite"
    );

    const productsStore = transaction.objectStore("products");
    const materialsStore = transaction.objectStore("rawMaterials");
    const movementsStore = transaction.objectStore("rawMaterialMovements");
    const batchesStore = transaction.objectStore("productionBatches");

    const productRequest = productsStore.get(productId);

    productRequest.onsuccess = () => {
        const product = productRequest.result;

        if (!product) {
            transaction.abort();
            return;
        }

        const materialRequests = consumption.map(item => ({
            item,
            request: materialsStore.get(item.materialId)
        }));

        let completed = 0;
        const materialRecords = [];

        function finishIfReady() {
            completed++;

            if (completed !== materialRequests.length) return;

            let totalCost = 0;

            for (const record of materialRecords) {
                const { material, item } = record;

                if (!material || material.quantity + 0.0000001 < item.quantity) {
                    transaction.abort();
                    return;
                }

                totalCost += item.quantity * material.costPerUnit;
            }

            const now = Date.now();
            const date = dateToday();
            const batchMaterials = [];

            for (const record of materialRecords) {
                const { material, item } = record;

                material.quantity = Number(
                    (material.quantity - item.quantity).toFixed(3)
                );
                material.updatedAt = now;

                materialsStore.put(material);

                movementsStore.add({
                    materialId: material.id,
                    materialName: material.name,
                    movement: "Production consumption",
                    quantity: -item.quantity,
                    note: `Production of ${quantityProduced} ${product.name}`,
                    date,
                    createdAt: now
                });

                batchMaterials.push({
                    materialId: material.id,
                    name: material.name,
                    unit: material.unit,
                    quantity: item.quantity,
                    costPerUnit: material.costPerUnit,
                    totalCost: item.quantity * material.costPerUnit
                });
            }

            product.quantity = Number(product.quantity || 0) + quantityProduced;
            productsStore.put(product);

            batchesStore.add({
                batchNumber: `BSC-${now}`,
                date,
                createdAt: now,
                productId: product.id,
                productName: product.name,
                quantityProduced,
                materials: batchMaterials,
                materialCost: totalCost,
                notes
            });
        }

        for (const entry of materialRequests) {
            entry.request.onsuccess = () => {
                materialRecords.push({
                    item: entry.item,
                    material: entry.request.result
                });
                finishIfReady();
            };

            entry.request.onerror = () => transaction.abort();
        }
    };

    const done = transactionDone(transaction);

    try {
        await done;
        $("production-form").reset();
        $("consumption-rows").innerHTML = "";
        $("production-message").textContent = "";
        $("production-dialog").close();
        await refreshProduction();
    } catch (error) {
        console.error("Production transaction failed:", error);
        $("production-message").textContent =
            "Production was not saved. Check that all materials have sufficient stock.";
    }
}

async function refreshProduction() {
    const batches = await getAll("productionBatches");

    const totalUnits = batches.reduce(
        (sum, batch) => sum + batch.quantityProduced, 0
    );

    const today = dateToday();
    const todayUnits = batches
        .filter(batch => batch.date === today)
        .reduce((sum, batch) => sum + batch.quantityProduced, 0);

    const totalCost = batches.reduce(
        (sum, batch) => sum + batch.materialCost, 0
    );

    $("batch-count").textContent = batches.length;
    $("units-produced").textContent = totalUnits.toLocaleString("en-UG");
    $("today-produced").textContent = todayUnits.toLocaleString("en-UG");
    $("material-cost").textContent = money(totalCost);

    renderBatches(batches);
}

function renderBatches(batches) {
    const table = $("production-table");

    const recent = [...batches].sort(
        (a, b) => b.createdAt - a.createdAt
    ).slice(0, 50);

    if (!recent.length) {
        table.innerHTML =
            '<tr><td colspan="6">No production batches recorded yet.</td></tr>';
        return;
    }

    table.innerHTML = recent.map(batch => `
        <tr>
            <td>${escapeHTML(batch.batchNumber)}</td>
            <td>${escapeHTML(batch.date)}</td>
            <td>${escapeHTML(batch.productName)}</td>
            <td>${batch.quantityProduced}</td>
            <td>${money(batch.materialCost)}</td>
            <td>
                <button class="material-action" data-details="${batch.id}">
                    View details
                </button>
            </td>
        </tr>
    `).join("");
}

async function showBatchDetails(batchId) {
    const batches = await getAll("productionBatches");
    const batch = batches.find(item => item.id === batchId);

    if (!batch) return;

    $("batch-details-content").innerHTML = `
        <div class="batch-detail-line">
            <span>Batch number</span><strong>${escapeHTML(batch.batchNumber)}</strong>
        </div>
        <div class="batch-detail-line">
            <span>Date</span><strong>${escapeHTML(batch.date)}</strong>
        </div>
        <div class="batch-detail-line">
            <span>Finished product</span><strong>${escapeHTML(batch.productName)}</strong>
        </div>
        <div class="batch-detail-line">
            <span>Quantity produced</span><strong>${batch.quantityProduced}</strong>
        </div>
        <h3 style="margin-top:18px;font-size:14px">Materials consumed</h3>
        <ul class="batch-material-list">
            ${batch.materials.map(material => `
                <li>${escapeHTML(material.name)}:
                    ${material.quantity} ${escapeHTML(material.unit)}
                    — ${money(material.totalCost)}
                </li>
            `).join("")}
        </ul>
        <div class="batch-detail-line">
            <span>Total material cost</span><strong>${money(batch.materialCost)}</strong>
        </div>
        <p style="font-size:12px;margin-top:12px;color:var(--muted)">
            ${escapeHTML(batch.notes || "No additional notes.")}
        </p>
    `;

    $("batch-details-dialog").showModal();
}

function setupEvents() {
    $("new-batch-button").addEventListener("click", async () => {
        $("production-message").textContent = "";
        $("production-form").reset();
        $("consumption-rows").innerHTML = "";
        $("batch-date").textContent = dateToday();
        await loadFormOptions();

        const products = await getAll("products");
        const materials = await getAll("rawMaterials");

        if (!products.length || !materials.length) {
            alert("Register at least one finished product and one raw material before production.");
            return;
        }

        $("production-dialog").showModal();
    });

    $("add-consumption-row").addEventListener("click", addConsumptionRow);
    $("production-form").addEventListener("submit", completeProduction);
    $("refresh-button").addEventListener("click", refreshProduction);

    $("production-table").addEventListener("click", event => {
        const button = event.target.closest("[data-details]");
        if (button) showBatchDetails(Number(button.dataset.details));
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
        await refreshProduction();

        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("./service-worker.js")
                .catch(error => console.error("Service worker error:", error));
        }
    } catch (error) {
        console.error("Production startup failed:", error);
        alert("Could not open production records. Please reload the page.");
    }
}

document.addEventListener("DOMContentLoaded", startApp);
