// BAK SNACKS CENTER PWA registration
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("./service-worker.js", {scope: "./"})
            .then(registration => {
                console.info("Offline support ready:", registration.scope);
            })
            .catch(error => console.error("PWA registration failed:", error));
    });
}
