# Bronx Bot Dashboard

A comprehensive web-based administration panel for managing Bronx Bot server settings, economy, and all bot features through an intuitive graphical user interface.

## 🌟 Features

### Core Management
- **Guild Settings**: Configure prefixes, logging, blocked channels
- **Command & Module Control**: Enable/disable commands and modules per server
- **User Management**: Search users, manage badges, view economy data

### Economy System
- **Economy Overview**: Monitor total economy value, user balances
- **Guild Balance Management**: Adjust server giveaway funds
- **Interest Rate Configuration**: Set interest rates and limits

### Shop & Marketplace
- **Shop Item Management**: Add, edit, remove shop items
- **Daily Deals**: Configure special offers and discounts
- **Bazaar Monitoring**: Track stock prices and visitor activity

### Fishing System
- **Fishing Statistics**: View catch rates, valuable fish data
- **Gear Management**: Configure rods and bait availability
- **Autofisher Control**: Monitor active autofishers and settings

### Moderation Tools
- **Blacklist/Whitelist**: Manage global user access
- **Autopurge Scheduling**: Automated message cleanup
- **Cooldown Management**: Configure command cooldowns

### Advanced Features
- **Reaction Roles**: Set up emoji-based role assignment
- **Giveaway Management**: Create and monitor server giveaways
- **ML Settings**: Configure machine learning parameters
- **Statistics Dashboard**: View command usage, leaderboards, analytics

## 🚀 Quick Start

### Prerequisites
- Node.js 14+ 
- MariaDB/MySQL database
- Existing Bronx Bot database schema

### Installation

1. **Navigate to the site directory**
   ```bash
   cd /path/to/bpp/site
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure database connection**
   
   Create a `.env` file:
   ```env
   DB_HOST=localhost
   DB_USER=your_db_user
   DB_PASSWORD=your_db_password
   DB_NAME=bronxbot
   PORT=3000
   ```

   Or set environment variables:
   ```bash
   export DB_HOST=localhost
   export DB_USER=root
   export DB_PASSWORD=your_password
   export DB_NAME=bronxbot
   ```

4. **Start the dashboard server**
   ```bash
   npm start
   ```

5. **Access the dashboard**
   Open http://localhost:3000 in your web browser

### Development Mode
```bash
npm run dev
```
This uses nodemon for automatic server restarts during development.

## 🎛️ Dashboard Sections

### Overview
- Real-time statistics and activity monitoring
- Quick access to key metrics
- Recent bot activity feed

### Guild Settings
- **Basic Settings**: Prefix, logging configuration
- **Blocked Channels**: Prevent bot usage in specific channels  
- **Custom Prefixes**: Multiple command prefixes per server

### Commands & Modules
- **Module Toggles**: Enable/disable entire feature sets
- **Command Control**: Individual command permissions
- **Scope Settings**: Channel/role/user specific permissions

### Economy Management
- **User Search**: Find users by ID or economy value
- **Balance Adjustments**: Modify guild giveaway funds
- **Interest Configuration**: Set bank interest rates

### Shop & Marketplace
- **Item Catalog**: Manage rods, bait, potions, upgrades
- **Pricing Control**: Set prices and stock limits
- **Daily Deals**: Create time-limited discounts

### Fishing System  
- **Catch Statistics**: Monitor fishing activity
- **Gear Configuration**: Manage fishing equipment
- **ML Data**: Review machine learning logs

### Giveaways
- **Create Giveaways**: Set up automated prize distributions
- **Monitor Active**: Track ongoing giveaways
- **History Review**: View past giveaway results

### Moderation
- **Global Lists**: Blacklist/whitelist management
- **Autopurge**: Schedule automatic message deletion
- **Cooldowns**: Prevent command spam

### Reaction Roles
- **Role Assignment**: Link emojis to Discord roles
- **Message Binding**: Connect reactions to specific messages

### Statistics
- **Command Usage**: Track popular commands
- **Leaderboards**: View top users by various metrics
- **Activity Graphs**: Visual performance data

### ML Settings
- **Configuration**: Machine learning parameters
- **Price History**: Track automated price adjustments

### User Management
- **User Search**: Find and examine user accounts
- **Badge System**: Grant special user badges
- **Suggestions**: Review user feedback

## 📊 Database Integration

The dashboard directly interfaces with your existing Bronx Bot MariaDB database:

- **Read Operations**: Real-time data from all bot tables
- **Write Operations**: Safe configuration updates
- **Transaction Safety**: Atomic operations for data integrity

### Supported Tables
- `users` - User economy and profile data
- `guild_settings` - Server configuration
- `shop_items` - Marketplace inventory
- `fish_catches` - Fishing statistics  
- `giveaways` - Prize distribution system
- `reaction_roles` - Emoji role assignments
- `ml_settings` - Machine learning configuration
- And many more...

## 🔒 Security Considerations

- **Database Access**: Uses parameterized queries to prevent SQL injection
- **Input Validation**: Server-side validation for all user inputs
- **Error Handling**: Graceful error responses without exposing internals
- **CORS Configuration**: Configurable cross-origin request handling

## 🛠️ API Endpoints

The dashboard includes a comprehensive REST API:

```
GET  /api/stats/overview          - Dashboard statistics
GET  /api/guild/settings          - Guild configuration
POST /api/guild/settings          - Update guild settings
GET  /api/modules                 - Module states
POST /api/modules/toggle          - Toggle module
GET  /api/economy/guild-balance   - Server economy
GET  /api/shop/items             - Shop catalog
POST /api/shop/items             - Add shop item
GET  /api/users/search           - User lookup
POST /api/giveaways              - Create giveaway
... and many more
```

## 🎨 Customization

### Styling
- Modern dark theme optimized for administrative use
- Responsive design for desktop and mobile
- CSS custom properties for easy color scheme changes

### Functionality
- Modular JavaScript architecture
- Chart.js integration for data visualization
- Modal system for complex actions

## 📈 Monitoring & Analytics

- **Real-time Stats**: Live command usage and user activity
- **Historical Data**: Trend analysis over time
- **Performance Metrics**: Database query optimization
- **User Behavior**: Command popularity and feature usage

## 🔧 Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Verify database credentials in `.env`
   - Check MariaDB service status
   - Ensure database exists and schema is loaded

2. **Permission Denied**
   - Verify database user has necessary privileges
   - Check table permissions for read/write operations

3. **Port Already in Use**
   - Change PORT in `.env` file
   - Kill existing process on port 3000

4. **Module Not Loading**
   - Restart server after making changes
   - Check browser console for JavaScript errors

### Debug Mode
Set NODE_ENV=development for detailed error logging.

## 📝 License

This dashboard is part of the Bronx Bot project. Please refer to the main project license.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📞 Support

For issues or questions:
- Check the troubleshooting section
- Review database schema documentation
- Contact the Bronx Bot development team

---

**Note**: This dashboard requires an existing Bronx Bot database with the proper schema. The dashboard reads from and writes to the live bot database, so use with caution in production environments.