# Remote Browser Control System

A mini TeamViewer-like system for running and controlling a headless Chromium browser inside a Docker container from a React web interface.

### 🚀 Live Demo Links
* **AWS Deployment**: [http://65.2.153.220](http://65.2.153.220)
* **Render Deployment**: [https://remote-browser-frontend.onrender.com](https://remote-browser-frontend.onrender.com)

This system connects the browser's internal engine directly to the host server using Puppeteer and the Chrome DevTools Protocol (CDP) screencast API, avoiding the overhead of heavy virtual framebuffers (Xvfb) or VNC servers.

## Architecture & Design

```
[ Web UI (Vite/React) ]
         ▲
         │ WebSocket (JPEG Screen Frames & Mouse/Key Input Events)
         ▼
[ Host Server (Node.js/Express) ]
         ▲
         │ Puppeteer connection (Port 9222)
         ▼
[ Chromium inside Docker ] (Headless, Exposed debug port)
```

- **Docker Container**: A lightweight Debian environment running Chromium with remote debugging enabled (`--remote-debugging-port=9222`, `--remote-debugging-address=0.0.0.0`, `--remote-allow-origins=*`).
- **Node.js Host Server**: Orchestrates starting/stopping the Docker container, connects Puppeteer to the containerized Chromium instance, establishes a CDP session to stream page frames (`Page.startScreencast`), and listens to WebSockets to handle remote user input (clicks, drags, scrolls, typing).
- **Web UI**: Renders the JPEG screencast stream onto an HTML5 Canvas and listens for mouse/key events. Event coordinates are normalized to relative values `(0.0 to 1.0)` and sent to the server for scaling, keeping interactions responsive and resolution-independent.

---

## Setup & Launch Guide

### Prerequisites
- Node.js (v18+)
- Docker Desktop (Running)

> [!NOTE]
> **Linux Docker Socket Note**: On Linux environments, the Node.js server needs to communicate with the Docker daemon via the default UNIX socket `/var/run/docker.sock`. Ensure the user running the server has the necessary permissions (e.g., belongs to the `docker` group) or run the server with appropriate privileges to avoid connection/permission errors.

### 1. Build the Docker Image
Navigate to the root directory and build the remote browser image:
```bash
docker build -t remote-browser-img -f docker/Dockerfile docker
```

### 2. Start the Backend Server
Navigate to the `backend` directory, install dependencies, and start the host:
```bash
cd backend
npm install
npm start
```
The server will run on `http://localhost:3001`.

### 3. Start the Frontend Application
In a new terminal window, navigate to the `frontend` directory, install dependencies, and start the development server:
```bash
cd frontend
npm install
npm run dev
```
The React UI will run on `http://localhost:5173/`.

---

## Technical Features & Solved Edge Cases

- **CDP Screencast Lifecycle**: The CDP screencast session starts exactly when the container launches and stays alive bound to the container's lifecycle. Reconnecting or opening multiple frontend tabs will attach to the existing stream without duplicating sessions or causing memory leaks.
- **Race Condition Prevention**: The backend polls `/json/version` on the container's debug port until it is fully ready before connecting Puppeteer, preventing startup errors.
- **Multi-Start Lock**: A lock mutex prevents concurrent startup commands from hammering the Docker daemon.
- **URL Normalization**: User-entered URLs that omit protocols (e.g., `google.com`) are automatically normalized (e.g., `https://google.com`) before triggering navigations.
- **State Capture Ref**: Stale React closures in the WebSocket `onclose` handler are prevented using a `statusRef` to always query the live application state.
- **Clean Container Lifecycle**: Automatic `SIGINT`/`SIGTERM` handlers and a defensive container cleanup process ensure no orphaned docker containers are left running.
