# Linux production image — web + bot (override CMD in compose for bot).
FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache libc6-compat openssl python3 make g++ bash

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate

ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl bash curl

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/data ./data

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV NODE_OPTIONS=--use-system-ca

EXPOSE 3000

CMD ["node", "scripts/start-cloud.js"]
