# AWS Deployment Guide (EC2 + Docker Compose)

Deploying to **Amazon EC2** is the most straightforward and flexible way to host this application on AWS. Since you have full root control of the EC2 instance, you can run the Docker daemon directly, supporting the local container orchestration workflow without cloud restrictions.

---

## Architecture on AWS

```
[ Client Browser ] 
       │ HTTPS / WSS (Ports 80/443)
       ▼
[ AWS EC2 Instance ]
       │
       ├──► [ Frontend Static Server ] (Nginx container or built files served)
       ├──► [ Node.js Backend Server ] (Port 3001)
       │         │ Docker Socket (/var/run/docker.sock)
       │         ▼
       └──► [ Chromium Browser Container ] (Port 9222)
```

---

## Step-by-Step Deployment

### Step 1: Launch an EC2 Instance
1. Log in to your **AWS Management Console**.
2. Go to the **EC2 Dashboard** and click **Launch Instance**.
3. Choose **Ubuntu Server 22.04 LTS** (or Amazon Linux 2023) as the OS.
4. Select an instance type:
   * **`t3.small`** (2 vCPUs, 2 GB RAM) is recommended because running headless Chromium consumes significant memory and CPU.
5. Create or select a **Key Pair (.pem)** for SSH access.
6. Under **Network Settings**, configure the **Security Group**:
   * Allow **SSH** (Port 22) from your IP.
   * Allow **HTTP** (Port 80) from Anywhere.
   * Allow **Custom TCP** (Port 3001) from Anywhere (for the backend API).
7. Click **Launch Instance**.

---

### Step 2: Install Docker and Docker Compose
SSH into your EC2 instance (replace `your-key.pem` and `your-ec2-ip` with your values):
```bash
ssh -i your-key.pem ubuntu@your-ec2-ip
```

Once inside, run the following commands to install Docker and Docker Compose:
```bash
# Update packages
sudo apt-get update && sudo apt-get upgrade -y

# Install Docker
sudo apt-get install -y docker.io

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Add ubuntu user to the docker group so you don't need sudo for docker commands
sudo usermod -aG docker ubuntu

# Log out and log back in to apply group changes
exit
```
Log back in:
```bash
ssh -i your-key.pem ubuntu@your-ec2-ip
```

---

### Step 3: Clone the Repository and Setup Code
Clone your repository:
```bash
git clone https://github.com/Shubhamsah27/remote-browser-control.git
cd remote-browser-control
```

---

### Step 4: Run via Docker Compose
To run everything cleanly, we can create a `docker-compose.yml` file in the root of the project to orchestrate both the frontend and backend.

Create a `docker-compose.yml` file:
```yaml
version: '3.8'

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: remote-browser-backend
    ports:
      - "3001:3001"
    volumes:
      # Mount the host's Docker socket so the backend can manage containers on the EC2 host
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - PORT=3001
      - USE_LOCAL_PUPPETEER=false # Use the local container spawning mode

  frontend:
    image: node:18-slim
    container_name: remote-browser-frontend
    working_dir: /usr/src/app
    ports:
      - "80:5173"
    volumes:
      - ./frontend:/usr/src/app
    environment:
      - VITE_API_URL=http://your-ec2-ip:3001
      - VITE_WS_URL=ws://your-ec2-ip:3001
    command: sh -c "npm install && npm run dev -- --host"
```
*(Make sure to replace `your-ec2-ip` with the public IP of your EC2 instance in the environment variables above.)*

#### Start the Services:
Run Docker Compose in the background:
```bash
# First, pre-build the browser container image so the backend can find it
docker build -t remote-browser-img -f docker/Dockerfile docker

# Start the docker-compose services
docker-compose up -d
```

---

### Step 5: Verify the Deployment
Open your browser and navigate to:
👉 **`http://your-ec2-ip`**

Click **Start Session** and enjoy your remote browser running on AWS!
