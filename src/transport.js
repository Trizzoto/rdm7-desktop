/**
 * RDM-7 Transport Abstraction Layer
 *
 * Provides a unified API (window.RDM) for all storage and device operations.
 * Transport implementations: LocalTransport (default), WifiTransport, HotspotTransport, UsbTransport.
 */
(function () {
    'use strict';

    /* ── Default layout (first-boot / offline fallback) ────────────── */
    const _DEFAULT_LAYOUT = {
        schema_version: 11, name: "default", screen_w: 800, screen_h: 480,
        ecu: "MaxxECU", ecu_version: "1.3",
        widgets: [
            { type:"shape_panel", id:"shape_panel_1", x:0, y:-182, w:800, h:9, config:{ bg_color:0x2965, bg_opa:255, border_color:0x2965, border_width:0, border_radius:0, shadow_width:0, shadow_color:0, shadow_opa:128, shadow_ofs_x:0, shadow_ofs_y:0 }},
            { type:"rpm_bar", id:"rpm_bar_0", x:0, y:-215, w:800, h:55, config:{ rpm_max:7000, signal_name:"RPM", redline:6500 }, signal:"RPM" },
            { type:"panel", id:"panel_0", x:-312, y:-26, w:155, h:92, config:{ slot:0, decimals:0, label:"COOLANT PRESSURE", signal_name:"COOLANT_PRESSURE" }, signal:"COOLANT_PRESSURE" },
            { type:"panel", id:"panel_1", x:-146, y:-26, w:155, h:92, config:{ slot:1, decimals:0, label:"FUEL PRESSURE", signal_name:"FUEL_PRESSURE" }, signal:"FUEL_PRESSURE" },
            { type:"panel", id:"panel_2", x:-312, y:82, w:155, h:92, config:{ slot:2, decimals:0, label:"COOLANT TEMP", signal_name:"COOLANT_TEMP" }, signal:"COOLANT_TEMP" },
            { type:"panel", id:"panel_3", x:-146, y:82, w:155, h:92, config:{ slot:3, decimals:0, label:"INTAKE AIR TEMP", signal_name:"INTAKE_AIR_TEMP" }, signal:"INTAKE_AIR_TEMP" },
            { type:"panel", id:"panel_4", x:146, y:-26, w:155, h:92, config:{ slot:4, decimals:0, label:"OIL TEMP", signal_name:"OIL_TEMP" }, signal:"OIL_TEMP" },
            { type:"panel", id:"panel_5", x:312, y:-26, w:155, h:92, config:{ slot:5, decimals:0, label:"MAP", signal_name:"MAP" }, signal:"MAP" },
            { type:"panel", id:"panel_6", x:146, y:82, w:155, h:92, config:{ slot:6, decimals:0, label:"LAMBDA TARGET", signal_name:"LAMBDA_TARGET" }, signal:"LAMBDA_TARGET" },
            { type:"panel", id:"panel_7", x:312, y:82, w:155, h:92, config:{ slot:7, decimals:2, label:"LAMBDA", signal_name:"LAMBDA" }, signal:"LAMBDA" },
            { type:"bar", id:"bar_0", x:-240, y:209, w:300, h:30, config:{ slot:0, label:"COOLANT TEMP", signal_name:"COOLANT_TEMP", bar_low:0, bar_high:100, bar_low_color:31, bar_high_color:63488 }, signal:"COOLANT_TEMP" },
            { type:"bar", id:"bar_1", x:240, y:209, w:300, h:30, config:{ slot:1, label:"THROTTLE  ", signal_name:"THROTTLE__", bar_low:0, bar_high:100, bar_low_color:31, bar_high_color:63488 }, signal:"THROTTLE__" },
            { type:"indicator", id:"indicator_0", x:-95, y:-133, w:35, h:35, config:{ slot:0, opa_off:180 }},
            { type:"indicator", id:"indicator_1", x:95, y:-133, w:35, h:35, config:{ slot:1, opa_off:180 }},
            { type:"warning", id:"warning_0", x:-352, y:-148, w:20, h:20, config:{ slot:0, inactive_opa:180 }},
            { type:"warning", id:"warning_1", x:-292, y:-148, w:20, h:20, config:{ slot:1, inactive_opa:180 }},
            { type:"warning", id:"warning_2", x:-232, y:-148, w:20, h:20, config:{ slot:2, inactive_opa:180 }},
            { type:"warning", id:"warning_3", x:-172, y:-148, w:20, h:20, config:{ slot:3, inactive_opa:180 }},
            { type:"warning", id:"warning_4", x:172, y:-148, w:20, h:20, config:{ slot:4, inactive_opa:180 }},
            { type:"warning", id:"warning_5", x:232, y:-148, w:20, h:20, config:{ slot:5, inactive_opa:180 }},
            { type:"warning", id:"warning_6", x:292, y:-148, w:20, h:20, config:{ slot:6, inactive_opa:180 }},
            { type:"warning", id:"warning_7", x:352, y:-148, w:20, h:20, config:{ slot:7, inactive_opa:180, label:"INTAKE AIR TEMP", radius:200 }},
            { type:"text", id:"text_1", x:0, y:70, w:180, h:80, config:{ static_text:"", decimals:0, rotation:0, font:"fugaz_56", text_color:65535, signal_name:"VEHICLE_SPEED" }, signal:"VEHICLE_SPEED" },
            { type:"image", id:"image_1", x:0, y:-60, w:120, h:62, config:{ image_name:"RDM", image_scale:256, opacity:255 }},
            { type:"text", id:"text_2", x:0, y:-111, w:180, h:80, config:{ static_text:"", decimals:0, rotation:0, font:"fugaz_28", text_color:65535, signal_name:"RPM" }, signal:"RPM" },
            { type:"text", id:"text_3", x:-380, y:-160, w:100, h:30, config:{ static_text:"", decimals:0, rotation:0, font:"", text_color:65535, signal_name:"FPS" }, signal:"FPS" }
        ],
        signals: [
            { name:"VEHICLE_SPEED", can_id:1314, bit_start:48, bit_length:16, scale:0.1, offset:0, is_little_endian:true, unit:"" },
            { name:"RPM", can_id:1312, bit_start:0, bit_length:16, scale:1, offset:0, is_little_endian:true, is_signed:true, unit:"" },
            { name:"COOLANT_TEMP", can_id:1328, bit_start:48, bit_length:16, scale:0.1, offset:0, is_little_endian:true, unit:"" },
            { name:"FPS", can_id:0, bit_start:0, bit_length:16, scale:1, offset:0, is_little_endian:true, unit:"" },
            { name:"THROTTLE__", can_id:1312, bit_start:16, bit_length:16, scale:0.1, offset:0, is_little_endian:true, unit:"" },
            { name:"COOLANT_PRESSURE", can_id:1335, bit_start:32, bit_length:16, scale:0.1, offset:0, is_little_endian:true, unit:"" },
            { name:"FUEL_PRESSURE", can_id:1335, bit_start:0, bit_length:16, scale:0.1, offset:0, is_little_endian:true, unit:"" },
            { name:"INTAKE_AIR_TEMP", can_id:1328, bit_start:32, bit_length:16, scale:0.1, offset:0, is_little_endian:true, unit:"" },
            { name:"LAMBDA_TARGET", can_id:1319, bit_start:48, bit_length:16, scale:0.001, offset:0, is_little_endian:true, unit:"" },
            { name:"LAMBDA_A", can_id:1313, bit_start:0, bit_length:16, scale:0.001, offset:0, is_little_endian:true, unit:"" },
            { name:"LAMBDA", can_id:1312, bit_start:48, bit_length:16, scale:0.001, offset:0, is_little_endian:true, unit:"" },
            { name:"MAP", can_id:1312, bit_start:32, bit_length:16, scale:0.1, offset:0, is_little_endian:true, unit:"" },
            { name:"OIL_TEMP", can_id:1334, bit_start:48, bit_length:16, scale:0.1, offset:0, is_little_endian:true, unit:"" }
        ]
    };

    /* ── Helpers ──────────────────────────────────────────────────── */

    function _isTauri() {
        return !!(window.__TAURI_INTERNALS__ || window.__TAURI__);
    }

    async function _tauriInvoke(cmd, args) {
        if (window.__TAURI_INTERNALS__) {
            return window.__TAURI_INTERNALS__.invoke(cmd, args);
        }
        throw new Error('Tauri invoke not available');
    }

    /* ── IndexedDB for large binary data (shared across transports) ─ */

    const _idb = (() => {
        const DB = 'rdm7_desktop_db';
        const STORES = { images: 'image_data', fonts: 'font_data' };
        let _db = null;

        function open() {
            if (_db) return Promise.resolve(_db);
            return new Promise((res, rej) => {
                const req = indexedDB.open(DB, 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    for (const s of Object.values(STORES))
                        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
                };
                req.onsuccess = () => { _db = req.result; res(_db); };
                req.onerror = () => rej(req.error);
            });
        }

        return {
            async get(store, key) {
                const db = await open();
                return new Promise((res, rej) => {
                    const tx = db.transaction(STORES[store], 'readonly');
                    const r = tx.objectStore(STORES[store]).get(key);
                    r.onsuccess = () => res(r.result || null);
                    r.onerror = () => rej(r.error);
                });
            },
            async set(store, key, val) {
                const db = await open();
                return new Promise((res, rej) => {
                    const tx = db.transaction(STORES[store], 'readwrite');
                    tx.objectStore(STORES[store]).put(val, key);
                    tx.oncomplete = () => res();
                    tx.onerror = () => rej(tx.error);
                });
            },
            async remove(store, key) {
                const db = await open();
                return new Promise((res, rej) => {
                    const tx = db.transaction(STORES[store], 'readwrite');
                    tx.objectStore(STORES[store]).delete(key);
                    tx.oncomplete = () => res();
                    tx.onerror = () => rej(tx.error);
                });
            },
            async keys(store) {
                const db = await open();
                return new Promise((res, rej) => {
                    const tx = db.transaction(STORES[store], 'readonly');
                    const r = tx.objectStore(STORES[store]).getAllKeys();
                    r.onsuccess = () => res(r.result);
                    r.onerror = () => rej(r.error);
                });
            }
        };
    })();

    /* ═══════════════════════════════════════════════════════════════
     *  LocalTransport — wraps localStorage + IndexedDB (offline)
     * ═══════════════════════════════════════════════════════════════ */

    const LocalTransport = {
        name: 'local',

        /* ── Layouts ─────────────────────────────────────────────── */
        async listLayouts() {
            const keys = Object.keys(localStorage)
                .filter(k => k.startsWith('rdm7_layout_') && !k.startsWith('rdm7_layout__splash_'));
            const names = keys.map(k => k.replace('rdm7_layout_', ''));
            if (!names.includes('default')) names.unshift('default');
            return names;
        },

        async loadLayout(name) {
            const raw = localStorage.getItem('rdm7_layout_' + (name || 'default'));
            if (raw) return JSON.parse(raw);
            if (!name || name === 'default') return JSON.parse(JSON.stringify(_DEFAULT_LAYOUT));
            return null;
        },

        async saveLayout(name, data) {
            localStorage.setItem('rdm7_layout_' + name, JSON.stringify(data));
        },

        async deleteLayout(name) {
            localStorage.removeItem('rdm7_layout_' + name);
        },

        async renameLayout(oldName, newName) {
            const raw = localStorage.getItem('rdm7_layout_' + oldName);
            if (!raw) throw new Error('Layout not found');
            const data = JSON.parse(raw);
            data.name = newName;
            localStorage.setItem('rdm7_layout_' + newName, JSON.stringify(data));
            localStorage.removeItem('rdm7_layout_' + oldName);
        },

        /* ── Splash ──────────────────────────────────────────────── */
        async listSplashes() {
            const keys = Object.keys(localStorage)
                .filter(k => k.startsWith('rdm7_layout__splash_'));
            return keys.map(k => k.replace('rdm7_layout__splash_', ''));
        },

        async loadSplash(name) {
            const raw = localStorage.getItem('rdm7_layout__splash_' + name);
            return raw ? JSON.parse(raw) : null;
        },

        async saveSplash(name, data) {
            localStorage.setItem('rdm7_layout__splash_' + name, JSON.stringify(data));
        },

        async deleteSplash(name) {
            localStorage.removeItem('rdm7_layout__splash_' + name);
        },

        async renameSplash(oldName, newName) {
            const raw = localStorage.getItem('rdm7_layout__splash_' + oldName);
            if (!raw) throw new Error('Splash not found');
            const data = JSON.parse(raw);
            data.name = '_splash_' + newName;
            localStorage.setItem('rdm7_layout__splash_' + newName, JSON.stringify(data));
            localStorage.removeItem('rdm7_layout__splash_' + oldName);
        },

        /* ── Images ──────────────────────────────────────────────── */
        async listImages() {
            const raw = localStorage.getItem('rdm7_images');
            return raw ? JSON.parse(raw) : [];
        },

        async addImageMeta(meta) {
            /* meta can be {name, width, height} or just a string */
            const entry = typeof meta === 'string' ? { name: meta, width: 0, height: 0 } : meta;
            let imgs = [];
            try { const s = localStorage.getItem('rdm7_images'); if (s) imgs = JSON.parse(s); } catch (e) { }
            imgs = imgs.filter(i => (typeof i === 'string' ? i : i.name) !== entry.name);
            imgs.push(entry);
            localStorage.setItem('rdm7_images', JSON.stringify(imgs));
        },

        async removeImageMeta(name) {
            let imgs = [];
            try { const s = localStorage.getItem('rdm7_images'); if (s) imgs = JSON.parse(s); } catch (e) { }
            imgs = imgs.filter(i => (typeof i === 'string' ? i : i.name) !== name);
            localStorage.setItem('rdm7_images', JSON.stringify(imgs));
        },

        async getImageData(name) {
            return await _idb.get('images', name) || localStorage.getItem('rdm7_image_data_' + name);
        },

        async setImageData(name, b64) {
            await _idb.set('images', name, b64);
            try { localStorage.removeItem('rdm7_image_data_' + name); } catch (e) { }
        },

        async deleteImage(name) {
            await _idb.remove('images', name);
            try { localStorage.removeItem('rdm7_image_data_' + name); } catch (e) { }
            await this.removeImageMeta(name);
        },

        /* ── Fonts ───────────────────────────────────────────────── */
        async listFonts() {
            const raw = localStorage.getItem('rdm7_fonts');
            return raw ? JSON.parse(raw) : [];
        },

        async addFontMeta(meta) {
            const entry = typeof meta === 'string' ? { name: meta, size: 0 } : meta;
            let fonts = [];
            try { const s = localStorage.getItem('rdm7_fonts'); if (s) fonts = JSON.parse(s); } catch (e) { }
            fonts = fonts.filter(f => (typeof f === 'string' ? f : f.name) !== entry.name);
            fonts.push(entry);
            localStorage.setItem('rdm7_fonts', JSON.stringify(fonts));
        },

        async removeFontMeta(name) {
            let fonts = [];
            try { const s = localStorage.getItem('rdm7_fonts'); if (s) fonts = JSON.parse(s); } catch (e) { }
            fonts = fonts.filter(f => (typeof f === 'string' ? f : f.name) !== name);
            localStorage.setItem('rdm7_fonts', JSON.stringify(fonts));
        },

        async getFontData(name) {
            return await _idb.get('fonts', name) || localStorage.getItem('rdm7_font_data_' + name);
        },

        async setFontData(name, b64) {
            await _idb.set('fonts', name, b64);
            try { localStorage.removeItem('rdm7_font_data_' + name); } catch (e) { }
        },

        async deleteFont(name) {
            await _idb.remove('fonts', name);
            try { localStorage.removeItem('rdm7_font_data_' + name); } catch (e) { }
            await this.removeFontMeta(name);
        },

        /* ── Presets ─────────────────────────────────────────────── */
        async getPresets() {
            const s = localStorage.getItem('rdm7_custom_presets');
            return s ? JSON.parse(s) : {};
        },

        async savePresets(data) {
            localStorage.setItem('rdm7_custom_presets', JSON.stringify(data));
        },

        /* ── Storage Info ────────────────────────────────────────── */
        async getStorageInfo() {
            let totalBytes = 0;
            const layoutKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key || !key.startsWith('rdm7_')) continue;
                totalBytes += (localStorage.getItem(key) || '').length * 2;
                if (key.startsWith('rdm7_layout_') && !key.startsWith('rdm7_layout__splash_'))
                    layoutKeys.push(key);
            }
            return {
                layouts: layoutKeys.map(k => ({
                    name: k.replace('rdm7_layout_', ''),
                    size: (localStorage.getItem(k) || '').length * 2
                })),
                images: await this.listImages(),
                fonts: await this.listFonts(),
                totalBytes,
                maxBytes: 5 * 1024 * 1024
            };
        },

        /* ── System (stubs for local mode) ───────────────────────── */
        async getScreenshot() { return null; },
        async getDeviceInfo() { return null; },
        async getBrightness() { return null; },
        async setBrightness() { },
        async getCanConfig() { return null; },
        async setCanConfig() { },
        async injectSignal() { },
        async toggleSimulation() { },
        async getSimulationStatus() { return { enabled: false }; },
        async getDimmerConfig() { return null; },
        async setDimmerConfig() { },
        async getSystemHealth() { return null; },
        async reboot() { },
        async getSignalValues() { return null; },
        async startLogging() { },
        async stopLogging() { },
        async getLogStatus() { return null; },
        async listLogs() { return []; },
        async downloadLog() { return null; },
        async deleteLog() { },
        async getFuelStatus() { return null; },
        async setFuelEmpty() { },
        async setFuelFull() { },
        async getWifiConfig() { return null; },
        async setWifiConfig() { },
        async applyToDevice() { },
        async previewOnDevice() { },
        async testConnection() { return null; },

        /* ── OTA (not available offline) ─────────────────────────── */
        async uploadFirmware() { throw new Error('OTA requires a device connection'); },
        async getOtaStatus() { return null; },

        /* ── SD Card (not available offline) ─────────────────────── */
        async getSdStatus() { return null; },
        async listSdFiles() { return []; },
        async copySdFile() { throw new Error('SD card requires a device connection'); },
        async deleteSdFile() { throw new Error('SD card requires a device connection'); },

        /* ── Bundle Export/Import ─────────────────────────────────── */
        async exportRdmBundle(layout) { return layout; },
        async importRdmBundle(data) { return data; },
    };

    /* ═══════════════════════════════════════════════════════════════
     *  WifiTransport — HTTP fetch to ESP32 on the network
     * ═══════════════════════════════════════════════════════════════ */

    function createWifiTransport(baseUrl) {
        const api = async (path, opts) => {
            if (_isTauri()) {
                const resp = await _tauriInvoke('http_fetch', {
                    req: {
                        url: baseUrl + path,
                        method: opts?.method || 'GET',
                        body: opts?.body || null,
                        timeout_ms: opts?.timeout || 10000,
                    }
                });
                if (resp.status < 200 || resp.status >= 300)
                    throw new Error(`HTTP ${resp.status}: ${resp.body}`);
                try { return JSON.parse(resp.body); } catch { return resp.body; }
            }
            return fetch(baseUrl + path, {
                ...opts,
                signal: AbortSignal.timeout(opts?.timeout || 10000),
            }).then(async r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
                const ct = r.headers.get('content-type') || '';
                return ct.includes('json') ? r.json() : r.text();
            });
        };

        const apiBlob = async (path) => {
            if (_isTauri()) {
                const bytes = await _tauriInvoke('http_fetch_binary', {
                    url: baseUrl + path,
                    timeout_ms: 15000,
                });
                return new Blob([new Uint8Array(bytes)]);
            }
            return fetch(baseUrl + path, {
                signal: AbortSignal.timeout(15000),
            }).then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.blob();
            });
        };

        return {
            name: 'wifi',
            baseUrl,

            /* ── Layouts ───────────────────────────────────────── */
            async listLayouts() {
                const r = await api('/api/layout/list');
                const list = r.layouts || r;
                if (!Array.isArray(list)) throw new Error('Invalid response from device');
                return list;
            },

            async loadLayout(name) {
                /* Use /api/layout/raw to read without changing the active layout on device */
                return await api('/api/layout/raw?name=' + encodeURIComponent(name || 'default'));
            },

            async saveLayout(name, data) {
                await api('/api/layout/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                    timeout: 15000,
                });
            },

            async deleteLayout(name) {
                await api('/api/layout/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name }),
                });
            },

            async renameLayout(oldName, newName) {
                await api('/api/layout/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ old_name: oldName, new_name: newName }),
                });
            },

            /* ── Splash ────────────────────────────────────────── */
            async listSplashes() {
                const r = await api('/api/splash/list');
                return r.splashes || [];
            },

            async loadSplash(name) {
                /* Splash layouts are stored as _splash_<name> internally */
                return await api('/api/layout/raw?name=' + encodeURIComponent('_splash_' + name));
            },

            async saveSplash(name, data) {
                data.name = '_splash_' + name;
                await api('/api/layout/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                    timeout: 15000,
                });
            },

            async deleteSplash(name) {
                await api('/api/splash/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name }),
                });
            },

            async renameSplash(oldName, newName) {
                await this.renameLayout('_splash_' + oldName, '_splash_' + newName);
            },

            /* ── Images ────────────────────────────────────────── */
            async listImages() {
                const r = await api('/api/image/list');
                return r.images || r;
            },

            async addImageMeta() { /* managed by firmware */ },
            async removeImageMeta() { /* managed by firmware */ },

            async getImageData(name) {
                const blob = await apiBlob('/api/image/data?name=' + encodeURIComponent(name));
                return new Promise((res, rej) => {
                    const reader = new FileReader();
                    reader.onload = () => res(reader.result.split(',')[1]);
                    reader.onerror = rej;
                    reader.readAsDataURL(blob);
                });
            },

            async setImageData(name, b64) {
                const binary = atob(b64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                const url = baseUrl + '/api/image/upload?name=' + encodeURIComponent(name);
                if (_isTauri()) {
                    await _tauriInvoke('http_upload_binary', {
                        url, data: Array.from(bytes), timeout_ms: 30000,
                    });
                } else {
                    await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/octet-stream' },
                        body: bytes,
                        signal: AbortSignal.timeout(30000),
                    });
                }
            },

            async deleteImage(name) {
                await api('/api/image/delete?name=' + encodeURIComponent(name), {
                    method: 'POST',
                });
            },

            /* ── Fonts ─────────────────────────────────────────── */
            async listFonts() {
                const r = await api('/api/font/list');
                return r.fonts || r;
            },

            async addFontMeta() { /* managed by firmware */ },
            async removeFontMeta() { /* managed by firmware */ },

            async getFontData(name) {
                const blob = await apiBlob('/api/font/data?name=' + encodeURIComponent(name));
                return new Promise((res, rej) => {
                    const reader = new FileReader();
                    reader.onload = () => res(reader.result.split(',')[1]);
                    reader.onerror = rej;
                    reader.readAsDataURL(blob);
                });
            },

            async setFontData(name, b64) {
                const binary = atob(b64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                const url = baseUrl + '/api/font/upload?name=' + encodeURIComponent(name);
                if (_isTauri()) {
                    await _tauriInvoke('http_upload_binary', {
                        url, data: Array.from(bytes), timeout_ms: 30000,
                    });
                } else {
                    await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/octet-stream' },
                        body: bytes,
                        signal: AbortSignal.timeout(30000),
                    });
                }
            },

            async deleteFont(name) {
                await api('/api/font/delete?name=' + encodeURIComponent(name), {
                    method: 'POST',
                });
            },

            /* ── Presets ───────────────────────────────────────── */
            async getPresets() {
                try {
                    return await api('/api/presets');
                } catch (e) {
                    return LocalTransport.getPresets();
                }
            },

            async savePresets(data) {
                return LocalTransport.savePresets(data);
            },

            /* ── Storage Info ──────────────────────────────────── */
            async getStorageInfo() {
                const [info, layoutData, images, fonts] = await Promise.all([
                    api('/api/storage/info'),
                    api('/api/layout/list'),
                    api('/api/image/list'),
                    api('/api/font/list'),
                ]);
                const layoutNames = layoutData.layouts || layoutData || [];
                return {
                    totalBytes: info.used,
                    maxBytes: info.total,
                    layouts: layoutNames.map(l => typeof l === 'string' ? { name: l, size: 0 } : l),
                    images: (images.images || images || []),
                    fonts: (fonts.fonts || fonts || []),
                    sd: info.sd,
                };
            },

            /* ── System ────────────────────────────────────────── */
            async getScreenshot() {
                const blob = await apiBlob('/screenshot');
                return URL.createObjectURL(blob);
            },

            async getDeviceInfo() {
                try { return await api('/api/device/info'); } catch (e) { return null; }
            },

            async getBrightness() {
                try {
                    const r = await api('/api/brightness');
                    return r.brightness !== undefined ? r.brightness : r;
                } catch (e) { return null; }
            },

            async setBrightness(val) {
                await api('/api/brightness', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ brightness: val }),
                });
            },

            async getCanConfig() {
                try { return await api('/api/can/config'); } catch (e) { return null; }
            },

            async setCanConfig(cfg) {
                await api('/api/can/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(cfg),
                });
            },

            async injectSignal(name, value) {
                await api('/api/signal/inject', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, value }),
                });
            },

            async toggleSimulation(enable) {
                return await api('/api/signal/simulate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enable: !!enable }),
                });
            },

            async getSimulationStatus() {
                return await api('/api/signal/simulate');
            },

            /* ── Dimmer Config ─────────────────────────────────── */
            async getDimmerConfig() {
                return await api('/api/dimmer/config');
            },

            async setDimmerConfig(cfg) {
                await api('/api/dimmer/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(cfg),
                });
            },

            /* ── System Health & Reboot ───────────────────────── */
            async getSystemHealth() {
                try { return await api('/api/system/health'); } catch (e) { return null; }
            },

            async reboot() {
                await api('/api/system/reboot', { method: 'POST' });
            },

            /* ── Signal Values ────────────────────────────────── */
            async getSignalValues() {
                try { return await api('/api/signals/values'); } catch (e) { return null; }
            },

            /* ── Data Logger ──────────────────────────────────── */
            async startLogging() {
                await api('/api/log/start', { method: 'POST' });
            },
            async stopLogging() {
                await api('/api/log/stop', { method: 'POST' });
            },
            async getLogStatus() {
                try { return await api('/api/log/status'); } catch (e) { return null; }
            },
            async listLogs() {
                try { return await api('/api/log/list'); } catch (e) { return []; }
            },
            async downloadLog(name) {
                try { return await apiBlob('/api/log/download?name=' + encodeURIComponent(name)); } catch (e) { return null; }
            },
            async deleteLog(name) {
                await api('/api/log/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name }),
                });
            },

            /* ── Fuel Calibration ─────────────────────────────── */
            async getFuelStatus() {
                try { return await api('/api/fuel/status'); } catch (e) { return null; }
            },
            async setFuelEmpty() {
                await api('/api/fuel/set-empty', { method: 'POST' });
            },
            async setFuelFull() {
                await api('/api/fuel/set-full', { method: 'POST' });
            },

            /* ── WiFi Config ──────────────────────────────────── */
            async getWifiConfig() {
                try { return await api('/api/wifi/config'); } catch (e) { return null; }
            },
            async setWifiConfig(cfg) {
                await api('/api/wifi/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(cfg),
                });
            },

            /* ── Apply Layout Live ─────────────────────────────── */
            async applyToDevice(name) {
                await api('/api/layout/set', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name }),
                });
            },

            async previewOnDevice(data) {
                await api('/api/layout/preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                    timeout: 15000,
                });
            },

            /* ── Test Connection ───────────────────────────────── */
            async testConnection() {
                const r = await api('/api/layout/version', { timeout: 5000 });
                return r;
            },

            /* ── OTA ───────────────────────────────────────────── */
            async uploadFirmware(data, onProgress) {
                const formData = new FormData();
                formData.append('firmware', new Blob([data]), 'firmware.bin');
                const xhr = new XMLHttpRequest();
                return new Promise((res, rej) => {
                    xhr.open('POST', baseUrl + '/api/ota/upload');
                    xhr.upload.onprogress = (e) => {
                        if (e.lengthComputable && onProgress)
                            onProgress(Math.round(e.loaded / e.total * 100));
                    };
                    xhr.onload = () => xhr.status < 300 ? res(JSON.parse(xhr.responseText)) : rej(new Error(xhr.responseText));
                    xhr.onerror = () => rej(new Error('Upload failed'));
                    xhr.timeout = 120000;
                    xhr.ontimeout = () => rej(new Error('Upload timed out'));
                    xhr.send(formData);
                });
            },

            async getOtaStatus() {
                try { return await api('/api/ota/status'); } catch (e) { return null; }
            },

            /* ── SD Card ───────────────────────────────────────── */
            async getSdStatus() {
                return await api('/api/sd/status');
            },

            async listSdFiles() {
                const r = await api('/api/sd/files');
                return r.files || r;
            },

            async copySdFile(src, dst) {
                await api('/api/sd/copy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ source: src, dest: dst }),
                });
            },

            async deleteSdFile(path) {
                await api('/api/sd/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path }),
                });
            },

            /* ── Bundle ────────────────────────────────────────── */
            async exportRdmBundle(layout) { return layout; },
            async importRdmBundle(data) { return data; },
        };
    }

    /* ═══════════════════════════════════════════════════════════════
     *  UsbTransport — serial protocol via Tauri backend
     * ═══════════════════════════════════════════════════════════════ */

    function createUsbTransport(portName) {
        /** Send a JSON-RPC request to the device via serial */
        async function rpc(method, params) {
            const resp = await _tauriInvoke('serial_request', {
                method,
                params: params || {},
            });
            if (resp && resp.error) throw new Error(resp.error);
            return resp ? resp.result : null;
        }


        return {
            name: 'usb',
            portName,

            /* ── Layouts ───────────────────────────────────────── */
            async listLayouts() {
                const r = await rpc('layout.list');
                if (!r) return [];
                const list = r.layouts || [];
                list._active = r.active || null;
                return list;
            },

            async loadLayout(name) {
                return await rpc('layout.raw', { name: name || 'default' });
            },

            async loadCurrentLayout() {
                return await rpc('layout.current');
            },

            async saveLayout(name, data) {
                await rpc('layout.save', { name, data });
            },

            async setActiveLayout(name) {
                await rpc('layout.set', { name });
            },

            async deleteLayout(name) {
                await rpc('layout.delete', { name });
            },

            async renameLayout(oldName, newName) {
                /* Serial protocol doesn't have rename — save+delete */
                const data = await rpc('layout.raw', { name: oldName });
                if (data) {
                    data.name = newName;
                    await rpc('layout.save', { name: newName, data });
                    await rpc('layout.delete', { name: oldName });
                }
            },

            /* ── Splash ────────────────────────────────────────── */
            async listSplashes() {
                const r = await rpc('splash.list');
                if (!r) return [];
                const list = r.splashes || [];
                list._active = r.active || null;
                return list;
            },

            async loadSplash(name) {
                return await rpc('layout.raw', { name: '_splash_' + name });
            },

            async saveSplash(name, data) {
                data.name = '_splash_' + name;
                await rpc('layout.save', { name: '_splash_' + name, data });
            },

            async deleteSplash(name) {
                await rpc('layout.delete', { name: '_splash_' + name });
            },

            async renameSplash(oldName, newName) {
                await this.renameLayout('_splash_' + oldName, '_splash_' + newName);
            },

            /* ── Images ────────────────────────────────────────── */
            async listImages() {
                return await rpc('image.list') || [];
            },

            async addImageMeta() { /* managed by firmware */ },
            async removeImageMeta() { /* managed by firmware */ },

            async getImageData(name) {
                return await _tauriInvoke('serial_download_base64', {
                    downloadType: 'image', name,
                });
            },

            async setImageData(name, b64) {
                const binary = atob(b64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                await _tauriInvoke('serial_upload_chunked', {
                    uploadType: 'image',
                    name,
                    data: Array.from(bytes),
                });
            },

            async deleteImage(name) {
                await rpc('image.delete', { name });
            },

            /* ── Fonts ─────────────────────────────────────────── */
            async listFonts() {
                return await rpc('font.list') || [];
            },

            async addFontMeta() { /* managed by firmware */ },
            async removeFontMeta() { /* managed by firmware */ },

            async getFontData(name) {
                return await _tauriInvoke('serial_download_base64', {
                    downloadType: 'font', name,
                });
            },

            async setFontData(name, b64) {
                const binary = atob(b64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                await _tauriInvoke('serial_upload_chunked', {
                    uploadType: 'font',
                    name,
                    data: Array.from(bytes),
                });
            },

            async deleteFont(name) {
                await rpc('font.delete', { name });
            },

            /* ── Presets ───────────────────────────────────────── */
            async getPresets() {
                return LocalTransport.getPresets();
            },

            async savePresets(data) {
                return LocalTransport.savePresets(data);
            },

            /* ── Storage Info ──────────────────────────────────── */
            async getStorageInfo() {
                /* Serial is single-threaded — run sequentially */
                const info = await rpc('storage.info');
                const layoutData = await rpc('layout.list');
                const images = await rpc('image.list');
                const fonts = await rpc('font.list');
                const layoutNames = layoutData.layouts || layoutData || [];
                return {
                    totalBytes: info.used,
                    maxBytes: info.total,
                    layouts: layoutNames.map(l => typeof l === 'string' ? { name: l, size: 0 } : l),
                    images: images || [],
                    fonts: fonts || [],
                    sd: info.sd,
                };
            },

            /* ── System ────────────────────────────────────────── */
            async getScreenshot() {
                /* Screenshot over serial returns binary after JSON info */
                await rpc('screenshot');
                /* Binary frame follows — desktop app would need to handle this.
                 * For now return null; WiFi screenshot feed is preferred. */
                return null;
            },

            async getDeviceInfo() {
                return await rpc('device.info');
            },

            async getBrightness() {
                try {
                    const r = await rpc('brightness.get');
                    return r ? r.brightness : null;
                } catch (e) { return null; }
            },
            async setBrightness(val) {
                await rpc('brightness.set', { brightness: val });
            },
            async getCanConfig() {
                try { return await rpc('can.config.get'); } catch (e) { return null; }
            },
            async setCanConfig(cfg) {
                await rpc('can.config.set', cfg);
            },

            async injectSignal(name, value) {
                await rpc('signal.inject', { name, value });
            },

            async toggleSimulation(enable) {
                return await rpc('signal.simulate', { enable: !!enable });
            },

            async getSimulationStatus() {
                return await rpc('signal.simulate', {});
            },

            async getDimmerConfig() {
                try { return await rpc('dimmer.get'); } catch (e) { return null; }
            },
            async setDimmerConfig(cfg) {
                await rpc('dimmer.set', cfg);
            },

            /* ── System Health & Reboot ───────────────────────── */
            async getSystemHealth() {
                try { return await rpc('system.health'); } catch (e) { return null; }
            },
            async reboot() {
                await rpc('system.reboot');
            },

            /* ── Signal Values ────────────────────────────────── */
            async getSignalValues() {
                try { return await rpc('signal.values'); } catch (e) { return null; }
            },

            /* ── Data Logger ──────────────────────────────────── */
            async startLogging() { await rpc('log.start'); },
            async stopLogging() { await rpc('log.stop'); },
            async getLogStatus() {
                try { return await rpc('log.status'); } catch (e) { return null; }
            },
            async listLogs() {
                try { return await rpc('log.list') || []; } catch (e) { return []; }
            },
            async downloadLog() { return null; /* WiFi recommended for log download */ },
            async deleteLog(name) { await rpc('log.delete', { name }); },

            /* ── Fuel Calibration ─────────────────────────────── */
            async getFuelStatus() {
                try { return await rpc('fuel.status'); } catch (e) { return null; }
            },
            async setFuelEmpty() { await rpc('fuel.set-empty'); },
            async setFuelFull() { await rpc('fuel.set-full'); },

            /* ── WiFi Config ──────────────────────────────────── */
            async getWifiConfig() {
                try { return await rpc('wifi.config.get'); } catch (e) { return null; }
            },
            async setWifiConfig(cfg) {
                await rpc('wifi.config.set', cfg);
            },

            async applyToDevice(name) {
                await rpc('layout.set', { name });
            },

            async previewOnDevice(data) {
                /* Preview not supported over serial (too large) */
            },

            async testConnection() {
                return await rpc('device.info');
            },

            /* ── OTA ───────────────────────────────────────────── */
            async uploadFirmware(data, onProgress) {
                const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
                /* Use chunked upload via Tauri backend */
                const result = await _tauriInvoke('serial_upload_chunked', {
                    uploadType: 'ota',
                    name: 'firmware',
                    data: Array.from(bytes),
                });
                if (onProgress) onProgress(100);
                return result;
            },

            async getOtaStatus() { return null; },

            /* ── SD Card ───────────────────────────────────────── */
            async getSdStatus() { return null; },
            async listSdFiles() { return []; },
            async copySdFile() { },
            async deleteSdFile() { },

            /* ── Bundle ────────────────────────────────────────── */
            async exportRdmBundle(layout) { return layout; },
            async importRdmBundle(data) { return data; },
        };
    }

    /* ═══════════════════════════════════════════════════════════════
     *  RDM Global Object — public API
     * ═══════════════════════════════════════════════════════════════ */

    const SETTINGS_KEY = 'rdm7_connection_settings';

    function _loadSettings() {
        try {
            return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
        } catch (e) { return {}; }
    }

    function _saveSettings(s) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    }

    const RDM = {
        mode: 'local',
        _transport: LocalTransport,
        _listeners: [],

        /* ── Connection Management ───────────────────────────── */
        get transport() { return this._transport; },

        setMode(mode, opts) {
            opts = opts || {};
            this.mode = mode;

            if (mode === 'local') {
                this._transport = LocalTransport;
            } else if (mode === 'wifi') {
                const ip = opts.ip || '192.168.1.1';
                const port = opts.port || 80;
                const url = `http://${ip}:${port}`;
                this._transport = createWifiTransport(url);
                _saveSettings({ mode, ip, port });
            } else if (mode === 'hotspot') {
                const url = 'http://192.168.4.1';
                this._transport = createWifiTransport(url);
                _saveSettings({ mode });
            } else if (mode === 'usb') {
                const portName = opts.portName || '';
                this._transport = createUsbTransport(portName);
                _saveSettings({ mode, portName });
            }

            this._notifyListeners();
        },

        onModeChange(fn) {
            this._listeners.push(fn);
        },

        _notifyListeners() {
            for (const fn of this._listeners) {
                try { fn(this.mode, this._transport); } catch (e) { }
            }
        },

        restoreLastConnection() {
            const s = _loadSettings();
            if (s.mode === 'wifi' && s.ip) {
                this.setMode('wifi', { ip: s.ip, port: s.port });
            } else if (s.mode === 'hotspot') {
                this.setMode('hotspot');
            } else if (s.mode === 'usb' && s.portName) {
                this.setMode('usb', { portName: s.portName });
            }
            // else stay local
        },

        getConnectionSettings() {
            return _loadSettings();
        },

        isConnected() {
            return this.mode !== 'local';
        },

        isTauri: _isTauri,
        tauriInvoke: _tauriInvoke,

        getBaseUrl() {
            return this._transport.baseUrl || '';
        },

        /* ── Device Discovery (Tauri only) ───────────────────── */
        async discoverDevices() {
            if (!_isTauri()) return [];
            try {
                return await _tauriInvoke('discover_devices');
            } catch (e) {
                console.warn('Device discovery failed:', e);
                return [];
            }
        },

        /* ── Serial Port Operations (Tauri only) ────────────── */
        async listSerialPorts() {
            if (!_isTauri()) return [];
            try {
                return await _tauriInvoke('serial_list_ports');
            } catch (e) {
                console.warn('Serial port listing failed:', e);
                return [];
            }
        },

        async autoDetectDevice() {
            if (!_isTauri()) return null;
            try {
                return await _tauriInvoke('serial_auto_detect');
            } catch (e) {
                console.warn('Auto-detect failed:', e);
                return null;
            }
        },

        async serialConnect(portName) {
            if (!_isTauri()) throw new Error('Serial requires desktop app');
            await _tauriInvoke('serial_connect', { portName });
            this.setMode('usb', { portName });
        },

        async serialDisconnect() {
            if (!_isTauri()) return;
            try { await _tauriInvoke('serial_disconnect'); } catch (e) { }
            this.setMode('local');
        },

        async serialIsConnected() {
            if (!_isTauri()) return false;
            try { return await _tauriInvoke('serial_is_connected'); } catch (e) { return false; }
        },

        /* ── Proxy all transport methods ─────────────────────── */
        async listLayouts() { return this._transport.listLayouts(); },
        async loadLayout(n) { return this._transport.loadLayout(n); },
        async loadCurrentLayout() {
            if (this._transport.loadCurrentLayout) return this._transport.loadCurrentLayout();
            return null;
        },
        async setActiveLayout(n) {
            if (this._transport.setActiveLayout) return this._transport.setActiveLayout(n);
        },
        async saveLayout(n, d) { return this._transport.saveLayout(n, d); },
        async deleteLayout(n) { return this._transport.deleteLayout(n); },
        async renameLayout(o, n) { return this._transport.renameLayout(o, n); },

        async listSplashes() { return this._transport.listSplashes(); },
        async loadSplash(n) { return this._transport.loadSplash(n); },
        async saveSplash(n, d) { return this._transport.saveSplash(n, d); },
        async deleteSplash(n) { return this._transport.deleteSplash(n); },
        async renameSplash(o, n) { return this._transport.renameSplash(o, n); },

        async listImages() { return this._transport.listImages(); },
        async addImageMeta(n) { return this._transport.addImageMeta(n); },
        async removeImageMeta(n) { return this._transport.removeImageMeta(n); },
        async getImageData(n) { return this._transport.getImageData(n); },
        async setImageData(n, d) { return this._transport.setImageData(n, d); },
        async deleteImage(n) { return this._transport.deleteImage(n); },

        async listFonts() { return this._transport.listFonts(); },
        async addFontMeta(n) { return this._transport.addFontMeta(n); },
        async removeFontMeta(n) { return this._transport.removeFontMeta(n); },
        async getFontData(n) { return this._transport.getFontData(n); },
        async setFontData(n, d) { return this._transport.setFontData(n, d); },
        async deleteFont(n) { return this._transport.deleteFont(n); },

        async getPresets() { return this._transport.getPresets(); },
        async savePresets(d) { return this._transport.savePresets(d); },

        async getStorageInfo() { return this._transport.getStorageInfo(); },
        async getScreenshot() { return this._transport.getScreenshot(); },
        async getDeviceInfo() { return this._transport.getDeviceInfo(); },
        async getBrightness() { return this._transport.getBrightness(); },
        async setBrightness(v) { return this._transport.setBrightness(v); },
        async getCanConfig() { return this._transport.getCanConfig(); },
        async setCanConfig(c) { return this._transport.setCanConfig(c); },
        async injectSignal(n, v) { return this._transport.injectSignal(n, v); },
        async toggleSimulation(e) { return this._transport.toggleSimulation(e); },
        async getSimulationStatus() { return this._transport.getSimulationStatus(); },
        async getDimmerConfig() { return this._transport.getDimmerConfig(); },
        async setDimmerConfig(c) { return this._transport.setDimmerConfig(c); },
        async getSystemHealth() { return this._transport.getSystemHealth(); },
        async reboot() { return this._transport.reboot(); },
        async getSignalValues() { return this._transport.getSignalValues(); },
        async startLogging() { return this._transport.startLogging(); },
        async stopLogging() { return this._transport.stopLogging(); },
        async getLogStatus() { return this._transport.getLogStatus(); },
        async listLogs() { return this._transport.listLogs(); },
        async downloadLog(n) { return this._transport.downloadLog(n); },
        async deleteLog(n) { return this._transport.deleteLog(n); },
        async getFuelStatus() { return this._transport.getFuelStatus(); },
        async setFuelEmpty() { return this._transport.setFuelEmpty(); },
        async setFuelFull() { return this._transport.setFuelFull(); },
        async getWifiConfig() { return this._transport.getWifiConfig(); },
        async setWifiConfig(c) { return this._transport.setWifiConfig(c); },
        async applyToDevice(n) { return this._transport.applyToDevice(n); },
        async previewOnDevice(d) { return this._transport.previewOnDevice(d); },
        async testConnection() { return this._transport.testConnection(); },

        async uploadFirmware(d, p) { return this._transport.uploadFirmware(d, p); },
        async getOtaStatus() { return this._transport.getOtaStatus(); },

        async getSdStatus() { return this._transport.getSdStatus(); },
        async listSdFiles() { return this._transport.listSdFiles(); },
        async copySdFile(s, d) { return this._transport.copySdFile(s, d); },
        async deleteSdFile(p) { return this._transport.deleteSdFile(p); },

        async exportRdmBundle(l) { return this._transport.exportRdmBundle(l); },
        async importRdmBundle(d) { return this._transport.importRdmBundle(d); },

        /* ── Native File Dialogs (Tauri only, falls back to browser) ── */

        /**
         * Show a native save-file dialog. Returns the chosen path, or null.
         * @param {string} defaultName - suggested filename
         * @param {Array} filters - [{name, extensions}]
         */
        async saveFileDialog(defaultName, filters) {
            if (!_isTauri()) return null;
            try {
                const result = await _tauriInvoke('plugin:dialog|save', {
                    options: {
                        defaultPath: defaultName,
                        filters: filters || [],
                    }
                });
                if (!result) return null;
                /* Tauri v2 may return {path: "..."} or a plain string */
                return typeof result === 'string' ? result : (result.path || result);
            } catch (e) {
                console.error('Save dialog failed:', e);
                return null;
            }
        },

        /**
         * Show a native open-file dialog. Returns the chosen path, or null.
         * @param {Array} filters - [{name, extensions}]
         */
        async openFileDialog(filters) {
            if (!_isTauri()) return null;
            try {
                const result = await _tauriInvoke('plugin:dialog|open', {
                    options: {
                        multiple: false,
                        filters: filters || [],
                    }
                });
                if (!result) return null;
                /* Tauri v2 may return {path: "..."} or a plain string */
                return typeof result === 'string' ? result : (result.path || result);
            } catch (e) {
                console.error('Open dialog failed:', e);
                return null;
            }
        },

        /**
         * Write binary data to a file path (Tauri only).
         */
        async writeFile(path, data) {
            return _tauriInvoke('write_binary_file', { path, data: Array.from(data) });
        },

        /**
         * Read binary data from a file path (Tauri only). Returns Uint8Array.
         */
        async readFile(path) {
            const arr = await _tauriInvoke('read_binary_file', { path });
            return new Uint8Array(arr);
        },
    };

    window.RDM = RDM;
})();
