// Section Page JavaScript - Handles individual section functionality
class SectionManager {
    constructor() {
        this.currentUser = this.getCurrentUser();
        this.currentSection = this.getCurrentSectionFromURL();
        this.currentTab = 'playbooks';
        this.sectionConfig = this.loadSectionConfig();
        this._bc = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('hub-sync') : null;
        this.init();
    }

    // Content activity logger (no-op without Supabase auth)
    logContentActivity(action, resourceType, title) { try {} catch (_) {} }

    getCurrentUser() {
        // Get current user from Supabase auth
        if (window.supabaseClient) {
            return window.supabaseClient.auth.getUser();
        }
        return null;
    }

    async init() {
        if (!this.validateSession()) {
            return;
        }
        this.checkAccess();
        // Section session start
        this.sectionSessionStartMs = Date.now();
        // IDs are handled by Supabase; no local migrations
        await this.loadSectionData();
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

    checkAccess() {
        if (!this.currentUser) {
            window.location.href = 'auth.html';
            return;
        }

        // Admins or users with global edit can always view sections
        if (this.currentUser.role === 'admin' || this.currentUser.permissions?.canEditAllSections) {
            return;
        }

        if (!this.currentUser.permissions.sections.includes(this.currentSection)) {
            alert('You do not have access to this section');
            window.location.href = 'index.html';
            return;
        }
    }

    async loadSectionData() {
        // Load section information from Supabase database
        let sectionConfig = null;
        
        try {
            if (window.hubDatabase && window.hubDatabaseReady) {
                const sections = await hubDatabase.getAllSections();
                sectionConfig = sections.find(s => s.id === this.currentSection) || null;
                console.log('Loaded section config from Supabase:', sectionConfig);
            } else {
                console.log('Database not ready, using fallback config');
            }
        } catch (error) {
            console.error('Error loading section data from Supabase:', error);
        }

        if (!sectionConfig) {
            // No named defaults; show section id and a generic icon
            sectionConfig = { name: this.currentSection, icon: 'fas fa-th-large', intro: '' };
        }

        const nameEl = document.getElementById('sectionName');
        const iconEl = document.getElementById('sectionIcon');
        if (nameEl) nameEl.textContent = sectionConfig.name || this.currentSection;
        if (iconEl) {
            if (sectionConfig.image) {
                try {
                    iconEl.outerHTML = `<img id="sectionIcon" src="${sectionConfig.image}" style="width:22px;height:22px;object-fit:contain;margin-right:8px;" />`;
                } catch (_) {
                    iconEl.className = this.normalizeIconClass(sectionConfig.icon || 'fa-solid fa-table-cells-large');
                }
            } else {
                iconEl.className = this.normalizeIconClass(sectionConfig.icon || 'fa-solid fa-table-cells-large');
            }
        }
        document.title = `${sectionConfig.name || this.currentSection} - Information Hub`;

        // Intro text
        const introEl = document.getElementById('sectionIntro');
        if (introEl) {
            const intro = (sectionConfig.intro || '').trim();
            introEl.textContent = intro;
            introEl.style.display = intro ? 'block' : 'none';
        }

        // Apply persistent background image per section (defer heavy images)
        try {
            const disable = false; // Background images disabled by default for performance
            const map = {}; // No local storage for background images
            let img = map[this.currentSection];
            const container = document.querySelector('.container');
            const preferList = [
                'background-pic/159484_L.png','background-pic/162053_L.png','background-pic/162054_L.png','background-pic/162058_L.png',
                'background-pic/162062_L.png','background-pic/168817_L.png','background-pic/171327_Y.png','background-pic/537081_L.png',
                'background-pic/537082_K.png','background-pic/560846_L.png'
            ];
            const heavyList = [
                'background-pic/SU24CBY_FESTIVAL_B_LONGFORM_GIF_1920x1080.gif','background-pic/SU25CBY_RST_GROUP.gif'
            ];
            if (!img) {
                const idx = Math.abs(this._hash(this.currentSection)) % preferList.length;
                img = preferList[idx];
            }
            if (container) {
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
                        const chosen = heavyList.includes(img) ? preferList[0] : img;
                        // Prefer WebP if available using the hub page helper when present
                        let finalUrl = chosen;
                        try {
                            if (typeof window.getOptimizedImageUrl === 'function') {
                                const opt = await window.getOptimizedImageUrl(chosen);
                                if (opt) finalUrl = opt;
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
    validateSession() {
        // Validate session using Supabase auth
        if (!window.supabaseClient) {
            window.location.href = 'auth.html';
            return false;
        }
        
        try {
            const user = window.supabaseClient.auth.getUser();
            this.currentUser = user;
            return true;
        } catch (e) {
            window.location.href = 'auth.html';
            return false;
        }
    }

    getCurrentSectionFromURL() {
        // Extract section from URL or use stored section
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('section') || sessionStorage.getItem('currentSection') || 'costing';
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
        // Live update section config across tabs/windows
        window.addEventListener('storage', (e) => {
            try {
                if (e && e.key === `section_config_${this.currentSection}`) {
                    this.sectionConfig = this.loadSectionConfig();
                    this.renderDynamicUI();
                    this.renderCurrentTab();
                }
            } catch (_) {}
        });
    }

    setupSectionSessionLogging() {
        const logClose = () => {
            if (this._sectionSessionLogged) return;
            this._sectionSessionLogged = true;
            const durationMs = Date.now() - (this.sectionSessionStartMs || Date.now());
            try {
                // Optionally write to Supabase activities if you decide to expose it client-side
            } catch (_) {}
        };
        window.addEventListener('beforeunload', logClose);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) logClose();
        });
        // Log open
        try {
            // Optionally write OPEN_SECTION to Supabase here
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
        const uiType = this.mapToStorageType(type); // 'playbooks' | 'boxLinks' | 'dashboards'
        const dbType = this._mapUiTypeToDbType(uiType); // 'playbook' | 'link' | 'dashboard'
        if (!window.supabaseClient) return [];
        try {
            const { data, error } = await window.supabaseClient
                .from('resources')
                .select('*')
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
        const label = storageType === 'playbooks' ? 'PLAYBOOK' : storageType === 'boxLinks' ? 'BOX LINK' : 'DASHBOARD';
        const iconClass = storageType === 'playbooks' ? 'fas fa-book' : storageType === 'boxLinks' ? 'fas fa-link' : 'fas fa-chart-bar';

        const canEdit = this.canEditResource() && (this.isAdmin() || this.isResourceOwner(resource));
        const canDelete = this.currentUser && this.currentUser.permissions.canDeleteResources && (this.isAdmin() || this.isResourceOwner(resource)) && this.canEditResource();

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
            } catch (_) {}
        });
    }

    getFilteredResources(resources) {
        const searchTerm = document.getElementById('searchInput')?.value.toLowerCase() || '';
        const categoryFilter = document.getElementById('categoryFilter')?.value || '';

        return resources.filter(resource => {
            const title = (resource.title || '').toLowerCase();
            const description = (resource.description || '').toLowerCase();
            const url = (resource.url || '').toLowerCase();
            const matchesSearch = !searchTerm ||
                title.includes(searchTerm) ||
                description.includes(searchTerm) ||
                (resource.tags && resource.tags.some(tag => String(tag).toLowerCase().includes(searchTerm))) ||
                url.includes(searchTerm);

            const matchesCategory = !categoryFilter || resource.category === categoryFilter;

            return matchesSearch && matchesCategory;
        });
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
        return this.currentUser.permissions.canEditAllSections || 
               this.currentUser.permissions.editableSections.includes(this.currentSection);
    }

    canDeleteResource() {
        if (!this.currentUser) return false;
        return this.currentUser.permissions.canDeleteResources && this.canEditResource();
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
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Add New ${type.replace('-', ' ').toUpperCase()}</h2>
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
            this.showMessage('Error saving resource', 'error');
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
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Edit ${type.replace('-', ' ').toUpperCase()}</h2>
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
        if (!this.isAdmin() && !this.isResourceOwner(resource)) {
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
        if (uiType === 'playbooks') return 'playbook';
        if (uiType === 'boxLinks') return 'link';
        if (uiType === 'dashboards') return 'dashboard';
        return String(uiType || '').trim();
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
                type: uiType
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

        // Insert at the top of the container
        const container = document.querySelector('.container');
        container.insertBefore(messageDiv, container.firstChild);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            messageDiv.remove();
        }, 3000);
    }

    goBackToHub() {
        // Signal hub to refresh stats immediately on return
        this._notifyHub({ type: 'NAV_BACK' });
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
        // Default config as placeholder; refreshed from Supabase asynchronously
        return {
            types: [
                { id: 'playbooks', name: 'Playbooks', icon: 'fas fa-book' },
                { id: 'box-links', name: 'Box Links', icon: 'fas fa-link' },
                { id: 'dashboards', name: 'Dashboards', icon: 'fas fa-chart-bar' }
            ],
            categories: ['process','procedure','guide','template','checklist']
        };
    }

    async saveSectionConfig(cfg) {
        try {
            this.sectionConfig = cfg;
            if (!window.supabaseClient) return;
            const payload = { section_id: this.currentSection, config: cfg };
            const { error } = await window.supabaseClient.from('sections').upsert(payload, { onConflict: 'section_id' });
            if (error) throw error;
            this._notifyHub({ type: 'SECTION_CUSTOMIZE' });
        } catch (_) {}
    }

    async _refreshSectionConfigFromDb() {
        try {
            if (!window.supabaseClient) return;
            const { data, error } = await window.supabaseClient
                .from('sections')
                .select('config')
                .eq('section_id', this.currentSection)
                .single();
            if (error) return;
            const cfg = (data && data.config && typeof data.config === 'object') ? data.config : null;
            if (cfg) {
                this.sectionConfig = cfg;
                this.renderDynamicUI();
                this.renderCurrentTab();
            }
        } catch (_) {}
    }

    renderDynamicUI() {
        // Customize button visibility
        const customizeBtn = document.getElementById('customizeBtn');
        if (customizeBtn) {
            customizeBtn.style.display = this.isAdmin() ? 'inline-flex' : 'none';
        }
            // Render tabs
        const tabs = document.getElementById('navTabs');
        if (tabs) {
            tabs.innerHTML = this.sectionConfig.types.filter(t => !t.hidden).map((t, idx) => {
                const active = (idx === 0 ? 'active' : '');
                const iconCls = this.normalizeIconClass(t.icon || '');
                return `<div class="nav-tab ${active}" onclick="switchTab('${t.id}')">
                    <i class="${iconCls}"></i> ${this.escapeHtml(t.name || t.id)}
                </div>`;
            }).join('');
            // set default current tab to first type id
                const firstVisible = (this.sectionConfig.types || []).find(t => !t.hidden);
                if (firstVisible) {
                    this.currentTab = firstVisible.id;
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
            wrap.innerHTML = this.sectionConfig.types.filter(t => !t.hidden).map((t, idx) => {
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

    openCustomizeModal() {
        if (!this.isAdmin()) {
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

        modal.querySelector('#addTypeBtn').addEventListener('click', () => {
            typeList.appendChild(makeRow({ id: '', name: '', icon: '' }));
            showAlert('Added a new type row', 'info');
        });

        modal.querySelector('#saveCfgBtn').addEventListener('click', () => {
            // Collect
            const rows = Array.from(typeList.querySelectorAll('.type-row'));
            const types = rows.map(r => ({
                id: String(r.querySelector('.type-id')?.value || '').trim(),
                name: String(r.querySelector('.type-name')?.value || '').trim(),
                icon: String(r.querySelector('.type-icon')?.value || '').trim()
            })).filter(t => t.id);
            if (types.length === 0) {
                showAlert('Provide at least one type with an id', 'error');
                return;
            }
            // Validate uniqueness of ids
            const seen = new Set();
            for (const t of types) {
                const id = t.id.toLowerCase();
                if (seen.has(id)) {
                    showAlert(`Duplicate type id: ${t.id}`, 'error');
                    return;
                }
                seen.add(id);
            }
            const catsRaw = modal.querySelector('#cfgCats').value || '';
            const categories = catsRaw.split(',').map(s => s.trim()).filter(Boolean);
            const validTypes = types.map(t => ({ id: t.id, name: t.name || t.id, icon: t.icon }));
            const cfgNew = { types: validTypes, categories };
            try {
                this.saveSectionConfig(cfgNew);
                this.renderDynamicUI();
                this.renderCurrentTab();
                this.showMessage('Section customized', 'success');
                modal.remove();
            } catch (e) {
                showAlert('Failed to save configuration', 'error');
            }
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
