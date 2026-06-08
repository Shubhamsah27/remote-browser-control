FROM node:18-slim

# Install Chromium and necessary dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set up app directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy app source code
COPY . .

# Set environment variables for production
ENV PORT=3001
ENV USE_LOCAL_PUPPETEER=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Expose backend port
EXPOSE 3001

CMD ["node", "server.js"]
