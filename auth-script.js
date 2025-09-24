// Authentication System
class AuthSystem {
    constructor() {
        this.users = [];
        this.currentUser = null;
        this.init();
    }

    init() {
        this.ensureSupabaseClient();
        this.bindEvents();
        this.checkExistingSession();
        // Show password recovery form if coming from email
        this.maybeShowRecoveryForm();
    }

    ensureSupabaseClient() {
        try {
            // Use CONFIG if available, otherwise fallback to old method
            if (window.CONFIG) {
                window.SUPABASE_URL = window.CONFIG.SUPABASE_URL;
                window.SUPABASE_ANON_KEY = window.CONFIG.SUPABASE_ANON_KEY;
            } else {
                // Fallback: pull keys from <meta> tags if not present on window
                if (!window.SUPABASE_URL) {
                    try {
                        var m1 = document.querySelector('meta[name="supabase-url"]');
                        window.SUPABASE_URL = (m1 && m1.content) || window.SUPABASE_URL;
                    } catch(_) {}
                }
                if (!window.SUPABASE_ANON_KEY) {
                    try {
                        var m2 = document.querySelector('meta[name="supabase-anon-key"]');
                        window.SUPABASE_ANON_KEY = (m2 && m2.content) || window.SUPABASE_ANON_KEY;
                    } catch(_) {}
                }
            }
            
            if (!window.supabaseClient && window.SUPABASE_URL && window.SUPABASE_ANON_KEY && window.supabase) {
                window.supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
            }
        } catch (error) {
            console.error('Error ensuring Supabase client:', error);
        }
        return !!window.supabaseClient;
    }

    async initSupabase(timeoutMs = 5000) {
        if (this.ensureSupabaseClient()) return true;
        if (!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY)) return false;
        // Dynamically load CDN if missing
        if (!window.supabase) {
            const existing = document.querySelector('script[data-supabase-cdn]');
            if (!existing) {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
                s.async = true;
                s.setAttribute('data-supabase-cdn', '1');
                document.head.appendChild(s);
            }
        }
        const startedAt = Date.now();
        return await new Promise((resolve) => {
            const tryInit = () => {
                if (this.ensureSupabaseClient()) return resolve(true);
                if (Date.now() - startedAt > timeoutMs) return resolve(false);
                setTimeout(tryInit, 100);
            };
            tryInit();
        });
    }

    bindEvents() {
        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        const signupForm = document.getElementById('signupForm');
        if (signupForm) {
            signupForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleSignup();
            });
        }

        const tabLogin = document.getElementById('tabLogin');
        const tabSignup = document.getElementById('tabSignup');
        if (tabLogin && tabSignup) {
            tabLogin.addEventListener('click', () => this.switchAuthTab('login'));
            tabSignup.addEventListener('click', () => this.switchAuthTab('signup'));
        }

        // Forgot password
        const forgot = document.getElementById('forgotLink');
        if (forgot) {
            forgot.addEventListener('click', (e) => {
                e.preventDefault();
                this.startPasswordReset();
            });
        }

        // Demo account filling
        window.fillDemoAccount = (role) => {
            const accounts = {
                'admin': { username: 'admin', password: 'admin123' },
                'manager': { username: 'manager', password: 'manager123' },
                'user': { username: 'user', password: 'user123' }
            };
            
            const account = accounts[role];
            document.getElementById('username').value = account.username;
            document.getElementById('password').value = account.password;
        };
    }

    switchAuthTab(tab) {
        const loginForm = document.getElementById('loginForm');
        const signupForm = document.getElementById('signupForm');
        const subtitle = document.getElementById('authSubtitle');
        const tabLogin = document.getElementById('tabLogin');
        const tabSignup = document.getElementById('tabSignup');
        if (!loginForm || !signupForm) return;
        if (tab === 'login') {
            loginForm.style.display = 'block';
            signupForm.style.display = 'none';
            if (subtitle) subtitle.textContent = 'Please sign in to access your resources';
            if (tabLogin) { tabLogin.className = 'btn btn-primary'; }
            if (tabSignup) { tabSignup.className = 'btn btn-secondary'; }
        } else {
            loginForm.style.display = 'none';
            signupForm.style.display = 'block';
            if (subtitle) subtitle.textContent = 'Create an account to request access';
            if (tabLogin) { tabLogin.className = 'btn btn-secondary'; }
            if (tabSignup) { tabSignup.className = 'btn btn-primary'; }
        }
    }

    async loadUsers() { return []; }

    async handleLogin() {
        try {
            if (!(await this.initSupabase())) { this.showMessage('Supabase not initialized', 'error'); return; }
            const email = String(document.getElementById('username').value || '').trim();
            const password = String(document.getElementById('password').value || '').trim();
            const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
            if (error) { this.showMessage(error.message || 'Invalid email or password', 'error'); return; }
            const user = data && data.user ? data.user : null;
            if (!user) { this.showMessage('Login failed', 'error'); return; }
            await this.createSessionFromSupabase(user);
            this.redirectToHub();
        } catch (_) { this.showMessage('Login failed', 'error'); }
    }

    async handleSignup() {
        try {
            if (!(await this.initSupabase())) { this.showMessage('Supabase not initialized', 'error'); return; }
            const name = String(document.getElementById('signupName').value || '').trim();
            const email = String(document.getElementById('signupEmail').value || '').trim().toLowerCase();
            const password = String(document.getElementById('signupPassword').value || '').trim();
            if (!name || !email || !password) { this.showMessage('All fields are required', 'error'); return; }
            const { data, error } = await window.supabaseClient.auth.signUp({ email, password, options: { data: { name } } });
            if (error) { this.showMessage(error.message || 'Signup failed', 'error'); return; }
            const uid = data && data.user ? data.user.id : null;
            if (uid) {
                // Assign default access to all visible sections in hub (from Supabase)
                let sectionIds = [];
                try {
                    const { data: secs } = await window.supabaseClient.from('sections').select('section_id');
                    sectionIds = Array.isArray(secs) ? secs.map(s => s.section_id).filter(Boolean) : [];
                } catch (_) { 
                    console.warn('Failed to load sections during signup, will assign empty permissions');
                    sectionIds = []; 
                }
                
                // If no sections exist yet, give user access to view all sections by default
                // This ensures they can see content when sections are added later
                const permissions = {
                    sections: sectionIds.length > 0 ? sectionIds : ['*'], // '*' means access to all sections
                    editableSections: [],
                    canViewAllSections: sectionIds.length === 0 // If no specific sections, allow viewing all
                };
                
                await window.supabaseClient.from('profiles').upsert({
                    id: uid,
                    email,
                    username: email,
                    name,
                    role: 'viewer',
                    permissions: permissions
                });
            }
            this.showMessage('Signup successful. Please verify your email if required.', 'success');
        } catch (_) { this.showMessage('Signup failed', 'error'); }
    }

    // Forgot password: send email, and handle recovery token
    async startPasswordReset() {
        try {
            if (!(await this.initSupabase())) { this.showMessage('Supabase not initialized', 'error'); return; }
            const email = prompt('Enter your account email:');
            if (!email) return;
            const redirectTo = (location.origin + location.pathname).replace(/auth\.html.*/, 'auth.html');
            const { error } = await window.supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
            if (error) { this.showMessage(error.message || 'Failed to send reset email', 'error'); return; }
            this.showMessage('Password reset email sent. Check your inbox.', 'success');
        } catch (_) { this.showMessage('Failed to send reset email', 'error'); }
    }

    async maybeShowRecoveryForm() {
        try {
            const hash = location.hash || '';
            const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
            const type = params.get('type');
            if (type !== 'recovery') return;
            // Show reset form, hide others
            const loginForm = document.getElementById('loginForm');
            const signupForm = document.getElementById('signupForm');
            const resetForm = document.getElementById('resetForm');
            if (loginForm) loginForm.style.display = 'none';
            if (signupForm) signupForm.style.display = 'none';
            if (resetForm) resetForm.style.display = 'block';
            // Bind submit
            resetForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const p1 = String(document.getElementById('newPassword').value || '').trim();
                const p2 = String(document.getElementById('confirmPassword').value || '').trim();
                if (!p1 || p1.length < 6) { this.showMessage('Password must be at least 6 characters', 'error'); return; }
                if (p1 !== p2) { this.showMessage('Passwords do not match', 'error'); return; }
                try {
                    const { error } = await window.supabaseClient.auth.updateUser({ password: p1 });
                    if (error) { this.showMessage(error.message || 'Failed to update password', 'error'); return; }
                    this.showMessage('Password updated. You can sign in now.', 'success');
                    // Switch back to login view
                    resetForm.style.display = 'none';
                    if (loginForm) loginForm.style.display = 'block';
                } catch (_) { this.showMessage('Failed to update password', 'error'); }
            }, { once: true });
        } catch (_) {}
    }

    async createSession(user) { return this.createSessionFromSupabase(user); }

    async createSessionFromSupabase(authUser) {
        try {
            if (!window.supabaseClient) return;
            const { data, error } = await window.supabaseClient
                .from('profiles')
                .select('id, username, role, name, email, permissions')
                .eq('id', authUser.id)
                .single();
            if (error) {
                console.warn('User profile not found, creating default profile with full access');
                
                // Create a default profile with full access to all sections
                const defaultPermissions = {
                    sections: ['*'], // Access to all sections
                    editableSections: [],
                    canViewAllSections: true
                };
                
                try {
                    await window.supabaseClient.from('profiles').upsert({
                        id: authUser.id,
                        email: authUser.email,
                        username: authUser.email,
                        name: authUser.user_metadata?.name || '',
                        role: 'viewer',
                        permissions: defaultPermissions
                    });
                } catch (profileError) {
                    console.error('Failed to create user profile:', profileError);
                }
                
                const session = {
                    userId: authUser.id,
                    username: authUser.email,
                    role: 'viewer',
                    name: authUser.user_metadata?.name || '',
                    email: authUser.email,
                    loginTime: new Date().toISOString(),
                    permissions: defaultPermissions
                };
                // Session is managed by Supabase auth
                return;
            }
            const p = data || {};
            const session = {
                userId: p.id,
                username: p.username || authUser.email,
                role: p.role || 'viewer',
                name: p.name || '',
                email: p.email || authUser.email,
                loginTime: new Date().toISOString(),
                permissions: p.permissions || {}
            };
            localStorage.setItem('hubSession', JSON.stringify(session));
        } catch (_) {}
    }

    async checkExistingSession() {
        try {
            if (!window.supabaseClient) return;
            const { data: { user } } = await window.supabaseClient.auth.getUser();
            if (!user) return;
            await this.createSessionFromSupabase(user);
            if (location.pathname.endsWith('auth.html')) return;
            this.redirectToHub();
        } catch (e) {
            console.warn('Invalid existing session; clearing.', e);
            // Session is managed by Supabase auth
        }
    }

    redirectToHub() {
        // Set a flag to indicate fresh login
        // Fresh login flag is managed by Supabase auth
        console.log('Redirecting to hub...');
        window.location.href = 'index.html';
    }

    async logout() {
        try { if (window.supabaseClient) await window.supabaseClient.auth.signOut(); } catch (_) {}
        // Session is managed by Supabase auth
        this.currentUser = null;
        window.location.href = 'auth.html';
    }

    // Global logout function
    static logout() {
        const authSystem = new AuthSystem();
        authSystem.logout();
    }

    getCurrentUser() {
        // Get current user from Supabase auth
        if (window.supabaseClient) {
            return window.supabaseClient.auth.getUser();
        }
        return null;
    }

    hasPermission(permission) {
        const user = this.getCurrentUser();
        if (!user) return false;
        return user.permissions[permission] || false;
    }

    canAccessSection(sectionId) {
        const user = this.getCurrentUser();
        if (!user) return false;
        return user.permissions.sections.includes(sectionId);
    }

    canEditResource(sectionId) {
        const user = this.getCurrentUser();
        if (!user) return false;
        return user.permissions.canEditAllSections || user.permissions.sections.includes(sectionId);
    }

    canDeleteResource(sectionId) {
        const user = this.getCurrentUser();
        if (!user) return false;
        return user.permissions.canDeleteResources && this.canEditResource(sectionId);
    }

    logActivity(action, description) {
        const user = this.getCurrentUser();
        if (!user) return;

        const activity = {
            id: Date.now().toString(),
            userId: user.id,
            username: user.username,
            action: action,
            description: description,
            timestamp: new Date().toISOString(),
            ip: '127.0.0.1' // In a real app, this would be the actual IP
        };

        const activities = this.getActivities();
        activities.unshift(activity);
        
        // Keep only last 1000 activities
        if (activities.length > 1000) {
            activities.splice(1000);
        }
        
        // Activities are managed in Supabase database
    }

    getActivities() {
        // Activities are retrieved from Supabase database
        return [];
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
        const container = document.querySelector('.auth-container');
        container.insertBefore(messageDiv, container.firstChild);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            messageDiv.remove();
        }, 3000);
    }
}

// Initialize authentication system
const authSystem = new AuthSystem();

// Export for global access
window.authSystem = authSystem;
