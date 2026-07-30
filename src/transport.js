/**
 * RDM-7 Transport Abstraction Layer
 *
 * Provides a unified API (window.RDM) for all storage and device operations.
 * Transport implementations: LocalTransport (default), WifiTransport, HotspotTransport, UsbTransport.
 */
(function () {
    'use strict';

    /* ── Default layout (first-boot / offline fallback) ────────────── */
    /* First-boot layout shown in Offline (Local) mode before any device is
     * paired: the firmware's OWN default dash (generate_default_layout in
     * main/layout/default_layout.c — the Haltech Nexus standard: RPM bar, 8
     * data panels, coolant/throttle bars, gear, speed, indicators, warnings),
     * schema v17. Kept byte-for-byte in sync with the C via
     * tools scratchpad gen_default.js. Colours are RGB565 (device format);
     * loadLayout converts to RGB888 for editing. Previously this seeded the
     * Ford cluster demo, which isn't our real default. */
    const _DEFAULT_LAYOUT = {"schema_version":17,"name":"default","screen_w":800,"screen_h":480,"ecu":"","ecu_version":"","widgets":[{"type":"shape_panel","id":"shape_panel_1","x":0,"y":-182,"w":800,"h":9,"config":{"bg_color":10597,"bg_opa":255,"border_color":10597,"border_width":0,"border_radius":0,"shadow_width":0,"shadow_color":0,"shadow_opa":128,"shadow_ofs_x":0,"shadow_ofs_y":0}},{"type":"rpm_bar","id":"rpm_bar_0","x":0,"y":-215,"w":800,"h":55,"config":{"rpm_max":7000,"redline":6500,"signal_name":"RPM"}},{"type":"panel","id":"panel_0","x":-312,"y":-26,"w":155,"h":92,"config":{"slot":0,"label":"IGNITION","signal_name":"IGNITION"}},{"type":"panel","id":"panel_1","x":-146,"y":-26,"w":155,"h":92,"config":{"slot":1,"label":"MAP","signal_name":"MAP"}},{"type":"panel","id":"panel_2","x":-312,"y":82,"w":155,"h":92,"config":{"slot":2,"label":"THROTTLE","signal_name":"THROTTLE"}},{"type":"panel","id":"panel_3","x":-146,"y":82,"w":155,"h":92,"config":{"slot":3,"label":"COOLANT","signal_name":"COOLANT_TEMP"}},{"type":"panel","id":"panel_4","x":146,"y":-26,"w":155,"h":92,"config":{"slot":4,"label":"INTAKE","signal_name":"INTAKE_AIR_TEMP"}},{"type":"panel","id":"panel_5","x":312,"y":-26,"w":155,"h":92,"config":{"slot":5,"label":"LAMBDA","signal_name":"LAMBDA"}},{"type":"panel","id":"panel_6","x":146,"y":82,"w":155,"h":92,"config":{"slot":6,"label":"OIL TEMP","signal_name":"OIL_TEMP"}},{"type":"panel","id":"panel_7","x":312,"y":82,"w":155,"h":92,"config":{"slot":7,"label":"FUEL TRIM","signal_name":"FUEL_TRIM"}},{"type":"bar","id":"bar_0","x":-240,"y":209,"w":300,"h":30,"config":{"slot":0,"label":"COOLANT","signal_name":"COOLANT_TEMP","bar_low":0,"bar_high":120,"bar_low_color":31,"bar_high_color":63488}},{"type":"bar","id":"bar_1","x":240,"y":209,"w":300,"h":30,"config":{"slot":1,"label":"THROTTLE","signal_name":"THROTTLE","bar_low":0,"bar_high":100,"bar_low_color":31,"bar_high_color":63488}},{"type":"panel","id":"panel_gear","x":0,"y":178,"w":92,"h":92,"config":{"slot":8,"label":"GEAR","signal_name":"GEAR","bg_color":14823,"border_color":14823,"decimals":0}},{"type":"indicator","id":"indicator_0","x":-95,"y":-133,"w":35,"h":35,"config":{"slot":0,"opa_off":180}},{"type":"indicator","id":"indicator_1","x":95,"y":-133,"w":35,"h":35,"config":{"slot":1,"opa_off":180}},{"type":"warning","id":"warning_0","x":-352,"y":-148,"w":20,"h":20,"config":{"slot":0,"inactive_opa":180}},{"type":"warning","id":"warning_1","x":-292,"y":-148,"w":20,"h":20,"config":{"slot":1,"inactive_opa":180}},{"type":"warning","id":"warning_2","x":-232,"y":-148,"w":20,"h":20,"config":{"slot":2,"inactive_opa":180}},{"type":"warning","id":"warning_3","x":-172,"y":-148,"w":20,"h":20,"config":{"slot":3,"inactive_opa":180}},{"type":"warning","id":"warning_4","x":172,"y":-148,"w":20,"h":20,"config":{"slot":4,"inactive_opa":180}},{"type":"warning","id":"warning_5","x":232,"y":-148,"w":20,"h":20,"config":{"slot":5,"inactive_opa":180}},{"type":"warning","id":"warning_6","x":292,"y":-148,"w":20,"h":20,"config":{"slot":6,"inactive_opa":180}},{"type":"warning","id":"warning_7","x":352,"y":-148,"w":20,"h":20,"config":{"slot":7,"inactive_opa":180}},{"type":"text","id":"text_1","x":0,"y":80,"w":120,"h":60,"config":{"static_text":"--","signal_name":"VEHICLE_SPEED","decimals":0,"rotation":0,"font":"fugaz_56","text_color":65535}},{"type":"image","id":"image_1","x":0,"y":-60,"w":120,"h":62,"config":{"image_name":"RDM","image_scale":256,"opacity":255}},{"type":"text","id":"text_2","x":0,"y":-133,"w":120,"h":30,"config":{"static_text":"--","signal_name":"RPM","decimals":0,"rotation":0,"font":"fugaz_28","text_color":65535}}],"signals":[{"name":"RPM","can_id":0,"bit_start":0,"bit_length":16,"scale":1,"offset":0,"is_signed":false,"unit":"","endian":0},{"name":"MAP","can_id":0,"bit_start":0,"bit_length":16,"scale":0.1,"offset":0,"is_signed":false,"unit":"","endian":1},{"name":"THROTTLE","can_id":0,"bit_start":0,"bit_length":16,"scale":0.1,"offset":0,"is_signed":false,"unit":"","endian":1},{"name":"COOLANT_TEMP","can_id":0,"bit_start":0,"bit_length":16,"scale":0.1,"offset":0,"is_signed":false,"unit":"","endian":1},{"name":"INTAKE_AIR_TEMP","can_id":0,"bit_start":0,"bit_length":16,"scale":0.1,"offset":0,"is_signed":false,"unit":"","endian":1},{"name":"LAMBDA","can_id":0,"bit_start":0,"bit_length":16,"scale":0.001,"offset":0,"is_signed":false,"unit":"","endian":1},{"name":"OIL_TEMP","can_id":0,"bit_start":0,"bit_length":16,"scale":0.1,"offset":0,"is_signed":false,"unit":"","endian":1},{"name":"OIL_PRESSURE","can_id":0,"bit_start":0,"bit_length":16,"scale":0.1,"offset":0,"is_signed":false,"unit":"","endian":1},{"name":"FUEL_PRESSURE","can_id":0,"bit_start":0,"bit_length":16,"scale":0.1,"offset":0,"is_signed":false,"unit":"","endian":1},{"name":"IGNITION","can_id":0,"bit_start":0,"bit_length":16,"scale":0.1,"offset":0,"is_signed":true,"unit":"","endian":0},{"name":"VEHICLE_SPEED","can_id":0,"bit_start":0,"bit_length":16,"scale":0.1,"offset":0,"is_signed":false,"unit":"","endian":1},{"name":"GEAR","can_id":0,"bit_start":0,"bit_length":16,"scale":1,"offset":0,"is_signed":false,"unit":"","endian":0},{"name":"BATTERY_VOLTAGE","can_id":0,"bit_start":0,"bit_length":16,"scale":0.01,"offset":0,"is_signed":false,"unit":"","endian":1},{"name":"FUEL_TRIM","can_id":0,"bit_start":0,"bit_length":16,"scale":0.1,"offset":0,"is_signed":true,"unit":"","endian":1},{"name":"EGT","can_id":0,"bit_start":0,"bit_length":16,"scale":0.1,"offset":0,"is_signed":false,"unit":"","endian":1}]};

    const _DEFAULT_SPLASH = {
        schema_version: 11, name: "_splash_Default", screen_w: 800, screen_h: 480,
        widgets: [
            { type:"image", id:"image_splash_0", x:0, y:0, w:120, h:62, config:{ image_name:"RDM", image_scale:256, opacity:255 }}
        ],
        signals: []
    };

    /* ── Helpers ──────────────────────────────────────────────────── */

    function _isTauri() {
        return !!(window.__TAURI_INTERNALS__ || window.__TAURI__);
    }

    /* ── Device type ───────────────────────────────────────────────────
     * The RDM family shares one wire protocol but NOT one API: a GPS puck,
     * keypad or IO node has no concept of layouts, images or fonts, and must
     * never be asked for them (rdm-gps-node/docs/USB_RPC.md).
     *
     * device.info's `device_type` is the discriminator. Dash firmware predates
     * the field, so its ABSENCE means "dash" — that default is what keeps
     * every existing device working unchanged. */
    const DEVICE_DASH = 'dash';

    /* Display names for the device types Studio can meet. Unknown types still
     * connect and report themselves — they just get no bespoke workspace. */
    const DEVICE_LABELS = {
        dash: 'RDM-7 Dash',
        gps: 'RDM GPS',
        keypad: 'RDM Keypad',
        io: 'RDM IO Expander',
    };

    /* device.info payload -> device type string, or null if this isn't one of
     * ours. A router or captive portal answering the same address returns HTML
     * or an array, never an object carrying a serial. */
    function _deviceTypeOf(info) {
        if (!info || typeof info !== 'object' || Array.isArray(info)) return null;
        if (info.device_type) return String(info.device_type);
        return ('serial' in info || 'schema' in info) ? DEVICE_DASH : null;
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

    /* Offline bench-sim on/off, persisted so the SIM pill survives a restart
     * (absent = ON; see LocalTransport.getSimulationStatus). */
    const LOCAL_SIM_KEY = 'rdm7_local_sim';

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
            if (raw) {
                const parsed = JSON.parse(raw);
                /* A stored 'default' older than schema 13 is the pre-modern
                 * seed (or a save over it) — it predates the current widget
                 * system and renders wrong. Serve the fresh seed instead. */
                if ((!name || name === 'default') && (parsed.schema_version || 0) < 13) {
                    localStorage.removeItem('rdm7_layout_default');
                } else if ((!name || name === 'default') && Array.isArray(parsed.widgets) &&
                           parsed.widgets.some(w => w && w.type === 'pathbar' && w.id === 'tach') &&
                           !parsed.widgets.some(w => w && w.type === 'rpm_bar')) {
                    /* Pre-0.4.47 the offline seed was the Ford cluster demo, so
                     * a save on 'default' persisted Ford under the default key
                     * and would shadow the real firmware default forever. Its
                     * pathbar tach (id 'tach', and no rpm_bar) is the
                     * fingerprint. Move the content aside — preserving any
                     * user edits — and let 'default' fall through to the seed. */
                    let alias = 'ford_cluster';
                    if (localStorage.getItem('rdm7_layout_' + alias)) alias = 'ford_cluster_old';
                    if (!localStorage.getItem('rdm7_layout_' + alias)) {
                        parsed.name = alias;
                        localStorage.setItem('rdm7_layout_' + alias, JSON.stringify(parsed));
                    }
                    localStorage.removeItem('rdm7_layout_default');
                } else {
                    return parsed;
                }
            }
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
            if (raw) return JSON.parse(raw);
            if (!name || name === 'Default') return JSON.parse(JSON.stringify(_DEFAULT_SPLASH));
            return null;
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
        /* Offline sim is REAL state, not a stub. There is no device to run the
         * firmware simulator, but the desktop draws its preview with the WASM
         * engine and sweeps it with a bench sim — so the SIM pill has something
         * genuine to switch. Persisted, and defaults ON: a dash with no data
         * renders as frozen no-signal gauges, which reads as broken. These were
         * previously `async toggleSimulation() {}` + a hardcoded
         * `{enabled:false}`, so the pill could never latch offline. */
        async toggleSimulation(enable) {
            const on = !!enable;
            try { localStorage.setItem(LOCAL_SIM_KEY, on ? '1' : '0'); } catch (e) { }
            return { enabled: on };
        },
        async getSimulationStatus() {
            let raw = null;
            try { raw = localStorage.getItem(LOCAL_SIM_KEY); } catch (e) { }
            return { enabled: raw === null ? true : raw === '1' };
        },
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
                /* USB/local transports carry the device's active layout on the
                 * list — wifi didn't, so every boot the header dropdown fell
                 * back to 'default' while the editor loaded the real active. */
                list._active = r.active || null;
                return list;
            },

            async loadLayout(name) {
                /* Use /api/layout/raw to read without changing the active layout on device */
                return await api('/api/layout/raw?name=' + encodeURIComponent(name || 'default'));
            },

            async setActiveLayout(name) {
                /* POST /api/layout/set with {name} — firmware calls layout_manager_set_active()
                 * then lv_async_calls the screen reload so the dashboard swaps to the new layout. */
                await api('/api/layout/set', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name }),
                });
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

            async getDeviceInfo(opts) {
                /* opts.timeout: the health check probes with a short timeout so
                 * a dead dash is noticed in seconds, not the default 10 s. */
                try { return await api('/api/device/info', opts); } catch (e) { return null; }
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
                    /* "enabled" — the HTTP handler reads exactly that key
                     * (web_server_signals.c: GetObjectItemCaseSensitive(root,
                     * "enabled")), so {enable:...} silently parsed as false and
                     * this could only ever turn the device sim OFF. Mostly
                     * latent (the editor's own fetch is passed through raw by
                     * proxyApiCall), but wrong for any direct RDM.* caller. */
                    body: JSON.stringify({ enabled: !!enable }),
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
                await api('/api/log/delete?name=' + encodeURIComponent(name), {
                    method: 'POST',
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

            async copySdFile(type, name, direction) {
                await api('/api/sd/copy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type, name, direction }),
                });
            },

            async deleteSdFile(type, name) {
                await api('/api/sd/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type, name }),
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
            async downloadLog(name) {
                try {
                    const bytes = await _tauriInvoke('serial_download_log', { name });
                    return new Blob([new Uint8Array(bytes)]);
                } catch (e) { return null; }
            },
            async deleteLog(name) { await rpc('log.delete', { name }); },

            /* ── Fuel Calibration ─────────────────────────────── */
            async getFuelStatus() {
                try { return await rpc('fuel.status'); } catch (e) { return null; }
            },
            async setFuelEmpty() { await rpc('fuel.set-empty'); },
            async setFuelFull() { await rpc('fuel.set-full'); },

            /* ── WiFi Config ──────────────────────────────────── */
            /* Same method names on the dash and the GPS node. On the node an
             * ABSENT password leaves the stored one alone (USB_RPC.md), so
             * callers must omit the key rather than send '' — see gpWifiSave. */
            async getWifiConfig() {
                try { return await rpc('wifi.config.get'); } catch (e) { return null; }
            },
            async setWifiConfig(cfg) {
                /* Returned, not swallowed: the node reports reboot_required
                 * and the UI has to be honest about it. */
                return await rpc('wifi.config.set', cfg);
            },

            /* ── GPS node (device_type "gps") ─────────────────── */
            async gpsStatus() {
                return await rpc('gps.status');
            },

            /* Flashes the status LED. Returns {ok, seconds, led_healthy};
             * led_healthy reports the RMT channel, NOT that light was emitted
             * (rdm-gps-node REV_A_ERRATA E6/E7). */
            async identify(seconds) {
                return await rpc('identify', seconds === undefined ? {} : { seconds });
            },

            /* ── Lap timing on the puck ────────────────────────────
             * The node owns a track and times its own laps, so it works with
             * no dash on the bus. Payload shapes deliberately mirror the
             * dash's HTTP lap surface — same field names, same units, same
             * "0 means unset" convention — so one client drives either. */
            /* CAN block + bitrate. Applied at boot, so a change needs a power
             * cycle — the reply says so rather than letting a caller assume
             * the new id is already on the wire. */
            async canConfigGet() { return await rpc('can.config.get'); },
            async canConfigSet(cfg) { return await rpc('can.config.set', cfg); },

            /* Mounting orientation and timezone. Unlike the CAN block these
             * take effect on the next sample, no reboot — the node applies
             * the rotation itself, so nothing downstream has to know. */
            async nodeConfigGet() { return await rpc('node.config.get'); },
            async nodeConfigSet(cfg) { return await rpc('node.config.set', cfg); },
            /* Measures the gyro's resting offset. Blocks on the node for ~2 s
             * and REFUSES if the unit was not still, so the caller must show
             * the error rather than assume success. */
            async imuCalibrate() { return await rpc('imu.calibrate'); },

            async lapStatus() { return await rpc('lap.status'); },
            /* Completed laps, oldest-first. `total` may exceed the list —
             * the node caps what it reports rather than putting the whole
             * ring on its RPC task stack. */
            async lapHistory() { return await rpc('lap.history'); },

            /* ── session trace ────────────────────────────────────
             * The recorded line at 25 Hz. Pages come back base64'd because a
             * page as JSON numbers is ~800 cJSON nodes on a node with a 4 KB
             * RPC stack — and twice the bytes on the wire. */
            async traceInfo() { return await rpc('trace.info'); },
            async traceRead(from) { return await rpc('trace.read', { from: from | 0 }); },
            async traceClear() { return await rpc('trace.clear'); },
            async traceRecord(on) { return await rpc('trace.record', { on: !!on }); },
            /* CAN channels logged beside the fix (trace format v2). Setting
             * the table clears the ring on the node — the record size just
             * changed, so old samples cannot be read under the new shape.
             * `channels` is [{can_id, start_bit, bit_len, is_signed, ext_id,
             * big_endian}, ...], same shape both directions. */
            async traceChannelsGet() { return await rpc('trace.channels.get'); },
            async traceChannelsSet(channels) { return await rpc('trace.channels.set', { channels }); },
            async lapTrackGet() { return await rpc('lap.track.get'); },
            async lapTrackSet(track) { return await rpc('lap.track.set', track); },
            async lapSessionReset() { return await rpc('lap.session.reset'); },
            async lapCapture(what, halfWidthM) {
                const p = { what };
                if (halfWidthM !== undefined) p.half_width_m = halfWidthM;
                return await rpc('lap.capture', p);
            },

            async applyToDevice(name) {
                await rpc('layout.set', { name });
            },

            async previewOnDevice(data) {
                /* Live preview — apply layout JSON on device without saving. */
                await rpc('layout.preview', { data });
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
            async getSdStatus() {
                try { return await rpc('sd.status'); } catch (e) { return null; }
            },
            async listSdFiles() {
                try { return await rpc('sd.files') || []; } catch (e) { return []; }
            },
            async copySdFile(type, name, direction) {
                await rpc('sd.copy', { type, name, direction });
            },
            async deleteSdFile(type, name) {
                await rpc('sd.delete', { type, name });
            },

            /* ── Bundle ────────────────────────────────────────── */
            async exportRdmBundle(layout) { return layout; },
            async importRdmBundle(data) { return data; },
        };
    }

    /* ═══════════════════════════════════════════════════════════════
     *  USB API proxy — maps /api/* URLs to UsbTransport methods
     * ═══════════════════════════════════════════════════════════════ */

    /* ── Local "virtual dash" router ──────────────────────────────────
     * Offline (Local) is its own dash: the firmware editor code talks to it
     * via the same /api/* calls it uses for a real device, and this serves
     * them from LocalTransport (localStorage/IndexedDB). Returns
     * { status, data }; a 404 makes the editor fall through (e.g. no live
     * /current, so loadLayout falls back to /raw?name=). */
    const LOCAL_ACTIVE_KEY = 'rdm7_local_active';
    function _bytesToB64(bytes) {
        let bin = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(bin);
    }
    function _b64ToBytes(b64) {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    async function _localRouteApiCall(url, method, body, binBody) {
        const qIdx = url.indexOf('?');
        const pathname = qIdx >= 0 ? url.slice(0, qIdx) : url;
        const qs = qIdx >= 0 ? url.slice(qIdx + 1) : '';
        const params = {};
        if (qs) qs.split('&').forEach(p => {
            const eq = p.indexOf('=');
            if (eq >= 0) params[p.slice(0, eq)] = decodeURIComponent(p.slice(eq + 1));
        });
        const T = LocalTransport;
        const ok = (data) => ({ status: 200, data: data === undefined ? { ok: true } : data });

        if (pathname === '/api/layout/list') {
            const layouts = await T.listLayouts();
            let active = localStorage.getItem(LOCAL_ACTIVE_KEY);
            if (!active || !layouts.includes(active)) active = layouts[0] || 'default';
            return ok({ layouts, active });
        }
        /* No "live in-memory" layout offline — 404 so loadLayout uses /raw. */
        if (pathname === '/api/layout/current') return { status: 404, data: '' };
        if (pathname === '/api/layout/raw') {
            const l = await T.loadLayout(params.name || 'default');
            return l ? ok(l) : { status: 404, data: '' };
        }
        if (pathname === '/api/layout/save' && method === 'POST') {
            const name = (body && body.name) || 'default';
            await T.saveLayout(name, body);
            localStorage.setItem(LOCAL_ACTIVE_KEY, name);
            return ok();
        }
        if (pathname === '/api/layout/set' && method === 'POST') {
            if (body && body.name) localStorage.setItem(LOCAL_ACTIVE_KEY, body.name);
            return ok();
        }
        if (pathname === '/api/layout/delete') {
            const nm = params.name || (body && body.name);   /* editor sends name in the body */
            if (nm) await T.deleteLayout(nm);
            return ok();
        }
        if (pathname === '/api/layout/rename' && method === 'POST') {
            /* The editor (and the firmware endpoint) speak {old_name,new_name};
             * this route only read {from,to}, so offline renames silently
             * no-opped. Accept both shapes. */
            const from = body && (body.old_name || body.from);
            const to = body && (body.new_name || body.to);
            if (from && to) {
                await T.renameLayout(from, to);
                if (localStorage.getItem(LOCAL_ACTIVE_KEY) === from)
                    localStorage.setItem(LOCAL_ACTIVE_KEY, to);
            }
            return ok();
        }
        if (pathname === '/api/layout/version') return ok({ version: 0 });
        if (pathname === '/api/image/list') return ok(await T.listImages());
        if (pathname === '/api/font/list') {
            /* firmware: bare array of family names; ?details=1 → [{name,size}] */
            const fonts = await T.listFonts();
            if (params.details === '1') return ok(fonts.map(f => typeof f === 'string' ? { name: f, size: 0 } : f));
            return ok(fonts.map(f => typeof f === 'string' ? f : f.name));
        }
        /* Font / image binary I/O — the editor uploads via raw fetch (octet-stream
           body), which arrives here as binBody. Store it so the WASM preview can
           render it and it survives to "This PC". */
        if (pathname === '/api/font/upload' && method === 'POST') {
            if (binBody && binBody.length && params.name) {
                await T.setFontData(params.name, _bytesToB64(binBody));
                await T.addFontMeta({ name: params.name, size: binBody.length });
            }
            return ok();
        }
        if (pathname === '/api/image/upload' && method === 'POST') {
            if (binBody && binBody.length && params.name) {
                await T.setImageData(params.name, _bytesToB64(binBody));
                await T.addImageMeta({ name: params.name, size: binBody.length });
            }
            return ok();
        }
        if (pathname === '/api/font/data' && params.name) {
            const b64 = await T.getFontData(params.name);
            return b64 ? { status: 200, binary: _b64ToBytes(b64) } : { status: 404, data: '' };
        }
        if (pathname === '/api/image/data' && params.name) {
            const b64 = await T.getImageData(params.name);
            return b64 ? { status: 200, binary: _b64ToBytes(b64) } : { status: 404, data: '' };
        }
        if (pathname === '/api/font/delete' && params.name) { await T.deleteFont(params.name); return ok(); }
        if (pathname === '/api/image/delete' && params.name) { await T.deleteImage(params.name); return ok(); }
        if (pathname === '/api/signals/values') return ok({ signals: [] });
        /* Sim toggle. Without this the path fell through to the catch-all
         * `ok({ok:true})` at the bottom: the POST looked like it worked, but the
         * GET carried no `enabled`, so the editor's _pollSimState() read
         * undefined and forced the pill OFF at boot — while the WASM bench sim
         * swept regardless. The editor speaks the firmware's HTTP contract
         * (web_server_signals.c), so read/emit `enabled`, NOT `enable` (that is
         * the serial contract). */
        if (pathname === '/api/signal/simulate') {
            if (method === 'POST') return ok(await T.toggleSimulation(body && body.enabled));
            return ok(await T.getSimulationStatus());
        }
        if (pathname === '/api/storage/info') {
            /* Rough localStorage/IndexedDB budget — enough for the UI meter. */
            return ok({ total: 8 * 1024 * 1024, used: 0, free: 8 * 1024 * 1024, maxBytes: 8 * 1024 * 1024, totalBytes: 0 });
        }
        if (pathname === '/api/device/info') {
            return ok({ serial: 'LOCAL', name: 'This PC', schema: 17, offline: true,
                        display: { width: 800, height: 480, shape: 'rect' } });
        }
        if (pathname === '/api/selftest') return ok({ ok: true, offline: true });
        /* Device-only families (CAN, OTA, channels, dimmer, …): harmless no-op. */
        return ok({ ok: true });
    }

    /* Endpoint families that only a dash implements. On any other RDM node
     * these RPCs don't exist, so forwarding them just produces a stream of
     * "unknown method" errors from the editor's boot-time fetches. */
    const _DASH_ONLY_API = /^\/api\/(layout|splash|image|font|signal|signals|fuel|sd|log|brightness|dimmer|ecu|indicator|warning|replay|gear|presets|screenshot|touch)\b/;

    /* Replies for the editor's own background fetches while a non-dash node is
     * connected, so they degrade quietly instead of erroring every tick. */
    function _nonDashApiStub(pathname) {
        /* Collections: empty is the TRUTHFUL answer — this node has none. */
        if (pathname === '/api/layout/list') { const l = []; l._active = null; return l; }
        if (pathname === '/api/image/list') return { images: [] };
        if (pathname === '/api/font/list') return { fonts: [] };
        if (pathname === '/api/splash/list') return { splashes: [] };
        if (pathname === '/api/log/list' || pathname === '/api/sd/files') return [];
        /* Anything that would hand back a LAYOUT has to fail outright: a
         * placeholder object would be fed straight into the renderer. */
        if (/^\/api\/(layout|splash)\//.test(pathname)) {
            throw new Error('not available on ' + RDM.deviceLabel());
        }
        return { ok: true };
    }

    async function _usbRouteApiCall(url, method, body, t, binBody) {
        const qIdx = url.indexOf('?');
        const pathname = qIdx >= 0 ? url.slice(0, qIdx) : url;
        const qs = qIdx >= 0 ? url.slice(qIdx + 1) : '';
        const params = {};
        if (qs) qs.split('&').forEach(p => {
            const eq = p.indexOf('=');
            if (eq >= 0) params[p.slice(0, eq)] = decodeURIComponent(p.slice(eq + 1));
        });

        /* device.info is how a caller LEARNS the type, so it must always go
         * through — only the dash-only families are short-circuited. */
        if (RDM.deviceType !== DEVICE_DASH && _DASH_ONLY_API.test(pathname)) {
            return _nonDashApiStub(pathname);
        }

        if (pathname === '/api/layout/list') return t.listLayouts();
        if (pathname === '/api/layout/current') return t.loadCurrentLayout ? t.loadCurrentLayout() : null;
        if (pathname === '/api/layout/raw') return t.loadLayout(params.name || 'default');
        if (pathname === '/api/layout/save' && method === 'POST') {
            await t.saveLayout(body.name || 'default', body); return { ok: true };
        }
        if (pathname === '/api/layout/set' && method === 'POST') {
            await t.setActiveLayout(body.name); return { ok: true };
        }
        if (pathname === '/api/layout/delete' && method === 'POST') {
            await t.deleteLayout(body.name); return { ok: true };
        }
        if (pathname === '/api/layout/rename' && method === 'POST') {
            await t.renameLayout(body.old_name, body.new_name); return { ok: true };
        }
        if (pathname === '/api/layout/preview' && method === 'POST') {
            await t.previewOnDevice(body); return { ok: true };
        }
        if (pathname === '/api/layout/version') return t.testConnection();
        if (pathname === '/api/device/info') return t.getDeviceInfo();
        if (pathname === '/api/image/list') return { images: await t.listImages() };
        if (pathname === '/api/font/list') return { fonts: await t.listFonts() };
        if (pathname === '/api/font/upload' && method === 'POST') {
            if (binBody && binBody.length && params.name) await t.setFontData(params.name, _bytesToB64(binBody));
            return { ok: true };
        }
        if (pathname === '/api/image/upload' && method === 'POST') {
            if (binBody && binBody.length && params.name) await t.setImageData(params.name, _bytesToB64(binBody));
            return { ok: true };
        }
        if (pathname === '/api/font/data' && params.name) { const b = await t.getFontData(params.name); return b ? _b64ToBytes(b) : null; }
        if (pathname === '/api/image/data' && params.name) { const b = await t.getImageData(params.name); return b ? _b64ToBytes(b) : null; }
        if (pathname === '/api/font/delete' && params.name) { await t.deleteFont(params.name); return { ok: true }; }
        if (pathname === '/api/image/delete' && params.name) { await t.deleteImage(params.name); return { ok: true }; }
        if (pathname === '/api/storage/info') return t.getStorageInfo();
        if (pathname === '/api/signals/values') return t.getSignalValues();
        if (pathname === '/api/signal/simulate') {
            /* Contract translation, HTTP -> serial. The editor speaks the
             * firmware's HTTP shape ({enabled} in, {enabled} out —
             * web_server_signals.c), but the serial RPC uses a DIFFERENT shape
             * ({enable} in, {active} out — serial_commands_signals.c). This
             * read `body.enable`, which is never present in the editor's POST,
             * so USB always toggled the sim OFF; and it returned the raw
             * {active} that the editor's _pollSimState() (reading .enabled)
             * could never see. Translate both directions. */
            if (method === 'POST') {
                await t.toggleSimulation(body && body.enabled);
                return { enabled: !!(body && body.enabled) };
            }
            const s = await t.getSimulationStatus();
            return { enabled: !!(s && (s.enabled !== undefined ? s.enabled : s.active)) };
        }
        if (pathname === '/api/signal/inject' && method === 'POST') {
            await t.injectSignal(body.name, body.value); return { ok: true };
        }
        if (pathname === '/api/signal/clear') return { ok: true };
        if (pathname === '/api/fuel/status') return t.getFuelStatus();
        if (pathname === '/api/fuel/set-empty') { await t.setFuelEmpty(); return { ok: true }; }
        if (pathname === '/api/fuel/set-full') { await t.setFuelFull(); return { ok: true }; }
        if (pathname === '/api/splash/list') return { splashes: await t.listSplashes() };
        if (pathname === '/api/splash/set') return { ok: true };
        if (pathname === '/api/splash/fade') return { ok: true };
        if (pathname === '/api/splash/delete') { await t.deleteSplash(body.name); return { ok: true }; }
        if (pathname === '/api/sd/files') return { files: await t.listSdFiles() };
        if (pathname === '/api/sd/copy') { await t.copySdFile(body.type, body.name, body.direction); return { ok: true }; }
        if (pathname === '/api/sd/delete') { await t.deleteSdFile(body.type, body.name); return { ok: true }; }
        if (pathname === '/api/system/health') return t.getSystemHealth();
        if (pathname === '/api/log/status') return t.getLogStatus();
        if (pathname === '/api/log/list') return await t.listLogs();
        if (pathname === '/api/log/start') { await t.startLogging(); return { ok: true }; }
        if (pathname === '/api/log/stop') { await t.stopLogging(); return { ok: true }; }
        if (pathname === '/api/log/delete') { await t.deleteLog(params.name); return { ok: true }; }
        if (pathname === '/api/brightness') {
            if (method === 'POST') { await t.setBrightness(body.brightness); return { ok: true }; }
            return t.getBrightness();
        }
        if (pathname === '/api/screenshot' || pathname === '/api/touch') return null;
        if (pathname.startsWith('/api/can/')) return { ok: true };
        if (pathname.startsWith('/api/ecu/')) return { ok: true };
        if (pathname.startsWith('/api/presets')) return {};
        if (pathname.startsWith('/api/ota/')) return { ok: true };
        if (pathname.startsWith('/api/indicator/') || pathname.startsWith('/api/warning/')) return { ok: true };
        if (pathname.startsWith('/api/replay/')) return { ok: true };
        if (pathname.startsWith('/api/gear/')) return { ok: true };
        if (pathname.startsWith('/api/wifi/')) return { ok: true };
        if (pathname.startsWith('/api/dimmer/')) return { ok: true };
        throw new Error('USB: unmapped endpoint: ' + pathname);
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

        /* What the far end actually IS, from device.info. Defaults to 'dash'
         * so nothing changes until a device says otherwise; re-probed on every
         * connect and reset by setMode. */
        deviceType: DEVICE_DASH,
        DEVICE_LABELS,

        isDash() { return this.deviceType === DEVICE_DASH; },

        deviceLabel() {
            return DEVICE_LABELS[this.deviceType] || this.deviceType || 'device';
        },

        /* ── Attached devices ─────────────────────────────────────────
         * `mode`/`_transport` is the PRIMARY connection — the dash, i.e. the
         * thing the layout editor and every /api/* call address. Other RDM
         * devices attach ALONGSIDE it, keyed by role, because they live on
         * different pipes: a dash on WiFi and a puck on USB are two
         * independent links and Studio has no reason to force a choice.
         *
         * Before this, connecting the puck REPLACED the dash transport, so
         * lap timing — which needs the dash's engine and the puck's position
         * — could never be seen in one place. */
        _attached: Object.create(null),        /* role -> {transport, info} */
        _dashInfo: null,                       /* device.info of the primary */

        attach(role, transport, info) {
            if (!role || !transport) return;
            this._attached[role] = { transport, info: info || null };
            this._notifyListeners();
        },

        detach(role) {
            if (this._attached[role]) {
                delete this._attached[role];
                this._notifyListeners();
            }
        },

        /* Transport for a role, or null. 'dash' resolves to the primary. */
        get(role) {
            if (role === DEVICE_DASH) {
                return (this.mode !== 'local' && this.isDash()) ? this._transport : null;
            }
            const a = this._attached[role];
            return a ? a.transport : null;
        },

        /* Cached device.info for a role, or null. */
        infoFor(role) {
            if (role === DEVICE_DASH) return this._dashInfo;
            const a = this._attached[role];
            return a ? a.info : null;
        },

        attachedRoles() { return Object.keys(this._attached); },

        /* Ask the device what it is. Returns {info, type}; type is null when
         * nothing recognisable answered. Call this BEFORE any dash-only
         * request — that ordering is the whole point (USB_RPC.md). */
        async probeDeviceType(opts) {
            const info = await this.getDeviceInfo(opts);
            const type = _deviceTypeOf(info);
            this.deviceType = type || DEVICE_DASH;
            if (type === DEVICE_DASH) this._dashInfo = info;
            return { info, type };
        },

        /* ── Connection Management ───────────────────────────── */
        get transport() { return this._transport; },

        /* The local store is always reachable regardless of the active
         * transport — layout transfer reads/writes both the device and the
         * local "offline dash" at once. */
        get local() { return LocalTransport; },
        /* The device transport when connected, else null. */
        deviceTransport() { return this.mode !== 'local' ? this._transport : null; },

        setMode(mode, opts) {
            opts = opts || {};
            this.mode = mode;
            /* Stale type = the previous device's API applied to this one.
             * Back to the safe default until the new link is probed.
             * Attached devices are deliberately NOT cleared — they're on
             * their own pipes and changing the dash link says nothing
             * about whether a puck is still plugged in. */
            this.deviceType = DEVICE_DASH;
            this._dashInfo = null;

            if (mode === 'local') {
                this._transport = LocalTransport;
                /* Persist the choice like every other mode does. Without this
                 * the stored mode stayed 'wifi', so _restoreConnection() ran
                 * _autoConnectWifi() on the next launch and forced the app back
                 * into WiFi — hunting a dash that may be off, while the user
                 * had deliberately picked Offline. _saveSettings REPLACES the
                 * object, so carry ip/port/serial over: choosing WiFi again
                 * should still remember which dash it was. */
                const prev = _loadSettings();
                _saveSettings({ ...prev, mode: 'local' });
            } else if (mode === 'wifi') {
                const ip = opts.ip || '192.168.1.1';
                const port = opts.port || 80;
                const url = `http://${ip}:${port}`;
                this._transport = createWifiTransport(url);
                /* serial: remembered so reconnect can re-find this exact dash
                 * by identity after a DHCP address change. */
                const prev = _loadSettings();
                _saveSettings({ mode, ip, port, serial: opts.serial || (prev.ip === ip ? prev.serial : undefined) });
            } else if (mode === 'hotspot') {
                const url = 'http://192.168.4.1';
                this._transport = createWifiTransport(url);
                /* Carry ip/port/serial over — _saveSettings REPLACES, so the
                 * bare {mode} this used to write erased the remembered dash and
                 * broke WiFi reconnect-by-serial after any hotspot excursion. */
                _saveSettings({ ..._loadSettings(), mode });
            } else if (mode === 'usb') {
                const portName = opts.portName || '';
                this._transport = createUsbTransport(portName);
                _saveSettings({ ..._loadSettings(), mode, portName });
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
        /* HTTP subnet sweep (firmware has no mDNS). extraIps are probed
         * first — pass last-known addresses for fast rediscovery. */
        async discoverDevices(extraIps) {
            if (!_isTauri()) return [];
            try {
                return await _tauriInvoke('discover_devices', { extraIps: extraIps || [] });
            } catch (e) {
                console.warn('Device discovery failed:', e);
                return [];
            }
        },

        /* Probe one IP for an RDM-7. Resolves to a DiscoveredDevice
         * ({ip, serial, hostname, schema, ...}) or null. */
        async probeDevice(ip, timeoutMs) {
            if (!_isTauri() || !ip) return null;
            try {
                return await _tauriInvoke('probe_device', { ip, timeoutMs: timeoutMs || 1500 });
            } catch (e) {
                return null;
            }
        },

        /* ── Known-device memory (keyed by serial, most recent first) ── */
        getKnownDevices() {
            try {
                return JSON.parse(localStorage.getItem('rdm7_known_devices')) || [];
            } catch (e) { return []; }
        },

        rememberDevice(dev) {
            if (!dev || !dev.serial) return;
            const list = this.getKnownDevices().filter(d => d.serial !== dev.serial);
            list.unshift({
                serial: dev.serial,
                ip: dev.ip,
                hostname: dev.hostname || '',
                lastSeen: Date.now()
            });
            try {
                localStorage.setItem('rdm7_known_devices', JSON.stringify(list.slice(0, 8)));
            } catch (e) { }
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

        /* Open a serial port and file whatever answers under its own role.
         * A dash becomes the PRIMARY connection (unchanged behaviour); any
         * other RDM device attaches alongside, leaving the dash link — WiFi
         * or Offline — exactly as it was.
         *
         * Returns {role, info}. Throws if nothing recognisable answers, so a
         * dead port can't masquerade as a successful connect.
         *
         * Note the backend holds ONE serial port, so a USB dash and a USB
         * puck are mutually exclusive. Dash-on-WiFi + puck-on-USB, the normal
         * case, works fine. */
        async serialConnectDevice(portName) {
            if (!_isTauri()) throw new Error('Serial requires desktop app');
            /* The backend owns ONE serial port, so opening a new one silently
             * re-points whatever was attached over USB. Drop those roles first
             * or they linger as live-looking entries pointing at a port that is
             * now someone else's — and a "save" in that workspace would go to
             * the wrong device. */
            for (const role of this.attachedRoles()) {
                const a = this._attached[role];
                if (a && a.transport && a.transport.name === 'usb') this.detach(role);
            }
            await _tauriInvoke('serial_connect', { portName });
            const t = createUsbTransport(portName);
            let info = null;
            try { info = await t.getDeviceInfo(); } catch (e) { info = null; }
            const role = _deviceTypeOf(info);
            if (!role) {
                try { await _tauriInvoke('serial_disconnect'); } catch (e) { }
                throw new Error('No RDM device answered on ' + portName);
            }
            if (role === DEVICE_DASH) {
                this.setMode('usb', { portName });
                this._dashInfo = info;
            } else {
                this.attach(role, t, info);
            }
            return { role, info };
        },

        /* Release an attached (non-primary) device and its serial port. */
        async detachDevice(role) {
            const t = this.get(role);
            this.detach(role);
            if (t && t.name === 'usb' && this.mode !== 'usb') {
                try { await _tauriInvoke('serial_disconnect'); } catch (e) { }
            }
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
        async getDeviceInfo(opts) { return this._transport.getDeviceInfo(opts); },
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

        /* ── GPS node ─────────────────────────────────────────────
         * Role-addressed, never via the primary transport: the puck is an
         * ATTACHED device and the dash is what `_transport` points at.
         * Config/diagnostics only — CAN remains the data path (ADR-0008). */
        gpsTransport() { return this.get('gps'); },

        async gpsStatus() {
            const t = this.get('gps');
            if (!t) throw new Error('No RDM GPS attached');
            return t.gpsStatus();
        },
        async identify(seconds) {
            const t = this.get('gps');
            if (!t) throw new Error('No RDM GPS attached');
            return t.identify(seconds);
        },
        async applyToDevice(n) { return this._transport.applyToDevice(n); },
        async previewOnDevice(d) { return this._transport.previewOnDevice(d); },
        async testConnection() { return this._transport.testConnection(); },

        async uploadFirmware(d, p) { return this._transport.uploadFirmware(d, p); },
        async getOtaStatus() { return this._transport.getOtaStatus(); },

        async getSdStatus() { return this._transport.getSdStatus(); },
        async listSdFiles() { return this._transport.listSdFiles(); },
        async copySdFile(type, name, direction) { return this._transport.copySdFile(type, name, direction); },
        async deleteSdFile(type, name) { return this._transport.deleteSdFile(type, name); },

        async exportRdmBundle(l) { return this._transport.exportRdmBundle(l); },
        async importRdmBundle(d) { return this._transport.importRdmBundle(d); },

        /* ── API proxy — routes raw /api/* fetches through the active transport ── */
        async proxyApiCall(url, init) {
            const method = (init && init.method) || 'GET';
            /* A binary upload body (font/image octet-stream) must survive as raw
               bytes. The old code JSON.stringify'd it → "{}" for an ArrayBuffer,
               which silently destroyed every font/image the editor uploaded. */
            let binBody = null;
            if (init && init.body != null && typeof init.body !== 'string') {
                const b = init.body;
                if (b instanceof ArrayBuffer) binBody = new Uint8Array(b);
                else if (ArrayBuffer.isView(b)) binBody = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
                else if (typeof Blob !== 'undefined' && b instanceof Blob) binBody = new Uint8Array(await b.arrayBuffer());
            }
            let bodyText = null;
            if (binBody == null && init && init.body) {
                bodyText = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
            }
            let bodyObj = null;
            if (bodyText) { try { bodyObj = JSON.parse(bodyText); } catch (e) { bodyObj = null; } }

            const makeResp = (data, status) => {
                const s = status || 200;
                const text = typeof data === 'string' ? data : JSON.stringify(data);
                return {
                    ok: s >= 200 && s < 300, status: s,
                    headers: { get: (h) => h.toLowerCase() === 'content-type' ? 'application/json' : null },
                    text: () => Promise.resolve(text),
                    json: () => Promise.resolve(typeof data === 'object' && data !== null ? data : JSON.parse(text)),
                    blob: () => Promise.resolve(new Blob([text])),
                };
            };

            const t = this._transport;
            if (t.name === 'wifi' || t.name === 'hotspot') {
                const fullUrl = (t.baseUrl || 'http://192.168.4.1') + url;
                /* Binary UPLOAD (font/image octet-stream POST) — send the raw
                 * bytes, never a JSON string. */
                if (binBody) {
                    try {
                        const respText = await _tauriInvoke('http_upload_binary', {
                            url: fullUrl, data: Array.from(binBody), timeout_ms: 30000,
                        });
                        return makeResp(respText || { ok: true }, 200);
                    } catch (e) {
                        return makeResp({ error: String(e) }, 0);
                    }
                }
                /* Binary DOWNLOAD (screenshot / font-data / image-data) must NOT
                 * go through http_fetch — its Rust-String body mangles the bytes
                 * (this broke CONTROL's mirror and custom-font preview). Fetch
                 * losslessly and hand back a real Response so .blob()/.arrayBuffer
                 * Just Work. */
                if (method === 'GET' && /^\/api\/(screenshot|font\/data|image\/data)(\?|$)/.test(url)) {
                    try {
                        const bytes = await _tauriInvoke('http_fetch_binary', {
                            url: fullUrl, timeout_ms: 15000,
                        });
                        const type = /screenshot/.test(url) ? 'image/jpeg' : 'application/octet-stream';
                        return new Response(new Blob([new Uint8Array(bytes)], { type }), { status: 200 });
                    } catch (e) {
                        return makeResp({ error: String(e) }, 0);
                    }
                }
                try {
                    const resp = await _tauriInvoke('http_fetch', {
                        req: { url: fullUrl, method, body: bodyText, timeout_ms: 15000 }
                    });
                    return makeResp(resp.body, resp.status);
                } catch (e) {
                    return makeResp({ error: String(e) }, 0);
                }
            }
            if (t.name === 'usb') {
                try {
                    const result = await _usbRouteApiCall(url, method, bodyObj, t, binBody);
                    if (result instanceof Uint8Array) return new Response(new Blob([result]), { status: 200 });
                    return makeResp(result);
                } catch (e) {
                    return makeResp({ error: String(e) }, 503);
                }
            }
            /* Local (offline) — serve from the virtual local dash. */
            try {
                const r = await _localRouteApiCall(url, method, bodyObj, binBody);
                if (r && r.binary) return new Response(new Blob([r.binary], { type: r.type || 'application/octet-stream' }), { status: r.status || 200 });
                return makeResp(r.data, r.status);
            } catch (e) {
                return makeResp({ error: String(e) }, 500);
            }
        },

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
        async openFileDialog(filters, opts) {
            opts = opts || {};
            if (!_isTauri()) return null;
            try {
                const result = await _tauriInvoke('plugin:dialog|open', {
                    options: {
                        multiple: !!opts.multiple,
                        filters: filters || [],
                    }
                });
                if (!result) return null;
                /* Tauri v2 may return {path: "..."} or a plain string */
                const one = (r) => (typeof r === 'string' ? r : (r && (r.path || r)));
                /* opts.multiple -> always an array (callers that omit it keep
                 * getting a single path, unchanged). */
                if (opts.multiple) {
                    return (Array.isArray(result) ? result : [result]).map(one).filter(Boolean);
                }
                return one(Array.isArray(result) ? result[0] : result);
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

    /* ── fetch interceptor: route /api/* through RDM transport when in Tauri ──
       Without this, firmware's raw fetch('/api/...') calls resolve to
       tauri://localhost/api/... instead of the connected device.
       Local mode is ALSO routed — through the virtual local-dash server in
       proxyApiCall — so the firmware editor's raw fetch('/api/...') calls
       (layout list/load/save, etc.) work offline against the local store
       instead of 404ing on the tauri.localhost origin. */
    if (typeof window.__TAURI_INTERNALS__ !== 'undefined' || typeof window.__TAURI__ !== 'undefined') {
        const _origFetch = window.fetch.bind(window);
        window.fetch = async function(input, init) {
            const url = typeof input === 'string' ? input
                : (input instanceof Request ? input.url : String(input));
            if (url.startsWith('/api/')) {
                return RDM.proxyApiCall(url, init);
            }
            return _origFetch(input, init);
        };
    }
})();
