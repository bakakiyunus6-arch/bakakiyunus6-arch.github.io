"use strict";

document.addEventListener("DOMContentLoaded", () => {
    const businessForm = document.getElementById("business-form");
    const pinForm = document.getElementById("pin-form");
    const businessMessage = document.getElementById("business-message");
    const pinMessage = document.getElementById("pin-message");
    const pinStatus = document.getElementById("pin-status");

    const settings = window.BSCSettings.get();

    document.getElementById("business-name").value = settings.businessName;
    document.getElementById("business-phone").value = settings.phone;
    document.getElementById("business-address").value = settings.address;

    function refreshPinStatus() {
        pinStatus.textContent = window.BSCSettings.hasPin()
            ? "Owner PIN is active. You can change it below."
            : "No owner PIN is set. Create one to protect this business app.";
    }

    refreshPinStatus();

    businessForm.addEventListener("submit", event => {
        event.preventDefault();

        try {
            window.BSCSettings.save({
                businessName: document.getElementById("business-name").value,
                phone: document.getElementById("business-phone").value,
                address: document.getElementById("business-address").value
            });

            businessMessage.textContent = "Business information saved successfully.";
            businessMessage.style.color = "#18794e";
            document.title =
                document.getElementById("business-name").value + " | Settings";
        } catch (error) {
            businessMessage.textContent = error.message;
            businessMessage.style.color = "#b42318";
        }
    });

    pinForm.addEventListener("submit", async event => {
        event.preventDefault();

        const pin = document.getElementById("new-pin").value;
        const confirmation = document.getElementById("confirm-pin").value;

        if (!/^\d{4,12}$/.test(pin)) {
            pinMessage.textContent = "Enter a PIN containing 4 to 12 digits.";
            pinMessage.style.color = "#b42318";
            return;
        }

        if (pin !== confirmation) {
            pinMessage.textContent = "The two PIN entries do not match.";
            pinMessage.style.color = "#b42318";
            return;
        }

        try {
            await window.BSCSettings.setPin(pin);

            pinForm.reset();
            pinMessage.textContent =
                "Owner PIN saved successfully. Your current session remains unlocked.";
            pinMessage.style.color = "#18794e";
            refreshPinStatus();
        } catch (error) {
            pinMessage.textContent = error.message;
            pinMessage.style.color = "#b42318";
        }
    });

    document.getElementById("lock-button").addEventListener("click", () => {
        if (!window.BSCSettings.hasPin()) {
            pinMessage.textContent = "Set an owner PIN before locking the business.";
            pinMessage.style.color = "#b42318";
            return;
        }

        window.BSCSettings.lock();
    });
});
