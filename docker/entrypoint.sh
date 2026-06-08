#!/bin/bash

# Start Chromium in the background
chromium \
    --headless=new \
    --no-sandbox \
    --disable-setuid-sandbox \
    --remote-debugging-port=9223 \
    --remote-debugging-address=127.0.0.1 \
    --remote-allow-origins=* \
    --disable-dev-shm-usage \
    --disable-gpu \
    --window-size=1280,800 &

# Start socat to proxy external port 9222 connections to localhost:9223
socat TCP-LISTEN:9222,fork,reuseaddr TCP:127.0.0.1:9223
