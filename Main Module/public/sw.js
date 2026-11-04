// Makes the app installable. It holds no cache and handles no requests, so every load comes from the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
