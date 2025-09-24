# Deployment Guide

This guide will help you deploy the Information Hub to various platforms.

## 🚀 Quick Deploy Options

### 1. Vercel (Your Current Setup)

**Your Supabase & Vercel Configuration:**

**Steps:**
1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click "New Project" and import your repository
3. Set deployment settings:
   - **Framework Preset**: Other
   - **Root Directory**: `./` (root)
   - **Build Command**: Leave empty
   - **Output Directory**: Leave empty
4. Set environment variables:
   - `SUPABASE_URL`: `https://pioubcszuayewepdawzt.supabase.co`
   - `SUPABASE_ANON_KEY`: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpb3ViY3N6dWF5ZXdlcGRhd3p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1NDU1MjIsImV4cCI6MjA3NDEyMTUyMn0.-L-vDiKP2xh18OMgBoBQ8mruzVGXhWvMdvxJg9mjY9k`
5. Click "Deploy"

**Your Live URL:** `https://information-hub-cts.vercel.app` (or similar)

### 2. Netlify

**Steps:**
1. Fork this repository to your GitHub account
2. Go to [netlify.com](https://netlify.com) and sign in with GitHub
3. Click "New site from Git" and select your repository
4. Set build settings:
   - Build command: `npm run build` (or leave empty)
   - Publish directory: `.` (root directory)
5. Add environment variables in Site settings > Environment variables
6. Click "Deploy site"

### 3. GitHub Pages

**Steps:**
1. Fork this repository
2. Go to Settings > Pages
3. Select "Deploy from a branch"
4. Choose "main" branch and "/ (root)" folder
5. Click "Save"
6. Your site will be available at `https://yourusername.github.io/information-hub`

**Note:** GitHub Pages doesn't support server-side features, so you'll need to use Supabase for backend functionality.

## 🔧 Manual Deployment

### Using a Web Server

1. **Upload files** to your web server
2. **Set up environment variables** in your hosting platform
3. **Configure your domain** to point to the server
4. **Set up SSL certificate** for HTTPS

### Using Docker

Create a `Dockerfile`:

```dockerfile
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Build and run:
```bash
docker build -t information-hub .
docker run -p 80:80 information-hub
```

## 🗄️ Database Setup

### Supabase Setup

1. **Create a new project** at [supabase.com](https://supabase.com)
2. **Run the SQL scripts** in this order:
   ```sql
   -- 1. Main schema
   \i complete-schema-final.sql
   
   -- 2. Sample data
   \i create-sample-data.sql
   
   -- 3. Security policies
   \i fix-rls-policies-v2.sql
   ```
3. **Configure authentication** in Supabase dashboard
4. **Set up storage** for file uploads (if needed)

### Environment Configuration

Update `config.js` with your Supabase credentials:

```javascript
const CONFIG = {
    SUPABASE_URL: 'https://your-project.supabase.co',
    SUPABASE_ANON_KEY: 'your-anon-key',
    // ... other settings
};
```

## 🔒 Security Considerations

### Production Checklist

- [ ] **HTTPS enabled** - Always use HTTPS in production
- [ ] **Environment variables** - Never commit secrets to git
- [ ] **CORS configured** - Set up proper CORS policies
- [ ] **Rate limiting** - Implement rate limiting for API calls
- [ ] **Input validation** - Validate all user inputs
- [ ] **Error handling** - Don't expose sensitive error details

### Supabase Security

1. **Enable RLS** (Row Level Security) on all tables
2. **Set up proper policies** for data access
3. **Configure authentication** settings
4. **Set up API rate limiting**
5. **Enable audit logs**

## 📊 Monitoring and Analytics

### Recommended Tools

- **Vercel Analytics** - Built-in analytics for Vercel deployments
- **Google Analytics** - Add GA tracking code
- **Sentry** - Error monitoring and performance tracking
- **Supabase Dashboard** - Monitor database usage and performance

### Adding Analytics

Add to `index.html` before closing `</head>`:

```html
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'GA_MEASUREMENT_ID');
</script>
```

## 🔄 CI/CD Pipeline

### GitHub Actions

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Vercel

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2
    - name: Deploy to Vercel
      uses: amondnet/vercel-action@v20
      with:
        vercel-token: ${{ secrets.VERCEL_TOKEN }}
        vercel-org-id: ${{ secrets.ORG_ID }}
        vercel-project-id: ${{ secrets.PROJECT_ID }}
```

## 🐛 Troubleshooting

### Common Issues

1. **CORS errors** - Check Supabase CORS settings
2. **Authentication fails** - Verify Supabase credentials
3. **Database connection** - Check RLS policies
4. **File uploads** - Verify storage configuration

### Debug Mode

Enable debug mode in `config.js`:

```javascript
const CONFIG = {
    // ... other config
    DEBUG_MODE: true,
    ENABLE_LOGGING: true
};
```

## 📞 Support

If you encounter issues during deployment:

1. Check the [Issues](https://github.com/yourusername/information-hub/issues) page
2. Review the troubleshooting section above
3. Create a new issue with deployment details
4. Contact the development team

---

**Happy Deploying! 🚀**