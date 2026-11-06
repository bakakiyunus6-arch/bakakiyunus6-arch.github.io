"use strict";

const DB_NAME = "BakSnacksDatabase";
const DB_VERSION = 6;

const STORE_NAMES = [
  "products",
  "transactions",
  "rawMaterials",
  "rawMaterialMovements",
  "productionBatches",
  "suppliers",
  "purchases",
  "supplierPayments",
  "cashbookEntries"
];

const $ = (id) => document.getElementById(id);

let db = null;
let selectedBackup = null;

function showStatus(message, type = "") {
  const status = $("status");
  status.textContent = message;
  status.className = "status" + (type ? " " + type : "");
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      const definitions = [
        ["products", true],
        ["transactions", true],
        ["rawMaterials", true],
        ["rawMaterialMovements", true],
        ["productionBatches", true],
        ["suppliers", false],
        ["purchases", false],
        ["supplierPayments", false],
        ["cashbookEntries", false]
      ];

      for (const [name, autoIncrement] of definitions) {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name, {
            keyPath: "id",
            autoIncrement
          });
        }
      }

      const transaction = request.transaction;
      const indexes = [
        ["transactions", "date", "date"],
        ["rawMaterialMovements", "materialId", "materialId"],
        ["rawMaterialMovements", "date", "date"],
        ["productionBatches", "date", "date"]
      ];

      for (const [storeName, indexName, keyPath] of indexes) {
        const store = transaction.objectStore(storeName);
        if (!store.indexNames.contains(indexName)) {
          store.createIndex(indexName, keyPath, { unique: false });
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(
      new Error("The database is busy. Close other BAK SNACKS CENTER tabs and try again.")
    );
  });
}

function getAllFromStore(storeName) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(
      transaction.error || new Error("Could not read " + storeName)
    );
  });
}

async function createBackup() {
  $("export-button").disabled = true;
  showStatus("Preparing your business backup…");

  try {
    const stores = {};

    for (const storeName of STORE_NAMES) {
      stores[storeName] = await getAllFromStore(storeName);
    }

    const backup = {
      format: "BAK_SNACKS_CENTER_BACKUP",
      backupVersion: 1,
      database: DB_NAME,
      exportedAt: new Date().toISOString(),
      stores
    };

    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().replace(/[:.]/g, "-");
    const link = document.createElement("a");

    link.href = url;
    link.download = "BAK-SNACKS-BACKUP-" + date + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    const total = STORE_NAMES.reduce(
      (sum, name) => sum + stores[name].length, 0
    );

    $("backup-info").textContent =
      "Backup created: " + new Date().toLocaleString() +
      " · " + total + " total records.";

    showStatus(
      "Your business backup has been prepared. Keep the downloaded JSON file somewhere safe.",
      "success"
    );
  } catch (error) {
    console.error(error);
    showStatus("Backup failed: " + error.message, "error");
  } finally {
    $("export-button").disabled = false;
  }
}

function validateBackup(data) {
  if (!data || typeof data !== "object" ||
      data.format !== "BAK_SNACKS_CENTER_BACKUP" ||
      data.backupVersion !== 1 ||
      data.database !== DB_NAME ||
      !data.stores || typeof data.stores !== "object") {
    throw new Error("This is not a supported BAK SNACKS CENTER backup file.");
  }

  for (const storeName of STORE_NAMES) {
    if (!Array.isArray(data.stores[storeName])) {
      throw new Error("The backup is missing valid records for: " + storeName);
    }

    const store = db.transaction(storeName, "readonly")
      .objectStore(storeName);

    if (typeof store.keyPath !== "string") {
      throw new Error("Unsupported key structure in " + storeName);
    }

    const seenKeys = new Set();

    for (const record of data.stores[storeName]) {
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw new Error("Invalid record found in " + storeName);
      }

      const key = record[store.keyPath];

      if (key === undefined || key === null ||
          !["string", "number"].includes(typeof key) ||
          (typeof key === "number" && !Number.isFinite(key))) {
        throw new Error("A record in " + storeName + " has an invalid ID.");
      }

      const uniqueKey = typeof key + ":" + String(key);

      if (seenKeys.has(uniqueKey)) {
        throw new Error("Duplicate record ID found in " + storeName);
      }

      seenKeys.add(uniqueKey);
    }
  }

  return true;
}

async function readBackupFile(file) {
  selectedBackup = null;
  $("restore-button").disabled = true;
  $("file-info").textContent = "Checking backup file…";
  showStatus("Validating the selected backup…");

  try {
    if (!file) {
      throw new Error("Please choose a backup file.");
    }

    if (file.size > 50 * 1024 * 1024) {
      throw new Error("The backup file is larger than the 50 MB limit.");
    }

    const text = await file.text();
    const data = JSON.parse(text);

    validateBackup(data);
    selectedBackup = data;

    const total = STORE_NAMES.reduce(
      (sum, name) => sum + data.stores[name].length, 0
    );

    const date = data.exportedAt
      ? new Date(data.exportedAt).toLocaleString()
      : "Unknown date";

    $("file-info").textContent =
      file.name + " · Backup date: " + date +
      " · " + total + " records";

    $("restore-button").disabled = false;
    showStatus(
      "Backup file is valid. You can now restore it.",
      "success"
    );
  } catch (error) {
    selectedBackup = null;
    $("file-info").textContent = "Backup file could not be verified.";
    showStatus("Cannot use this backup: " + error.message, "error");
  }
}

function restoreBackup() {
  if (!selectedBackup) {
    showStatus("Choose and verify a backup file first.", "error");
    return;
  }

  const confirmed = window.confirm(
    "IMPORTANT: This will replace ALL current business records in this browser " +
    "with the records in the selected backup.\n\n" +
    "Download a fresh backup of your current records before continuing.\n\n" +
    "Do you want to replace the current records?"
  );

  if (!confirmed) return;

  $("restore-button").disabled = true;
  $("export-button").disabled = true;
  showStatus("Restoring business records. Please do not close this page…");

  let transaction;

  try {
    transaction = db.transaction(STORE_NAMES, "readwrite");

    for (const storeName of STORE_NAMES) {
      const store = transaction.objectStore(storeName);
      store.clear();

      for (const record of selectedBackup.stores[storeName]) {
        store.put(record);
      }
    }

    transaction.oncomplete = () => {
      const total = STORE_NAMES.reduce(
        (sum, name) => sum + selectedBackup.stores[name].length, 0
      );

      showStatus(
        "Restore completed successfully. " + total +
        " records were restored. Return to the dashboard and reload the app.",
        "success"
      );

      $("file-info").textContent = "Restore completed.";
      $("backup-file").value = "";
      selectedBackup = null;
      $("export-button").disabled = false;
    };

    transaction.onerror = () => {
      showStatus(
        "Restore failed. The database transaction was rolled back where possible. " +
        (transaction.error?.message || ""),
        "error"
      );
      $("restore-button").disabled = false;
      $("export-button").disabled = false;
    };

    transaction.onabort = () => {
      showStatus(
        "Restore was cancelled or failed. " +
        (transaction.error?.message || ""),
        "error"
      );
      $("restore-button").disabled = false;
      $("export-button").disabled = false;
    };
  } catch (error) {
    console.error(error);
    showStatus("Restore could not start: " + error.message, "error");
    $("restore-button").disabled = false;
    $("export-button").disabled = false;
  }
}

async function startBackupPage() {
  try {
    db = await openDatabase();
    $("export-button").disabled = false;

    let total = 0;

    for (const storeName of STORE_NAMES) {
      total += await getAllFromStore(storeName).then(records => records.length);
    }

    $("backup-info").textContent =
      total + " business records currently stored on this device.";

    showStatus("Backup tools are ready.", "success");
  } catch (error) {
    console.error(error);
    showStatus("Could not open the business database: " + error.message, "error");
  }
}

$("export-button").addEventListener("click", createBackup);
$("backup-file").addEventListener("change", (event) => {
  readBackupFile(event.target.files[0]);
});
$("restore-button").addEventListener("click", restoreBackup);

startBackupPage();
