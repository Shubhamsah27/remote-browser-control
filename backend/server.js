const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const puppeteer = require('puppeteer-core');
const Docker = require('dockerode');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3001;
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;
const CONTAINER_NAME = 'remote-browser-container';
const IMAGE_NAME = 'remote-browser-img';

const docker = new Docker(); // Defaults to //./pipe/docker_engine on Windows

const session = {
  container: null,
  browser: null,
  page: null,
  cdpSession: null,
  active: false
};

// Helper: Poll Chromium remote debugging port until ready
function pollDebugPort(url, maxAttempts = 40, interval = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      const req = http.get(
        `${url}/json/version`,
        { agent: false, headers: { 'Connection': 'close' }, timeout: 1000 },
        (res) => {
          res.resume(); // Always consume the response to free socket
          if (res.statusCode === 200) {
            resolve();
          } else {
            next();
          }
        }
      );
      req.on('error', (err) => {
        next();
      });
    };

    const next = () => {
      if (attempts >= maxAttempts) {
        reject(new Error(`Chromium debug port not ready after ${maxAttempts} attempts.`));
      } else {
        setTimeout(check, interval);
      }
    };

    check();
  });
}

// Helper: Clean up existing container by name to avoid conflict
async function cleanupExistingContainer() {
  try {
    const container = docker.getContainer(CONTAINER_NAME);
    const info = await container.inspect();
    console.log(`Found existing container ${CONTAINER_NAME}. Removing...`);
    if (info.State.Running) {
      await container.stop();
    }
    await container.remove();
    console.log('Existing container removed.');
  } catch (err) {
    // Container does not exist, safe to ignore
  }
}

let isStarting = false;

// Start browser container and establish Puppeteer session
app.post('/api/start', async (req, res) => {
  if (session.active) {
    return res.json({ status: 'ready', message: 'Browser session already active.' });
  }
  if (isStarting) {
    return res.status(409).json({ error: 'Session start already in progress.' });
  }

  isStarting = true;
  try {
    let browser;

    if (process.env.USE_LOCAL_PUPPETEER === 'true') {
      console.log('Starting local Chromium directly...');
      browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'chromium',
        args: [
          '--headless=new',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--window-size=1280,800'
        ],
        defaultViewport: null
      });
    } else {
      console.log('Verifying Docker image exists...');
      try {
        await docker.getImage(IMAGE_NAME).inspect();
      } catch (err) {
        throw new Error(`Docker image '${IMAGE_NAME}' not found. Please build the image first using: docker build -t ${IMAGE_NAME} -f docker/Dockerfile docker`);
      }

      console.log('Cleaning up any leftover containers...');
      await cleanupExistingContainer();

      console.log('Starting remote browser container...');
      const container = await docker.createContainer({
        Image: IMAGE_NAME,
        name: CONTAINER_NAME,
        ExposedPorts: { '9222/tcp': {} },
        HostConfig: {
          PortBindings: {
            '9222/tcp': [{ HostPort: '9222' }]
          }
        }
      });

      await container.start();
      session.container = container;

      console.log('Polling remote debugging port...');
      await pollDebugPort('http://127.0.0.1:9222');
      console.log('Chromium is ready. Connecting Puppeteer...');

      browser = await puppeteer.connect({
        browserURL: 'http://127.0.0.1:9222',
        defaultViewport: null
      });
    }

    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });

    session.browser = browser;
    session.page = page;

    // Setup CDP screencast right here, bound to the browser's lifecycle
    console.log('Initializing CDP screencast session...');
    const cdpSession = await page.createCDPSession();
    session.cdpSession = cdpSession;

    await cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 60,
      maxWidth: VIEWPORT_WIDTH,
      maxHeight: VIEWPORT_HEIGHT,
      everyNthFrame: 1
    });

    cdpSession.on('Page.screencastFrame', async ({ data, sessionId }) => {
      try {
        await cdpSession.send('Page.screencastFrameAck', { sessionId });
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'frame', data }));
          }
        });
      } catch (err) {
        // Ignore errors during tear down/close
      }
    });

    session.active = true;

    // Set default homepage
    await page.goto('https://news.ycombinator.com', { waitUntil: 'domcontentloaded' }).catch(() => {});

    console.log('Browser successfully started and attached.');
    res.json({ status: 'ready' });
  } catch (err) {
    console.error('Error starting browser:', err);
    res.status(500).json({ error: err.message });
  } finally {
    isStarting = false;
  }
});

// Stop browser container and clean up references
app.post('/api/stop', async (req, res) => {
  try {
    await shutdownSession();
    res.json({ status: 'stopped' });
  } catch (err) {
    console.error('Error stopping browser:', err);
    res.status(500).json({ error: err.message });
  }
});

async function shutdownSession() {
  console.log('Shutting down session...');
  session.active = false;

  if (session.cdpSession) {
    try {
      await session.cdpSession.send('Page.stopScreencast').catch(() => {});
    } catch (e) {}
    session.cdpSession = null;
  }

  if (session.page) {
    try {
      await session.page.close().catch(() => {});
    } catch (e) {}
    session.page = null;
  }

  if (session.browser) {
    try {
      if (process.env.USE_LOCAL_PUPPETEER === 'true') {
        console.log('Closing local Chromium...');
        await session.browser.close().catch(() => {});
      } else {
        console.log('Disconnecting from Chromium...');
        session.browser.disconnect();
      }
    } catch (e) {}
    session.browser = null;
  }

  if (session.container) {
    try {
      const container = session.container;
      session.container = null;
      console.log('Stopping container...');
      await container.stop().catch(() => {});
      console.log('Removing container...');
      await container.remove().catch(() => {});
    } catch (e) {
      console.error('Error during container cleanup:', e.message);
    }
  }
  console.log('Shutdown completed.');
}

// WebSocket handlers
wss.on('connection', async (ws) => {
  console.log('WebSocket client connected.');

  if (!session.active || !session.page) {
    console.log('No active session, waiting for start.');
  }

  ws.on('message', async (message) => {
    if (!session.active || !session.page) return;

    try {
      const msg = JSON.parse(message);
      const { type } = msg;

      if (type === 'navigate') {
        // Normalize URL: prefix with http:// or https:// if omitted
        let targetUrl = msg.url.trim();
        if (!/^https?:\/\//i.test(targetUrl)) {
          targetUrl = 'https://' + targetUrl;
        }
        await session.page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch((err) => {
          console.warn(`Navigation error for URL "${targetUrl}":`, err.message);
        });
      } else if (type === 'mousedown') {
        const absX = Math.round(msg.x * VIEWPORT_WIDTH);
        const absY = Math.round(msg.y * VIEWPORT_HEIGHT);
        await session.page.mouse.move(absX, absY);
        await session.page.mouse.down({ button: msg.button || 'left' });
      } else if (type === 'mouseup') {
        const absX = Math.round(msg.x * VIEWPORT_WIDTH);
        const absY = Math.round(msg.y * VIEWPORT_HEIGHT);
        await session.page.mouse.move(absX, absY);
        await session.page.mouse.up({ button: msg.button || 'left' });
      } else if (type === 'mousemove') {
        const absX = Math.round(msg.x * VIEWPORT_WIDTH);
        const absY = Math.round(msg.y * VIEWPORT_HEIGHT);
        await session.page.mouse.move(absX, absY);
      } else if (type === 'click') {
        const absX = Math.round(msg.x * VIEWPORT_WIDTH);
        const absY = Math.round(msg.y * VIEWPORT_HEIGHT);
        await session.page.mouse.click(absX, absY, { button: msg.button || 'left' });
      } else if (type === 'scroll') {
        const absX = msg.x !== undefined ? Math.round(msg.x * VIEWPORT_WIDTH) : undefined;
        const absY = msg.y !== undefined ? Math.round(msg.y * VIEWPORT_HEIGHT) : undefined;
        await session.page.mouse.wheel({ deltaY: msg.deltaY, x: absX, y: absY });
      } else if (type === 'keydown') {
        await session.page.keyboard.down(msg.key);
      } else if (type === 'keyup') {
        await session.page.keyboard.up(msg.key);
      } else if (type === 'keypress') {
        await session.page.keyboard.press(msg.key);
      }
    } catch (err) {
      console.error('Error executing input instruction:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected.');
  });
});

// Graceful cleanup on server shut down
process.on('SIGINT', async () => {
  console.log('\nSIGINT signal received.');
  await shutdownSession();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nSIGTERM signal received.');
  await shutdownSession();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
