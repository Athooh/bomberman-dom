# 🎮 Bomberman DOM Game

A modern, real-time multiplayer Bomberman game built with pure JavaScript, WebSockets, and DOM rendering. Experience classic Bomberman gameplay with smooth 60fps performance, real-time chat, and advanced power-up systems.

## ✨ Features

### 🎯 Core Gameplay
- **2-4 Player Multiplayer**: Real-time multiplayer support for 2-4 players
- **Classic Bomberman Mechanics**: Place bombs, destroy blocks, eliminate opponents
- **Lives System**: Each player starts with 3 lives
- **Corner Spawn System**: Players spawn at corner positions for balanced gameplay
- **Collision Detection**: Precise collision system for smooth gameplay

### 🚀 Power-ups System
- **💣 Extra Bombs**: Increase bomb capacity
- **🔥 Flame Range**: Extend explosion radius
- **⚡ Speed Boost**: Move faster around the map
- **👻 Block Pass**: Pass through destructible blocks (not walls)
- **Timed Effects**: Power-ups have duration and stack properly

### 🌐 Networking & Performance
- **WebSocket Communication**: Real-time, low-latency multiplayer
- **60fps Performance**: Optimized game loop and rendering
- **Prediction & Reconciliation**: Client-side prediction with server authority
- **Delta Compression**: Efficient network protocol
- **Heartbeat System**: Connection monitoring and auto-reconnection

### 💬 Social Features
- **Real-time Chat**: In-game chat system with WebSocket integration
- **Player Nicknames**: Custom player names with duplicate prevention
- **Queue System**: Automatic matchmaking with countdown timers
- **Game Statistics**: Track wins, duration, and player performance

### 🎨 Technical Features
- **Pure DOM Rendering**: No Canvas/WebGL - uses DOM elements for rendering
- **Virtual DOM**: Custom virtual DOM implementation for performance
- **Responsive Design**: Works on desktop and mobile devices
- **Dark Theme**: Modern dark UI with green accent colors
- **Modular Architecture**: Clean separation of concerns

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ 
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone https://learn.zone01kisumu.ke/git/rcaleb/bomberman-dom
   cd bomberman-dom
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the server**
   ```bash
   npm start
   ```

4. **Open your browser**
   ```
   http://localhost:8080
   ```

### Development Mode
```bash
npm run dev    # Start with auto-reload
npm run test   # Run tests
npm run lint   # Check code quality
```

## 🎮 How to Play

### Basic Controls
- **Movement**: WASD or Arrow Keys
- **Place Bomb**: Spacebar
- **Chat**: Enter key
- **Debug**: F1 (development mode)

### Game Flow
1. **Set Nickname**: Enter your player name
2. **Join Queue**: Wait for other players (2-4 players)
3. **Game Start**: 10-second countdown before gameplay begins
4. **Objective**: Eliminate other players by trapping them with bomb explosions
5. **Win Condition**: Be the last player standing

### Power-ups
- Destroy blocks to reveal power-ups
- Walk over power-ups to collect them
- Effects stack and have limited duration
- Strategic use of power-ups is key to victory

## 🏗️ Architecture

### Project Structure
```
BomberMan-Game/
├── src/
│   ├── core/           # Core game logic
│   │   ├── GameEngine.js      # Main game engine
│   │   ├── GameRoom.js        # Game session management
│   │   ├── NetworkManager.js  # WebSocket handling
│   │   └── StateManager.js    # Game state management
│   ├── ui/             # User interface
│   │   ├── UIManager.js       # UI rendering and management
│   │   └── components/        # UI components
│   ├── systems/        # Game systems
│   │   ├── CollisionSystem.js # Collision detection
│   │   ├── InputSystem.js     # Input handling
│   │   └── RenderSystem.js    # Rendering system
│   └── utils/          # Utilities
│       ├── Logger.js          # Logging system
│       └── EventManager.js    # Event handling
├── static/             # Static assets
│   ├── styles.css            # Game styles
│   └── index.html            # Main HTML file
├── bomberman-server.js       # WebSocket server
└── package.json             # Dependencies and scripts
```

### Key Components

#### Server (bomberman-server.js)
- WebSocket server handling multiplayer connections
- Game room management and matchmaking
- Player state synchronization
- Queue system with countdown timers

#### Game Engine (src/core/GameEngine.js)
- Main game loop and state management
- Player input processing
- Game logic coordination
- Network message handling

#### UI Manager (src/ui/UIManager.js)
- Virtual DOM rendering system
- Screen state management
- User interface components
- Notification system

#### Network Manager (src/core/NetworkManager.js)
- WebSocket communication
- Message serialization/deserialization
- Connection management and reconnection
- Latency optimization

## 🔧 Configuration

### Server Configuration
```javascript
// In bomberman-server.js
const GAME_CONFIG = {
    MAX_PLAYERS: 4,        // Maximum players per game
    MIN_PLAYERS: 2,        // Minimum players to start
    MAX_GAMES: 10,         // Maximum concurrent games
    HEARTBEAT_INTERVAL: 30000  // Ping interval (ms)
};
```

### Game Configuration
```javascript
// Game mechanics can be configured in GameRoom.js
const GAME_CONFIG = {
    PLAYER_SPEED: 6,           // Player movement speed
    BOMB_TIMER: 3000,          // Bomb explosion delay (ms)
    EXPLOSION_DURATION: 1000,   // Explosion duration (ms)
    INVULNERABILITY_TIME: 2000, // Damage immunity (ms)
    POWER_UP_DURATION: 30000    // Power-up effect duration (ms)
};
```

## 🌐 Network Protocol

### Message Types
- `setNickname`: Set player nickname
- `joinQueue`: Join matchmaking queue
- `playerAction`: Player input (move, bomb)
- `gameUpdate`: Server game state updates
- `chatMessage`: Chat communication
- `gameEnd`: Game completion notification

### Connection Flow
1. WebSocket connection established
2. Player sets nickname
3. Player joins queue
4. Server creates game when enough players
5. Real-time game state synchronization
6. Game end and cleanup

## 🎨 Customization

### Styling
The game uses CSS custom properties for easy theming:
```css
:root {
    --bg-primary: #0a0e0a;
    --player-1: #22d3ee;
    --player-2: #fb7185;
    --player-3: #a78bfa;
    --player-4: #4ade80;
}
```

### Adding New Power-ups
1. Define power-up type in `GameRoom.js`
2. Add rendering logic in `UIManager.js`
3. Implement effect logic in power-up system
4. Update network protocol if needed

## 🐛 Troubleshooting

### Common Issues

**Connection Problems**
- Check if port 8080 is available
- Verify WebSocket support in browser
- Check firewall settings

**Performance Issues**
- Reduce number of concurrent games
- Check browser developer tools for errors
- Monitor server memory usage

**Game Sync Issues**
- Check network latency
- Verify server-client time synchronization
- Review console logs for errors

### Debug Mode
Press F1 during gameplay to enable debug mode:
- Shows collision boundaries
- Displays network statistics
- Reveals internal game state

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

### Code Style
- Use ES6+ features
- Follow existing naming conventions
- Add JSDoc comments for functions
- Maintain separation of concerns

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Classic Bomberman game mechanics
- Modern web technologies (WebSockets, ES6+)
- Real-time multiplayer game development patterns

## 🔍 API Reference

### Server Events

#### Client → Server
```javascript
// Set player nickname
{
    type: 'setNickname',
    nickname: 'PlayerName'
}

// Join matchmaking queue
{
    type: 'joinQueue'
}

// Player movement/action
{
    type: 'playerAction',
    action: 'move',        // 'move' | 'placeBomb'
    direction: 'up',       // 'up' | 'down' | 'left' | 'right'
    timestamp: Date.now()
}

// Send chat message
{
    type: 'chatMessage',
    message: 'Hello world!',
    timestamp: Date.now()
}
```

#### Server → Client
```javascript
// Queue status update
{
    type: 'queueUpdate',
    queueSize: 2,
    maxPlayers: 4,
    players: [...]
}

// Game state update
{
    type: 'gameUpdate',
    players: [...],
    bombs: [...],
    explosions: [...],
    powerUps: [...],
    timestamp: Date.now()
}

// Game end notification
{
    type: 'gameEnd',
    winner: { id: 'player1', nickname: 'Winner' },
    stats: { duration: 120000, ... },
    finalScores: [...]
}
```

## 🧪 Testing

### Running Tests
```bash
# Run all tests
npm test

# Run specific test suite
npm test -- --grep "GameEngine"

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### Test Structure
```
tests/
├── unit/              # Unit tests
│   ├── core/         # Core logic tests
│   ├── systems/      # System tests
│   └── utils/        # Utility tests
├── integration/       # Integration tests
│   ├── multiplayer/  # Multiplayer scenarios
│   └── networking/   # Network tests
└── e2e/              # End-to-end tests
    └── gameplay/     # Full gameplay tests
```

## 🚀 Deployment

### Production Deployment

#### Using PM2 (Recommended)
```bash
# Install PM2 globally
npm install -g pm2

# Start application with PM2
pm2 start bomberman-server.js --name "bomberman-game"

# Monitor application
pm2 monit

# View logs
pm2 logs bomberman-game

# Restart application
pm2 restart bomberman-game
```

#### Using Docker
```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
EXPOSE 8080

CMD ["node", "bomberman-server.js"]
```

```bash
# Build and run
docker build -t bomberman-game .
docker run -p 8080:8080 bomberman-game
```

#### Environment Variables
```bash
# .env file
PORT=8080
NODE_ENV=production
MAX_GAMES=20
MAX_PLAYERS_PER_GAME=4
HEARTBEAT_INTERVAL=30000
LOG_LEVEL=info
```

### Performance Optimization

#### Server Optimization
- Use clustering for multiple CPU cores
- Implement Redis for session storage
- Add rate limiting for connections
- Monitor memory usage and garbage collection

#### Client Optimization
- Minimize DOM manipulations
- Use requestAnimationFrame for smooth rendering
- Implement object pooling for game entities
- Optimize network message frequency

## 🔒 Security Considerations

### Input Validation
- Sanitize all user inputs (nicknames, chat messages)
- Validate movement boundaries server-side
- Rate limit player actions and connections
- Implement anti-cheat measures

### Network Security
- Use WSS (WebSocket Secure) in production
- Implement CORS policies
- Add DDoS protection
- Monitor for suspicious connection patterns

## 📊 Monitoring & Analytics

### Server Metrics
- Active connections count
- Games in progress
- Average game duration
- Player retention rates
- Server resource usage

### Performance Metrics
- Frame rate consistency
- Network latency
- Message processing time
- Memory usage patterns

### Logging
```javascript
// Logger configuration
const logger = new Logger('GameServer', {
    level: 'info',
    format: 'json',
    transports: ['console', 'file']
});
```

### Getting Help
- 📖 Check this README for common solutions
- 🐛 Report bugs via GitHub Issues

**Enjoy the game! 💣💥**
