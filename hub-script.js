// Information Hub - Main JavaScript File
class InformationHub {
    constructor() {
        this.currentUser = null;
        this.sections = {
            'costing': {
                name: 'Costing',
                icon: 'fas fa-calculator',
                color: '#4CAF50',
                playbooks: [],
                boxLinks: [],
                dashboards: []
            },
            'supply-planning': {
                name: 'Supply Planning',
                icon: 'fas fa-truck',
                color: '#2196F3',
                playbooks: [],
                boxLinks: [],
                dashboards: []
            },
            'operations': {
                name: 'Operations',
                icon: 'fas fa-cogs',
                color: '#FF9800',
                playbooks: [],
                boxLinks: [],
                dashboards: []
            },
            'quality': {
                name: 'Quality Management',
                icon: 'fas fa-check-circle',
                color: '#9C27B0',
                playbooks: [],
                boxLinks: [],
                dashboards: []
            },
            'hr': {
                name: 'Human Resources',
                icon: 'fas fa-users',
                color: '#E91E63',
                playbooks: [],
                boxLinks: [],
                dashboards: []
            },
            'it': {
                name: 'IT & Technology',
                icon: 'fas fa-laptop-code',
                color: '#607D8B',
                playbooks: [],
                boxLinks: [],
                dashboards: []
            },
            'sales': {
                name: 'Sales & Marketing',
                icon: 'fas fa-chart-line',
                color: '#795548',
                playbooks: [],
                boxLinks: [],
                dashboards: []
            },
            'compliance': {
                name: 'Compliance & Legal',
                icon: 'fas fa-gavel',
                color: '#F44336',
                playbooks: [],
                boxLinks: [],
                dashboards: []
            },
            'test-section': {
                name: 'Test Section',
                icon: 'fas fa-test',
                color: '#007bff',
                playbooks: [],
                boxLinks: [],
                dashboards: []
            }
        };
        
        this.currentSection = null;
        this.init();
    }

    async init() {
        this.checkAuthentication();
        await this.loadData();
        this.bindEvents();
        // Start blank by default; no sample data seeding
        this.updateUserInterface();
        // Track hub page session
        this.hubSessionStartMs = Date.now();
        try {
            if (window.hubDatabase && hubDatabase.saveActivity && this.currentUser) {
                hubDatabase.saveActivity({
                    id: Date.now().toString(),
                    userId: this.currentUser.id,
                    username: this.currentUser.username,
                    action: 'OPEN_HUB',
                    description: 'Opened hub page',
                    timestamp: new Date().toISOString()
                });
            }
        } catch (_) {}
        this._hubSessionLogged = false;
        this.setupHubSessionLogging();
        // Auto-refresh from Supabase database
        try { this.setupSupabaseAutoRefresh(); } catch (_) {}
    }

    checkAuthentication() {
        // Authentication is handled by Supabase auth
        if (!window.supabaseClient) {
            window.location.href = 'auth.html';
            return;
        }
        // Get current user from Supabase auth
        this.currentUser = window.supabaseClient.auth.getUser();
    }

    updateUserInterface() {
        if (!this.currentUser) return;

        // Update user info in header (guard if elements not yet in DOM)
        const userNameEl = document.getElementById('userName');
        if (userNameEl) userNameEl.textContent = this.currentUser.username;
        const userRoleEl = document.getElementById('userRole');
        if (userRoleEl) userRoleEl.textContent = this.currentUser.role;

        // Show/hide admin panel button
        const adminBtn = document.getElementById('adminPanelBtn');
        if (adminBtn && this.currentUser.permissions && this.currentUser.permissions.canManageUsers) {
            adminBtn.style.display = 'inline-flex';
        }

        // Show/hide export button for admins/managers only
        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) {
            const role = (this.currentUser.role || '').toLowerCase();
            if (role === 'admin' || role === 'manager') {
                exportBtn.style.display = 'inline-flex';
            } else {
                exportBtn.style.display = 'none';
            }
        }

        // Show/hide reshuffle backgrounds button for admins only
        const reshuffleBtn = document.getElementById('reshuffleBackgroundsBtn');
        if (reshuffleBtn) {
            const role = (this.currentUser.role || '').toLowerCase();
            reshuffleBtn.style.display = (role === 'admin') ? 'inline-flex' : 'none';
        }

        // Update hub cards with access restrictions immediately
        this.updateHubCardsAccess();
        try { if (typeof updateMainHubSections === 'function') updateMainHubSections(); } catch (_) {}
    }

    updateHubCardsAccess() {
        const hubCards = document.querySelectorAll('.hub-card');
        hubCards.forEach(card => {
            const sectionId = card.onclick.toString().match(/navigateToSection\('([^']+)'\)/)[1];
            // For now, allow access to all sections - remove restrictions
            // const allowed = (this.currentUser && this.currentUser.permissions && Array.isArray(this.currentUser.permissions.sections)) ? this.currentUser.permissions.sections : [];
            // if (!allowed.includes(sectionId)) {
            //     card.classList.add('restricted');
            //     card.onclick = () => {
            //         this.showMessage('You do not have access to this section', 'error');
            //     };
            // }
        });
    }

    bindEvents() {
        // Quick action buttons
        window.showAllSections = () => this.showAllSections();
        window.searchAcrossHub = () => this.searchAcrossHub();
        window.showRecentActivity = () => this.showRecentActivity();
        
        // Navigation
        window.navigateToSection = (sectionId) => this.navigateToSection(sectionId);
        window.goBackToHub = () => this.goBackToHub();
        
        // User management
        window.showUserProfile = () => this.showUserProfile();
        window.showAdminPanel = () => this.showAdminPanel();
        window.closeModal = (modalId) => this.closeModal(modalId);
        window.switchAdminTab = (tabName) => this.switchAdminTab(tabName);
        window.addUser = () => this.addUser();
    }

    setupGitHubAutoRefresh() {
        if (this._ghHubTimer) try { clearInterval(this._ghHubTimer); } catch(_) {}
        const refresh = async () => {
            try {
                if (document.hidden) return;
                // If admin panel export tab is open, refresh the dropdowns
                try { if (document.getElementById('adminPanelModal')?.style.display === 'block') await this.loadExportOptions(); } catch(_) {}
                // Optionally refresh visible hub cards if they depend on sectionOrder names (left local/local)
                try { if (typeof updateMainHubSections === 'function') updateMainHubSections(); } catch(_) {}
                // Data is automatically synced to Supabase database
                // No manual sync needed
            } catch (_) {}
        };
        setTimeout(refresh, 2000);
        this._ghHubTimer = setInterval(refresh, 60000);
        window.addEventListener('beforeunload', () => { try { clearInterval(this._ghHubTimer); } catch(_) {} });
        document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(() => refresh().catch(()=>{}), 250); });
    }

    setupHubSessionLogging() {
        const logClose = () => {
            if (this._hubSessionLogged) return;
            this._hubSessionLogged = true;
            const durationMs = Date.now() - (this.hubSessionStartMs || Date.now());
            try {
                if (window.hubDatabase && hubDatabase.saveActivity && this.currentUser) {
                    hubDatabase.saveActivity({
                        id: Date.now().toString(),
                        userId: this.currentUser.id,
                        username: this.currentUser.username,
                        action: 'CLOSE_HUB',
                        description: `Closed hub page after ${Math.round(durationMs/1000)}s`,
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (_) {}
        };
        window.addEventListener('beforeunload', logClose);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) logClose();
        });
    }

    // Navigation Functions
    navigateToSection(sectionId) {
        // Store the current section in session storage for the section page
        sessionStorage.setItem('currentSection', sectionId);

        // Attempt to record hub card click (non-blocking)
        try {
            const user = this.currentUser;
            if (window.hubDatabase && hubDatabase.saveActivity && user) {
                hubDatabase.saveActivity({
                    id: Date.now().toString(),
                    userId: user.id,
                    username: user.username,
                    action: 'CLICK_HUB_CARD',
                    description: `Opened section ${sectionId} from hub`,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (_) {}

        // Navigate to a dedicated section page with a smooth transition
        const go = () => { window.location.href = `section.html?section=${sectionId}`; };
        try {
            if (document.startViewTransition) {
                // Use View Transitions API when available
                document.startViewTransition(() => go());
            } else {
                // Fallback: quick fade-out
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

    bindSectionEvents() {
        // Tab switching
        window.switchTab = (tabName) => this.switchTab(tabName);
        
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
        
        // Back to hub
        window.goBackToHub = () => this.goBackToHub();
    }

    switchTab(tabName) {
        // Update tab appearance
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        event.target.classList.add('active');

        // Show/hide content sections
        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.remove('active');
        });
        document.getElementById(`${tabName}-section`).classList.add('active');

        // Render the appropriate content
        this.renderCurrentSection();
    }

    renderCurrentSection() {
        const activeTab = document.querySelector('.nav-tab.active');
        if (!activeTab) return;

        const tabName = activeTab.onclick.toString().match(/switchTab\('([^']+)'\)/)[1];
        this.renderResources(tabName);
    }

    renderResources(type) {
        const gridId = `${type.replace('-', '-')}-grid`;
        const grid = document.getElementById(gridId);
        const emptyState = document.getElementById('emptyState');
        
        if (!grid) return;

        const resources = this.sections[this.currentSection][type.replace('-', '')];
        const filteredResources = this.getFilteredResources(resources);

        if (filteredResources.length === 0) {
            grid.style.display = 'none';
            emptyState.style.display = 'block';
            return;
        }

        grid.style.display = 'grid';
        emptyState.style.display = 'none';

        grid.innerHTML = filteredResources.map(resource => this.createResourceCard(resource, type)).join('');
    }

    createResourceCard(resource, type) {
        const typeLabels = {
            'playbooks': 'PLAYBOOK',
            'box-links': 'BOX LINK',
            'dashboards': 'DASHBOARD'
        };

        return `
            <div class="resource-card" data-id="${resource.id}">
                <div class="resource-header">
                    <div>
                        <h3 class="resource-title">${this.escapeHtml(resource.title)}</h3>
                    </div>
                    <div class="resource-type">${typeLabels[type]}</div>
                </div>
                
                ${resource.description ? `<p class="resource-description">${this.escapeHtml(resource.description)}</p>` : ''}
                
                <a href="${resource.url}" target="_blank" rel="noopener noreferrer" class="resource-url">
                    <i class="fas fa-external-link-alt"></i> ${this.escapeHtml(resource.url)}
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
                        <button class="action-btn edit-btn" onclick="editResource('${type}', '${resource.id}')" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="action-btn delete-btn" onclick="deleteResource('${type}', '${resource.id}')" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    getFilteredResources(resources) {
        const searchTerm = document.getElementById('searchInput')?.value.toLowerCase() || '';
        const categoryFilter = document.getElementById('categoryFilter')?.value || '';

        return resources.filter(resource => {
            const matchesSearch = !searchTerm || 
                resource.title.toLowerCase().includes(searchTerm) ||
                resource.description.toLowerCase().includes(searchTerm) ||
                (resource.tags && resource.tags.some(tag => tag.toLowerCase().includes(searchTerm))) ||
                resource.url.toLowerCase().includes(searchTerm);

            const matchesCategory = !categoryFilter || resource.category === categoryFilter;

            return matchesSearch && matchesCategory;
        });
    }

    filterResources() {
        this.renderCurrentSection();
    }

    // Resource Management
    addResource(type) {
        const title = prompt(`Enter ${type.replace('-', ' ')} title:`);
        if (!title) return;

        const description = prompt(`Enter description (optional):`);
        const url = prompt(`Enter URL:`);
        if (!url) return;

        const tags = prompt(`Enter tags (comma-separated, optional):`);

        const resource = {
            id: Date.now().toString(),
            title: title,
            description: description || '',
            url: url,
            tags: tags ? tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [],
            category: 'process',
            createdAt: new Date().toISOString()
        };

        const resourceType = type.replace('-', '');
        this.sections[this.currentSection][resourceType].unshift(resource);
        this.saveData();
        this.renderCurrentSection();
        this.showMessage(`${type.replace('-', ' ')} added successfully!`, 'success');
    }

    editResource(type, id) {
        const resourceType = type.replace('-', '');
        const resource = this.sections[this.currentSection][resourceType].find(r => r.id === id);
        if (!resource) return;

        const newTitle = prompt('Enter new title:', resource.title);
        if (newTitle === null) return;

        const newDescription = prompt('Enter new description:', resource.description);
        const newUrl = prompt('Enter new URL:', resource.url);
        if (!newUrl) return;

        const newTags = prompt('Enter new tags (comma-separated):', resource.tags.join(', '));

        resource.title = newTitle;
        resource.description = newDescription || '';
        resource.url = newUrl;
        resource.tags = newTags ? newTags.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
        resource.updatedAt = new Date().toISOString();

        this.saveData();
        this.renderCurrentSection();
        this.showMessage(`${type.replace('-', ' ')} updated successfully!`, 'success');
    }

    deleteResource(type, id) {
        if (!confirm('Are you sure you want to delete this resource?')) return;

        const resourceType = type.replace('-', '');
        this.sections[this.currentSection][resourceType] = this.sections[this.currentSection][resourceType].filter(r => r.id !== id);
        this.saveData();
        this.renderCurrentSection();
        this.showMessage(`${type.replace('-', ' ')} deleted successfully!`, 'success');
    }

    // Utility Functions
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

    // Data Management
    saveData() {
        // Data is automatically saved to Supabase database
        // No manual save needed
    }

    async loadData() {
        // Load sections from Supabase
        try {
            if (window.hubDatabase && window.hubDatabaseReady) {
                const sections = await window.hubDatabase.getAllSections();
                if (sections && sections.length > 0) {
                    // Clear existing sections and load from Supabase
                    this.sections = {};
                    sections.forEach(section => {
                        this.sections[section.section_id] = {
                            name: section.name,
                            icon: section.icon,
                            color: section.color,
                            playbooks: [],
                            boxLinks: [],
                            dashboards: []
                        };
                    });
                }
            }
        } catch (error) {
            console.error('Failed to load sections from Supabase:', error);
        }

        // No fallback needed - Supabase is the primary data source
    }

    // Quick Actions
    showAllSections() {
        alert('All sections view - This would show a comprehensive list of all resources across all sections.');
    }

    searchAcrossHub() {
        const searchTerm = prompt('Enter search term:');
        if (searchTerm) {
            alert(`Searching for "${searchTerm}" across all sections...`);
        }
    }

    showRecentActivity() {
        alert('Recent activity - This would show recently added or modified resources.');
    }

    goBackToHub() {
        location.reload();
    }

    // Sample Data
    addSampleData() {
        // Start blank by default. Only seed example if no data anywhere.
        // Sample data is managed through Supabase database
        // Optional: Seed a tiny example dataset in the single example section if present
        if (this.sections['example']) {
            this.addSampleDataForSection('example');
            this.saveData();
        }
    }

    addSampleDataForSection(sectionId) {
        const section = this.sections[sectionId];
        // Do not seed any sample content
        section.playbooks = [];
        section.boxLinks = [];
        section.dashboards = [];
    }

    getSamplePlaybooks(sectionId) {
        const playbookTemplates = {
            'example': [
                { title: 'Getting Started Guide', description: 'How to add your first resources', url: 'https://example.com/getting-started', tags: ['onboarding','setup'] }
            ]
        };

        return (playbookTemplates[sectionId] || []).map(playbook => ({
            ...playbook,
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            category: 'process',
            createdAt: new Date().toISOString()
        }));
    }

    getSampleBoxLinks(sectionId) {
        const boxLinkTemplates = {
            'example': [
                { title: 'Company Docs Folder', description: 'Place to store your team docs', url: 'https://box.com/', tags: ['storage','docs'] }
            ]
        };

        return (boxLinkTemplates[sectionId] || []).map(link => ({
            ...link,
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            category: 'process',
            createdAt: new Date().toISOString()
        }));
    }

    getSampleDashboards(sectionId) {
        const dashboardTemplates = {
            'example': [
                { title: 'Starter Dashboard', description: 'A placeholder dashboard link', url: 'https://dashboard.example.com', tags: ['starter'] }
            ]
        };

        return (dashboardTemplates[sectionId] || []).map(dashboard => ({
            ...dashboard,
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            category: 'process',
            createdAt: new Date().toISOString()
        }));
    }

    // User Management Functions
    showUserProfile() {
        const user = this.currentUser;
        if (!user) return;

        document.getElementById('profileName').textContent = user.name || user.username;
        document.getElementById('profileUsername').textContent = user.username;
        document.getElementById('profileRole').textContent = user.role;
        document.getElementById('profileEmail').textContent = user.email || 'Not provided';
        
        const sectionsList = document.getElementById('profileSections');
        sectionsList.innerHTML = user.permissions.sections.map(section => 
            `<span class="tag">${section.replace('-', ' ')}</span>`
        ).join('');

        document.getElementById('userProfileModal').style.display = 'block';
    }

    showAdminPanel() {
        if (!this.currentUser.permissions.canManageUsers) {
            this.showMessage('You do not have permission to access the admin panel', 'error');
            return;
        }

        this.loadUsersList();
        this.loadAuditLog();
        document.getElementById('adminPanelModal').style.display = 'block';
        // Pre-populate export dropdowns when opening the panel
        try { this.loadExportOptions(); } catch (_) {}
    }

    closeModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
    }

    switchAdminTab(tabName) {
        // Update tab appearance (avoid relying on implicit event)
        document.querySelectorAll('.admin-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        try {
            const tabEl = document.querySelector(`.admin-tab[onclick="switchAdminTab('${tabName}')"]`);
            if (tabEl) tabEl.classList.add('active');
        } catch (_) {}

        // Show/hide content sections
        document.querySelectorAll('.admin-tab-content').forEach(content => {
            content.classList.remove('active');
        });
        const target = document.getElementById(`${tabName}-tab`);
        if (target) target.classList.add('active');

        // Load specific tab content
        if (tabName === 'users') {
            this.loadUsersList();
        } else if (tabName === 'audit') {
            this.loadAuditLog();
        } else if (tabName === 'export') {
            this.loadExportOptions();
        }
    }

    async loadUsersList() {
        const usersList = document.getElementById('usersList');
        if (!usersList) return;
        try {
            if (!window.supabaseClient) throw new Error('Supabase not initialized');
            const { data, error } = await window.supabaseClient
                .from('profiles')
                .select('id, username, role, name, email, permissions');
            if (error) throw error;
            const users = Array.isArray(data) ? data : [];
            usersList.innerHTML = users.map(user => `
                <div class="user-item">
                    <div class="user-details-info">
                        <div class="name">${this.escapeHtml(user.name || user.username || user.email || '')}</div>
                        <div class="role">${this.escapeHtml(user.role || '')}</div>
                        <div class="sections">Access: ${(user.permissions && Array.isArray(user.permissions.sections)) ? user.permissions.sections.length : 0} sections</div>
                    </div>
                    <div class="user-item-actions">
                        <button class="btn btn-secondary" onclick="editUser('${user.id}')" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-danger" onclick="deleteUser('${user.id}')" title="Disable">
                            <i class="fas fa-user-slash"></i>
                        </button>
                    </div>
                </div>
            `).join('');
        } catch (e) {
            usersList.innerHTML = '<div class="user-item">Failed to load users from Supabase.</div>';
        }
    }

    async loadAuditLog() {
        const activities = window.hubDatabase && window.hubDatabaseReady ? await hubDatabase.getActivities() : [];
        const auditLog = document.getElementById('auditLog');
        
        auditLog.innerHTML = activities.map(activity => `
            <div class="audit-entry">
                <div class="audit-info">
                    <div class="audit-user">${activity.username}</div>
                    <div class="audit-action">${activity.action}</div>
                    <div class="audit-description">${activity.description}</div>
                </div>
                <div class="audit-time">${new Date(activity.timestamp).toLocaleString()}</div>
            </div>
        `).join('');
    }

    async addUser() {
        try {
            if (!window.supabaseClient) { this.showMessage('Supabase not initialized', 'error'); return; }
            const email = prompt('Enter email for the new user:');
            if (!email) return;
            const password = prompt('Enter temporary password:');
            if (!password) return;
            const name = prompt('Enter full name (optional):') || '';
            const roleInput = prompt('Enter role (admin/editor/viewer):', 'viewer') || 'viewer';
            const role = ['admin','editor','viewer'].includes(roleInput) ? roleInput : 'viewer';

            const { data: signUpData, error: signUpError } = await window.supabaseClient.auth.signUp({ email, password, options: { data: { name } } });
            if (signUpError) { this.showMessage('Sign up failed: ' + signUpError.message, 'error'); return; }
            const newUserId = signUpData.user ? signUpData.user.id : null;
            if (newUserId) {
                await window.supabaseClient.from('profiles').upsert({ id: newUserId, email, username: email, name, role });
            }
            this.showMessage('User invited/created. If email confirmation is required, ask them to verify.', 'success');
            await this.loadUsersList();
        } catch (e) {
            this.showMessage('Failed to add user', 'error');
        }
    }

    getDefaultPermissions(role) {
        const permissions = {
            'admin': {
                canManageUsers: true,
                canEditAllSections: true,
                canDeleteResources: true,
                canViewAuditLog: true,
                canManageRoles: true,
                sections: ['costing', 'supply-planning', 'operations', 'quality', 'hr', 'it', 'sales', 'compliance']
            },
            'editor': {
                canManageUsers: false,
                canEditAllSections: false,
                canDeleteResources: true,
                canViewAuditLog: false,
                canManageRoles: false,
                sections: ['costing', 'supply-planning', 'operations', 'quality']
            },
            'viewer': {
                canManageUsers: false,
                canEditAllSections: false,
                canDeleteResources: false,
                canViewAuditLog: false,
                canManageRoles: false,
                sections: ['costing', 'supply-planning']
            }
        };
        return permissions[role] || permissions['viewer'];
    }

    async logActivity(action, description) {
        const user = this.currentUser;
        if (!user) return;

        const activity = {
            id: Date.now().toString(),
            userId: user.id,
            username: user.username,
            action: action,
            description: description,
            timestamp: new Date().toISOString(),
            ip: '127.0.0.1'
        };

        // Save activity to Supabase database
        if (window.hubDatabase && window.hubDatabaseReady) {
            await hubDatabase.saveActivity(activity);
        }
    }

    // Export Functions
    async loadExportOptions() {
        // Load users for export dropdown (Supabase profiles)
        const userSelect = document.getElementById('userExportSelect');
        if (userSelect) userSelect.innerHTML = '<option value="">Select User</option>';
        try {
            if (!window.supabaseClient) return;
            const { data, error } = await window.supabaseClient
                .from('profiles')
                .select('id, username, role');
            if (error) throw error;
            const users = Array.isArray(data) ? data : [];
            const me = this.currentUser;
            const myRole = String(me?.role || '').toLowerCase();
            const filtered = users.filter(u => {
                if (myRole === 'admin') return true;
                if (myRole === 'manager') return String(u.id) === String(me?.userId || me?.id);
                return String(u.id) === String(me?.userId || me?.id);
            });
            if (userSelect) {
                filtered.forEach(user => {
                    const option = document.createElement('option');
                    option.value = user.id;
                    option.textContent = `${user.username || user.id} (${user.role || ''})`;
                    userSelect.appendChild(option);
                });
            }
        } catch (_) {}

        // Load sections for export dropdown (still using GitHub config for names)
        try {
            let sections = [];
            try {
                if (window.hubDatabase && window.hubDatabaseReady) {
                    sections = await hubDatabase.getAllSections();
                }
            } catch (_) { sections = []; }
            const list = (Array.isArray(sections) ? sections : [])
                .map(s => ({ id: s.id, sectionId: s.id, name: s.name || s.id }))
                .sort((a,b) => String(a.name).localeCompare(String(b.name)));
            const secSelect = document.getElementById('sectionExportSelect');
            if (secSelect) {
                secSelect.innerHTML = '<option value="">Select Section</option>';
                list.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.sectionId || s.id;
                    opt.textContent = s.name || s.sectionId || s.id;
                    secSelect.appendChild(opt);
                });
            }
        } catch (_) {}
    }

    // Expose for index.html to call directly
    static async loadExportOptions() {
        try { 
            const hub = new InformationHub();
            await hub.loadExportOptions(); 
        } catch (_) {}
    }
}

// Global functions for index.html
window.editUser = async (userId) => {
    try {
        if (!window.supabaseClient) { alert('Supabase not initialized'); return; }
        const { data: prof, error } = await window.supabaseClient
            .from('profiles')
            .select('id, username, name, email, role, permissions')
            .eq('id', userId)
            .single();
        if (error) { alert('Failed to load user'); return; }
        const name = prompt('Full name:', prof.name || '') ?? (prof.name || '');
        const roleInput = prompt('Role (admin/editor/viewer):', prof.role || 'viewer') || prof.role || 'viewer';
        const role = ['admin','editor','viewer'].includes(roleInput) ? roleInput : (prof.role || 'viewer');
        // Keep existing permissions; optional tweak for disabled flag
        const perms = prof.permissions || {};
        if (perms.disabled === true) {
            if (confirm('User is disabled. Re-enable this user?')) { delete perms.disabled; }
        }
        const { error: upErr } = await window.supabaseClient
            .from('profiles')
            .update({ name, role, permissions: perms })
            .eq('id', userId);
        if (upErr) { alert('Update failed: ' + upErr.message); return; }
        try { informationHub.showMessage('User updated', 'success'); } catch (_) {}
        try { await informationHub.loadUsersList(); } catch (_) {}
    } catch (e) {
        alert('Edit failed');
    }
};

window.deleteUser = async (userId) => {
    try {
        if (!confirm('Disable this user? They will keep their auth account but be marked disabled in profiles.')) return;
        if (!window.supabaseClient) { alert('Supabase not initialized'); return; }
        // Soft-disable: set permissions.disabled = true and clear sections
        const { data: prof, error } = await window.supabaseClient
            .from('profiles')
            .select('permissions')
            .eq('id', userId)
            .single();
        if (error) { alert('Failed to load user'); return; }
        const perms = Object.assign({}, prof?.permissions || {});
        perms.disabled = true;
        if (Array.isArray(perms.sections)) perms.sections = [];
        if (Array.isArray(perms.editableSections)) perms.editableSections = [];
        const { error: upErr } = await window.supabaseClient
            .from('profiles')
            .update({ permissions: perms })
            .eq('id', userId);
        if (upErr) { alert('Disable failed: ' + upErr.message); return; }
        try { informationHub.showMessage('User disabled', 'success'); } catch (_) {}
        try { await informationHub.loadUsersList(); } catch (_) {}
    } catch (e) {
        alert('Disable failed');
    }
};

// Global export functions
window.exportAllData = async () => {
    try {
        informationHub.showMessage('Preparing export...', 'success');
        const result = await excelExporter.exportToExcel();
        if (result.success) {
            informationHub.showMessage(`Export completed! File: ${result.fileName}`, 'success');
            informationHub.logActivity('EXPORT', `Exported all data - ${result.fileName}`);
        } else {
            informationHub.showMessage(`Export failed: ${result.error}`, 'error');
        }
    } catch (error) {
        informationHub.showMessage(`Export failed: ${error.message}`, 'error');
    }
};

window.exportSectionData = async function() {
    // Resolve section id from dropdown, or fallbacks (first option / hub cards)
    let sectionId = '';
    try { sectionId = document.getElementById('sectionExportSelect')?.value || ''; } catch (_) {}
    if (!sectionId) {
        try {
            const sel = document.getElementById('sectionExportSelect');
            if (sel && sel.options && sel.options.length > 1) sectionId = sel.options[1].value;
        } catch (_) {}
    }
    if (!sectionId) {
        try { sectionId = document.querySelector('.hub-card')?.getAttribute('data-section-id') || ''; } catch (_) {}
    }
    if (!sectionId) {
        alert('Please select a section');
        return;
    }
    try {
        const result = await excelExporter.exportSectionToExcel(sectionId);
        if (!result || result.success !== true) {
            alert('Export failed: ' + (result && result.error ? result.error : 'Unknown error'));
        } else {
            alert('Export completed: ' + result.fileName);
        }
    } catch (err) {
        console.error('Export error:', err);
        alert('Export failed: ' + (err && err.message ? err.message : String(err)));
    }
};

window.exportUserData = async () => {
    const userId = document.getElementById('userExportSelect').value;
    if (!userId) {
        informationHub.showMessage('Please select a user', 'error');
        return;
    }

    try {
        // Permission guard: admin -> any; manager -> only users; user -> self
        try {
            const me = informationHub.currentUser;
            const role = String(me?.role || '').toLowerCase();
            const targetId = parseInt(userId);
            if (role === 'manager') {
                // Get users from Supabase database
                const users = window.hubDatabase && window.hubDatabaseReady ? await hubDatabase.getAllUsers() : [];
                const target = users.find(u => u.id === targetId);
                const targetRole = String(target?.role || '').toLowerCase();
                if (targetRole !== 'user' && targetId !== me?.userId && targetId !== me?.id) {
                    informationHub.showMessage('Managers can export only their users or self', 'error');
                    return;
                }
            } else if (role !== 'admin') {
                if (targetId !== me?.userId && targetId !== me?.id) {
                    informationHub.showMessage('You can export only your own data', 'error');
                    return;
                }
            }
        } catch (_) {}
        informationHub.showMessage('Preparing user data export...', 'success');
        const result = await excelExporter.exportUserDataToExcel(parseInt(userId));
        if (result.success) {
            informationHub.showMessage(`User data export completed! File: ${result.fileName}`, 'success');
            informationHub.logActivity('EXPORT', `Exported user data - ${result.username}`);
        } else {
            informationHub.showMessage(`Export failed: ${result.error}`, 'error');
        }
    } catch (error) {
        informationHub.showMessage(`Export failed: ${error.message}`, 'error');
    }
};

window.exportAuditLog = async () => {
    try {
        informationHub.showMessage('Preparing audit log export...', 'success');
        const activities = await hubDatabase.getActivities();
        
        // Create workbook
        const workbook = XLSX.utils.book_new();
        const activityData = activities.map(activity => ({
            'ID': activity.id,
            'User ID': activity.userId,
            'Username': activity.username,
            'Action': activity.action,
            'Description': activity.description,
            'Timestamp': new Date(activity.timestamp).toLocaleString(),
            'IP Address': activity.ip || ''
        }));

        const worksheet = XLSX.utils.json_to_sheet(activityData);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Audit Log');

        const fileName = `Audit_Log_Export_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(workbook, fileName);

        informationHub.showMessage(`Audit log export completed! File: ${fileName}`, 'success');
        informationHub.logActivity('EXPORT', 'Exported audit log');
    } catch (error) {
        informationHub.showMessage(`Export failed: ${error.message}`, 'error');
    }
};

// JSON Backup/Restore (raw)
window.backupJson = async () => {
    try {
        // Admin-only hint (non-blocking for download)
        try {
            const me = informationHub.currentUser;
            if (!(me && (String(me.role||'').toLowerCase()==='admin' || me.permissions?.canManageUsers))) {
                informationHub.showMessage('Tip: Admin should perform backups for completeness.', 'error');
            }
        } catch(_) {}

        // Supabase database backup
        let users = [], sections = [], sectionConfigs = {}, resources = {}, activities = [], views = [];
        if (window.hubDatabase && window.hubDatabaseReady) {
            try { users = await hubDatabase.getAllUsers(); } catch(_) {}
            try { sections = await hubDatabase.getAllSections(); } catch(_) {}
            try { activities = await hubDatabase.getActivities(); } catch(_) {}
            try { views = await hubDatabase.getAllViews(); } catch(_) {}
            // Per-section resources
            for (const s of (sections||[])) {
                const sid = String(s.section_id||s.id||'').trim(); if (!sid) continue;
                try { resources[sid] = await hubDatabase.getResourcesBySection(sid); } catch(_) { resources[sid] = []; }
            }
        }

        const payload = {
            exportDate: new Date().toISOString(),
            users, sections, sectionConfigs, resources, activities, views
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Information_Hub_Backup_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        informationHub.showMessage('Backup downloaded', 'success');
    } catch (error) {
        informationHub.showMessage(`Backup failed: ${error.message}`, 'error');
    }
};

window.restoreJson = async () => {
    try {
        // Admin-only guard
        const me = informationHub.currentUser;
        if (!(me && (String(me.role||'').toLowerCase()==='admin' || me.permissions?.canManageUsers))) {
            informationHub.showMessage('Only admin can restore data', 'error');
            return;
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = async () => {
            const file = input.files && input.files[0];
            if (!file) return;
            const text = await file.text();
            const json = JSON.parse(text);
            if (!window.hubDatabase || !window.hubDatabaseReady) throw new Error('Supabase database unavailable');
            // Users
            try { if (Array.isArray(json.users)) for (const user of json.users) await hubDatabase.saveUser(user); } catch(_) {}
            // Sections
            try { if (Array.isArray(json.sections)) for (const section of json.sections) await hubDatabase.saveSection(section); } catch(_) {}
            // Resources (as map: { [sectionId]: [...] })
            try {
                const res = json.resources && typeof json.resources === 'object' ? json.resources : {};
                for (const sid of Object.keys(res)) {
                    const resources = Array.isArray(res[sid]) ? res[sid] : [];
                    for (const resource of resources) {
                        await hubDatabase.saveResource({...resource, sectionId: sid});
                    }
                }
            } catch(_) {}
            // Optional: audit + views
            try { if (Array.isArray(json.activities)) for (const activity of json.activities) await hubDatabase.saveActivity(activity); } catch(_) {}

            // Refresh UI
            try { updateMainHubSections(); } catch(_) {}
            informationHub.showMessage('Restore completed', 'success');
        };
        input.click();
    } catch (error) {
        informationHub.showMessage(`Restore failed: ${error.message}`, 'error');
    }
};

// Initialize the application (once)
let informationHub;
function initInformationHubOnce() {
	if (informationHub && informationHub instanceof InformationHub) return;
	informationHub = new InformationHub();
	// Export for global access
	window.informationHub = informationHub;
}
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initInformationHubOnce);
} else {
	initInformationHubOnce();
}
