# Information Hub

A modern, responsive web application for managing organizational resources and information across different functional areas. Built with vanilla JavaScript and Supabase for authentication and data management.

## 🚀 Features

- **Multi-Section Dashboard**: Organized sections for different functional areas (Costing, Supply Planning, Operations, Quality, HR, IT)
- **User Authentication**: Secure login system powered by Supabase
- **Role-Based Access Control**: Different permission levels for different user types
- **Resource Management**: Upload, organize, and manage documents and resources
- **Real-time Updates**: Live data synchronization with Supabase
- **Responsive Design**: Works seamlessly on desktop and mobile devices
- **Admin Panel**: User management and system administration tools

## 🛠️ Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Backend**: Supabase (PostgreSQL, Authentication, Real-time)
- **Styling**: Custom CSS with modern design principles
- **Icons**: Font Awesome
- **Deployment**: Vercel/Netlify ready

## 📋 Prerequisites

- Modern web browser (Chrome, Firefox, Safari, Edge)
- Supabase account and project
- Web server (for local development)

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/information-hub.git
cd information-hub
```

### 2. Configure Supabase

1. Your Supabase project is already set up at [supabase.com](https://supabase.com)
2. Your current Supabase credentials in `config.js`:
   - **URL**: `https://pioubcszuayewepdawzt.supabase.co`
   - **Anon Key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpb3ViY3N6dWF5ZXdlcGRhd3p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1NDU1MjIsImV4cCI6MjA3NDEyMTUyMn0.-L-vDiKP2xh18OMgBoBQ8mruzVGXhWvMdvxJg9mjY9k`

**Note**: These credentials are already configured in your `config.js` file.

### 3. Set Up Database

Run the SQL scripts in the following order:

1. `complete-schema-final.sql` - Main database schema
2. `create-sample-data.sql` - Sample data for testing
3. `fix-rls-policies-v2.sql` - Row Level Security policies

### 4. Deploy to Vercel

**Your project is configured for Vercel deployment:**

1. **Connect to Vercel:**
   - Go to [vercel.com](https://vercel.com)
   - Sign in with your GitHub account
   - Click "New Project" and import your repository

2. **Deploy Settings:**
   - **Framework Preset**: Other
   - **Root Directory**: `./` (root)
   - **Build Command**: Leave empty (no build needed)
   - **Output Directory**: Leave empty

3. **Environment Variables:**
   - `SUPABASE_URL`: `https://pioubcszuayewepdawzt.supabase.co`
   - `SUPABASE_ANON_KEY`: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpb3ViY3N6dWF5ZXdlcGRhd3p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1NDU1MjIsImV4cCI6MjA3NDEyMTUyMn0.-L-vDiKP2xh18OMgBoBQ8mruzVGXhWvMdvxJg9mjY9k`

4. **Deploy:** Click "Deploy" and your site will be live!

**Your live URL will be:** `https://your-project-name.vercel.app`

#### Local Development
```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve .

# Using PHP
php -S localhost:8000
```

## 📁 Project Structure

```
information-hub/
├── index.html              # Main dashboard page
├── auth.html               # Authentication page
├── section.html            # Individual section page
├── styles.css              # Main stylesheet
├── config.js               # Configuration file
├── database-supabase.js    # Supabase database operations
├── hub-script.js           # Main application logic
├── section-script.js       # Section-specific functionality
├── auth-script.js          # Authentication logic
├── excel-export.js         # Excel export functionality
├── background-pic/         # Background images and assets
├── data/                   # JSON data files
├── *.sql                   # Database schema and setup files
└── README.md               # This file
```

## 🔧 Configuration

### Environment Variables

Create a `.env` file (for local development) or set environment variables in your deployment platform:

```env
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-supabase-anon-key
```

### Database Setup

1. **Users Table**: Stores user profiles and permissions
2. **Sections Table**: Defines available sections
3. **Resources Table**: Stores uploaded resources
4. **Activities Table**: Tracks user activities
5. **Views Table**: Tracks resource views

## 👥 User Roles

- **Admin**: Full access to all features and admin panel
- **Manager**: Can manage assigned sections
- **Member**: Basic access to assigned sections
- **Guest**: Limited read-only access

## 🔐 Security Features

- Row Level Security (RLS) policies
- JWT-based authentication
- Role-based access control
- Secure file uploads
- Input validation and sanitization

## 📱 Responsive Design

The application is fully responsive and works on:
- Desktop computers
- Tablets
- Mobile phones
- Various screen sizes and orientations

## 🚀 Deployment

### Vercel Deployment

1. Fork this repository
2. Connect to Vercel
3. Set environment variables
4. Deploy

### Netlify Deployment

1. Fork this repository
2. Connect to Netlify
3. Set build settings
4. Deploy

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

If you encounter any issues or have questions:

1. Check the [Issues](https://github.com/yourusername/information-hub/issues) page
2. Create a new issue with detailed information
3. Contact the development team

## 🔄 Version History

- **v1.0.0** - Initial release with basic functionality
- **v1.1.0** - Added Supabase integration
- **v1.2.0** - Enhanced UI and user experience
- **v1.3.0** - Added admin panel and user management

## 🙏 Acknowledgments

- Supabase for backend services
- Font Awesome for icons
- The open-source community for inspiration and tools

---

**Made with ❤️ for better information management**