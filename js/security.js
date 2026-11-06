"use strict";

(() => {
    const SETTINGS_KEY = "bsc_business_settings";
    const PIN_HASH_KEY = "bsc_owner_pin_hash";
    const PIN_SALT_KEY = "bsc_owner_pin_salt";
    const SESSION_KEY = "bsc_owner_unlocked";

    function getSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
            return {
                businessName: saved.businessName || "BAK SNACKS CENTER",
                phone: saved.phone || "",
                address: saved.address || "",
                currency: "UGX"
            };
        } catch {
            return {
                businessName: "BAK SNACKS CENTER",
                phone: "",
                address: "",
                currency: "UGX"
            };
        }
    }

    function saveSettings(settings) {
        const clean = {
            businessName: String(settings.businessName || "").trim(),
            phone: String(settings.phone || "").trim(),
            address: String(settings.address || "").trim(),
            currency: "UGX"
        };

        if (!clean.businessName) {
            throw new Error("Enter the business name.");
        }

        localStorage.setItem(SETTINGS_KEY, JSON.stringify(clean));
        return clean;
    }

    function hasPin() {
        return Boolean(
            localStorage.getItem(PIN_HASH_KEY) &&
            localStorage.getItem(PIN_SALT_KEY)
        );
    }

    function toHex(buffer) {
        return Array.from(new Uint8Array(buffer))
            .map(byte => byte.toString(16).padStart(2, "0"))
            .join("");
    }

    async function hashPin(pin, salt) {
        if (!crypto.subtle) {
            throw new Error("Secure PIN protection requires a secure browser connection. Use localhost or an HTTPS address.");
        }

        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            "raw",
            encoder.encode(pin),
            "PBKDF2",
            false,
            ["deriveBits"]
        );

        const result = await crypto.subtle.deriveBits(
            {
                name: "PBKDF2",
                salt: encoder.encode(salt),
                iterations: 150000,
                hash: "SHA-256"
            },
            key,
            256
        );

        return toHex(result);
    }

    async function setPin(pin) {
        if (!/^\d{4,12}$/.test(pin)) {
            throw new Error("Your PIN must contain 4 to 12 digits.");
        }

        const saltBytes = crypto.getRandomValues(new Uint8Array(16));
        const salt = toHex(saltBytes);
        const hash = await hashPin(pin, salt);

        localStorage.setItem(PIN_SALT_KEY, salt);
        localStorage.setItem(PIN_HASH_KEY, hash);
        sessionStorage.setItem(SESSION_KEY, "yes");
    }

    async function verifyPin(pin) {
        const salt = localStorage.getItem(PIN_SALT_KEY);
        const savedHash = localStorage.getItem(PIN_HASH_KEY);

        if (!salt || !savedHash) return false;

        const candidate = await hashPin(pin, salt);
        return candidate === savedHash;
    }

    function lock() {
        sessionStorage.removeItem(SESSION_KEY);
        window.location.reload();
    }

    function addStyles() {
        if (document.getElementById("bsc-security-styles")) return;

        const style = document.createElement("style");
        style.id = "bsc-security-styles";
        style.textContent = `
            .bsc-settings-shortcut {
                position: fixed;
                z-index: 900;
                right: 14px;
                bottom: 82px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-height: 42px;
                padding: 0 14px;
                border: 1px solid #d9e2ed;
                border-radius: 24px;
                background: #10233f;
                color: white;
                font: 700 13px Arial, sans-serif;
                text-decoration: none;
                box-shadow: 0 4px 15px rgba(0,0,0,.16);
            }
            .bsc-lock-screen {
                position: fixed;
                inset: 0;
                z-index: 99999;
                display: grid;
                place-items: center;
                padding: 20px;
                background: #edf1f6;
                font-family: Arial, sans-serif;
            }
            .bsc-lock-card {
                width: min(100%, 390px);
                padding: 28px;
                border-radius: 18px;
                background: white;
                box-shadow: 0 12px 35px rgba(16,35,63,.13);
                text-align: center;
            }
            .bsc-lock-card h2 {
                margin: 0 0 8px;
                color: #10233f;
            }
            .bsc-lock-card p {
                color: #687386;
                font-size: 14px;
                line-height: 1.5;
            }
            .bsc-lock-card input {
                width: 100%;
                min-height: 48px;
                margin: 12px 0;
                padding: 10px;
                border: 1px solid #cbd5e1;
                border-radius: 9px;
                font-size: 20px;
                text-align: center;
                letter-spacing: 5px;
            }
            .bsc-lock-card button {
                width: 100%;
                min-height: 46px;
                border: 0;
                border-radius: 9px;
                background: #10233f;
                color: white;
                font-size: 15px;
                font-weight: 700;
            }
            .bsc-lock-message {
                min-height: 20px;
                color: #b42318 !important;
            }
            @media print {
                .bsc-settings-shortcut,
                .bsc-lock-screen {
                    display: none !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function addSettingsShortcut() {
        const currentPage = location.pathname.split("/").pop();

        if (currentPage === "settings.html") return;
        if (document.querySelector(".bsc-settings-shortcut")) return;

        const link = document.createElement("a");
        link.className = "bsc-settings-shortcut";
        link.href = "settings.html";
        link.textContent = "⚙ Settings";
        link.setAttribute("aria-label", "Open business settings");
        document.body.appendChild(link);
    }

    function showLockScreen() {
        if (!hasPin() || sessionStorage.getItem(SESSION_KEY) === "yes") {
            return;
        }

        const overlay = document.createElement("div");
        overlay.className = "bsc-lock-screen";
        overlay.innerHTML = `
            <form class="bsc-lock-card" id="bsc-unlock-form">
                <div style="font-size:38px;margin-bottom:12px">🔒</div>
                <h2>Business locked</h2>
                <p>Enter your owner PIN to access BAK SNACKS CENTER.</p>
                <input
                    id="bsc-unlock-pin"
                    type="password"
                    inputmode="numeric"
                    pattern="[0-9]*"
                    maxlength="12"
                    autocomplete="current-password"
                    placeholder="Enter PIN"
                    required
                >
                <button type="submit">Unlock business</button>
                <p class="bsc-lock-message" id="bsc-lock-message" role="alert"></p>
            </form>
        `;

        document.body.appendChild(overlay);
        document.getElementById("bsc-unlock-pin").focus();

        document.getElementById("bsc-unlock-form").addEventListener("submit", async event => {
            event.preventDefault();

            const input = document.getElementById("bsc-unlock-pin");
            const message = document.getElementById("bsc-lock-message");
            const button = event.currentTarget.querySelector("button");

            button.disabled = true;
            button.textContent = "Checking...";

            try {
                const valid = await verifyPin(input.value);

                if (valid) {
                    sessionStorage.setItem(SESSION_KEY, "yes");
                    overlay.remove();
                    return;
                }

                message.textContent = "Incorrect PIN. Please try again.";
                input.value = "";
                input.focus();
            } catch (error) {
                message.textContent = error.message || "Could not verify PIN.";
            } finally {
                button.disabled = false;
                button.textContent = "Unlock business";
            }
        });
    }

    window.BSCSettings = {
        get: getSettings,
        save: saveSettings,
        hasPin,
        setPin,
        verifyPin,
        lock
    };

    addStyles();
    addSettingsShortcut();
    showLockScreen();
})();
