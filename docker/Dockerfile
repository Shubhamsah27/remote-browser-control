FROM debian:bookworm-slim

# Install Chromium, socat, and dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    socat \
    ca-certificates \
    fonts-liberation \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Copy the entrypoint script
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Expose remote debugging port
EXPOSE 9222

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

