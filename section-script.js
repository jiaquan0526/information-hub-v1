// Section Page JavaScript - Handles individual section functionality
class SectionManager {
    constructor() {
        this.currentUser = null;
		this.currentSection = this.getCurrentSectionFromURL();
		this.currentTab = '';
        this.sectionConfig = this.loadSectionConfig();
        this._bc = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('hub-sync') : null;
        this._initStarted = false;
        try { window.sectionManager = this; } catch (_) {}
        this.init();
    }

    async _seedExampleResourcesIfMissing(types) {
        try {
            if (!window.supabaseClient) return;
            const secId = this.currentSection;
            for (const t of (types || [])) {
                const uiId = String(t.id || '').toLowerCase();
                const dbType = this._mapUiTypeToDbType(uiId);
                const { count, error } = await window.supabaseClient
                    .from('resources')
                    .select('*', { count: 'exact', head: true })
                    .eq('section_id', secId)
                    .eq('type', dbType);
                if (error) continue;
                if (!count || count === 0) {
                    const sectionNameEl = document.getElementById('sectionName');
                    const sectionName = (sectionNameEl && sectionNameEl.textContent) ? sectionNameEl.textContent.trim() : secId;
                    const typeName = String(t.name || t.id || uiId).trim();
                    const payload = {
                        section_id: secId,
                        type: dbType,
                        title: `${typeName} example` ,
                        description: '',
                        url: 'https://example.com',
                        tags: [],
                        extra: { category: '' },
                        section_name: sectionName,
                        type_name: typeName
                    };
                    try { await window.supabaseClient.from('resources').insert(payload).select().single(); } catch (_) {}
                }
            }
            // Notify hub to refresh counts
            this._notifyHub({ type: 'RESOURCE_CHANGE', action: 'seed' });
        } catch (_) {}
    }

    async refreshTypesFromResources() {
        try {
            if (!window.supabaseClient) return;
            const { data, error } = await window.supabaseClient
                .from('resources')
                .select('type')
                .eq('section_id', this.currentSection);
            if (error) return;
            const seen = new Map();
            (Array.isArray(data) ? data : []).forEach(r => {
                const dbt = String(r.type || '').trim().toLowerCase();
                if (!dbt) return;
                // Map DB type back to UI id
                let id = dbt === 'playbook' ? 'playbooks' : dbt === 'link' ? 'box-links' : dbt === 'dashboard' ? 'dashboards' : dbt;
                const cfg = this.sectionConfig || {};
                const t = (Array.isArray(cfg.types) ? cfg.types : []).find(x => String(x.id||'').trim().toLowerCase() === id);
                const name = t ? (t.name || t.id) : (id === 'playbooks' ? 'Playbooks' : id === 'box-links' ? 'Box Links' : id === 'dashboards' ? 'Dashboards' : id);
                const icon = t ? (t.icon || '') : (id === 'playbooks' ? 'fas fa-book' : id === 'box-links' ? 'fas fa-link' : id === 'dashboards' ? 'fas fa-chart-bar' : 'fas fa-folder');
                seen.set(id, { id, name, icon });
            });
            const types = Array.from(seen.values());
            if (types.length > 0) {
                this.sectionConfig = { ...(this.sectionConfig || {}), types, categories: this.sectionConfig.categories || [] };
            }
        } catch (_) {}
    }

    // Content activity logger (records to activities table via wrapper)
    async logContentActivity(action, resourceType, title) {
        try {
            if (!window.hubDatabase || !window.hubDatabaseReady) return;
            const upper = String(action || 'updated').toUpperCase();
            const mapped = upper === 'CREATED' ? 'CREATE_RESOURCE'
                : upper === 'UPDATED' ? 'UPDATE_RESOURCE'
                : upper === 'DELETED' ? 'DELETE_RESOURCE'
                : upper;
            await hubDatabase.addActivity({
                action: mapped,
                type: resourceType || '',
                title: title || '',
                section: this.currentSection || null,
                username: (this.currentUser && (this.currentUser.username || this.currentUser.email)) || null,
                timestamp: new Date().toISOString()
            });
        } catch (_) {}
    }

    async getCurrentUser() {
        try {
            if (!window.supabaseClient || !window.supabaseClient.auth) return null;
            const { data: { user } } = await window.supabaseClient.auth.getUser();
            if (!user) return null;
            let role = 'viewer';
            let permissions = { sections: ['*'], canViewAllSections: true, canEditAllSections: false };
            let username = '';
            try {
                const { data: profile } = await window.supabaseClient
                    .from('profiles')
                    .select('role, permissions, username, email')
                    .eq('id', user.id)
                    .single();
                if (profile) {
                    role = profile.role || role;
                    permissions = (profile.permissions && typeof profile.permissions === 'object') ? profile.permissions : permissions;
                    username = profile.username || profile.email || '';
                }
            } catch (_) {}
            return { id: user.id, email: user.email, username: username || user.email, role, permissions };
        } catch (_) { return null; }
    }

    async init() {
        if (this._initStarted) return; this._initStarted = true;
        const ok = await this.validateSession();
        if (!ok) return;
        const allowed = await this.checkAccess();
        if (!allowed) {
            try {
                const loadingEl = document.getElementById('loadingScreen');
                const contentEl = document.getElementById('mainContent');
                if (loadingEl) loadingEl.style.display = 'none';
                if (contentEl) contentEl.style.display = 'block';
            } catch (_) {}
        }
        // Section session start
        this.sectionSessionStartMs = Date.now();
        // IDs are handled by Supabase; no local migrations
        await this.loadSectionData();
		// Ensure config is loaded before first render
		try { await this.ensureSectionConfigLoaded(); } catch (_) {}
		// Do not auto-infer tabs from resources; show blank until configured in Supabase
        this.bindEvents();
        this.renderDynamicUI();
        // Asynchronously refresh section config from Supabase so all users share the same tabs
        try { this._refreshSectionConfigFromDb(); } catch (_) {}
        // Periodic auto-refresh from Supabase to keep view fresh
        try { this._setupAutoRefresh(); } catch (_) {}
        // Realtime: subscribe to resources/config for this section
        try { this._setupRealtime(); } catch (_) {}
        // Ensure filters are cleared on entry to avoid stale search/category narrowing results
        try {
            const searchInput = document.getElementById('searchInput');
            const categoryFilter = document.getElementById('categoryFilter');
            if (searchInput) searchInput.value = '';
            if (categoryFilter) categoryFilter.value = '';
        } catch (_) {}
        // Show content early to avoid spinner stuck on minor errors
        const loadingEl = document.getElementById('loadingScreen');
        const contentEl = document.getElementById('mainContent');
        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) contentEl.style.display = 'block';
        try {
            this.renderCurrentTab();
        } catch (e) {
            console.error('Error rendering tab:', e);
        }
        // usage logging for resource clicks
        this.bindResourceClickLogging();
        this.setupSectionSessionLogging();
    }

    // Avoid UI hangs if optional DB promises never resolve
    async _safeDbCall(promise, timeoutMs = 1500) {
        try {
            await Promise.race([
                promise,
                new Promise((resolve) => setTimeout(resolve, timeoutMs))
            ]);
        } catch (_) {
            // Ignore DB errors/timeouts silently; localStorage is already updated
        }
    }

    async _safeDbFetch(promise, timeoutMs = 1500, fallback = []) {
        try {
            return await Promise.race([
                promise.catch(() => fallback),
                new Promise((resolve) => setTimeout(() => resolve(fallback), Math.min(timeoutMs, 800)))
            ]);
        } catch (_) {
            return fallback;
        }
    }

    // Avoid UI hangs if optional DB promises never resolve
    async _safeDbCall(promise, timeoutMs = 1500) {
        try {
            await Promise.race([
                promise,
                new Promise((resolve) => setTimeout(resolve, timeoutMs))
            ]);
        } catch (_) {
            // Ignore DB errors/timeouts silently; localStorage is already updated
        }
    }
    normalizeUrl(possibleUrl) {
        try {
            const raw = String(possibleUrl || '').trim();
            if (!raw) return raw;
            if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
                return 'https://' + raw;
            }
            return raw;
        } catch (_) { return possibleUrl; }
    }

    // Canonicalization and merge helpers to keep section view consistent with hub
    canonicalizeUrlForKey(url) {
        try {
            let raw = String(url || '').trim();
            if (!raw) return '';
            if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) raw = 'https://' + raw;
            const u = new URL(raw);
            const host = (u.host || '').toLowerCase();
            const path = (u.pathname || '/').replace(/\/+$/, '');
            const norm = `${u.protocol}//${host}${path}${u.search || ''}`;
            return norm.toLowerCase();
        } catch (_) {
            return String(url || '').trim().toLowerCase();
        }
    }
    canonicalKeyForResource(r) {
        const title = String(r?.title || '').trim().toLowerCase();
        const urlKey = this.canonicalizeUrlForKey(r?.url);
        const pair = `t:${title}|u:${urlKey}`;
        return pair;
    }
    _getMergeKey(r) {
        try {
            const pair = this.canonicalKeyForResource(r);
            if (pair) return `pair:${pair}`;
            const id = (r && r.id !== undefined && r.id !== null) ? String(r.id) : '';
            if (id) return `id:${id}`;
        } catch (_) {}
        return '';
    }
    _pickNewerResource(a, b) {
        try {
            const ta = Date.parse(a?.updatedAt || a?.createdAt || 0) || 0;
            const tb = Date.parse(b?.updatedAt || b?.createdAt || 0) || 0;
            return tb >= ta ? b : a;
        } catch (_) { return b || a; }
    }

    async checkAccess() {
        try {
            if (!this.currentUser) { window.location.href = 'auth.html'; return false; }
            const role = String(this.currentUser.role || '').toLowerCase();
            const perms = this.currentUser.permissions || {};
            const sections = Array.isArray(perms.sections) ? perms.sections : [];
            const canAll = !!perms.canEditAllSections || !!perms.canViewAllSections || sections.includes('*');
            if (role === 'admin' || canAll) return true;
            if (!sections.includes(this.currentSection)) {
                // Do not redirect back to hub; show a non-blocking message and continue with limited UI
                try { this.showMessage('You do not have access to this section', 'error'); } catch(_) {}
                return false;
            }
            return true;
        } catch (_) {
            window.location.href = 'auth.html';
            return false;
        }
    }

    async loadSectionData() {
        // Fetch header fields strictly from Supabase
        let sectionConfig = null;
        try {
            if (window.supabaseClient) {
                const { data, error } = await window.supabaseClient
                    .from('sections')
                    .select('section_id, name, icon, color, config')
                    .eq('section_id', this.currentSection)
                    .single();
                if (!error && data) {
                    try {
                        if (data && data.config && typeof data.config === 'string') {
                            data.config = JSON.parse(data.config);
                        }
                    } catch (_) {}
                    sectionConfig = data;
                    console.log('Loaded section from Supabase (authoritative):', sectionConfig);
                    // Apply config immediately so tabs render on first load
                    try {
                        const cfgObj = (sectionConfig && sectionConfig.config && typeof sectionConfig.config === 'object') ? sectionConfig.config : null;
                        if (cfgObj) {
                            this.sectionConfig = cfgObj;
                            // Render immediately without waiting for later refreshes
                            try { this.renderDynamicUI(); } catch (_) {}
                            try { this.renderCurrentTab(); } catch (_) {}
                        }
                    } catch (_) {}
                }
            }
        } catch (e) {
            console.warn('Supabase fetch failed:', e);
        }

        const nameEl = document.getElementById('sectionName');
        const iconEl = document.getElementById('sectionIcon');
        if (nameEl) {
            const nm = (sectionConfig && sectionConfig.name) ? String(sectionConfig.name).trim() : '';
            // Fallback to readable section id if name missing
            try {
                const fallbackName = String(this.currentSection || 'Section')
                    .replace(/[-_]+/g, ' ')
                    .replace(/\b\w/g, c => c.toUpperCase());
                nameEl.textContent = nm || fallbackName;
            } catch (_) {
                nameEl.textContent = nm || (this.currentSection || 'Section');
            }
        }
        if (iconEl) {
            const icn = sectionConfig && sectionConfig.icon ? String(sectionConfig.icon).trim() : '';
            try {
                if (icn) {
                    iconEl.className = this.normalizeIconClass(icn);
                } else {
                    // No icon: show default icon so header is visible
                    if (iconEl.tagName && iconEl.tagName.toLowerCase() === 'img') {
                        iconEl.outerHTML = '<i id="sectionIcon" class="fa-solid fa-table-cells-large"></i>';
                    } else {
                        iconEl.className = 'fa-solid fa-table-cells-large';
                    }
                }
            } catch (_) {
                // On any error, clear icon completely
                try {
                    if (iconEl.tagName && iconEl.tagName.toLowerCase() === 'img') {
                        iconEl.outerHTML = '<i id="sectionIcon" class="fa-solid fa-table-cells-large"></i>';
                    } else {
                        iconEl.className = 'fa-solid fa-table-cells-large';
                    }
                } catch (_) {}
            }
        }
        if (sectionConfig && sectionConfig.name && String(sectionConfig.name).trim()) {
            document.title = `${String(sectionConfig.name).trim()} - Information Hub`;
        }

        // Intro text
        const introEl = document.getElementById('sectionIntro');
        if (introEl) {
            const intro = ((sectionConfig && sectionConfig.config && sectionConfig.config.intro) ? String(sectionConfig.config.intro) : '').trim();
            introEl.textContent = intro;
            introEl.style.display = intro ? 'block' : 'none';
        }

        // Apply persistent background image per section (deterministic and global-seed based)
        try {
            // Determine enablement via Supabase (fallback to hub page flag)
            let enabled = false;
            try {
                if (window.hubDatabase && window.hubDatabaseReady && typeof hubDatabase.getSiteSetting === 'function') {
                    const v = await hubDatabase.getSiteSetting('backgrounds');
                    enabled = !!(v && (v.forceEnabled === true || String(v.forceEnabled).toLowerCase() === 'true'));
                } else if (window.supabaseClient && window.supabaseClient.from) {
                    try {
                        const { data } = await window.supabaseClient
                            .from('site_settings')
                            .select('value')
                            .eq('key', 'backgrounds')
                            .single();
                        const v = data && data.value;
                        enabled = !!(v && (v.forceEnabled === true || String(v.forceEnabled).toLowerCase() === 'true'));
                    } catch (_) {}
                } else if (typeof window.globalBackgroundsEnabled !== 'undefined') {
                    enabled = window.globalBackgroundsEnabled === true;
                }
            } catch (_) { enabled = false; }
            const disable = !enabled;
            const container = document.querySelector('.container');
            // Deterministic list built from manifest, filtered and sorted
            const loadImages = async () => {
                try {
                    // Fallback to fetching manifest.json
                    try {
                        const bust = Date.now();
                        const resp = await fetch(`background-pic/manifest.json?t=${bust}`, { cache: 'no-store' });
                        if (resp && resp.ok) {
                            const data = await resp.json();
                            if (Array.isArray(data) && data.length > 0) {
                                return data.map(p => `background-pic/${p}`).sort();
                            }
                        }
                    } catch (_) {}
                    // Final fallback static list
                    return [
                        'background-pic/159484_L.png','background-pic/162053_L.png','background-pic/162054_L.png','background-pic/162058_L.png',
                        'background-pic/162062_L.png','background-pic/168817_L.png','background-pic/171327_Y.png','background-pic/537081_L.png',
                        'background-pic/537082_K.png','background-pic/560846_L.png'
                    ].sort();
                } catch (_) { return []; }
            };
            const images = await loadImages();
            if (container && Array.isArray(images) && images.length > 0) {
                container.style.borderRadius = '12px';
                container.style.backgroundImage = 'linear-gradient(rgba(255,255,255,0.92), rgba(255,255,255,0.92))';
                const applyBg = async () => {
                    try {
                        // Skip on user-disabled or low-data connections
                        try {
                            const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
                            if (conn && (conn.saveData === true || (conn.effectiveType && /(^|\b)(2g|slow-2g)\b/i.test(conn.effectiveType)))) return;
                        } catch (_) {}
                        if (disable) return;
                        // Use a session-only seed to pick within this load (no persistence)
                        const seed = (typeof window.BG_SESSION_SEED === 'string' && window.BG_SESSION_SEED.length > 0)
                            ? window.BG_SESSION_SEED
                            : (window.BG_SESSION_SEED = String(Date.now()) + ':' + Math.random());
                        const idx = Math.abs(this._hash(`${seed}|${this.currentSection}`)) % images.length;
                        const chosen = images[idx];
                        // Prefer WebP if available using the hub page helper when present
                        let finalUrl = chosen;
                        try {
                            if (typeof window.getOptimizedImageUrl === 'function') {
                                // Resize/convert via online proxy before applying (with fallback)
                                const cand = await window.getOptimizedImageUrl(chosen, 1600, 0, 0.8);
                                if (cand && cand !== chosen) {
                                    const ok = await new Promise((resolve)=>{
                                        try {
                                            const t = new Image();
                                            t.onload = () => resolve(true);
                                            t.onerror = () => resolve(false);
                                            t.src = cand;
                                        } catch(_) { resolve(false); }
                                    });
                                    if (ok) finalUrl = cand;
                                }
                            }
                        } catch (_) {}
                        container.style.backgroundImage = `linear-gradient(rgba(255,255,255,0.92), rgba(255,255,255,0.92)), url('${finalUrl}')`;
                        container.style.backgroundSize = 'cover';
                        container.style.backgroundPosition = 'center';
                    } catch(_) {}
                };
                if ('requestIdleCallback' in window) {
                    requestIdleCallback(applyBg, { timeout: 1200 });
                } else {
                    setTimeout(applyBg, 200);
                }
            }
        } catch (_) {}
    }

    // Ensure sectionConfig is loaded and normalized from Supabase before first render
    async ensureSectionConfigLoaded() {
        try {
            if (this.sectionConfig && (Array.isArray(this.sectionConfig.tabs) || Array.isArray(this.sectionConfig.types))) return;
            if (!window.supabaseClient) return;
            const { data, error } = await window.supabaseClient
                .from('sections')
                .select('config')
                .eq('section_id', this.currentSection)
                .single();
            if (error) return;
            let cfg = null;
            if (data && data.config && typeof data.config === 'string') {
                try { cfg = JSON.parse(data.config); } catch (_) { cfg = null; }
            } else if (data && typeof data.config === 'object') {
                cfg = data.config;
            }
            if (cfg && typeof cfg === 'object') {
                this.sectionConfig = this._normalizeConfig(cfg);
            }
        } catch (_) {}
    }

    _normalizeConfig(raw) {
        try {
            const cfg = (raw && typeof raw === 'object') ? raw : {};
            const tabs = Array.isArray(cfg.tabs) ? cfg.tabs.map(s => String(s||'').trim()).filter(Boolean) : [];
            const names = Array.isArray(cfg.tab_names) ? cfg.tab_names.map(s => String(s||'').trim()) : [];
            const types = Array.isArray(cfg.types) ? cfg.types.map(t => ({
                id: String(t?.id || t?.name || '').trim(),
                name: String(t?.name || t?.id || '').trim(),
                icon: String(t?.icon || '').trim(),
                key: t?.key || (this.currentSection ? `${this.currentSection}:${String(t?.id || t?.name || '').trim()}` : undefined)
            })).filter(t => t.id) : [];
            const categories = Array.isArray(cfg.categories) ? cfg.categories : ['process','procedure','guide','template','checklist'];
            return { tabs, tab_names: names, types, categories, intro: cfg.intro || '', visible: cfg.visible !== false, order: cfg.order || 0 };
        } catch (_) { return raw || {}; }
    }

    // Normalize FA icon class (simple copy from index page)
    normalizeIconClass(cls) {
        if (!cls || typeof cls !== 'string') return 'fa-solid fa-table-cells-large';
        let c = cls.trim();
        if (/\bfa-(solid|regular|light|thin|duotone|brands)\b/.test(c)) return c;
        c = c.replace(/\bfas\b/, 'fa-solid').replace(/\bfar\b/, 'fa-regular').replace(/\bfab\b/, 'fa-brands');
        if (!/\bfa-\w+\b/.test(c) || !/\bfa-\w+\b.*\bfa-/.test('fa ' + c)) {
            if (!/\bfa-(solid|regular|brands)\b/.test(c)) {
                c = 'fa-solid ' + c;
            }
        }
        return c;
    }

    _hash(str) {
        let h = 0; for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; } return h;
    }

    // Add session validation on page load
    async validateSession() {
        // Validate session using Supabase auth (wait for client/session to be ready)
        try {
            let tries = 0;
            while (tries < 100 && (!window.supabaseClient || !window.supabaseClient.auth)) {
                await new Promise(r => setTimeout(r, 100));
                tries++;
            }
            if (!window.supabaseClient) {
                window.location.href = 'auth.html';
                return false;
            }
            // Give the session a moment to restore
            let user = null;
            let authTries = 0;
            while (authTries < 50 && !user) {
                try {
                    const { data: { user: u } } = await window.supabaseClient.auth.getUser();
                    user = u || null;
                    if (user) break;
                } catch (_) {}
                await new Promise(r => setTimeout(r, 100));
                authTries++;
            }
            if (!user) {
                window.location.href = 'auth.html';
                return false;
            }
            this.currentUser = await this.getCurrentUser();
            if (!this.currentUser) {
                window.location.href = 'auth.html';
                return false;
            }
            return true;
        } catch (_) {
            window.location.href = 'auth.html';
            return false;
        }
    }

    getCurrentSectionFromURL() {
        // Extract section from URL or use stored section
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('section');
    }

    bindEvents() {
        // Tab switching
        window.switchTab = (tabName) => this.switchTab(tabName);
        // Customize
        window.customizeSection = () => this.openCustomizeModal();
        // Search and filter
        const searchInput = document.getElementById('searchInput');
        const categoryFilter = document.getElementById('categoryFilter');
        if (searchInput) {
            searchInput.addEventListener('input', () => this.filterResources());
        }
        if (categoryFilter) {
            categoryFilter.addEventListener('change', () => this.filterResources());
        }
        // Add resource
        window.addResource = (type) => this.addResource(type);
        // Edit and delete resources
        window.editResource = (type, id) => this.editResource(type, id);
        window.deleteResource = (type, id) => this.deleteResource(type, id);
        // Back to hub
        window.goBackToHub = () => this.goBackToHub();
        // No storage sync: rely on Supabase realtime only
    }

    setupSectionSessionLogging() {
        const logClose = () => {
            if (this._sectionSessionLogged) return;
            this._sectionSessionLogged = true;
            const durationMs = Date.now() - (this.sectionSessionStartMs || Date.now());
            try {
                if (window.hubDatabase && typeof hubDatabase.saveActivity === 'function' && this.currentUser) {
                    const desc = `Closed section ${this.currentSection} after ${Math.round(durationMs/1000)}s`;
                    this._safeDbCall(hubDatabase.saveActivity({
                        action: 'CLOSE_SECTION',
                        section: this.currentSection,
                        description: desc,
                        timestamp: new Date().toISOString(),
                        username: this.currentUser.username || this.currentUser.email || null
                    }), 1200);
                }
            } catch (_) {}
        };
        window.addEventListener('beforeunload', logClose);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) logClose();
        });
        // Log open
        try {
            if (window.hubDatabase && typeof hubDatabase.saveActivity === 'function' && this.currentUser) {
                const desc = `Opened section ${this.currentSection}`;
                this._safeDbCall(hubDatabase.saveActivity({
                    action: 'OPEN_SECTION',
                    section: this.currentSection,
                    description: desc,
                    timestamp: new Date().toISOString(),
                    username: this.currentUser.username || this.currentUser.email || null
                }), 1200);
            }
        } catch (_) {}
    }

    switchTab(tabName) {
        this.currentTab = tabName;
        
        // Update tab appearance
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        const ev = (typeof event !== 'undefined' ? event : window.event);
        if (ev && ev.target) {
            ev.target.classList.add('active');
        } else {
            const activeTab = document.querySelector(`.nav-tab[onclick*="${tabName}"]`);
            if (activeTab) activeTab.classList.add('active');
        }

        // Show/hide content sections
        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.remove('active');
        });
        document.getElementById(`${tabName}-section`).classList.add('active');

        // Reset filters on tab change so counts and visible items match expectations
        try {
            const searchInput = document.getElementById('searchInput');
            const categoryFilter = document.getElementById('categoryFilter');
            if (searchInput) searchInput.value = '';
            if (categoryFilter) categoryFilter.value = '';
        } catch (_) {}

        // Render the appropriate content
        this.renderCurrentTab();

        // Optionally log SWITCH_SECTION_TAB to Supabase
    }

	renderCurrentTab() {
		if (!this.currentTab) return;
		this.renderResources(this.currentTab);
	}

    async renderResources(type) {
        const gridId = `${type.replace('-', '-')}-grid`;
        const grid = document.getElementById(gridId);
        const emptyState = document.getElementById('emptyState');
        const addBtn = document.querySelector(`#${type}-section .add-resource-btn`);
        
        if (!grid) return;

        // Show/hide add button based on permissions
        if (addBtn) {
            addBtn.style.display = this.canEditResource() ? 'inline-flex' : 'none';
        }

        // Supabase-only: fetch and render
        try {
            const resources = await this.getResources(type);
            // Rebuild category options based on the current tab's resources
            try { this._populateCategoryFilterFromResources(resources); } catch (_) {}
            const filteredResources = this.getFilteredResources(resources);
            if (filteredResources.length === 0) {
                grid.style.display = 'none';
                emptyState.style.display = 'block';
                grid.innerHTML = '';
            } else {
                grid.style.display = 'grid';
                emptyState.style.display = 'none';
                grid.innerHTML = filteredResources.map(resource => this.createResourceCard(resource, type)).join('');
            }
        } catch (_) {
            grid.style.display = 'none';
            emptyState.style.display = 'block';
        }
    }

    async getResources(type) {
        const uiType = this.mapToStorageType(type);
        const dbType = this._mapUiTypeToDbType(uiType);
        if (!window.supabaseClient) return [];
        try {
            const { data, error } = await window.supabaseClient
                .from('resources')
                .select('*, sections(name)')
                .eq('section_id', this.currentSection)
                .eq('type', dbType)
                .order('created_at', { ascending: false });
            if (error) throw error;
            const list = Array.isArray(data) ? data : [];
            return list.map(r => this._normalizeResourceRow(r, uiType));
        } catch (_) { return []; }
    }

    // Local-only fast resource fetch (no DB calls)
    async getResourcesLocalOnly(type) { return this.getResources(type); }

    async getSectionData() {
        try {
            const section = window.hubDatabase && hubDatabase.getSection
                ? await this._safeDbFetch(hubDatabase.getSection(this.currentSection), 1500, null)
                : null;
            return section ? section.data : { playbooks: [], boxLinks: [], dashboards: [] };
        } catch (error) {
            console.error('Error loading section data:', error);
            return { playbooks: [], boxLinks: [], dashboards: [] };
        }
    }

    createResourceCard(resource, type) {
        const storageType = this.mapToStorageType(type);
        const cfg = this.sectionConfig || {};
        const tabsArr = Array.isArray(cfg.tabs) ? cfg.tabs : [];
        const tabNames = Array.isArray(cfg.tab_names) ? cfg.tab_names : [];
        const typesArr = Array.isArray(cfg.types) ? cfg.types : [];
        const typesById = new Map(typesArr.map(t => [String(t?.id || '').trim(), t]));
        const idx = tabsArr.findIndex(id => String(id || '').trim().toLowerCase() === String(type || '').trim().toLowerCase());
        const base = typesById.get(String(type || '').trim()) || {};
        const displayName = (idx >= 0 && tabNames[idx] && String(tabNames[idx]).trim()) ? String(tabNames[idx]).trim() : (base.name || type || '');
        const label = String(displayName || type || '').toUpperCase();
        const iconClass = (base && base.icon) ? this.normalizeIconClass(base.icon) : (storageType === 'playbooks' ? 'fas fa-book' : storageType === 'boxLinks' ? 'fas fa-link' : storageType === 'dashboards' ? 'fas fa-chart-bar' : 'fas fa-folder');

        const canEdit = this.canEditResource() && (this.isAdmin() || this.isResourceOwner(resource));
        const isEditor = this.currentUser && String(this.currentUser.role || '').toLowerCase() === 'editor';
        const canDelete = this.canDeleteResource() && ((this.isAdmin() || isEditor) || this.isResourceOwner(resource));

        return `
            <div class="resource-card" data-id="${resource.id}">
                <div class="resource-header">
                    <div>
                        <h3 class="resource-title">${this.escapeHtml(resource.title)}</h3>
                    </div>
                    <div class="resource-type">${label}</div>
                </div>
                
                ${resource.description ? `<p class="resource-description">${this.escapeHtml(resource.description)}</p>` : ''}
                
                <a href="${resource.url}" target="_blank" rel="noopener noreferrer" class="resource-url">
                    <i class="${iconClass}"></i> ${this.escapeHtml(resource.url)}
                </a>
                
                <div class="resource-meta">
                    ${resource.tags && resource.tags.length > 0 ? `
                        <div class="resource-tags">
                            ${resource.tags.map(tag => `<span class="tag">${this.escapeHtml(tag)}</span>`).join('')}
                        </div>
                    ` : ''}
                </div>
                
                <div class="resource-footer">
                    <span>Added: ${new Date(resource.createdAt).toLocaleDateString()}</span>
                    <div>
                        ${canEdit ? `
                            <button class="action-btn edit-btn" onclick="editResource('${type}', '${resource.id}')" title="Edit">
                                <i class="fas fa-edit"></i>
                            </button>
                        ` : ''}
                        ${canDelete ? `
                            <button class="action-btn delete-btn" onclick="deleteResource('${type}', '${resource.id}')" title="Delete">
                                <i class="fas fa-trash"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    // Hook clicks to record usage
    bindResourceClickLogging() {
        document.body.addEventListener('click', async (e) => {
            const anchor = e.target.closest('a.resource-url');
            if (!anchor) return;
            const card = anchor.closest('.resource-card');
            if (!card) return;
            const resourceId = card.getAttribute('data-id');
            try {
                if (window.supabaseClient && typeof window.supabaseClient.rpc === 'function') {
                    const u = await window.supabaseClient.auth.getUser();
                    const uid = (u && u.data && u.data.user && u.data.user.id) ? u.data.user.id : null;
                    await window.supabaseClient.rpc('increment_view', { p_user_id: uid, p_resource_id: resourceId });
                }
                // Audit: record resource open with details (non-blocking)
                try {
                    if (window.hubDatabase && typeof hubDatabase.saveActivity === 'function' && this.currentUser) {
                        const titleEl = card.querySelector('.resource-title');
                        const typeEl = card.querySelector('.resource-type');
                        const title = titleEl ? String(titleEl.textContent || '').trim() : '';
                        const typeLabel = typeEl ? String(typeEl.textContent || '').trim() : '';
                        const href = anchor && anchor.getAttribute('href') ? String(anchor.getAttribute('href')).trim() : '';
                        const meta = {
                            title,
                            description: title || '',
                            type: typeLabel,
                            url: href,
                            section: this.currentSection
                        };
                        this._safeDbCall(hubDatabase.saveActivity({
                            action: 'OPEN_RESOURCE',
                            resourceId,
                            section: this.currentSection,
                            timestamp: new Date().toISOString(),
                            username: this.currentUser.username || this.currentUser.email || null,
                            metadata: meta
                        }), 1200);
                    }
                } catch (_) {}
            } catch (_) {}
        });
    }

    getFilteredResources(resources) {
        const searchTerm = document.getElementById('searchInput')?.value.toLowerCase() || '';
        const selectedRaw = document.getElementById('categoryFilter')?.value || '';
        const normalizedFilter = String(selectedRaw).trim().toLowerCase();

        return resources.filter(resource => {
            const title = (resource.title || '').toLowerCase();
            const description = (resource.description || '').toLowerCase();
            const url = (resource.url || '').toLowerCase();
            const matchesSearch = !searchTerm ||
                title.includes(searchTerm) ||
                description.includes(searchTerm) ||
                (resource.tags && resource.tags.some(tag => String(tag).toLowerCase().includes(searchTerm))) ||
                url.includes(searchTerm);

            const resourceCategory = String(resource.category || '').trim().toLowerCase();
            const matchesCategory = !normalizedFilter || resourceCategory === normalizedFilter;

            return matchesSearch && matchesCategory;
        });
    }

    _populateCategoryFilterFromResources(resources) {
        try {
            const sel = document.getElementById('categoryFilter');
            if (!sel) return;
            const current = String(sel.value || '').trim().toLowerCase();
            const cats = Array.from(new Set(
                (Array.isArray(resources) ? resources : [])
                    .map(r => String(r.category || '').trim())
                    .filter(Boolean)
            ));
            const normCats = Array.from(new Set(cats.map(c => c.toLowerCase()))).sort();
            const toLabel = (c) => c.charAt(0).toUpperCase() + c.slice(1);
            const options = ['<option value="">All Categories</option>']
                .concat(normCats.map(c => `<option value="${this.escapeHtml(c)}"${current === c ? ' selected' : ''}>${this.escapeHtml(toLabel(c))}</option>`));
            sel.innerHTML = options.join('');
            if (current && !normCats.includes(current)) {
                sel.value = '';
            }
        } catch (_) {}
    }

    filterResources() {
        this.renderCurrentTab();
    }

    // Resource Management
    addResource(type) {
        if (!this.canEditResource()) {
            this.showMessage('You do not have permission to add resources', 'error');
            return;
        }

        const modal = this.createResourceModal(type);
        document.body.appendChild(modal);
        modal.style.display = 'block';
    }

    canEditResource() {
        if (!this.currentUser) return false;
        const perms = this.currentUser.permissions || {};
        const editableSections = Array.isArray(perms.editableSections) ? perms.editableSections : [];
        return !!perms.canEditAllSections || editableSections.includes(this.currentSection);
    }

    // Section customization (tabs/config) permission: admin or editor with edit rights on this section
    canCustomizeSection() {
        if (!this.currentUser) return false;
        if (this.isAdmin()) return true;
        return this.canEditResource();
    }

    canDeleteResource() {
        if (!this.currentUser) return false;
        const role = String(this.currentUser.role || '').toLowerCase();
        const perms = this.currentUser.permissions || {};
        const roleAllowed = role === 'admin' || role === 'editor' || perms.canEditAllSections === true;
        return (perms.canDeleteResources === true || roleAllowed) && this.canEditResource();
    }

    isResourceOwner(resource) {
        if (!this.currentUser || !resource) return false;
        // Treat legacy resources without userId as editable by section editors
        const ownerId = resource.userId;
        if (ownerId === undefined || ownerId === null || ownerId === '' || ownerId === 0) return true;
        return String(ownerId) === String(this.currentUser.id || '');
    }

    isAdmin() {
        if (!this.currentUser) return false;
        return this.currentUser.role === 'admin' || this.currentUser.permissions.canEditAllSections === true;
    }
    
    createResourceModal(type) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        const cfg = this.sectionConfig || {};
        const tabsArr = Array.isArray(cfg.tabs) ? cfg.tabs : [];
        const tabNames = Array.isArray(cfg.tab_names) ? cfg.tab_names : [];
        const typesArr = Array.isArray(cfg.types) ? cfg.types : [];
        const typesById = new Map(typesArr.map(t => [String(t?.id || '').trim(), t]));
        const idx = tabsArr.findIndex(id => String(id || '').trim().toLowerCase() === String(type || '').trim().toLowerCase());
        const base = typesById.get(String(type || '').trim()) || {};
        const displayName = (idx >= 0 && tabNames[idx] && String(tabNames[idx]).trim()) ? String(tabNames[idx]).trim() : (base.name || type || '');
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Add New ${this.escapeHtml(String((displayName || type || '').toUpperCase()))}</h2>
                    <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
                </div>
                <form id="resourceForm">
                    <div class="form-group">
                        <label for="resourceTitle">Title *</label>
                        <input type="text" id="resourceTitle" name="title" required>
                    </div>
                    <div class="form-group">
                        <label for="resourceDescription">Description</label>
                        <textarea id="resourceDescription" name="description" rows="3"></textarea>
                    </div>
                    <div class="form-group">
                        <label for="resourceUrl">URL *</label>
                        <input type="text" id="resourceUrl" name="url" required>
                    </div>
                    <div class="form-group">
                        <label for="resourceCategory">Category</label>
                        <select id="resourceCategory" name="category">
                            <option value="process">Process</option>
                            <option value="procedure">Procedure</option>
                            <option value="guide">Guide</option>
                            <option value="template">Template</option>
                            <option value="checklist">Checklist</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="resourceTags">Tags (comma-separated)</label>
                        <input type="text" id="resourceTags" name="tags" placeholder="e.g., analysis, framework, financial">
                    </div>
                    <div class="form-actions">
                        <button type="button" onclick="this.closest('.modal').remove()" class="btn btn-secondary">Cancel</button>
                        <button type="submit" class="btn btn-primary">Save Resource</button>
                    </div>
                </form>
            </div>
        `;

        // Handle form submission
        const form = modal.querySelector('#resourceForm');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const success = await this.saveResource(type, form);
            if (success) {
                modal.remove();
            }
        });

        return modal;
    }

    async saveResource(type, form) {
        const formData = new FormData(form);
        const resource = {
            title: String(formData.get('title') || '').trim(),
            description: formData.get('description') || '',
            url: this.normalizeUrl(formData.get('url')),
            category: formData.get('category'),
            tags: formData.get('tags') ? formData.get('tags').split(',').map(tag => tag.trim()).filter(tag => tag) : []
        };

        // Validate URL
        if (!this.isValidUrl(resource.url)) {
            this.showMessage('Please enter a valid URL', 'error');
            return false;
        }

        const ok = await this.addResourceToSection(type, resource);
        if (!ok) {
            // Error already shown by callee
            return false;
        }
        // Log content creation
        try { this.logContentActivity('created', this.mapToStorageType(type), resource.title); } catch(_) {}
        this.renderCurrentTab();
        this.showMessage(`${type.replace('-', ' ')} added successfully!`, 'success');
        return true;
    }

    async addResourceToSection(type, resource) {
        try {
            const uiType = this.mapToStorageType(type);
            const dbType = this._mapUiTypeToDbType(uiType);
            if (!window.supabaseClient) throw new Error('Supabase unavailable');
            // Enrich with display fields for easier joins/use
            const payload = {
                section_id: this.currentSection,
                type: dbType,
                title: resource.title,
                description: resource.description || '',
                url: resource.url,
                tags: resource.tags || [],
                extra: { category: resource.category || '' }
            };
            const { error } = await window.supabaseClient.from('resources').insert(payload).select().single();
            if (error) throw error;
            this._notifyHub({ type: 'RESOURCE_CHANGE', action: 'create', resourceType: uiType });
            return true;
        } catch (error) {
            console.error('Error saving resource:', error);
            const msg = (error && (error.message || error.details || error.code)) ? (error.message || error.details || error.code) : 'Unknown error';
            try { this.showModalAlert(document.querySelector('.modal'), `Error saving resource: ${msg}`, 'error'); } catch(_) {}
            this.showMessage(`Error saving resource: ${msg}`, 'error');
            return false;
        }
    }

    async editResource(type, id) {
        if (!this.canEditResource()) {
            this.showMessage('You do not have permission to edit resources', 'error');
            return;
        }

        // Use merged source (DB + local) so DB-only items are editable
        const resources = await this.getResources(type);
        const resource = resources.find(r => String(r.id) === String(id));
        if (!resource) return;

        if (!this.isAdmin() && !this.isResourceOwner(resource)) {
            this.showMessage('You can only edit resources assigned to you', 'error');
            return;
        }

        const modal = this.createEditModal(type, resource);
        document.body.appendChild(modal);
        modal.style.display = 'block';
    }

    createEditModal(type, resource) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        const tagsString = Array.isArray(resource.tags) ? resource.tags.join(', ') : '';
        const cfg = this.sectionConfig || {};
        const tabsArr = Array.isArray(cfg.tabs) ? cfg.tabs : [];
        const tabNames = Array.isArray(cfg.tab_names) ? cfg.tab_names : [];
        const typesArr = Array.isArray(cfg.types) ? cfg.types : [];
        const typesById = new Map(typesArr.map(t => [String(t?.id || '').trim(), t]));
        const idx = tabsArr.findIndex(id => String(id || '').trim().toLowerCase() === String(type || '').trim().toLowerCase());
        const base = typesById.get(String(type || '').trim()) || {};
        const displayName = (idx >= 0 && tabNames[idx] && String(tabNames[idx]).trim()) ? String(tabNames[idx]).trim() : (base.name || type || '');
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Edit ${this.escapeHtml(String((displayName || type || '').toUpperCase()))}</h2>
                    <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
                </div>
                <form id="editResourceForm">
                    <input type="hidden" name="__origId" value="${this.escapeHtml(resource.id || '')}">
                    <input type="hidden" name="__origTitle" value="${this.escapeHtml(resource.title || '')}">
                    <input type="hidden" name="__origUrl" value="${this.escapeHtml(resource.url || '')}">
                    <div class="form-group">
                        <label for="editResourceTitle">Title *</label>
                        <input type="text" id="editResourceTitle" name="title" value="${this.escapeHtml(resource.title)}" required>
                    </div>
                    <div class="form-group">
                        <label for="editResourceDescription">Description</label>
                        <textarea id="editResourceDescription" name="description" rows="3">${this.escapeHtml(resource.description)}</textarea>
                    </div>
                    <div class="form-group">
                        <label for="editResourceUrl">URL *</label>
                        <input type="text" id="editResourceUrl" name="url" value="${this.escapeHtml(resource.url || '')}" required>
                    </div>
                    <div class="form-group">
                        <label for="editResourceCategory">Category</label>
                        <select id="editResourceCategory" name="category">
                            <option value="process" ${resource.category === 'process' ? 'selected' : ''}>Process</option>
                            <option value="procedure" ${resource.category === 'procedure' ? 'selected' : ''}>Procedure</option>
                            <option value="guide" ${resource.category === 'guide' ? 'selected' : ''}>Guide</option>
                            <option value="template" ${resource.category === 'template' ? 'selected' : ''}>Template</option>
                            <option value="checklist" ${resource.category === 'checklist' ? 'selected' : ''}>Checklist</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="editResourceTags">Tags (comma-separated)</label>
                        <input type="text" id="editResourceTags" name="tags" value="${this.escapeHtml(tagsString)}" placeholder="e.g., analysis, framework, financial">
                    </div>
                    <div class="form-actions">
                        <button type="button" onclick="this.closest('.modal').remove()" class="btn btn-secondary">Cancel</button>
                        <button type="submit" class="btn btn-primary" onclick="(function(btn){var f=btn.closest('form'); if(!f) return; if(typeof f.requestSubmit==='function'){ f.requestSubmit(); } else { f.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); }})(this)">Update Resource</button>
                    </div>
                </form>
            </div>
        `;

        // Handle form submission
        const form = modal.querySelector('#editResourceForm');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = form.querySelector('button[type="submit"]');
            const cancelBtn = form.querySelector('.btn.btn-secondary');
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Updating...'; }
            if (cancelBtn) cancelBtn.disabled = true;
            let finished = false;
            const reenable = () => {
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Update Resource'; }
                if (cancelBtn) cancelBtn.disabled = false;
            };
            const fallback = setTimeout(() => {
                if (!finished) {
                    reenable();
                    this.showMessage('Update is taking longer than expected. Please try again.', 'error');
                }
            }, 2500);
            try {
                const success = await this.updateResource(type, resource.id, form).catch(err => { this.showMessage(`Update failed: ${err?.message || err}`, 'error'); return false; });
                finished = true;
                clearTimeout(fallback);
                reenable();
                if (success) {
                    try {
                        const hdr = modal.querySelector('.modal-header h2');
                        if (hdr) {
                            const note = document.createElement('span');
                            note.style.fontSize = '0.9rem';
                            note.style.marginLeft = '10px';
                            note.textContent = '✓ Saved';
                            hdr.appendChild(note);
                        }
                    } catch (_) {}
                    setTimeout(() => modal.remove(), 400);
                }
            } finally {
                // Ensure buttons are restored in any case
                if (!finished) {
                    clearTimeout(fallback);
                    reenable();
                }
            }
        });

        return modal;
    }

    async updateResource(type, id, form) {
        const formData = new FormData(form);
        const origId = formData.get('__origId');
        const existingResources = await this.getResources(type);
        const original = existingResources.find(r => String(r.id) === String(origId)) || {};
        const updatedResource = {
            title: String(formData.get('title') || '').trim(),
            description: formData.get('description') || '',
            url: this.normalizeUrl(formData.get('url')),
            category: formData.get('category'),
            tags: formData.get('tags') ? formData.get('tags').split(',').map(tag => tag.trim()).filter(tag => tag) : [],
            userId: original.userId || this.currentUser?.id || 0
        };

        // Validate URL
        if (!this.isValidUrl(updatedResource.url)) {
            this.showMessage('Please enter a valid URL', 'error');
            return false;
        }

        await this.updateResourceInSection(type, original.id || id, updatedResource, original);
        // Log content update
        try { this.logContentActivity('updated', this.mapToStorageType(type), updatedResource.title); } catch(_) {}
        this.renderCurrentTab();
        this.showMessage(`${type.replace('-', ' ')} updated successfully!`, 'success');
        return true;
    }

    // Generate stable unique IDs for resources in this section: sectionId:type:time:random
    generateResourceId(storageType) {
        try {
            const ts = Date.now().toString(36);
            let rand = '';
            try {
                const arr = new Uint32Array(2);
                (window.crypto || window.msCrypto).getRandomValues(arr);
                rand = Array.from(arr).map(n => n.toString(36)).join('');
            } catch (_) {
                rand = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
            }
            const type = storageType || 'resource';
            return `${this.currentSection}:${type}:${ts}:${rand}`;
        } catch (_) {
            return `${this.currentSection}:${storageType || 'resource'}:${Date.now()}`;
        }
    }

    // Assign missing IDs to legacy resources in this section across local stores and DB (best-effort)
    async ensureResourceIdsForCurrentSection() {
        const sectionId = this.currentSection;
        const types = ['playbooks', 'boxLinks', 'dashboards'];
        try {
            // Section data is stored in Supabase database
            // No local storage needed
        } catch(_) {}

        try {
            // Information hub data is stored in Supabase database
            // No local storage needed
        } catch(_) {}
    }

    async updateResourceInSection(type, id, updatedResource, original) {
        try {
            const uiType = this.mapToStorageType(type);
            const payload = {
                title: updatedResource.title,
                description: updatedResource.description || '',
                url: updatedResource.url,
                tags: updatedResource.tags || [],
                extra: { category: updatedResource.category || '' }
            };
            if (!window.supabaseClient) throw new Error('Supabase unavailable');
            const { error } = await window.supabaseClient
                .from('resources')
                .update(payload)
                .eq('id', id);
            if (error) throw error;
            this._notifyHub({ type: 'RESOURCE_CHANGE', action: 'update', resourceType: uiType });
            return true;
        } catch (error) {
            console.error('Error updating resource:', error);
            this.showMessage('Error updating resource', 'error');
            return false;
        }
    }

    async deleteResource(type, id) {
        if (!this.canDeleteResource()) {
            this.showMessage('You do not have permission to delete resources', 'error');
            return;
        }

        if (!confirm('Are you sure you want to delete this resource?')) return;

        const resources = await this.getResources(type);
        const resource = resources.find(r => String(r.id) === String(id));
        if (!(this.isAdmin() || this.currentUser.role === 'editor') && !this.isResourceOwner(resource)) {
            this.showMessage('You can only delete resources assigned to you', 'error');
            return;
        }

        const ok = await this.removeResourceFromSection(type, id);
        if (!ok) return;
        // Log content deletion (use original resource title if available)
        try { this.logContentActivity('deleted', this.mapToStorageType(type), resource?.title || ''); } catch(_) {}
        this.renderCurrentTab();
        this.showMessage(`${type.replace('-', ' ')} deleted successfully!`, 'success');
    }

    async removeResourceFromSection(type, id) {
        try {
            const uiType = this.mapToStorageType(type);
            if (!window.supabaseClient) throw new Error('Supabase unavailable');
            const { error } = await window.supabaseClient
                .from('resources')
                .delete()
                .eq('id', id);
            if (error) throw error;
            this._notifyHub({ type: 'RESOURCE_CHANGE', action: 'delete', resourceType: uiType });
            return true;
        } catch (error) {
            console.error('Error deleting resource:', error);
            this.showMessage('Error deleting resource', 'error');
            return false;
        }
    }

    // Utility Functions
    mapToStorageType(type) {
        const raw = String(type || '').toLowerCase().trim();
        // Strict mapping for built-ins
        if (raw === 'playbooks' || raw === 'playbook') return 'playbooks';
        if (raw === 'box-links' || raw === 'boxlinks') return 'boxLinks';
        if (raw === 'dashboards' || raw === 'dashboard') return 'dashboards';
        // Custom types: use id as-is (no accidental substring mapping)
        return raw;
    }
    async _requireSupabaseAuth() {
        try {
            if (!window.supabaseClient || !window.supabaseClient.auth) return false;
            const res = await window.supabaseClient.auth.getUser();
            const user = res && res.data ? res.data.user : null;
            if (!user) {
                this.showMessage('Please sign in to perform this action.', 'error');
                try { window.location.href = 'auth.html'; } catch (_) {}
                return false;
            }
            return true;
        } catch (_) { return false; }
    }
    _mapUiTypeToDbType(uiType) {
        // Identity mapping: store UI id directly in resources.type
        return String(uiType || '').toLowerCase().trim();
    }
    _normalizeResourceRow(row, uiType) {
        try {
            return {
                id: row.id,
                title: row.title || '',
                description: row.description || '',
                url: row.url || '',
                tags: Array.isArray(row.tags) ? row.tags : [],
                category: (row.extra && row.extra.category) ? row.extra.category : '',
                createdAt: row.created_at || row.createdAt || new Date().toISOString(),
                updatedAt: row.updated_at || row.updatedAt || undefined,
                userId: row.created_by || row.user_id || row.userId || null,
                type: uiType,
                section_name: (row.sections && row.sections.name) ? row.sections.name : undefined
            };
        } catch (_) {
            return { id: row.id, title: row.title || '', url: row.url || '', tags: [], category: '', createdAt: new Date().toISOString(), type: uiType };
        }
    }
    isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showMessage(message, type) {
        // Remove existing messages
        const existingMessages = document.querySelectorAll('.message');
        existingMessages.forEach(msg => msg.remove());

        // Create new message
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.textContent = message;
        // Ensure message is visible above modals
        try {
            messageDiv.style.position = 'fixed';
            messageDiv.style.top = '12px';
            messageDiv.style.left = '50%';
            messageDiv.style.transform = 'translateX(-50%)';
            messageDiv.style.zIndex = '10000';
            messageDiv.style.padding = '10px 14px';
            messageDiv.style.borderRadius = '8px';
            messageDiv.style.background = type === 'error' ? '#fff5f5' : (type === 'success' ? '#edfdf2' : '#f6f9ff');
            messageDiv.style.border = '1px solid ' + (type === 'error' ? '#ffd6d6' : (type === 'success' ? '#d1fadf' : '#dbe7ff'));
            messageDiv.style.color = type === 'error' ? '#8a1f1f' : (type === 'success' ? '#034d2a' : '#1b3a6b');
        } catch (_) {}
        document.body.appendChild(messageDiv);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            try { messageDiv.remove(); } catch(_) {}
        }, 3000);
    }

    // Inline alert inside modals so errors are visible above overlay
    showModalAlert(modalEl, message, type = 'error') {
        try {
            const host = modalEl && modalEl.querySelector('.modal-content');
            if (!host) { this.showMessage(message, type); return; }
            let alertBox = host.querySelector('.modal-inline-alert');
            if (!alertBox) {
                alertBox = document.createElement('div');
                alertBox.className = 'modal-inline-alert';
                alertBox.style.margin = '8px 0 10px 0';
                alertBox.style.padding = '8px 10px';
                alertBox.style.borderRadius = '6px';
                alertBox.style.border = '1px solid #ffd6d6';
                alertBox.style.background = '#fff5f5';
                alertBox.style.color = '#8a1f1f';
                const header = host.querySelector('.modal-header');
                if (header && header.parentNode) {
                    header.parentNode.insertBefore(alertBox, header.nextSibling);
                } else {
                    host.insertBefore(alertBox, host.firstChild);
                }
            }
            alertBox.textContent = message;
            alertBox.style.display = 'block';
        } catch (_) { this.showMessage(message, type); }
    }

    goBackToHub() {
        // Signal hub to refresh stats immediately on return
        this._notifyHub({ type: 'NAV_BACK', action: 'return', reason: 'tabs_or_counts_may_have_changed' });
        const go = () => { window.location.href = 'index.html'; };
        try {
            if (document.startViewTransition) {
                document.startViewTransition(() => go());
            } else {
                const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                if (!prefersReduced) {
                    document.body.classList.add('fade-out');
                    setTimeout(go, 150);
                } else {
                    go();
                }
            }
        } catch (_) { go(); }
    }

	loadSectionConfig() {
		// Start with no tabs by default; Supabase config controls visibility.
		return { types: [], categories: ['process','procedure','guide','template','checklist'] };
	}

    async saveSectionConfig(cfg) {
        // Defensive merge to avoid blank overwrites
        const incoming = (cfg && typeof cfg === 'object') ? cfg : {};
        try {
            if (!window.supabaseClient) throw new Error('Supabase unavailable');
            // Load existing config
            let existingCfg = {};
            try {
                const cur = await window.supabaseClient
                    .from('sections')
                    .select('config, name, icon, color')
                    .eq('section_id', this.currentSection)
                    .single();
                if (cur && !cur.error) {
                    existingCfg = (typeof cur.data?.config === 'string') ? JSON.parse(cur.data.config) : (cur.data?.config || {});
                }
            } catch (_) { existingCfg = {}; }

            const pickArray = (next, prev) => (Array.isArray(next) && next.length > 0) ? next : (Array.isArray(prev) ? prev : []);
            const merged = {
                // Arrays: only replace when incoming is non-empty
                tabs: pickArray(incoming.tabs, existingCfg.tabs),
                tab_names: pickArray(incoming.tab_names, existingCfg.tab_names),
                types: pickArray(incoming.types, existingCfg.types),
                categories: pickArray(incoming.categories, existingCfg.categories),
                // Scalars: prefer incoming if defined, else keep existing
                intro: (incoming.intro !== undefined ? incoming.intro : (existingCfg.intro || '')),
                visible: (incoming.visible !== undefined ? incoming.visible : (existingCfg.visible !== false)),
                order: (incoming.order !== undefined ? incoming.order : (existingCfg.order || 0))
            };

            // If nothing would change, skip write
            try {
                const before = JSON.stringify(existingCfg);
                const after = JSON.stringify(merged);
                if (before === after) {
                    this.sectionConfig = merged;
                    return true;
                }
            } catch (_) {}

            // Use wrapper first
            let writeOk = false;
            let lastErr = null;
            try {
                if (window.hubDatabase && window.hubDatabaseReady && typeof hubDatabase.saveSectionConfig === 'function') {
                    await hubDatabase.saveSectionConfig(this.currentSection, merged);
                    writeOk = true;
                }
            } catch (we) { lastErr = we; }

            // Fallback: direct upsert with merged config
            if (!writeOk) {
                if (!window.supabaseClient) throw (lastErr || new Error('Supabase unavailable'));
                // Ensure required non-null columns (e.g., name) are present on insert
                let ensure = {};
                try {
                    const { data: existing } = await window.supabaseClient
                        .from('sections')
                        .select('name, icon, color')
                        .eq('section_id', this.currentSection)
                        .single();
                    ensure.name = (existing && existing.name && String(existing.name).trim())
                        ? existing.name
                        : (document.getElementById('sectionName')?.textContent?.trim() || this.currentSection);
                    if (existing && existing.icon) ensure.icon = existing.icon;
                    if (existing && existing.color) ensure.color = existing.color;
                } catch (_) {
                    ensure.name = document.getElementById('sectionName')?.textContent?.trim() || this.currentSection;
                }
                const payload = { section_id: this.currentSection, ...ensure, config: merged };
                const { error: upErr } = await window.supabaseClient
                    .from('sections')
                    .upsert(payload, { onConflict: 'section_id' });
                if (upErr) throw upErr;
                writeOk = true;
            }

            // Verify persisted value matches (best-effort)
            try {
                const { data: verifyRow } = await window.supabaseClient
                    .from('sections')
                    .select('config')
                    .eq('section_id', this.currentSection)
                    .single();
                if (verifyRow && verifyRow.config) {
                    const a = JSON.stringify(merged);
                    const b = JSON.stringify(verifyRow.config);
                    if (a !== b) console.warn('Section config verify mismatch; DB value differs. DB:', verifyRow.config);
                }
            } catch (_) {}

            this.sectionConfig = merged;
            this._notifyHub({ type: 'SECTION_CUSTOMIZE' });
            return true;
        } catch (e) {
            const detail = (e && (e.message || e.details || e.code)) ? (e.message || e.details || e.code) : 'Unknown error';
            this.showMessage(`Failed to save section config: ${detail}`, 'error');
            return false;
        }
    }

    async _refreshSectionConfigFromDb() {
        try {
            if (!window.supabaseClient) return;
            const { data, error } = await window.supabaseClient
                .from('sections')
                .select('name, icon, color, config')
                .eq('section_id', this.currentSection)
                .single();
            if (error) return;
            // Update config for types/categories
            let cfg = null;
            try {
                if (data && data.config && typeof data.config === 'string') {
                    cfg = JSON.parse(data.config);
                } else if (data && data.config && typeof data.config === 'object') {
                    cfg = data.config;
                }
            } catch (_) {
                cfg = (data && data.config && typeof data.config === 'object') ? data.config : null;
            }
            if (cfg) {
                this.sectionConfig = cfg;
            }
            // Update header name and icon/image if available
            try {
                if (data && (data.name || data.icon || cfg)) {
                    const nameEl = document.getElementById('sectionName');
                    const iconEl = document.getElementById('sectionIcon');
                    if (nameEl) {
                        const nm = (data && data.name) ? String(data.name).trim() : '';
                        try {
                            const fallbackName = String(this.currentSection || 'Section')
                                .replace(/[-_]+/g, ' ')
                                .replace(/\b\w/g, c => c.toUpperCase());
                            nameEl.textContent = nm || fallbackName;
                        } catch (_) {
                            nameEl.textContent = nm || (this.currentSection || 'Section');
                        }
                    }
                    if (iconEl) {
                        if (data.icon) {
                            iconEl.className = this.normalizeIconClass(data.icon);
                        } else {
                            // Ensure a default icon when DB has no icon
                            if (iconEl.tagName && iconEl.tagName.toLowerCase() === 'img') {
                                iconEl.outerHTML = '<i id="sectionIcon" class="fa-solid fa-table-cells-large"></i>';
                            } else {
                                iconEl.className = 'fa-solid fa-table-cells-large';
                            }
                        }
                    }
                    // Update document title with section name
                    if (data && data.name) {
                        document.title = `${data.name} - Information Hub`;
                    }
                }
            } catch (_) {}
            // Re-render UI with any config changes
            this.renderDynamicUI();
            this.renderCurrentTab();
        } catch (_) {}
    }

		renderDynamicUI() {
        // Customize button visibility
        const customizeBtn = document.getElementById('customizeBtn');
        if (customizeBtn) {
            customizeBtn.style.display = this.canCustomizeSection() ? 'inline-flex' : 'none';
        }
				// Build visible types from tabs + tab_names; robust fallbacks when config is partial
			const cfg = this.sectionConfig || {};
			const tabsArr = Array.isArray(cfg.tabs) ? cfg.tabs : [];
			const tabNames = Array.isArray(cfg.tab_names) ? cfg.tab_names : [];
			const typesArr = Array.isArray(cfg.types) ? cfg.types : [];
			const typesById = new Map(typesArr.map(t => [String(t?.id || '').trim(), t]));
			let visibleTypes = [];
			if (tabsArr.length > 0) {
				visibleTypes = tabsArr.map((rawId, i) => {
					const id = String(rawId || '').trim();
					const base = typesById.get(id) || {};
					const name = String((tabNames[i] !== undefined && tabNames[i] !== null && String(tabNames[i]).trim()) ? tabNames[i] : (base.name || id)).trim();
					const icon = String(base.icon || '').trim();
					return { id, name, icon };
				}).filter(t => t.id);
			} else {
				// Fallback 1: configured types
				visibleTypes = (typesArr || [])
					.filter(t => t && !t.hidden)
					.map(t => {
						const id = String(t.id || t.name || '').trim();
						return id ? { id, name: t.name || id, icon: t.icon || '' } : null;
					})
					.filter(Boolean);
				// Fallback 2: derive ids from tab_names if still empty
				if (visibleTypes.length === 0 && tabNames.length > 0) {
					visibleTypes = tabNames.map((nm) => {
						const id = String(nm || '').trim();
						const base = typesById.get(id) || {};
						const icon = String(base.icon || '').trim();
						return id ? { id, name: String(nm || id).trim(), icon } : null;
					}).filter(Boolean);
				}
			}
			// Render tabs
			const tabs = document.getElementById('navTabs');
			if (tabs) {
				if (visibleTypes.length === 0) {
					tabs.innerHTML = '';
					this.currentTab = '';
				} else {
					tabs.innerHTML = visibleTypes.map((t, idx) => {
						const active = (idx === 0 ? 'active' : '');
						const iconCls = this.normalizeIconClass(t.icon || '');
						return `<div class="nav-tab ${active}" onclick="switchTab('${t.id}')">
							<i class="${iconCls}"></i> ${this.escapeHtml(t.name || t.id)}
						</div>`;
					}).join('');
					// set default current tab to first visible type if none selected
					if (!this.currentTab && visibleTypes[0]) {
						this.currentTab = visibleTypes[0].id;
					}
				}
			}
        // Render category filter
        const catSel = document.getElementById('categoryFilter');
        if (catSel) {
            const options = ['<option value="">All Categories</option>'].concat(
                (this.sectionConfig.categories || []).map(c => `<option value="${this.escapeHtml(c)}">${this.escapeHtml(c.charAt(0).toUpperCase()+c.slice(1))}</option>`) 
            );
            catSel.innerHTML = options.join('');
        }
			// Render content sections containers
			const wrap = document.getElementById('dynamic-sections');
				if (wrap) {
				if (visibleTypes.length === 0) {
					wrap.innerHTML = `<div class="content-blank" style="padding:24px; text-align:center; color:#666;">No tabs configured yet.</div>`;
				} else {
					wrap.innerHTML = visibleTypes.map((t, idx) => {
						const active = (idx === 0 ? 'active' : '');
						return `<div class="content-section ${active}" id="${t.id}-section">
							<button class="add-resource-btn" onclick="addResource('${t.id}')" style="display: none;">
								<i class="fas fa-plus"></i> Add ${this.escapeHtml(t.name || t.id)}
							</button>
							<div class="resource-grid" id="${t.id}-grid"></div>
						</div>`;
					}).join('');
				}
			}
    }

    openCustomizeModal() {
        if (!this.canCustomizeSection()) {
            this.showMessage('You do not have permission to customize', 'error');
            return;
        }
        const cfg = this.sectionConfig;
        const modal = document.createElement('div');
        modal.className = 'modal';
        const cats = this.escapeHtml((cfg.categories || []).join(', '));
        modal.innerHTML = `
            <div class="modal-content" style="max-width:780px; width:95%;">
                <div class="modal-header">
                    <h2>Customize Tabs & Categories</h2>
                    <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
                </div>
                <div class="modal-body" style="max-height:62vh; overflow:auto; padding-bottom:6px;">
                    <div id="cfgAlert" style="position:sticky; top:0; z-index:1; display:none; background:#f6f9ff; border:1px solid #dbe7ff; color:#1b3a6b; padding:8px 10px; border-radius:6px; margin:0 0 10px 0;"></div>
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin:4px 0 8px 0;">
                        <strong>Tabs (Types)</strong>
                        <button type="button" class="btn btn-secondary" id="addTypeBtn"><i class="fas fa-plus"></i> Add Type</button>
                    </div>
                    <div class="type-header" style="display:grid; grid-template-columns:1fr 1fr 1fr auto; gap:8px; align-items:center; padding:6px 8px; border:1px solid #e6eaf0; background:#f9fafb; border-radius:8px; margin-bottom:6px; font-weight:600; color:#334155;">
                        <div>ID</div>
                        <div>Name</div>
                        <div>Icon</div>
                        <div>Actions</div>
                    </div>
                    <div id="typeList" style="display:flex; flex-direction:column; gap:8px; max-height:320px; overflow:auto; border:1px solid #eee; border-radius:8px; padding:8px; background:#fff;"></div>
                    <div style="margin:12px 0 6px 0;"><strong>Categories</strong></div>
                    <input id="cfgCats" type="text" style="width:100%;" value="${cats}" placeholder="e.g., process, procedure, guide, template, checklist" />
                </div>
                <div class="form-actions" style="padding:12px 16px 18px 16px; display:flex; gap:10px; justify-content:flex-end;">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()">Cancel</button>
                    <button type="button" class="btn btn-primary" id="saveCfgBtn">Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.style.display = 'block';

        const typeList = modal.querySelector('#typeList');
        const alertBox = modal.querySelector('#cfgAlert');
        const showAlert = (msg, kind) => {
            if (!alertBox) return;
            alertBox.style.display = 'block';
            alertBox.style.background = kind === 'error' ? '#fff5f5' : '#f6f9ff';
            alertBox.style.borderColor = kind === 'error' ? '#ffd6d6' : '#dbe7ff';
            alertBox.style.color = kind === 'error' ? '#8a1f1f' : '#1b3a6b';
            alertBox.textContent = msg;
            setTimeout(() => { try { alertBox.style.display = 'none'; } catch(_) {} }, 2500);
        };

        const makeRow = (t) => {
            const row = document.createElement('div');
            row.className = 'type-row';
            row.style.display = 'grid';
            row.style.gridTemplateColumns = '1fr 1fr 1fr auto';
            row.style.gap = '8px';
            row.style.alignItems = 'center';
            row.style.border = '1px solid #eee';
            row.style.borderRadius = '8px';
            row.style.padding = '8px';
            const iconClassInit = t.icon || 'fas fa-circle';
            row.innerHTML = `
                <input type=\"text\" class=\"type-id\" placeholder=\"id (e.g., playbooks)\" value=\"${this.escapeHtml(t.id || '')}\">
                <input type=\"text\" class=\"type-name\" placeholder=\"name (e.g., Playbooks)\" value=\"${this.escapeHtml(t.name || t.id || '')}\">
                <div class=\"icon-cell\" style=\"display:flex; align-items:center; gap:8px;\">
                    <button type=\"button\" class=\"btn btn-secondary icon-choose\" title=\"Choose icon\" style=\"display:flex; align-items:center; gap:8px;\">
                        <i class=\"icon-preview ${this.escapeHtml(iconClassInit)}\" style=\"font-size:18px;\"></i>
                        <span>Choose</span>
                    </button>
                    <input type=\"hidden\" class=\"type-icon\" value=\"${this.escapeHtml(iconClassInit)}\">
                </div>
                <div style=\"display:flex; gap:6px;\">
                    <button type=\"button\" class=\"btn btn-secondary btn-up\" title=\"Move up\"><i class=\"fas fa-arrow-up\"></i></button>
                    <button type=\"button\" class=\"btn btn-secondary btn-down\" title=\"Move down\"><i class=\"fas fa-arrow-down\"></i></button>
                    <button type=\"button\" class=\"btn btn-danger btn-del\" title=\"Remove\"><i class=\"fas fa-trash\"></i></button>
                </div>
            `;
            // Inline icon picker panel
            const panel = document.createElement('div');
            panel.className = 'icon-picker-panel';
            panel.style.display = 'none';
            panel.style.gridColumn = '1 / -1';
            panel.style.borderTop = '1px dashed #eee';
            panel.style.marginTop = '8px';
            panel.style.paddingTop = '8px';
            panel.innerHTML = `
                <div style=\"display:flex; gap:8px; align-items:center; margin-bottom:6px;\">
                    <input type=\"text\" class=\"icon-search\" placeholder=\"Search icons (e.g., book, link)\" style=\"flex:1; padding:6px 8px; border:1px solid #e1e5e9; border-radius:6px;\">
                    <button type=\"button\" class=\"btn btn-secondary icon-close\">Close</button>
                </div>
                <div class=\"icon-grid\" style=\"display:grid; grid-template-columns:repeat(auto-fill, minmax(44px,1fr)); gap:8px; max-height:160px; overflow:auto; border:1px solid #eee; padding:8px; border-radius:6px; background:#fff;\"></div>
            `;
            row.appendChild(panel);
            row.querySelector('.btn-up').addEventListener('click', () => {
                const prev = row.previousElementSibling;
                if (prev) typeList.insertBefore(row, prev);
            });
            row.querySelector('.btn-down').addEventListener('click', () => {
                const next = row.nextElementSibling?.nextElementSibling;
                typeList.insertBefore(row, next || null);
            });
            row.querySelector('.btn-del').addEventListener('click', () => {
                row.remove();
            });
            // Icon choose behavior
            const iconBtn = row.querySelector('.icon-choose');
            const iconPrev = row.querySelector('.icon-preview');
            const iconInput = row.querySelector('.type-icon');
            const iconGrid = panel.querySelector('.icon-grid');
            const iconSearch = panel.querySelector('.icon-search');
            const iconClose = panel.querySelector('.icon-close');
            const faIcons = [
                'fas fa-book','fas fa-link','fas fa-chart-bar','fas fa-file-alt','fas fa-database','fas fa-cube','fas fa-cubes','fas fa-table','fas fa-diagram-project','fas fa-clipboard-list','fas fa-sitemap','fas fa-bolt','fas fa-shield-halved','fas fa-globe','fas fa-briefcase','fas fa-pen','fas fa-user','fas fa-users','fas fa-layer-group','fas fa-gears'
            ];
            const renderIcons = (filter) => {
                const term = String(filter || '').toLowerCase().trim().replace(/\s+/g,'-');
                iconGrid.innerHTML = '';
                faIcons.filter(cls => !term || cls.includes(term)).forEach(cls => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'btn';
                    btn.style.border = '1px solid #ddd';
                    btn.style.borderRadius = '6px';
                    btn.style.padding = '8px';
                    btn.style.display = 'flex';
                    btn.style.justifyContent = 'center';
                    btn.style.alignItems = 'center';
                    btn.style.background = '#fff';
                    btn.style.cursor = 'pointer';
                    btn.innerHTML = `<i class="${cls}" style="font-size:18px;"></i>`;
                    btn.addEventListener('click', () => {
                        iconPrev.className = `icon-preview ${cls}`;
                        iconInput.value = cls;
                        panel.style.display = 'none';
                    });
                    iconGrid.appendChild(btn);
                });
            };
            renderIcons('');
            iconBtn.addEventListener('click', () => {
                panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
                if (panel.style.display === 'block') {
                    iconSearch.value = '';
                    renderIcons('');
                }
            });
            iconClose.addEventListener('click', () => { panel.style.display = 'none'; });
            iconSearch.addEventListener('input', () => renderIcons(iconSearch.value));
            return row;
        };

        // Seed existing types
        (cfg.types || []).filter(t => !t.hidden).forEach(t => typeList.appendChild(makeRow(t)));

        // Local normalizer to ensure consistent IDs and detect collisions
        const normalizeTypeIdLocal = (raw) => {
            try {
                let t = String(raw || '').toLowerCase().trim();
                t = t.replace(/\s+/g, '-');
                t = t.replace(/_/g, '-');
                // Collapse repeats and strip invalids
                t = t.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
                // Canonicalize built-ins and common synonyms
                if (t === 'playbook') t = 'playbooks';
                if (t === 'boxlink' || t === 'box-links' || t === 'boxlinks' || t === 'box') t = 'box-links';
                if (t === 'dashboard') t = 'dashboards';
                return t;
            } catch (_) { return String(raw || '').toLowerCase().trim(); }
        };

        modal.querySelector('#addTypeBtn').addEventListener('click', () => {
            // Suggest a unique ID automatically
            try {
                const existingIds = Array.from(typeList.querySelectorAll('.type-row .type-id'))
                    .map(inp => normalizeTypeIdLocal(inp.value || ''))
                    .filter(Boolean);
                let idx = 1;
                let candidate = 'type';
                while (existingIds.includes(candidate) || !candidate) {
                    idx++;
                    candidate = `type-${idx}`;
                }
                typeList.appendChild(makeRow({ id: candidate, name: '', icon: '' }));
            } catch (_) {
                typeList.appendChild(makeRow({ id: '', name: '', icon: '' }));
            }
            showAlert('Added a new type row', 'info');
        });

			modal.querySelector('#saveCfgBtn').addEventListener('click', async () => {
            // Collect rows in UI order
            const rows = Array.from(typeList.querySelectorAll('.type-row'));
            // Normalize and build last-wins dedup by id while preserving final order
            const normalized = rows.map((r, idx) => ({
                rawId: String(r.querySelector('.type-id')?.value || '').trim(),
                name: String(r.querySelector('.type-name')?.value || '').trim(),
                icon: String(r.querySelector('.type-icon')?.value || '').trim(),
                idx
            })).filter(t => t.rawId);
            const lastIndexById = new Map();
            const rowById = new Map();
            normalized.forEach(t => {
                const id = normalizeTypeIdLocal(t.rawId);
                lastIndexById.set(id, t.idx);
                rowById.set(id, { id, name: t.name, icon: t.icon });
            });
            if (rowById.size === 0) {
                showAlert('Provide at least one type with an id', 'error');
                return;
            }
            const sortedIds = Array.from(lastIndexById.entries()).sort((a, b) => a[1] - b[1]).map(e => e[0]);
				const secId = this.currentSection;
				// Merge with current config in Supabase to avoid overwriting or losing tabs
				let existingCfg = {};
				try {
					if (window.supabaseClient) {
						const cur = await window.supabaseClient
							.from('sections')
							.select('config')
							.eq('section_id', secId)
							.single();
						if (!cur.error && cur.data) {
							existingCfg = (typeof cur.data.config === 'string') ? JSON.parse(cur.data.config) : (cur.data.config || {});
						}
					}
				} catch (_) { existingCfg = {}; }

				const existingTypesArr = Array.isArray(existingCfg.types) ? existingCfg.types : [];
				const typesById = new Map(existingTypesArr.map(t => [String(t?.id || '').trim(), { id: t.id, name: t.name || t.id, icon: t.icon || '', key: t.key || `${secId}:${t.id}` }]));
				// Apply UI rows as last-wins updates
				sortedIds.forEach(id => {
					const t = rowById.get(id);
					typesById.set(id, { id, name: t.name || id, icon: t.icon, key: `${secId}:${id}` });
				});
				const types = sortedIds.map(id => typesById.get(id));
				const catsRaw = modal.querySelector('#cfgCats').value || '';
				const categories = catsRaw.split(',').map(s => s.trim()).filter(Boolean);
				const tabs = sortedIds;
				const tab_names = sortedIds.map(id => (rowById.get(id)?.name || typesById.get(id)?.name || id));
				const cfgMerged = Object.assign({}, existingCfg, { types, categories, tabs, tab_names });
				const ok = await this.saveSectionConfig(cfgMerged);
            if (!ok) { showAlert('Failed to save configuration', 'error'); return; }
				// Record tab activities (create/update/delete) to activities table
				try {
					if (window.hubDatabase && typeof hubDatabase.saveActivity === 'function' && this.currentUser) {
						const prevIds = Array.isArray(existingCfg.tabs) ? existingCfg.tabs.map(s => String(s || '').trim()).filter(Boolean) : [];
						const prevNamesArr = Array.isArray(existingCfg.tab_names) ? existingCfg.tab_names.map(s => String(s || '').trim()) : [];
						const prevTypesArr = Array.isArray(existingCfg.types) ? existingCfg.types : [];
						const prevNameById = new Map();
						prevIds.forEach((id, idx) => {
							let nm = prevNamesArr[idx];
							if (!nm) {
								const t = prevTypesArr.find(x => String(x?.id || '').trim() === id);
								nm = (t && t.name) ? String(t.name).trim() : id;
							}
							prevNameById.set(id, (nm && String(nm).trim()) ? String(nm).trim() : id);
						});

						const nextIds = sortedIds.map(s => String(s || '').trim()).filter(Boolean);
						const nextNameById = new Map();
						nextIds.forEach(id => {
							const row = rowById.get(id);
							const nm = row && row.name ? String(row.name).trim() : id;
							nextNameById.set(id, nm || id);
						});

						const prevSet = new Set(prevIds);
						const nextSet = new Set(nextIds);
						const ts = new Date().toISOString();
						const uname = this.currentUser.username || this.currentUser.email || null;
						const sid = this.currentSection;

						// Creates
						nextIds.forEach(id => {
							if (!prevSet.has(id)) {
								this._safeDbCall(hubDatabase.saveActivity({
									action: 'CREATE_TAB',
									section: sid,
									timestamp: ts,
									username: uname,
									metadata: { tabId: id, name: nextNameById.get(id) || id }
								}), 1200);
							}
						});

						// Deletions
						prevIds.forEach(id => {
							if (!nextSet.has(id)) {
								this._safeDbCall(hubDatabase.saveActivity({
									action: 'DELETE_TAB',
									section: sid,
									timestamp: ts,
									username: uname,
									metadata: { tabId: id, name: prevNameById.get(id) || id }
								}), 1200);
							}
						});

						// Renames (ids unchanged, name changed)
						nextIds.forEach(id => {
							if (prevSet.has(id)) {
								const oldName = prevNameById.get(id) || id;
								const newName = nextNameById.get(id) || id;
								if (String(oldName).trim() !== String(newName).trim()) {
									this._safeDbCall(hubDatabase.saveActivity({
										action: 'UPDATE_TAB',
										section: sid,
										timestamp: ts,
										username: uname,
										metadata: { tabId: id, oldName, newName }
									}), 1200);
								}
							}
						});
					}
				} catch (_) { /* best-effort logging; ignore */ }
            // Seed example resources for any types that have none yet in Supabase
            try { await this._seedExampleResourcesIfMissing(types); } catch (_) {}
            this.renderDynamicUI();
            this.renderCurrentTab();
            this.showMessage('Section customized', 'success');
            modal.remove();
        });
    }

    _notifyHub(message) {
        try {
            if (this._bc) {
                this._bc.postMessage({
                    source: 'section',
                    sectionId: this.currentSection,
                    timestamp: Date.now(),
                    ...message
                });
            }
        } catch (_) {}
        // Refresh notifications are handled through Supabase realtime
        // No local storage needed
    }

    // Periodic auto-refresh for Supabase-backed data
    _setupAutoRefresh() {
        // Avoid duplicate timers
        if (this._ghRefreshTimer) try { clearInterval(this._ghRefreshTimer); } catch(_) {}
        const tick = async () => {
            try {
                // Skip heavy work if tab not visible
                if (document.hidden) return;
                // Refresh config (types/categories) and re-render tabs if changed
                await this._refreshSectionConfigFromDb();
                // Refresh currently visible tab resources
                await this.renderCurrentTab();
            } catch (_) {}
        };
        // First delayed run to avoid contention at load
        setTimeout(tick, 2000);
        this._ghRefreshTimer = setInterval(tick, 60000);
        // Clean up on unload
        window.addEventListener('beforeunload', () => { try { clearInterval(this._ghRefreshTimer); } catch(_) {} });
        document.addEventListener('visibilitychange', () => { /* opportunistic tick on return */ if (!document.hidden) setTimeout(() => tick().catch(()=>{}), 250); });
    }

    _setupRealtime() {
        try {
            if (!window.supabaseClient) return;
            if (this._rtCh) { try { window.supabaseClient.removeChannel(this._rtCh); } catch(_) {} }
            const sid = this.currentSection;
            const ch = window.supabaseClient
                .channel('section-' + sid)
				.on('postgres_changes', { event: '*', schema: 'public', table: 'resources', filter: 'section_id=eq.' + sid }, async () => {
					// Do not auto-add tabs from resources; only refresh current tab content if one is selected
					try { await this.renderCurrentTab(); } catch(_) {}
				})
                .on('postgres_changes', { event: '*', schema: 'public', table: 'sections', filter: 'section_id=eq.' + sid }, async () => {
                    try { await this._refreshSectionConfigFromDb(); } catch(_) {}
                })
                .subscribe();
            this._rtCh = ch;
            window.addEventListener('beforeunload', () => { try { window.supabaseClient.removeChannel(ch); } catch(_) {} }, { once: true });
        } catch (_) {}
    }
}

// Initialize section manager when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    const sectionManager = new SectionManager();
    await sectionManager.init();
});
