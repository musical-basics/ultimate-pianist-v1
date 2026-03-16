# Step 22-24: Dockerfile for the Railway video render worker
# Uses dumb-init as PID 1 to reap zombie Chrome/FFmpeg processes

FROM node:20-bullseye-slim

# ─── Install dumb-init (Zombie Assassin) ───────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init

# ─── Install Headless Chrome + FFmpeg + required shared libs ───────
RUN apt-get install -y --no-install-recommends \
    ffmpeg \
    chromium \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxss1 \
    libasound2 \
    libgbm1 \
    libxcomposite1 \
    libxrandr2 \
    libxdamage1 \
    fonts-liberation \
    libappindicator3-1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ─── Environment ───────────────────────────────────────────────────
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_ENV=production

WORKDIR /app

# ─── Dependencies ──────────────────────────────────────────────────
COPY package.json pnpm-lock.yaml* ./
RUN npm install -g pnpm && pnpm install --prod --frozen-lockfile || pnpm install --prod

# ─── Application ───────────────────────────────────────────────────
COPY . .
RUN pnpm build

# ─── PID 1: dumb-init reaps orphaned Chrome/FFmpeg on crash ───────
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
