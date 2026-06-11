# Stage 1: Build Vite React application
FROM node:18-slim AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
ARG VITE_API_URL
ARG VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
RUN npm run build

# Stage 2: Serve static files via Nginx
FROM nginx:alpine
COPY --from=builder /usr/src/app/dist /usr/share/nginx/html
# Copy default nginx config if custom routing is needed, or just let default serve index.html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
