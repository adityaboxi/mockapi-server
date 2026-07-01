require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const http = require('http');
const { Server } = require('socket.io');

// Configs
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');
const { authenticateToken,requireAuth } = require('./middleware/auth');

// Models
const SystemEventLog = require('./models/SystemEventLog');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL,   
    credentials: true,
  },
});

// ============ DATABASE CONNECTION (with graceful failure) ============
let dbConnected = false;
let redisConnected = false;

const startServer = async () => {
  try {
    await connectDB();
    dbConnected = true;
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  }

  try {
    await connectRedis();
    redisConnected = true;
    console.log('✅ Redis connected');
  } catch (err) {
    console.error('❌ Redis coonnectioon failed:', err.message);
    process.exit(1);
  }

  // ============ BACKGROUND QUEUE SERVICES ============
  require('./queues/emailQueue');

  // ============ MIDDLEWARE ============
  app.use(cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
  }));
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, res, next) => { req.io = io; next(); });

  // ============ CONTROLLERS (unchanged) ============
  const login = require('./controllers/login');
  const setuser = require('./controllers/setuser');
  const isemailvalid = require('./controllers/isemailvalid');
  const isvalidusername = require('./controllers/isvalidusername');
  const otp_resend = require('./controllers/otp_resend');
  const otp_verify = require('./controllers/otp_verify');
  const logout = require('./controllers/logout');
  const sync_auth = require('./controllers/sync_auth');
  const guest_session = require('./controllers/guest_session');
  const create_project = require('./controllers/create_project');
  const projects = require('./controllers/projects');
  const join_project = require('./controllers/join_project');
  const updateProjectStatus = require('./controllers/updateProjectStatus');
  const api_history = require('./controllers/api_history');
  const update_api = require('./controllers/update_api');
  const add_api = require('./controllers/add_api');
  const verify_project = require('./controllers/verify_project');
  const api_version_data = require('./controllers/api_version_data');
  const reset_invitation_code = require('./controllers/reset_invitation_code');
  const verify_invitationcode_otp = require('./controllers/verify_invitationcode_otp');
  const approve_project_request = require('./controllers/approve_project_request');
  const get_received_requests = require('./controllers/get_received_requests');
  const get_sent_requests = require('./controllers/get_sent_requests');
  const revoke_request = require('./controllers/revoke_request');
  const get_user_apis = require('./controllers/get_user_apis');
  const delete_api_version = require('./controllers/delete_api_version');
  const reverse_ai = require('./controllers/reverse_ai');
  const subscribe = require('./controllers/subscribe');
  const logs = require('./controllers/logs');
  const unsubscribe = require('./controllers/unsubscribe');
const { ask_ai } = require('./controllers/ask_ai');
const delete_project = require('./controllers/delete_project');


  // ============ ROUTES ============
  app.post('/api/subscribe', authenticateToken, subscribe);
  app.post('/api/unsubscribe', authenticateToken, unsubscribe);
  app.post('/api/isemailvalid', isemailvalid);
  app.post('/api/isvalidusername', isvalidusername);
  app.post('/api/setuser', setuser);
  app.post('/api/login', login);
  app.post('/api/logout', logout);
  app.post('/api/otp-resend', otp_resend);
  app.post('/api/otp-verify', otp_verify);
  app.get('/api/sync-auth', sync_auth);
  app.post('/api/guest-session', guest_session);
  app.post('/api/create-project', authenticateToken, create_project);
  app.post('/api/join-project', authenticateToken, join_project);
  app.get('/api/projects', authenticateToken, projects);
  app.patch('/api/projects/:projectId/status', authenticateToken, updateProjectStatus);
  app.post('/api/verify-project', authenticateToken, verify_project);
  app.post('/api/reset-invitation-code', authenticateToken, reset_invitation_code);
  app.post('/api/verify-invitationcode-otp', authenticateToken, verify_invitationcode_otp);
  app.get('/api/requests/received', authenticateToken, get_received_requests);
  app.get('/api/requests/sent', authenticateToken, get_sent_requests);
  app.post('/api/requests/accept/:requestId', authenticateToken, approve_project_request);
  app.delete('/api/requests/revoke/:requestId', authenticateToken, revoke_request);
  app.get('/api/user-apis', authenticateToken, get_user_apis);
  app.post('/api/update-api', authenticateToken, update_api);
  app.post('/api/add-api', authenticateToken, add_api);
  app.post('/api/api-version-data', authenticateToken, api_version_data);
  app.get('/api/api-history', authenticateToken, api_history);
  app.delete('/api/versions/delete/:versionId', authenticateToken, delete_api_version);
  app.post('/api/ask-ai', authenticateToken, ask_ai);
  app.post('/api/reverse-ai', authenticateToken, reverse_ai);
  app.post('/api/logs', authenticateToken, logs);
app.delete('/api/deleteproject/:projectId', authenticateToken, delete_project);


app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// ============ SOCKET.IO ============
  let heartbeatInterval;
  let dataPollingInterval;
  let lastCheckedTime = new Date();

  io.on('connection', (socket) => {
    console.log(`✅ Socket connected: ${socket.id}`);

    socket.on('join_room', (roomName) => {
      if (roomName && typeof roomName === 'string') {
        socket.join(roomName);
        console.log(`📡 Socket ${socket.id} joined room: ${roomName}`);
      }
    });

    socket.on('join_project', async (projectId) => {
      if (!projectId) return;
      socket.join(projectId);
      console.log(`📡 Socket ${socket.id} joined project room: ${projectId}`);
      try {
        const initialLogs = await SystemEventLog.find({ projectId })
          .sort({ createdAt: -1 })
          .limit(50);
        socket.emit('initial_logs', initialLogs);
      } catch (err) {
        console.error('Error fetching initial logs:', err);
        socket.emit('initial_logs', []);
      }
    });

    socket.on('leave_project', (projectId) => {
      socket.leave(projectId);
      console.log(`🚪 Socket ${socket.id} left project room: ${projectId}`);
    });

    socket.on('disconnect', () => {
      console.log(`❌ Socket disconnected: ${socket.id}`);
    });
  });

  // Heartbeat interval – read from env
  const HEARTBEAT_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL);
  heartbeatInterval = setInterval(() => {
    io.emit('heartbeat', { timestamp: Date.now() });
  }, HEARTBEAT_INTERVAL);

  // Polling fallback interval – read from env
  const LOG_POLLING_INTERVAL = parseInt(process.env.LOG_POLLING_INTERVAL);
  dataPollingInterval = setInterval(async () => {
    const now = new Date();
    try {
      const newLogs = await SystemEventLog.find({ createdAt: { $gt: lastCheckedTime } })
        .sort({ createdAt: 1 });
      if (newLogs.length > 0) {
        const logsByProject = {};
        newLogs.forEach(log => {
          if (!logsByProject[log.projectId]) logsByProject[log.projectId] = [];
          logsByProject[log.projectId].push(log);
        });
        for (const [projectId, logs] of Object.entries(logsByProject)) {
          logs.forEach(singleLog => {
            io.to(projectId).emit('new_api_log', singleLog);
          });
        }
      }
      lastCheckedTime = now;
    } catch (error) {
      console.error('Error polling logs:', error);
    }
  }, LOG_POLLING_INTERVAL);

  // ============ GRACEFUL SHUTDOWN ============
  const gracefulShutdown = async () => {
    console.log("⚠️ Shutting down gracefully...");
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (dataPollingInterval) clearInterval(dataPollingInterval);
    try {
    
      console.log("✅ AI Queue disconnected safely.");
    } catch (error) {
      console.error("Error closing AI Queue:", error);
    }
    setTimeout(() => {
      process.exit(0);
    }, 500);
  };
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);

  // ============ START SERVER ============
  const PORT = process.env.PORT;
  server.listen(PORT, () => {
    console.log(`🚀 Server running${PORT}`);
  });
};

startServer().catch(err => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});