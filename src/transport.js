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
     * paired: the Ford cluster demo (firmware tools/ford_cluster.json,
     * schema v15 — migrated on load). The previous seed was a schema-v11
     * relic that predated the modern widget system and rendered wrong. */
    const _DEFAULT_LAYOUT = {"schema_version":15,"name":"default","screen_w":800,"screen_h":480,"signals":[{"name":"GEAR","value_map":[{"v":0,"label":"N"}]},{"name":"FUEL_SENDER_V","fuel_cal":{"empty_v":0.5,"full_v":3,"full_value":100,"enabled":false}}],"widgets":[{"type":"pathbar","id":"tach","x":-150,"y":-50,"w":500,"h":315,"config":{"signal_name":"RPM","max":8000,"redline":6500,"band_width":34,"shape":4,"hook_angle":142,"rounded":false,"fade_fill":true,"dim_color":2277,"lit_color":13854,"redline_color":57861,"dim_opa":210,"smoothing_ms":90,"smooth":true,"show_ticks":true,"minor_tick_step":250,"major_tick_step":1000,"show_labels":true,"tick_label_divisor":1000,"tick_len":16,"major_tick_len":34,"tick_color":27568,"label_gap":22,"label_font":"Montserrat:26"},"signal":"RPM"},{"type":"text","id":"gear_lbl","x":-212,"y":-38,"w":150,"h":22,"config":{"slot":0,"decimals":0,"static_text":"GEAR","font":"Montserrat:17","text_color":36020}},{"type":"text","id":"gear_val","x":-217,"y":0,"w":140,"h":80,"config":{"slot":0,"decimals":0,"static_text":"4","font":"Montserrat:62"}},{"type":"text","id":"rpm_x","x":-185,"y":100,"w":170,"h":18,"config":{"slot":0,"decimals":0,"static_text":"RPM x1000","font":"Montserrat:14","text_color":36020}},{"type":"meter","id":"speed_scale","x":250,"y":-18,"w":300,"h":300,"config":{"slot":0,"min":0,"max":160,"start_angle":135,"end_angle":45,"signal_name":"VEHICLE_SPEED","minor_tick_length":16,"major_tick_length":34,"minor_tick_color":27568,"show_needle":false,"show_needle_ball":false,"meter_bg_opa":0,"scale_padding":24,"label_gap":6,"smoothing_ms":80,"tick_label_font":"Montserrat:24","show_ticks":true,"show_tick_labels":true,"minor_tick_count":33,"major_tick_every":4,"minor_tick_width":2,"major_tick_width":4,"major_tick_color":65535,"mid_tick_step":0,"tick_label_divisor":1,"start_angle_user":225,"sweep_degrees":270,"auto_ticks":false,"minor_tick_step":5,"major_tick_step":20,"reverse":false},"signal":"VEHICLE_SPEED"},{"type":"arc","id":"speed_fill","x":250,"y":-18,"w":300,"h":300,"config":{"arc_width":22,"arc_color":13854,"bg_arc_color":2277,"bg_arc_width":22,"fade_fill":true,"signal_name":"VEHICLE_SPEED","signal_max":160,"smoothing_ms":80,"minor_tick_step":10,"major_tick_step":50,"auto_ticks":false,"start_angle_user":225,"sweep_degrees":270,"minor_tick_count":17,"major_tick_every":5,"start_angle":135,"end_angle":45,"rules":[{"signal_name":"","op":">","threshold":0,"overrides":[]},{"signal_name":"GEAR","op":">","threshold":3,"overrides":[{"field":"arc_color","type":"color","value":63488},{"field":"arc_width","type":"number","value":7}]}]},"signal":"VEHICLE_SPEED"},{"type":"text","id":"speed_val","x":250,"y":-6,"w":170,"h":92,"config":{"slot":0,"decimals":0,"signal_name":"VEHICLE_SPEED","font":"Montserrat:74"},"signal":"VEHICLE_SPEED"},{"type":"arc","id":"oilp","x":-90,"y":-55,"w":64,"h":64,"config":{"arc_offset":3,"arc_color":13854,"bg_arc_color":2277,"fade_fill":true,"signal_name":"OIL_PRESSURE","signal_min":100,"signal_max":300,"smoothing_ms":80,"redline_color":57861,"redline_arc_width":4,"minor_tick_step":10,"major_tick_step":50,"show_ticks":false,"show_labels":false,"redline_threshold":270,"redline_enabled":true,"auto_ticks":false,"start_angle_user":225,"sweep_degrees":270,"minor_tick_count":21,"major_tick_every":5,"start_angle":135,"end_angle":45},"signal":"OIL_PRESSURE"},{"type":"arc","id":"ect","x":-15,"y":-55,"w":64,"h":64,"config":{"arc_offset":3,"arc_color":13854,"bg_arc_color":2277,"fade_fill":true,"signal_name":"COOLANT_TEMP","signal_max":120,"smoothing_ms":80,"redline_color":57861,"redline_arc_width":4,"arc_alerts_enabled":true,"minor_tick_step":10,"major_tick_step":50,"show_ticks":false,"show_labels":false,"redline_threshold":110,"redline_enabled":true,"auto_ticks":false,"start_angle_user":225,"sweep_degrees":270,"minor_tick_count":13,"major_tick_every":5,"start_angle":135,"end_angle":45},"signal":"COOLANT_TEMP"},{"type":"arc","id":"oilt","x":60,"y":-55,"w":64,"h":64,"config":{"arc_offset":3,"arc_color":13854,"bg_arc_color":2277,"fade_fill":true,"signal_name":"OIL_TEMP","signal_min":140,"signal_max":340,"smoothing_ms":80,"redline_color":57861,"redline_arc_width":4,"minor_tick_step":10,"major_tick_step":50,"show_ticks":false,"show_labels":false,"redline_threshold":310,"redline_enabled":true,"auto_ticks":false,"start_angle_user":225,"sweep_degrees":270,"minor_tick_count":21,"major_tick_every":5,"start_angle":135,"end_angle":45},"signal":"OIL_TEMP"},{"type":"line","id":"divider","x":90,"y":112,"w":420,"h":2,"config":{"line_color":36020,"line_opa":80}},{"type":"text","id":"odo","x":-140,"y":150,"w":170,"h":22,"config":{"slot":0,"decimals":1,"signal_name":"ODOMETER","channel":"odometer","font":"Montserrat:17","text_color":36020},"signal":"ODOMETER","channel":"odometer"},{"type":"text","id":"prnd_p","x":-16,"y":150,"w":20,"h":22,"config":{"slot":0,"decimals":0,"static_text":"P","font":"Montserrat:17","text_color":27568}},{"type":"text","id":"prnd_r","x":7,"y":150,"w":20,"h":22,"config":{"slot":0,"decimals":0,"static_text":"R","font":"Montserrat:17","text_color":27568}},{"type":"text","id":"prnd_n","x":30,"y":150,"w":20,"h":22,"config":{"slot":0,"decimals":0,"static_text":"N","font":"Montserrat:17","text_color":27568}},{"type":"text","id":"prnd_d","x":53,"y":150,"w":20,"h":22,"config":{"slot":0,"decimals":0,"static_text":"D","font":"Montserrat:18","text_color":57861}},{"type":"text","id":"prnd_s","x":76,"y":150,"w":20,"h":22,"config":{"slot":0,"decimals":0,"static_text":"S","font":"Montserrat:17","text_color":27568}},{"type":"text","id":"c_c","x":-388,"y":196,"w":18,"h":18,"config":{"slot":0,"decimals":0,"static_text":"C","font":"Montserrat:13","text_color":36020}},{"type":"bar","id":"c_bar","x":-57,"y":345,"w":220,"h":85,"config":{"slot":0,"label":" ","bar_min":0,"bar_max":120,"smoothing_ms":80,"anchor_value":50,"bar_low_color":31,"bar_high_color":57861,"bar_in_range_color":13854,"grad_stops":[{"pos":0,"color":9366},{"pos":100,"color":13854}],"show_bar_value":false,"invert_bar_value":false,"signal_name":"COOLANT_TEMP","bar_bg_color":6438,"bar_radius":3,"bar_border_width":0,"bar_border_color":10597,"indicator_radius":3,"label_color":65535,"value_color":65535,"fill_edge_width":5,"fill_edge_color":65535},"signal":"COOLANT_TEMP"},{"type":"text","id":"c_h","x":-212,"y":196,"w":18,"h":18,"config":{"slot":0,"decimals":0,"static_text":"H","font":"Montserrat:13","text_color":36020}},{"type":"text","id":"f_e","x":212,"y":196,"w":18,"h":18,"config":{"slot":0,"decimals":0,"static_text":"E","font":"Montserrat:13","text_color":36020}},{"type":"bar","id":"f_bar","x":300,"y":196,"w":150,"h":12,"config":{"slot":0,"label":" ","bar_min":0,"bar_max":100,"smoothing_ms":80,"bar_low_color":31,"bar_high_color":63488,"bar_in_range_color":13854,"grad_stops":[{"pos":0,"color":9366},{"pos":100,"color":13854}],"show_bar_value":false,"invert_bar_value":false,"fill_dir":1,"signal_name":"FUEL_LEVEL","bar_bg_color":6438,"bar_radius":3,"bar_border_width":0,"bar_border_color":10597,"indicator_radius":3,"label_color":65535,"value_color":65535,"fill_edge_width":5,"fill_edge_color":65535},"signal":"FUEL_LEVEL"},{"type":"text","id":"f_f","x":388,"y":196,"w":18,"h":18,"config":{"slot":0,"decimals":0,"static_text":"F","font":"Montserrat:13","text_color":36020}},{"type":"text","id":"amb","x":320,"y":-210,"w":120,"h":20,"config":{"slot":0,"decimals":0,"static_text":"80\u00b0F","font":"Montserrat:16","text_color":36020}},{"type":"image","id":"oilp_ic","x":-90,"y":-58,"w":26,"h":26,"config":{"image_name":"ic_oilp","image_scale":108,"opacity":255,"recolor":0,"recolor_opa":0}},{"type":"text","id":"oilp_lo","x":-112,"y":-23,"w":30,"h":15,"config":{"decimals":0,"static_text":"100","font":"Montserrat:12","text_color":36020}},{"type":"text","id":"oilp_hi","x":-68,"y":-23,"w":30,"h":15,"config":{"decimals":0,"static_text":"300","font":"Montserrat:12","text_color":36020}},{"type":"image","id":"ect_ic","x":-15,"y":-58,"w":26,"h":26,"config":{"image_name":"ic_ect","image_scale":108,"opacity":255,"recolor":0,"recolor_opa":0}},{"type":"text","id":"ect_lo","x":-37,"y":-23,"w":30,"h":15,"config":{"decimals":0,"static_text":"L","font":"Montserrat:12","text_color":36020}},{"type":"text","id":"ect_hi","x":7,"y":-23,"w":30,"h":15,"config":{"decimals":0,"static_text":"H","font":"Montserrat:12","text_color":36020}},{"type":"image","id":"oilt_ic","x":60,"y":-58,"w":26,"h":26,"config":{"image_name":"ic_oilt","image_scale":108,"opacity":255,"recolor":0,"recolor_opa":0}},{"type":"text","id":"oilt_lo","x":38,"y":-23,"w":30,"h":15,"config":{"decimals":0,"static_text":"140","font":"Montserrat:12","text_color":36020}},{"type":"text","id":"oilt_hi","x":82,"y":-23,"w":30,"h":15,"config":{"decimals":0,"static_text":"340","font":"Montserrat:12","text_color":36020}},{"type":"text","id":"mph_lbl","x":250,"y":-60,"w":80,"h":18,"config":{"decimals":0,"static_text":"MPH","font":"Montserrat:16","text_color":36020}},{"type":"text","id":"sport","x":-217,"y":48,"w":60,"h":22,"config":{"decimals":0,"static_text":"S+","font":"Montserrat:18","text_color":13854}}]};

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
            if (raw) {
                const parsed = JSON.parse(raw);
                /* A stored 'default' older than schema 13 is the pre-modern
                 * seed (or a save over it) — it predates the current widget
                 * system and renders wrong. Serve the fresh seed instead. */
                if ((!name || name === 'default') && (parsed.schema_version || 0) < 13) {
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
    async function _localRouteApiCall(url, method, body) {
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
            if (params.name) await T.deleteLayout(params.name);
            return ok();
        }
        if (pathname === '/api/layout/rename' && method === 'POST') {
            if (body && body.from && body.to) {
                await T.renameLayout(body.from, body.to);
                if (localStorage.getItem(LOCAL_ACTIVE_KEY) === body.from)
                    localStorage.setItem(LOCAL_ACTIVE_KEY, body.to);
            }
            return ok();
        }
        if (pathname === '/api/layout/version') return ok({ version: 0 });
        if (pathname === '/api/image/list') return ok(await T.listImages());
        if (pathname === '/api/font/list') return ok(await T.listFonts());
        if (pathname === '/api/signals/values') return ok({ signals: [] });
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

    async function _usbRouteApiCall(url, method, body, t) {
        const qIdx = url.indexOf('?');
        const pathname = qIdx >= 0 ? url.slice(0, qIdx) : url;
        const qs = qIdx >= 0 ? url.slice(qIdx + 1) : '';
        const params = {};
        if (qs) qs.split('&').forEach(p => {
            const eq = p.indexOf('=');
            if (eq >= 0) params[p.slice(0, eq)] = decodeURIComponent(p.slice(eq + 1));
        });

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
        if (pathname === '/api/storage/info') return t.getStorageInfo();
        if (pathname === '/api/signals/values') return t.getSignalValues();
        if (pathname === '/api/signal/simulate') {
            if (method === 'POST') return t.toggleSimulation(body && body.enable);
            return t.getSimulationStatus();
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

            if (mode === 'local') {
                this._transport = LocalTransport;
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
        async copySdFile(type, name, direction) { return this._transport.copySdFile(type, name, direction); },
        async deleteSdFile(type, name) { return this._transport.deleteSdFile(type, name); },

        async exportRdmBundle(l) { return this._transport.exportRdmBundle(l); },
        async importRdmBundle(d) { return this._transport.importRdmBundle(d); },

        /* ── API proxy — routes raw /api/* fetches through the active transport ── */
        async proxyApiCall(url, init) {
            const method = (init && init.method) || 'GET';
            let bodyText = null;
            if (init && init.body) {
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
                /* Binary endpoints must NOT go through http_fetch — its body
                 * is a Rust String, which mangles JPEG bytes. This is what
                 * broke CONTROL's mirror (fetch('/api/screenshot') → garbage
                 * blob). Fetch the bytes losslessly and hand back a real
                 * Response so .blob() Just Works. */
                if (method === 'GET' && /^\/api\/screenshot(\?|$)/.test(url)) {
                    try {
                        const bytes = await _tauriInvoke('http_fetch_binary', {
                            url: fullUrl, timeout_ms: 15000,
                        });
                        return new Response(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), { status: 200 });
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
                    const result = await _usbRouteApiCall(url, method, bodyObj, t);
                    return makeResp(result);
                } catch (e) {
                    return makeResp({ error: String(e) }, 503);
                }
            }
            /* Local (offline) — serve from the virtual local dash. */
            try {
                const r = await _localRouteApiCall(url, method, bodyObj);
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
