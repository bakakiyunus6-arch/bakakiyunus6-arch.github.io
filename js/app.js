"use strict";

const DB_NAME = "BakSnacksDatabase";
const DB_VERSION = 6;
let db;

const $ = (id) => document.getElementById(id);

const money = (amount) =>
    new Intl.NumberFormat("en-UG", {
        style: "currency",
        currency: "UGX",
        maximumFractionDigits: 0
    }).format(amount || 0);

const today = () => new Date().toISOString().slice(0, 10);

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

function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getAll(storeName) {
    const transaction = db.transaction(storeName, "readonly");
    return requestResult(transaction.objectStore(storeName).getAll());
}

async function addRecord(storeName, record) {
    const transaction = db.transaction(storeName, "readwrite");
    const request = transaction.objectStore(storeName).add(record);
    return requestResult(request);
}

async function updateRecord(storeName, record) {
    const transaction = db.transaction(storeName, "readwrite");
    const request = transaction.objectStore(storeName).put(record);
    return requestResult(request);
}

async function initialiseProducts() {
    const products = await getAll("products");

    if (products.length === 0) {
        await addRecord("products", {
            name: "Small popcorn pack",
            price: 500,
            quantity: 0,
            reorderLevel: 10
        });

        await addRecord("products", {
            name: "Large popcorn pack",
            price: 1000,
            quantity: 0,
            reorderLevel: 10
        });
    }
}

async function refreshDashboard() {
    const products = await getAll("products");
    const transactions = await getAll("transactions");

    const todaysTransactions = transactions.filter(
        item => item.date === today()
    );

    const sales = todaysTransactions
        .filter(item => item.type === "Sale")
        .reduce((sum, item) => sum + item.amount, 0);

    const expenses = todaysTransactions
        .filter(item => item.type === "Expense")
        .reduce((sum, item) => sum + item.amount, 0);

    const stockCount = products.reduce(
        (sum, product) => sum + product.quantity, 0
    );

    $("today-sales").textContent = money(sales);
    $("today-expenses").textContent = money(expenses);
    $("today-balance").textContent = money(sales - expenses);
    $("stock-count").textContent = stockCount.toLocaleString("en-UG");

    renderProducts(products);
    renderTransactions(transactions);
    renderSalesReport(transactions);
    populateProductSelects(products);
}


function renderSalesReport(transactions) {
    const from = $("report-from").value;
    const to = $("report-to").value;

    if (from && to && from > to) {
        $("report-error").textContent =
            "The start date cannot be later than the end date.";
        $("report-revenue").textContent = money(0);
        $("report-count").textContent = "0";
        $("report-units").textContent = "0";
        $("report-payments").innerHTML =
            '<tr><td colspan="3">Correct the date range.</td></tr>';
        $("report-products").innerHTML =
            '<tr><td colspan="3">Correct the date range.</td></tr>';
        $("report-daily").innerHTML =
            '<tr><td colspan="4">Correct the date range.</td></tr>';
        return;
    }

    $("report-error").textContent = "";

    const sales = transactions.filter(item =>
        item.type === "Sale" &&
        (!from || item.date >= from) &&
        (!to || item.date <= to)
    );

    const payments = new Map();
    const products = new Map();
    const days = new Map();

    let revenue = 0;
    let unitsSold = 0;

    for (const sale of sales) {
        const amount = Number(sale.amount) || 0;
        const match = String(sale.description || "").match(/ × (\d+)$/);
        const quantity = Number(sale.quantity) ||
            (match ? Number(match[1]) : 1);

        const productName = match
            ? String(sale.description).slice(0, match.index)
            : String(sale.description || "Unspecified product");

        const method = sale.payment || "Unspecified";
        const date = sale.date || "Unknown date";

        revenue += amount;
        unitsSold += quantity;

        const payment = payments.get(method) || { count: 0, amount: 0 };
        payment.count++;
        payment.amount += amount;
        payments.set(method, payment);

        const product = products.get(productName) || { units: 0, amount: 0 };
        product.units += quantity;
        product.amount += amount;
        products.set(productName, product);

        const day = days.get(date) || { count: 0, units: 0, amount: 0 };
        day.count++;
        day.units += quantity;
        day.amount += amount;
        days.set(date, day);
    }

    $("report-revenue").textContent = money(revenue);
    $("report-count").textContent = sales.length.toLocaleString("en-UG");
    $("report-units").textContent = unitsSold.toLocaleString("en-UG");

    if (!sales.length) {
        $("report-payments").innerHTML =
            '<tr><td colspan="3">No sales in this period.</td></tr>';
        $("report-products").innerHTML =
            '<tr><td colspan="3">No sales in this period.</td></tr>';
        $("report-daily").innerHTML =
            '<tr><td colspan="4">No sales in this period.</td></tr>';
        return;
    }

    $("report-payments").innerHTML = [...payments.entries()]
        .sort((a, b) => b[1].amount - a[1].amount)
        .map(([name, item]) => `
            <tr>
                <td>${escapeHTML(name)}</td>
                <td>${item.count}</td>
                <td>${money(item.amount)}</td>
            </tr>
        `).join("");

    $("report-products").innerHTML = [...products.entries()]
        .sort((a, b) => b[1].units - a[1].units)
        .map(([name, item]) => `
            <tr>
                <td>${escapeHTML(name)}</td>
                <td>${item.units.toLocaleString("en-UG")}</td>
                <td>${money(item.amount)}</td>
            </tr>
        `).join("");

    $("report-daily").innerHTML = [...days.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([date, item]) => `
            <tr>
                <td>${escapeHTML(date)}</td>
                <td>${item.count}</td>
                <td>${item.units.toLocaleString("en-UG")}</td>
                <td>${money(item.amount)}</td>
            </tr>
        `).join("");
}

function renderProducts(products) {
    const table = $("products-table");

    if (!products.length) {
        table.innerHTML = '<tr><td colspan="4">No products found.</td></tr>';
        return;
    }

    table.innerHTML = products.map(product => {
        const low = product.quantity <= product.reorderLevel;

        return `
            <tr>
                <td>${escapeHTML(product.name)}</td>
                <td>${money(product.price)}</td>
                <td>${product.quantity}</td>
                <td><span class="stock-badge ${low ? "low" : ""}">
                    ${low ? "Low stock" : "Available"}
                </span></td>
            </tr>
        `;
    }).join("");
}

function renderTransactions(transactions) {
    const table = $("transactions-table");

    const recent = [...transactions]
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 10);

    if (!recent.length) {
        table.innerHTML = '<tr><td colspan="6">No transactions yet.</td></tr>';
        return;
    }

    table.innerHTML = recent.map(item => `
        <tr>
            <td>${escapeHTML(item.date || "")}</td>
            <td>${escapeHTML(item.type || "")}</td>
            <td>${escapeHTML(item.description || "")}</td>
            <td>${escapeHTML(item.payment || item.paymentMethod || "—")}</td>
            <td class="${item.type === "Sale" ? "amount-positive" : "amount-negative"}">
                ${item.type === "Sale" ? "+" : "−"}${money(Number(item.amount) || 0)}
            </td>
            <td>
                ${item.type === "Sale" && item.id !== undefined
                    ? `<a class="receipt-link" href="receipt.html?id=${encodeURIComponent(item.id)}">Receipt</a>`
                    : "—"}
            </td>
        </tr>
    `).join("");
}

function populateProductSelects(products) {
    const options = products.map(product => `
        <option value="${product.id}">
            ${escapeHTML(product.name)} — ${money(product.price)}
        </option>
    `).join("");

    $("sale-product").innerHTML = options;
    $("stock-product").innerHTML = options;

    updateSalePrice();
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}

async function updateSalePrice() {
    const products = await getAll("products");
    const selected = products.find(
        product => product.id === Number($("sale-product").value)
    );

    if (selected) {
        $("sale-price").value = selected.price;
        updateSaleTotal();
    }
}

function updateSaleTotal() {
    const quantity = Number($("sale-quantity").value) || 0;
    const price = Number($("sale-price").value) || 0;
    $("sale-total").textContent = money(quantity * price);
}

function openDialog(id) {
    $(id).showModal();
}

function closeDialog(id) {
    $(id).close();
}

async function recordSale(event) {
    event.preventDefault();

    const productId = Number($("sale-product").value);
    const quantity = Number($("sale-quantity").value);
    const price = Number($("sale-price").value);
    const payment = $("sale-payment").value;
    const reference = $("sale-reference").value.trim();

    const products = await getAll("products");
    const product = products.find(item => item.id === productId);

    if (!product || !Number.isInteger(quantity) || quantity < 1 ||
        !Number.isInteger(price) || price < 1) {
        $("sale-message").textContent = "Please enter valid sale details.";
        return;
    }

    if (product.quantity < quantity) {
        $("sale-message").textContent =
            `Insufficient stock. Available quantity: ${product.quantity}.`;
        return;
    }

    const amount = quantity * price;
    const createdAt = Date.now();
    const saleDescription = `${product.name} × ${quantity}`;

    const saleDate = today();
    const receiptNumber = "BSC-" + saleDate.replace(/-/g, "") + "-" +
        createdAt + "-" + Math.random().toString(16).slice(2, 6).toUpperCase();

    const sale = {
        type: "Sale",
        receiptNumber,
        productName: product.name,
        description: saleDescription,
        quantity,
        unitPrice: price,
        amount,
        payment,
        reference,
        date: saleDate,
        createdAt
    };

    const cashbookEntry = {
        id: "sale-" + createdAt + "-" +
            Math.random().toString(16).slice(2),
        type: "income",
        category: "Sales",
        description: saleDescription,
        amount,
        paymentMethod: payment,
        reference,
        date: sale.date,
        createdAt
    };

    try {
        const transaction = db.transaction(
            ["products", "transactions", "cashbookEntries"],
            "readwrite"
        );

        const productStore = transaction.objectStore("products");
        const transactionStore = transaction.objectStore("transactions");
        const cashbookStore = transaction.objectStore("cashbookEntries");

        product.quantity -= quantity;

        productStore.put(product);
        transactionStore.add(sale);
        cashbookStore.add(cashbookEntry);

        transaction.oncomplete = async () => {
            $("sale-form").reset();
            $("sale-message").textContent = "";
            closeDialog("sale-dialog");
            await refreshDashboard();
        };

        transaction.onerror = () => {
            console.error("Sale transaction failed:", transaction.error);
            $("sale-message").textContent =
                "Could not save the sale. No changes were completed.";
        };

        transaction.onabort = () => {
            $("sale-message").textContent =
                "Sale was cancelled because the transaction could not be completed.";
        };
    } catch (error) {
        console.error(error);
        $("sale-message").textContent =
            "An error occurred while saving the sale.";
    }
}

async function recordExpense(event) {
    event.preventDefault();

    const description = $("expense-description").value.trim();
    const amount = Number($("expense-amount").value);
    const payment = $("expense-payment").value;

    if (!description || !Number.isInteger(amount) || amount < 1) {
        $("expense-message").textContent = "Enter a description and valid amount.";
        return;
    }

    const createdAt = Date.now();
    const date = today();

    const expenseTransaction = {
        type: "Expense",
        description,
        amount,
        payment,
        date,
        createdAt
    };

    const cashbookEntry = {
        id: "expense-" + createdAt + "-" + Math.random().toString(16).slice(2),
        type: "expense",
        category: "Operating expense",
        description,
        amount,
        paymentMethod: payment,
        reference: "",
        date,
        createdAt
    };

    try {
        const transaction = db.transaction(
            ["transactions", "cashbookEntries"],
            "readwrite"
        );

        transaction.objectStore("transactions").add(expenseTransaction);
        transaction.objectStore("cashbookEntries").add(cashbookEntry);

        transaction.oncomplete = async () => {
            $("expense-form").reset();
            closeDialog("expense-dialog");
            await refreshDashboard();
        };

        transaction.onerror = () => {
            console.error("Expense transaction failed:", transaction.error);
            $("expense-message").textContent =
                "Could not save the expense. No partial entry was recorded.";
        };

        transaction.onabort = () => {
            console.error("Expense transaction aborted:", transaction.error);
            $("expense-message").textContent =
                "Expense saving was cancelled or failed. Please try again.";
        };
    } catch (error) {
        console.error(error);
        $("expense-message").textContent = "Could not save the expense.";
    }
}

async function addStock(event) {
    event.preventDefault();

    const productId = Number($("stock-product").value);
    const quantity = Number($("stock-quantity").value);

    if (!Number.isInteger(quantity) || quantity < 1) {
        $("stock-message").textContent = "Enter a valid quantity.";
        return;
    }

    const products = await getAll("products");
    const product = products.find(item => item.id === productId);

    if (!product) {
        $("stock-message").textContent = "Product not found.";
        return;
    }

    product.quantity += quantity;

    try {
        await updateRecord("products", product);
        $("stock-form").reset();
        closeDialog("stock-dialog");
        await refreshDashboard();
    } catch (error) {
        console.error(error);
        $("stock-message").textContent = "Could not update stock.";
    }
}

function showConnectionStatus() {
    $("connection-status").textContent =
        navigator.onLine ? "Online" : "Offline";
}

function setupEvents() {
    $("sale-button").addEventListener("click", () => openDialog("sale-dialog"));
    $("quick-sale").addEventListener("click", () => openDialog("sale-dialog"));
    $("nav-sale").addEventListener("click", () => openDialog("sale-dialog"));

    $("quick-expense").addEventListener("click", () => openDialog("expense-dialog"));

    $("quick-stock").addEventListener("click", () => openDialog("stock-dialog"));
    $("stock-button").addEventListener("click", () => openDialog("stock-dialog"));
    $("nav-stock").addEventListener("click", () => openDialog("stock-dialog"));

    const showHistory = () => {
        $("history-section").scrollIntoView({ behavior: "smooth" });
    };

    $("quick-history").addEventListener("click", showHistory);
    $("nav-history").addEventListener("click", showHistory);

    document.querySelectorAll("[data-close]").forEach(button => {
        button.addEventListener("click", () => closeDialog(button.dataset.close));
    });

    $("report-from").addEventListener("change", async () => {
        renderSalesReport(await getAll("transactions"));
    });

    $("report-to").addEventListener("change", async () => {
        renderSalesReport(await getAll("transactions"));
    });

    $("report-today").addEventListener("click", async () => {
        $("report-from").value = today();
        $("report-to").value = today();
        renderSalesReport(await getAll("transactions"));
    });

    $("sale-form").addEventListener("submit", recordSale);
    $("expense-form").addEventListener("submit", recordExpense);
    $("stock-form").addEventListener("submit", addStock);

    $("sale-product").addEventListener("change", updateSalePrice);
    $("sale-quantity").addEventListener("input", updateSaleTotal);
    $("sale-price").addEventListener("input", updateSaleTotal);

    window.addEventListener("online", showConnectionStatus);
    window.addEventListener("offline", showConnectionStatus);
}

async function startApp() {
    $("today-date").textContent = new Date().toLocaleDateString("en-UG", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    });

    $("year").textContent = new Date().getFullYear();
    showConnectionStatus();
    setupEvents();

    try {
        db = await openDatabase();
        await initialiseProducts();
        await refreshDashboard();

        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("./service-worker.js")
                .catch(error => console.error("Service worker error:", error));
        }
    } catch (error) {
        console.error("Application startup failed:", error);
        alert("The local database could not be opened. Please reload the app.");
    }
}

document.addEventListener("DOMContentLoaded", startApp);
