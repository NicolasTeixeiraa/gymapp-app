FROM node:24-slim AS base

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/

FROM base AS deps

RUN npm ci

FROM deps AS build

COPY . .

RUN npx prisma generate && npm run build && cp -r src/generated dist/generated

FROM base AS production

RUN npm ci --omit=dev --ignore-scripts

COPY --from=build /app/dist ./dist

CMD ["node", "dist/index.js"]
