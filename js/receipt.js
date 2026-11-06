"use strict";

const RECEIPT_DB_NAME = "BakSnacksDatabase";

const businessSettings = (() => {
    try {
        return JSON.parse(localStorage.getItem("bsc_business_settings") || "{}");
    } catch {
        return {};
    }
})();

const businessName = businessSettings.businessName || "BAK SNACKS CENTER";
const businessPhone = businessSettings.phone || "";
const businessAddress = businessSettings.address || "";


const receiptContent = document.getElementById("receipt-content");
const receiptActions = document.getElementById("receipt-actions");

let currentReceiptText = "";

function escapeReceiptHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}

function formatUGX(value) {
    return "UGX " + new Intl.NumberFormat("en-UG").format(
        Number(value) || 0
    );
}

function formatReceiptDate(value) {
    if (!value) return "Not recorded";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return date.toLocaleDateString("en-UG", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    });
}

function formatReceiptTime(value) {
    if (!value) return "Not recorded";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Not recorded";

    return date.toLocaleTimeString("en-UG", {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function getReceiptNumber(sale) {
    return sale.receiptNumber || `BSC-OLD-${sale.id}`;
}

function getProductName(sale) {
    if (sale.productName) return sale.productName;

    const description = String(sale.description || "Product");
    return description.replace(/\s*[×x]\s*\d+\s*$/, "").trim() || "Product";
}

function buildShareText(sale) {
    const product = getProductName(sale);
    const receiptNumber = getReceiptNumber(sale);

    return [
        businessName,
        "SALES RECEIPT",
        "Receipt: " + receiptNumber,
        "Date: " + formatReceiptDate(sale.date),
        "Time: " + formatReceiptTime(sale.createdAt),
        "------------------------------",
        "Product: " + product,
        "Quantity: " + (sale.quantity ?? "Not recorded"),
        "Unit price: " + formatUGX(sale.unitPrice),
        "TOTAL: " + formatUGX(sale.amount),
        "Payment: " + (sale.payment || "Not recorded"),
        "Reference: " + (sale.reference || "None"),
        "------------------------------",
        "Thank you for supporting our business."
    ].join("\n");
}

function renderReceipt(sale) {
    const productName = getProductName(sale);
    const receiptNumber = getReceiptNumber(sale);
    const quantity = Number(sale.quantity) || 0;
    const unitPrice = Number(sale.unitPrice) || 0;
    const amount = Number(sale.amount) || quantity * unitPrice;
    const payment = sale.payment || "Not recorded";
    const reference = sale.reference || "None";
    const isLegacy = !sale.receiptNumber;

    currentReceiptText = buildShareText(sale);

    receiptContent.innerHTML = `
        <header class="receipt-brand">
            <div class="receipt-logo">B</div>
            <h1>${escapeReceiptHTML(businessName)}</h1>
            ${businessAddress ? `<p>${escapeReceiptHTML(businessAddress)}</p>` : ""}
            ${businessPhone ? `<p>Tel: ${escapeReceiptHTML(businessPhone)}</p>` : ""}
            <p>Sales receipt</p>
        </header>

        <div class="receipt-heading">
            <h2>Sales receipt</h2>
            <p>${escapeReceiptHTML(receiptNumber)}</p>
        </div>

        <div class="receipt-meta">
            <div class="meta-item">
                <span>Date</span>
                <strong>${escapeReceiptHTML(formatReceiptDate(sale.date))}</strong>
            </div>
            <div class="meta-item">
                <span>Time</span>
                <strong>${escapeReceiptHTML(formatReceiptTime(sale.createdAt))}</strong>
            </div>
        </div>

        <table class="receipt-items">
            <thead>
                <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Unit price</th>
                    <th>Total</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>${escapeReceiptHTML(productName)}</td>
                    <td>${quantity || "—"}</td>
                    <td>${formatUGX(unitPrice)}</td>
                    <td>${formatUGX(amount)}</td>
                </tr>
            </tbody>
        </table>

        <div class="receipt-total">
            <span>AMOUNT PAID</span>
            <strong>${formatUGX(amount)}</strong>
        </div>

        <div class="receipt-payment">
            <p>
                <span>Payment method</span>
                <strong>${escapeReceiptHTML(payment)}</strong>
            </p>
            <p>
                <span>Payment reference</span>
                <strong>${escapeReceiptHTML(reference)}</strong>
            </p>
        </div>

        ${isLegacy ? `
            <div class="legacy-note">
                This is an older sale. Its receipt number was generated for display;
                the original sale record has not been changed.
            </div>
        ` : ""}

        <footer class="receipt-thanks">
            <strong>Thank you for your purchase!</strong>
            <p>We appreciate your support.</p>
        </footer>

        <p class="receipt-note">Please keep this receipt for your records.</p>
    `;

    receiptActions.hidden = false;
}

function showReceiptError(message) {
    receiptContent.innerHTML =
        `<p class="error-message">${escapeReceiptHTML(message)}</p>`;
    receiptActions.hidden = true;
}

function loadReceipt() {
    const params = new URLSearchParams(window.location.search);
    const rawId = params.get("id");
    const saleId = Number(rawId);

    if (!rawId || !Number.isSafeInteger(saleId) || saleId < 1) {
        showReceiptError("A valid sale receipt ID was not provided.");
        return;
    }

    const request = indexedDB.open(RECEIPT_DB_NAME);

    request.onerror = () => {
        showReceiptError("Could not open the business database. Return to the dashboard and try again.");
    };

    request.onsuccess = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains("transactions")) {
            database.close();
            showReceiptError("The sales records could not be found in the database.");
            return;
        }

        const transaction = database.transaction("transactions", "readonly");
        const store = transaction.objectStore("transactions");
        const getRequest = store.get(saleId);

        getRequest.onsuccess = () => {
            const sale = getRequest.result;
            database.close();

            if (!sale || sale.type !== "Sale") {
                showReceiptError("This sale receipt could not be found.");
                return;
            }

            renderReceipt(sale);
        };

        getRequest.onerror = () => {
            database.close();
            showReceiptError("Could not read this sale record.");
        };
    };
}

document.getElementById("print-button").addEventListener("click", () => {
    window.print();
});

document.getElementById("share-button").addEventListener("click", async () => {
    if (!currentReceiptText) return;

    if (navigator.share) {
        try {
            await navigator.share({
                title: businessName + " receipt",
                text: currentReceiptText
            });
        } catch (error) {
            if (error.name !== "AbortError") {
                alert("Sharing was not available. You can print the receipt instead.");
            }
        }
        return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(currentReceiptText);
            alert("Receipt copied. You can paste it into WhatsApp or another app.");
        } catch (error) {
            alert("Sharing is not supported by this browser. Please print the receipt.");
        }
        return;
    }

    alert("Sharing is not supported by this browser. Please print the receipt.");
});

loadReceipt();
