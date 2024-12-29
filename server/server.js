const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const net = require('net');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 5000;
const API_HOST = '127.0.0.1';
const API_PORT = 65432;

// Reusable TCP client
let client;
function createClient() {
  client = new net.Socket();
  
  client.on('error', (err) => {
    console.error(`Socket error: ${err.message}`);
    client.destroy(); // Destroy on error to allow clean reconnection
  });

  client.on('close', () => {
    console.log('Connection to server closed.');
    client.removeAllListeners('data'); // Clear listeners to avoid memory leaks
  });
}

// Initialize the TCP client connection once
createClient();

// Reactive object for prediction updates
const output = new Proxy({ prediction: "none" }, {
  set(target, prop, value) {
    if (target[prop] !== value) {
      console.log(`Property '${prop}' changed from ${target[prop]} to ${value}`);
      target[prop] = value;
    }
    return true;
  }
});

// WebSocket setup
const wss = new WebSocket.Server({ port: 8080 });
wss.on('connection', (ws) => {
  ws.on('message', (message) => console.log(`Received message from client: ${message}`));
});

function broadcastPrediction(prediction) { 
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(prediction);
    }
  });
}

// View engine and static files
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'views')));
app.get('/', (req, res) => res.render('pages/index'));
app.get('/about', (req, res) => res.render('pages/about'));

// Middleware for CORS
app.use(cors());

// Setup for uploading files
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => cb(null, file.mimetype === 'audio/wav')
});

// Function to connect to Python model server and handle predictions
function apiModel() {
  if (client.destroyed) createClient(); // Reconnect if destroyed

  client.connect(API_PORT, API_HOST, () => {
    console.log('Connected to Python server');
    client.write('Audio file uploaded');
  });

  client.on('data', (data) => {
    output.prediction = data.toString().trim();

    console.log(`Received prediction from server: ${output.prediction}`);
    
    broadcastPrediction(output.prediction); // Broadcast to WebSocket clients
    
    client.end(); // End client connection after receiving data
  });
}

// Endpoint to handle file uploads
app.post('/upload', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');
  console.log(`Received file upload: ${req.file.path}`);
  apiModel();
});


// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
