// Environment Configuration for Information Hub
// This file should be added to .gitignore in production

const CONFIG = {
    // Supabase Configuration
    SUPABASE_URL: window.SUPABASE_URL || 
                  localStorage.getItem('SUPABASE_URL') || 
                  document.querySelector('meta[name="supabase-url"]')?.content ||
                  'https://pioubcszuayewepdawzt.supabase.co',
    
    SUPABASE_ANON_KEY: window.SUPABASE_ANON_KEY || 
                       localStorage.getItem('SUPABASE_ANON_KEY') || 
                       document.querySelector('meta[name="supabase-anon-key"]')?.content ||
                       'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpb3ViY3N6dWF5ZXdlcGRhd3p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1NDU1MjIsImV4cCI6MjA3NDEyMTUyMn0.-L-vDiKP2xh18OMgBoBQ8mruzVGXhWvMdvxJg9mjY9k',
    
    // Application Configuration
    APP_NAME: 'Information Hub',
    VERSION: '1.0.0',
    
    // Database Configuration
    DB_RETRY_ATTEMPTS: 3,
    DB_TIMEOUT_MS: 5000,
    
    // Security Configuration
    SESSION_TIMEOUT_MS: 24 * 60 * 60 * 1000, // 24 hours
    MAX_LOGIN_ATTEMPTS: 5,
    
    // Development flags
    DEBUG_MODE: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
    ENABLE_LOGGING: true
};

// Validate configuration
function validateConfig() {
    const errors = [];
    
    if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL === '') {
        errors.push('SUPABASE_URL is not configured');
    }
    
    if (!CONFIG.SUPABASE_ANON_KEY || CONFIG.SUPABASE_ANON_KEY === '') {
        errors.push('SUPABASE_ANON_KEY is not configured');
    }
    
    if (errors.length > 0) {
        console.error('Configuration validation failed:', errors);
        if (CONFIG.DEBUG_MODE) {
            alert('Configuration Error: ' + errors.join(', '));
        }
        return false;
    }
    
    return true;
}

// Export configuration
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CONFIG, validateConfig };
} else {
    window.CONFIG = CONFIG;
    window.validateConfig = validateConfig;
}
