// Database System for Information Hub - Supabase Implementation
class HubDatabase {
    constructor() {
        this.supabase = null;
        this.init();
    }

    async init() {
        try {
            // Wait for Supabase client to be available
            let retries = 0;
            const maxRetries = 100; // 20 seconds max wait
            while (retries < maxRetries && !window.supabaseClient) {
                console.log('Waiting for Supabase client...', retries + 1);
                await new Promise(resolve => setTimeout(resolve, 200));
                retries++;
            }
            
            if (!window.supabaseClient) {
                console.error('Supabase client not initialized after waiting');
                console.error('Available window objects:', Object.keys(window).filter(k => k.includes('supabase')));
                return false;
            }
            
            this.supabase = window.supabaseClient;
            console.log('Supabase database initialized successfully');
            return true;
        } catch (error) {
            console.error('Failed to initialize Supabase database:', error);
            return false;
        }
    }

    // Helper method to get current user ID
    getCurrentUserId() {
        if (window.supabaseClient) {
            const user = window.supabaseClient.auth.getUser();
            return user?.id || null;
        }
        return null;
    }

    // User Management
    async saveUser(user) {
        try {
            const { data, error } = await this.supabase
                .from('profiles')
                .upsert({
                    id: user.id,
                    username: user.username,
                    role: user.role || 'viewer',
                    name: user.name,
                    email: user.email,
                    permissions: user.permissions || {}
                });
            
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error saving user:', error);
            throw error;
        }
    }

    async getUser(id) {
        try {
            const { data, error } = await this.supabase
                .from('profiles')
                .select('*')
                .eq('id', id)
                .single();
            
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error getting user:', error);
            return null;
        }
    }

    async getAllUsers() {
        try {
            const { data, error } = await this.supabase
                .from('profiles')
                .select('*')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error getting all users:', error);
            return [];
        }
    }

    async updateUser(user) {
        try {
            const { data, error } = await this.supabase
                .from('profiles')
                .update({
                    username: user.username,
                    role: user.role || 'viewer',
                    name: user.name,
                    email: user.email,
                    permissions: user.permissions || {}
                })
                .eq('id', user.id);
            
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error updating user:', error);
            throw error;
        }
    }

    async deleteUser(id) {
        try {
            const { error } = await this.supabase
                .from('profiles')
                .delete()
                .eq('id', id);
            
            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error deleting user:', error);
            throw error;
        }
    }

    // Section Management
    async saveSection(section) {
        try {
            const { data, error } = await this.supabase
                .from('sections')
                .upsert({
                    section_id: section.sectionId || section.id,
                    name: section.name,
                    icon: section.icon,
                    color: section.color,
                    config: section.config || {},
                    data: section.data || {}
                });
            
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error saving section:', error);
            throw error;
        }
    }

    async getSection(sectionId) {
        try {
            const { data, error } = await this.supabase
                .from('sections')
                .select('*')
                .eq('section_id', sectionId)
                .single();
            
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error getting section:', error);
            return null;
        }
    }

    async getAllSections() {
        try {
            const { data, error } = await this.supabase
                .from('sections')
                .select('*')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error getting all sections:', error);
            return [];
        }
    }

    async createSection(section) {
        try {
            const { data, error } = await this.supabase
                .from('sections')
                .insert({
                    section_id: section.sectionId || section.id,
                    name: section.name,
                    icon: section.icon,
                    color: section.color,
                    config: {
                        ...(section.config || {}),
                        visible: section.visible !== false,
                        intro: section.intro || '',
                        order: section.order || 0
                    },
                    data: section.data || {}
                });
            
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error creating section:', error);
            throw error;
        }
    }

    async updateSection(section) {
        try {
            const { data, error } = await this.supabase
                .from('sections')
                .update({
                    name: section.name,
                    icon: section.icon,
                    color: section.color,
                    config: {
                        ...(section.config || {}),
                        visible: section.visible !== false,
                        intro: section.intro || '',
                        order: section.order || 0
                    },
                    data: section.data || {}
                })
                .eq('section_id', section.sectionId || section.id);
            
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error updating section:', error);
            throw error;
        }
    }

    async deleteSection(sectionId) {
        try {
            const { error } = await this.supabase
                .from('sections')
                .delete()
                .eq('section_id', sectionId);
            
            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error deleting section:', error);
            throw error;
        }
    }

    // Section configuration helpers
    async saveSectionConfig(sectionId, config) {
        try {
            const { data, error } = await this.supabase
                .from('sections')
                .update({ config: config || {} })
                .eq('section_id', sectionId);
            
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error saving section config:', error);
            throw error;
        }
    }

    async getSectionConfig(sectionId) {
        try {
            const section = await this.getSection(sectionId);
            return section ? section.config : null;
        } catch (error) {
            console.error('Error getting section config:', error);
            return null;
        }
    }

    // Resource Management
    async saveResource(resource) {
        try {
            const { data, error } = await this.supabase
                .from('resources')
                .upsert({
                    id: resource.id,
                    section_id: resource.sectionId,
                    type: resource.type,
                    title: resource.title,
                    url: resource.url,
                    description: resource.description,
                    tags: resource.tags || [],
                    extra: resource.extra || {},
                    created_by: resource.userId || this.getCurrentUserId()
                });
            
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error saving resource:', error);
            throw error;
        }
    }

    async getResource(id) {
        try {
            const { data, error } = await this.supabase
                .from('resources')
                .select('*')
                .eq('id', id)
                .single();
            
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error getting resource:', error);
            return null;
        }
    }

    async getResourcesBySection(sectionId) {
        try {
            const { data, error } = await this.supabase
                .from('resources')
                .select('*')
                .eq('section_id', sectionId)
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error getting resources by section:', error);
            return [];
        }
    }

    async getResourcesByType(sectionId, type) {
        try {
            const { data, error } = await this.supabase
                .from('resources')
                .select('*')
                .eq('section_id', sectionId)
                .eq('type', type)
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error getting resources by type:', error);
            return [];
        }
    }

    async deleteResource(id) {
        try {
            const { error } = await this.supabase
                .from('resources')
                .delete()
                .eq('id', id);
            
            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error deleting resource:', error);
            throw error;
        }
    }

    async getAllResources() {
        try {
            const { data, error } = await this.supabase
                .from('resources')
                .select('*')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error getting all resources:', error);
            return [];
        }
    }

    // Activity Management
    async saveActivity(activity) {
        try {
            const { data, error } = await this.supabase
                .from('activities')
                .insert({
                    user_id: activity.userId || this.getCurrentUserId(),
                    action: activity.action,
                    resource_id: activity.resourceId,
                    section_id: activity.sectionId,
                    metadata: activity.metadata || {}
                });
            
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error saving activity:', error);
            throw error;
        }
    }

    async getActivities(limit = 1000) {
        try {
            const { data, error } = await this.supabase
                .from('activities')
                .select('*')
                .order('timestamp', { ascending: false })
                .limit(limit);
            
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error getting activities:', error);
            return [];
        }
    }

    // Views Management
    async recordView(userId, resourceId) {
        try {
            // Use the RPC function for safe increment
            const { error } = await this.supabase
                .rpc('increment_view', {
                    p_user_id: userId,
                    p_resource_id: resourceId
                });
            
            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error recording view:', error);
            throw error;
        }
    }

    async getAllViews() {
        try {
            const { data, error } = await this.supabase
                .from('views')
                .select('*')
                .order('last_viewed_at', { ascending: false });
            
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error getting all views:', error);
            return [];
        }
    }

    // Export all data
    async exportAllData() {
        try {
            const [users, sections, resources, activities, views] = await Promise.all([
                this.getAllUsers(),
                this.getAllSections(),
                this.getAllResources(),
                this.getActivities(),
                this.getAllViews()
            ]);

            return {
                users,
                sections,
                resources,
                activities,
                views,
                exportDate: new Date().toISOString(),
                totalRecords: {
                    users: users.length,
                    sections: sections.length,
                    resources: resources.length,
                    activities: activities.length,
                    views: views.length
                }
            };
        } catch (error) {
            console.error('Export failed:', error);
            throw error;
        }
    }

    // Clear all data (admin only)
    async clearAllData() {
        try {
            const userId = this.getCurrentUserId();
            if (!userId) throw new Error('Not authenticated');

            // Check if user is admin
            const user = await this.getUser(userId);
            if (!user || user.role !== 'admin') {
                throw new Error('Only admins can clear all data');
            }

            // Delete in reverse order of dependencies
            await this.supabase.from('views').delete().neq('id', '00000000-0000-0000-0000-000000000000');
            await this.supabase.from('activities').delete().neq('id', '00000000-0000-0000-0000-000000000000');
            await this.supabase.from('resources').delete().neq('id', '00000000-0000-0000-0000-000000000000');
            await this.supabase.from('sections').delete().neq('section_id', '');
            // Note: Don't delete profiles as they're linked to auth.users

            console.log('All data cleared successfully');
            return true;
        } catch (error) {
            console.error('Error clearing data:', error);
            throw error;
        }
    }
}

// Initialize database
let hubDatabase;

async function initializeDatabase() {
    try {
        hubDatabase = new HubDatabase();
        const success = await hubDatabase.init();
        
        if (success) {
            // Make globally accessible
            window.hubDatabase = hubDatabase;
            window.hubDatabaseReady = true;
            document.dispatchEvent(new Event('hubdb-ready'));
            console.log('Database system ready!');
        } else {
            console.error('Database initialization failed');
        }
    } catch (error) {
        console.error('Database initialization error:', error);
    }
}

// Try to initialize immediately, then on DOM ready, then on window load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDatabase);
} else {
    initializeDatabase();
}

// Also try on window load as fallback
window.addEventListener('load', () => {
    if (!window.hubDatabaseReady) {
        console.log('Retrying database initialization on window load...');
        initializeDatabase();
    }
});

// Additional fallback - try every 2 seconds for 30 seconds
let fallbackAttempts = 0;
const fallbackInterval = setInterval(() => {
    if (window.hubDatabaseReady) {
        clearInterval(fallbackInterval);
        return;
    }
    
    fallbackAttempts++;
    if (fallbackAttempts > 15) { // 30 seconds
        clearInterval(fallbackInterval);
        console.error('Database initialization failed after 30 seconds');
        return;
    }
    
    console.log('Fallback database initialization attempt', fallbackAttempts);
    initializeDatabase();
}, 2000);

// Backward compatibility flag
window.hubDatabaseReady = false;
