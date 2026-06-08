FROM debian:bookworm-slim

# Install Chromium and dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    ca-certificates \
    fonts-liberation \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Expose remote debugging port
EXPOSE 9222

# Run Chromium headless with debugging enabled
ENTRYPOINT ["chromium"]
CMD [ \
    "--headless=new", \
    "--no-sandbox", \
    "--disable-setuid-sandbox", \
    "--remote-debugging-port=9222", \
    "--remote-debugging-address=0.0.0.0", \
    "--remote-allow-origins=*", \
    "--disable-dev-shm-usage", \
    "--disable-gpu", \
    "--window-size=1280,800" \
]
