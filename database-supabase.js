// Database System for Information Hub - Supabase Implementation
class HubDatabase {
    constructor() {
        this.supabase = null;
        this.init();
    }

    // Transient network error detection and retry helper
    isTransientNetworkError(err) {
        try {
            const name = String(err?.name || '')
                .toLowerCase();
            const msg = String(err?.message || '')
                .toLowerCase();
            return (
                name === 'typeerror' ||
                /failed to fetch|networkerror|err_name_not_resolved|enotfound|econnreset|etimedout/.test(msg)
            );
        } catch (_) { return false; }
    }

    wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    async withRetry(runFn, { retries = 3, baseDelayMs = 300 } = {}) {
        let attempt = 0;
        let delay = baseDelayMs;
        while (attempt < retries) {
            try {
                return await runFn();
            } catch (err) {
                const last = attempt === (retries - 1);
                if (!this.isTransientNetworkError(err) || last) {
                    throw err;
                }
                try { console.warn(`[retry] transient network error, attempt ${attempt + 1} → retrying in ${delay}ms`, err?.message || err); } catch(_) {}
                await this.wait(delay);
                delay = Math.min(delay * 2, 3000);
                attempt++;
            }
        }
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
    async getCurrentUserId() {
        try {
            if (!window.supabaseClient || !window.supabaseClient.auth) return null;
            const { data: { user } } = await window.supabaseClient.auth.getUser();
            return user ? user.id : null;
        } catch (_) {
            return null;
        }
    }

    // User Management
    async saveUser(user) {
        try {
            const { data, error } = await this.supabase
                .from('profiles')
                .upsert({
                    id: user.id,
                    username: user.username,
                    role: user.role,
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
            const client = window.supabaseClient || this.supabase;
            if (!client) throw new Error('Supabase client not ready');
            const { data, error } = await client
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
            const client = window.supabaseClient || this.supabase;
            if (!client) throw new Error('Supabase client not ready');
            // Prefer username, fallback to name, then no ordering
            let resp = await client.from('profiles').select('*').order('username', { ascending: true });
            if (resp.error) {
                resp = await client.from('profiles').select('*').order('name', { ascending: true });
            }
            if (resp.error) {
                resp = await client.from('profiles').select('*');
            }
            if (resp.error) throw resp.error;
            return resp.data || [];
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
                    role: user.role,
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
            const client = window.supabaseClient || this.supabase;
            if (!client) throw new Error('Supabase client not ready');
            const { data, error } = await client
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
            const client = window.supabaseClient || this.supabase;
            if (!client) throw new Error('Supabase client not ready');
            const { data, error } = await client
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
            const client = window.supabaseClient || this.supabase;
            if (!client) throw new Error('Supabase client not ready');
            // Prefer name, fallback to section_id, then no ordering
            let resp = await client.from('sections').select('*').order('name', { ascending: true });
            if (resp.error) {
                resp = await client.from('sections').select('*').order('section_id', { ascending: true });
            }
            if (resp.error) {
                resp = await client.from('sections').select('*');
            }
            if (resp.error) throw resp.error;
            return resp.data || [];
        } catch (error) {
            console.error('Error getting all sections:', error);
            return [];
        }
    }

    async createSection(section) {
        try {
            // Ensure authenticated session before attempting write (RLS requires auth.uid())
            const currentUserId = await this.getCurrentUserId();
            if (!currentUserId) {
                throw new Error('Not authenticated. Please sign in again.');
            }

            const payload = {
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
            };

            const run = async () => {
                const { data, error } = await this.supabase
                    .from('sections')
                    .upsert(payload, { onConflict: 'section_id' })
                    .select('section_id')
                    .single();
                if (error) throw error;
                return data;
            };

            return await this.withRetry(run, { retries: 3, baseDelayMs: 300 });
        } catch (error) {
            console.error('Error creating section:', error);
            throw error;
        }
    }

    async updateSection(section) {
        try {
            const run = async () => {
                const sid = section.sectionId || section.id;
                // Read current to preserve config fields like types/categories
                let current = null;
                try {
                    const cur = await this.supabase
                        .from('sections')
                        .select('config')
                        .eq('section_id', sid)
                        .single();
                    if (!cur.error) current = cur.data;
                } catch (_) {}
                const existingCfg = (current && typeof current.config === 'object') ? current.config : {};
                const nextConfig = Object.assign({}, existingCfg, section.config || {});
                // Ensure critical flags are kept in sync but do not drop other keys
                nextConfig.visible = section.visible !== false;
                nextConfig.intro = section.intro || '';
                nextConfig.order = section.order || 0;
                const { data, error } = await this.supabase
                    .from('sections')
                    .update({
                        name: section.name,
                        icon: section.icon,
                        color: section.color,
                        config: nextConfig,
                        data: section.data || {}
                    })
                    .eq('section_id', sid);
                if (error) throw error;
                return data;
            };
            return await this.withRetry(run, { retries: 3, baseDelayMs: 300 });
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
            const currentUserId = await this.getCurrentUserId();
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
                    created_by: (
                        resource.created_by || resource.createdBy || resource.user_id || resource.userId || currentUserId || null
                    )
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
            // Prefer created_at desc, fallback to title asc, then no ordering
            let query = this.supabase.from('resources').select('*').eq('section_id', sectionId);
            let resp = await query.order('created_at', { ascending: false });
            if (resp.error) {
                resp = await query.order('title', { ascending: true });
            }
            if (resp.error) {
                resp = await this.supabase.from('resources').select('*').eq('section_id', sectionId);
            }
            if (resp.error) throw resp.error;
            return resp.data || [];
        } catch (error) {
            console.error('Error getting resources by section:', error);
            return [];
        }
    }

    async getResourcesByType(sectionId, type) {
        try {
            // Prefer created_at desc, fallback to title asc, then no ordering
            let base = this.supabase.from('resources').select('*').eq('section_id', sectionId).eq('type', type);
            let resp = await base.order('created_at', { ascending: false });
            if (resp.error) {
                resp = await base.order('title', { ascending: true });
            }
            if (resp.error) {
                resp = await this.supabase.from('resources').select('*').eq('section_id', sectionId).eq('type', type);
            }
            if (resp.error) throw resp.error;
            return resp.data || [];
        } catch (error) {
            console.error('Error getting resources by type:', error);
            return [];
        }
    }

    async deleteResource(id) {
        try {
            const client = window.supabaseClient || this.supabase;
            if (!client) throw new Error('Supabase client not ready');
            const { error } = await client
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
            const client = window.supabaseClient || this.supabase;
            if (!client) throw new Error('Supabase client not ready');
            // Prefer created_at desc, fallback to title asc, then no ordering
            let resp = await client.from('resources').select('*').order('created_at', { ascending: false });
            if (resp.error) {
                resp = await client.from('resources').select('*').order('title', { ascending: true });
            }
            if (resp.error) {
                resp = await client.from('resources').select('*');
            }
            if (resp.error) throw resp.error;
            return resp.data || [];
        } catch (error) {
            console.error('Error getting all resources:', error);
            return [];
        }
    }

    // Activity Management
    async saveActivity(activity) {
        try {
            const client = window.supabaseClient || this.supabase;
            if (!client) throw new Error('Supabase client not ready');
            const currentUserId = await this.getCurrentUserId();
            const userId = activity.userId || currentUserId || null;
            // Resolve username/email for display if not explicitly provided
            let resolvedUsername = activity.username || activity.user || null;
            if (!resolvedUsername) {
                try {
                    const { data: authData } = await window.supabaseClient.auth.getUser();
                    const authUser = authData && authData.user ? authData.user : null;
                    const profileId = (authUser && authUser.id) ? authUser.id : userId;
                    if (profileId) {
                        try {
                            const { data: prof } = await client
                                .from('profiles')
                                .select('username, name, email')
                                .eq('id', profileId)
                                .single();
                            if (prof) resolvedUsername = prof.username || prof.name || prof.email || null;
                        } catch (_) {}
                    }
                    if (!resolvedUsername) {
                        resolvedUsername = (authUser && (authUser.user_metadata && (authUser.user_metadata.username || authUser.user_metadata.user_name))) || (authUser && authUser.email) || null;
                    }
                    if (!resolvedUsername && userId) {
                        const { data: prof } = await client
                            .from('profiles')
                            .select('username, name, email')
                            .eq('id', userId)
                            .single();
                        if (prof) resolvedUsername = prof.username || prof.name || prof.email || null;
                    }
                } catch (_) { /* ignore */ }
            }
            const meta = Object.assign({}, activity.metadata || {}, {
                username: resolvedUsername || null,
                title: activity.title || null,
                description: activity.description || null,
                type: activity.type || activity.resourceType || null,
                section: activity.section || activity.sectionId || null,
                ip: activity.ip || null
            });
            const rawSection = activity.sectionId || activity.section || null;
            // Normalize identifiers and attempt inference from provided fields
            const normalizedSection = activity.section || activity.sectionId || (activity.metadata && (activity.metadata.section || activity.metadata.sectionId)) || null;
            const normalizedResource = activity.resourceId || (activity.metadata && (activity.metadata.resource_id || activity.metadata.resourceId)) || null;
            // Enrich from resources table using title/id where possible (best-effort)
            try {
                // If we have resource_id but not a title, fetch title
                if (normalizedResource && !meta.title) {
                    const { data: r1 } = await client
                        .from('resources')
                        .select('title, section_id')
                        .eq('id', normalizedResource)
                        .maybeSingle();
                    if (r1 && r1.title) meta.title = r1.title;
                    if (!rawSection && !normalizedSection && r1 && r1.section_id && !meta.section) meta.section = r1.section_id;
                }
                // If we have a title but no resource_id, try to resolve id by (section + title) or title alone
                const candidateTitle = meta.title || activity.resource || activity.title || meta.description || null;
                if (!normalizedResource && candidateTitle) {
                    let query = client.from('resources').select('id, section_id, title').eq('title', candidateTitle).limit(1);
                    if (normalizedSection || rawSection) {
                        query = query.eq('section_id', normalizedSection || rawSection);
                    }
                    const { data: r2 } = await query.maybeSingle();
                    if (r2 && r2.id) {
                        activity.resourceId = r2.id; // reflect for payload below
                        if (!meta.section && r2.section_id) meta.section = r2.section_id;
                    }
                }
            } catch (_) { /* ignore enrichment failures */ }
            const payload = {
                user_id: userId,
                action: activity.action || 'EVENT',
                resource_id: (activity.resourceId || normalizedResource) || null,
                section_id: (rawSection && String(rawSection).trim().toLowerCase() !== 'general') ? rawSection : (normalizedSection || null),
                metadata: meta
            };
            // Attempt to parse section/resource IDs from description as a last resort
            try {
                if (!payload.section_id && activity.description && typeof activity.description === 'string') {
                    const m = activity.description.match(/section\s+([A-Za-z0-9_-]+)/i);
                    if (m && m[1]) payload.section_id = m[1];
                }
            } catch (_) {}
            if (activity.timestamp) {
                payload.timestamp = new Date(activity.timestamp);
            }
            const { data, error } = await client
                .from('activities')
                .insert(payload);
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error saving activity:', error);
            throw error;
        }
    }

    // Convenience method used by the hub UI to record content updates
    async addActivity(entry) {
        try {
            const client = window.supabaseClient || this.supabase;
            if (!client) throw new Error('Supabase client not ready');
            const currentUserId = await this.getCurrentUserId();
            const userId = currentUserId || null;
            // Resolve username/email for display if not explicitly provided
            let resolvedUsername = entry.username || null;
            if (!resolvedUsername) {
                try {
                    const { data: authData } = await window.supabaseClient.auth.getUser();
                    const authUser = authData && authData.user ? authData.user : null;
                    const profileId = (authUser && authUser.id) ? authUser.id : userId;
                    if (profileId) {
                        try {
                            const { data: prof } = await client
                                .from('profiles')
                                .select('username, name, email')
                                .eq('id', profileId)
                                .single();
                            if (prof) resolvedUsername = prof.username || prof.name || prof.email || null;
                        } catch (_) {}
                    }
                    if (!resolvedUsername) {
                        resolvedUsername = (authUser && (authUser.user_metadata && (authUser.user_metadata.username || authUser.user_metadata.user_name))) || (authUser && authUser.email) || null;
                    }
                    if (!resolvedUsername && userId) {
                        const { data: prof } = await client
                            .from('profiles')
                            .select('username, name, email')
                            .eq('id', userId)
                            .single();
                        if (prof) resolvedUsername = prof.username || prof.name || prof.email || null;
                    }
                } catch (_) { /* ignore */ }
            }
            const normalizedSection = entry.section || entry.sectionId || (entry.metadata && (entry.metadata.section || entry.metadata.sectionId)) || null;
            let normalizedResource = entry.resourceId || (entry.metadata && (entry.metadata.resource_id || entry.metadata.resourceId)) || null;
            // Enrich from resources table using title/id where possible (best-effort)
            try {
                // If we have resource_id but no title, fetch title
                if (normalizedResource && !(entry.title || (entry.metadata && entry.metadata.title))) {
                    const { data: r1 } = await client
                        .from('resources')
                        .select('title, section_id')
                        .eq('id', normalizedResource)
                        .maybeSingle();
                    if (r1 && r1.title) entry.title = entry.title || r1.title;
                    if (!normalizedSection && r1 && r1.section_id) entry.section = entry.section || r1.section_id;
                }
                // If we have a title but no resource_id, try to resolve id
                const candidateTitle = entry.title || (entry.metadata && entry.metadata.title) || entry.resource || (entry.metadata && entry.metadata.description) || null;
                if (!normalizedResource && candidateTitle) {
                    let query = client.from('resources').select('id, section_id, title').eq('title', candidateTitle).limit(1);
                    if (normalizedSection) query = query.eq('section_id', normalizedSection);
                    const { data: r2 } = await query.maybeSingle();
                    if (r2 && r2.id) {
                        normalizedResource = r2.id;
                        if (!entry.section && r2.section_id) entry.section = r2.section_id;
                    }
                }
            } catch (_) { /* ignore enrichment failures */ }
            const payload = {
                user_id: userId,
                action: entry.action || 'updated',
                section_id: (entry.section && String(entry.section).trim().toLowerCase() !== 'general') ? entry.section : (normalizedSection || null),
                resource_id: normalizedResource || null,
                metadata: {
                    username: resolvedUsername || null,
                    title: entry.title || null,
                    description: entry.title || null,
                    type: entry.type || null,
                    section: entry.section || null
                }
            };
            // Parse from description as fallback
            try {
                if (!payload.section_id && entry.description && typeof entry.description === 'string') {
                    const m = entry.description.match(/section\s+([A-Za-z0-9_-]+)/i);
                    if (m && m[1]) payload.section_id = m[1];
                }
            } catch (_) {}
            if (entry.timestamp) {
                payload.timestamp = new Date(entry.timestamp);
            }
            const { data, error } = await client.from('activities').insert(payload);
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error adding activity:', error);
            throw error;
        }
    }

    async getActivities(limit = 1000, offset = 0) {
        try {
            const client = window.supabaseClient || this.supabase;
            if (!client) throw new Error('Supabase client not ready');
            const from = offset;
            const to = Math.max(offset, offset + limit - 1);
            let data = null, error = null;
            // Try ordering by 'timestamp' (newer schema)
            try {
                const res = await client
                    .from('activities')
                    .select('*')
                    .order('timestamp', { ascending: false })
                    .range(from, to);
                data = res.data; error = res.error;
            } catch (e1) { error = e1; }
            // Fallback: order by 'created_at' (older schema)
            if (error) {
                try {
                    const res2 = await client
                        .from('activities')
                        .select('*')
                        .order('created_at', { ascending: false })
                        .range(from, to);
                    data = res2.data; error = res2.error;
                } catch (e2) { error = e2; }
            }
            // Final fallback: no explicit ordering
            if (error) {
                const res3 = await client
                    .from('activities')
                    .select('*')
                    .range(from, to);
                data = res3.data; error = res3.error;
            }
            if (error) throw error;

            const rows = Array.isArray(data) ? data : [];
            const userIds = Array.from(new Set(rows.map(r => r.user_id).filter(Boolean)));
            let usersById = {};
            if (userIds.length > 0) {
                try {
                    const { data: profs } = await this.supabase
                        .from('profiles')
                        .select('id, username, email')
                        .in('id', userIds);
                    (profs || []).forEach(p => { usersById[p.id] = p; });
                } catch (_) {}
            }

            return rows.map(r => {
                const meta = r.metadata || {};
                const prof = r.user_id ? usersById[r.user_id] : null;
                return Object.assign({}, r, {
                    username: meta.username || (prof && (prof.username || prof.email)) || null,
                    description: meta.description || meta.title || null,
                    title: meta.title || null,
                    section: r.section_id || meta.section || null
                });
            });
        } catch (error) {
            console.error('Error getting activities:', error);
            return [];
        }
    }

    // Views Management
    async recordView(userId, resourceId) {
        try {
            const client = window.supabaseClient || this.supabase;
            if (!client) throw new Error('Supabase client not ready');
            // Use the RPC function for safe increment
            const { error } = await client
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
            const client = window.supabaseClient || this.supabase;
            if (!client) throw new Error('Supabase client not ready');
            const { data, error } = await client
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

    // Site settings (global key/value store)
    async getSiteSetting(key) {
        try {
            if (!key) throw new Error('Missing setting key');
            const { data, error } = await this.supabase
                .from('site_settings')
                .select('value')
                .eq('key', key)
                .single();
            if (error) {
                // If no rows, return null instead of throwing
                if (String(error.message || '').toLowerCase().includes('no rows')) return null;
                throw error;
            }
            if (!data) return null;
            let v = data.value || null;
            try {
                // Coerce stringified JSON to object for robustness
                if (typeof v === 'string') v = JSON.parse(v);
            } catch (_) { /* leave as-is if not parseable */ }
            return v;
        } catch (error) {
            console.error('Error getting site setting:', error);
            return null;
        }
    }

    async setSiteSetting(key, value) {
        try {
            if (!key) throw new Error('Missing setting key');
            // Admin-only guard using profiles table
            const userId = await this.getCurrentUserId();
            if (!userId) throw new Error('Not authenticated');
            const { data: prof, error: pErr } = await this.supabase
                .from('profiles')
                .select('role, permissions')
                .eq('id', userId)
                .single();
            if (pErr) throw pErr;
            const role = String(prof?.role || '').toLowerCase();
            const canManage = !!(prof && prof.permissions && prof.permissions.canManageUsers);
            if (!(role === 'admin' || canManage)) {
                throw new Error('Only admins can update site settings');
            }

            // Store value as-is; backend column is jsonb and accepts any JSON
            const payload = { key, value };
            const { data, error } = await this.supabase
                .from('site_settings')
                .upsert(payload, { onConflict: 'key' })
                .select('key')
                .single();
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error setting site setting:', error);
            throw error;
        }
    }

	// Fetch all site settings as an array of { key, value }
	async getAllSiteSettings() {
		try {
			const client = window.supabaseClient || this.supabase;
			if (!client) throw new Error('Supabase client not ready');
			const { data, error } = await client
				.from('site_settings')
				.select('key, value')
				.order('key', { ascending: true });
			if (error) throw error;
			return Array.isArray(data) ? data : [];
		} catch (error) {
			console.error('Error getting all site settings:', error);
			return [];
		}
	}

	// Export full system state for JSON backup (superset of exportAllData)
	async exportRawState() {
		try {
			const base = await this.exportAllData();
			let siteSettings = [];
			try { siteSettings = await this.getAllSiteSettings(); } catch(_) { siteSettings = []; }
			return Object.assign({}, base, { siteSettings });
		} catch (error) {
			console.error('Error exporting raw state:', error);
			throw error;
		}
	}

	// Import raw state produced by backup JSON (admin-only)
	async importRawState(raw, opts = {}) {
		try {
			const onProgress = (evt) => { try { if (opts && typeof opts.onProgress === 'function') opts.onProgress(evt); } catch(_) {} };
			const client = window.supabaseClient || this.supabase;
			if (!client) throw new Error('Supabase client not ready');
			// Admin-only guard
			const currentUserId = await this.getCurrentUserId();
			if (!currentUserId) throw new Error('Not authenticated');
			const { data: prof, error: pErr } = await client
				.from('profiles')
				.select('role, permissions')
				.eq('id', currentUserId)
				.single();
			if (pErr) throw pErr;
			const role = String(prof?.role || '').toLowerCase();
			const canManage = !!(prof && prof.permissions && prof.permissions.canManageUsers);
			if (!(role === 'admin' || canManage)) {
				throw new Error('Only admin or managers can restore data');
			}

			const data = raw && typeof raw === 'object' ? raw : {};
			const counts = {
				sections: Array.isArray(data.sections) ? data.sections.length : 0,
				resources: (data.resources && typeof data.resources === 'object')
					? (Array.isArray(data.resources) ? data.resources.length : Object.values(data.resources).reduce((n,a)=>n+(Array.isArray(a)?a.length:0),0))
					: 0,
				views: Array.isArray(data.views) ? data.views.length : 0,
				siteSettings: Array.isArray(data.siteSettings) ? data.siteSettings.length : (data.siteSettings && typeof data.siteSettings === 'object' ? Object.keys(data.siteSettings).length : 0),
				users: Array.isArray(data.users) ? data.users.length : 0
			};
			onProgress({ step: 'start', counts });

			// Temporarily elevate current user's edit rights to satisfy RLS during restore
			let originalPermissions = null;
			try {
				const { data: curProf } = await client
					.from('profiles')
					.select('id, permissions')
					.eq('id', currentUserId)
					.single();
				originalPermissions = (curProf && curProf.permissions && typeof curProf.permissions === 'object') ? JSON.parse(JSON.stringify(curProf.permissions)) : {};
				const nextPerm = Object.assign({}, originalPermissions, { canEditAllSections: true });
				await client.from('profiles').update({ permissions: nextPerm }).eq('id', currentUserId);
				onProgress({ step: 'elevated', details: { canEditAllSections: true } });
			} catch (_) { /* best-effort */ }

			// Sections
			if (Array.isArray(data.sections)) {
				for (const section of data.sections) {
					const sectionIdRaw = section.section_id || section.sectionId || section.id;
					const sectionId = sectionIdRaw != null ? String(sectionIdRaw) : '';
					if (!sectionId) { try { console.warn('restore: skipped section with missing id'); } catch(_) {} continue; }
					const incomingCfg = (section && typeof section.config === 'object' && section.config !== null) ? section.config : {};
					const nextConfig = incomingCfg; // preserve exactly as provided
					const payload = {
						sectionId,
						name: section.name,
						icon: section.icon,
						color: section.color,
						config: nextConfig,
						data: section.data || {}
					};
					try { await this.saveSection(payload); onProgress({ step: 'section', id: sectionId, status: 'ok' }); }
					catch (e) { try { console.warn('restore: saveSection failed', e?.message || e); onProgress({ step: 'section', id: sectionId, status: 'error', error: e?.message || String(e) }); } catch(_) {} }
				}
			}
			// Resources (array or { [sectionId]: Resource[] })
			if (data.resources && typeof data.resources === 'object') {
				if (Array.isArray(data.resources)) {
					for (const r of data.resources) {
						const sectionId = r.section_id || r.sectionId || r.section || null;
						const payload = Object.assign({}, r, { sectionId });
						try { await this.saveResource(payload); onProgress({ step: 'resource', sectionId, id: r.id || null, status: 'ok' }); }
						catch (e) { try { console.warn('restore: saveResource failed', e?.message || e); onProgress({ step: 'resource', sectionId, id: r.id || null, status: 'error', error: e?.message || String(e) }); } catch(_) {} }
					}
				} else {
					for (const sid of Object.keys(data.resources)) {
						const arr = Array.isArray(data.resources[sid]) ? data.resources[sid] : [];
						for (const r of arr) {
							const payload = Object.assign({}, r, { sectionId: sid });
							try { await this.saveResource(payload); onProgress({ step: 'resource', sectionId: sid, id: r.id || null, status: 'ok' }); }
							catch (e) { try { console.warn('restore: saveResource failed', e?.message || e); onProgress({ step: 'resource', sectionId: sid, id: r.id || null, status: 'error', error: e?.message || String(e) }); } catch(_) {} }
						}
					}
				}
			}
			// Activities: present in backup for audit history, but intentionally NOT restored
			// Views (best-effort)
			if (Array.isArray(data.views)) {
				for (const v of data.views) {
					try {
						const payload = {
							id: v.id,
							user_id: v.user_id || v.userId || null,
							resource_id: v.resource_id || v.resourceId || null,
							count: v.count || v.view_count || v.views,
							last_viewed_at: v.last_viewed_at || v.lastViewedAt || v.last_viewed
						};
						Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
						if (payload.user_id && payload.resource_id) {
							await client.from('views').upsert(payload, { onConflict: 'user_id,resource_id' });
						}
						onProgress({ step: 'view', id: v.id || null, status: 'ok' });
					} catch (e) { try { console.warn('restore: upsert view failed', e?.message || e); onProgress({ step: 'view', id: v.id || null, status: 'error', error: e?.message || String(e) }); } catch(_) {} }
				}
			}
			// Site settings
			if (data.siteSettings) {
				try {
					if (Array.isArray(data.siteSettings)) {
						for (const row of data.siteSettings) {
							if (!row || typeof row.key !== 'string') continue;
							try { await this.setSiteSetting(row.key, row.value); onProgress({ step: 'siteSetting', key: row.key, status: 'ok' }); }
							catch (e) { try { console.warn('restore: setSiteSetting failed', row.key, e?.message || e); onProgress({ step: 'siteSetting', key: row.key, status: 'error', error: e?.message || String(e) }); } catch(_) {} }
						}
					} else if (typeof data.siteSettings === 'object') {
						for (const k of Object.keys(data.siteSettings)) {
							try { await this.setSiteSetting(k, data.siteSettings[k]); onProgress({ step: 'siteSetting', key: k, status: 'ok' }); }
							catch (e) { try { console.warn('restore: setSiteSetting failed', k, e?.message || e); onProgress({ step: 'siteSetting', key: k, status: 'error', error: e?.message || String(e) }); } catch(_) {} }
						}
					}
				} catch (e) { try { console.warn('restore: siteSettings import failed', e?.message || e); onProgress({ step: 'siteSetting', status: 'error', error: e?.message || String(e) }); } catch(_) {} }
			}
			// Users (import last so temporary permission elevation persists during section/resource writes)
			if (Array.isArray(data.users)) {
				for (const user of data.users) {
					try { await this.saveUser(user); onProgress({ step: 'user', id: user.id || user.email || null, status: 'ok' }); }
					catch (e) { try { console.warn('restore: saveUser failed', e?.message || e); onProgress({ step: 'user', id: user.id || user.email || null, status: 'error', error: e?.message || String(e) }); } catch(_) {} }
				}
			}
			// Best-effort revert of temporary elevation
			try {
				if (originalPermissions) {
					await client.from('profiles').update({ permissions: originalPermissions }).eq('id', currentUserId);
					onProgress({ step: 'reverted' });
				}
			} catch (_) { /* keep elevated if revert fails */ }
			onProgress({ step: 'done' });
			return true;
		} catch (error) {
			console.error('Error importing raw state:', error);
			try { if (opts && typeof opts.onProgress === 'function') opts.onProgress({ step: 'error', error: error?.message || String(error) }); } catch(_) {}
			throw error;
		}
	}

    // Export all data (tolerant of RLS: missing datasets return as empty arrays)
    async exportAllData() {
        // Prefer a privileged RPC if available (reduces multi-round trips and bypasses per-table RLS complexity)
        try {
            if (this.supabase && typeof this.supabase.rpc === 'function') {
                const { data: payload, error: rpcError } = await this.supabase.rpc('export_all_data');
                if (!rpcError && payload && typeof payload === 'object') {
                    const users = Array.isArray(payload.users) ? payload.users : [];
                    const sections = Array.isArray(payload.sections) ? payload.sections : [];
                    const resources = Array.isArray(payload.resources) ? payload.resources : [];
                    const activities = Array.isArray(payload.activities) ? payload.activities : [];
                    const views = Array.isArray(payload.views) ? payload.views : [];
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
                }
            }
        } catch (e) {
            try { console.warn('exportAllData RPC fallback failed:', e?.message || e); } catch(_) {}
        }

        const safe = async (fn, fallback = []) => {
            try { const res = await fn(); return Array.isArray(res) ? res : (res || []); }
            catch (e) { console.warn('exportAllData partial fetch failed:', e?.message || e); return fallback; }
        };
        const users = await safe(() => this.getAllUsers(), []);
        const sections = await safe(() => this.getAllSections(), []);
        const resources = await safe(() => this.getAllResources(), []);
        const activities = await safe(() => this.getActivities(), []);
        const views = await safe(() => this.getAllViews(), []);

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
    }

    // Clear all data (admin only)
    async clearAllData() {
        try {
            const userId = await this.getCurrentUserId();
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
