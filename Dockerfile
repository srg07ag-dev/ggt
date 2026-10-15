# syntax=docker/dockerfile:1
# Deux images à partir d'un même dépôt :
#   docker build --target app   -t ggt-app .     # serveur web (paquet autonome Next.js)
#   docker build --target tools -t ggt-tools .   # migrations et scripts d'exploitation (npm run db:migrate, tsx scripts/…)

FROM node:22-alpine AS deps
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-alpine AS tools
WORKDIR /srv
ENV NODE_ENV=production
COPY --from=deps /srv/node_modules ./node_modules
COPY package.json tsconfig.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src ./src
COPY scripts ./scripts
USER node
CMD ["npm", "run", "db:migrate"]

FROM node:22-alpine AS app
WORKDIR /srv
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /srv/.next/standalone ./
COPY --from=build --chown=node:node /srv/.next/static ./.next/static
RUN mkdir -p /var/lib/ggt/storage && chown node:node /var/lib/ggt/storage
ENV STORAGE_DIR=/var/lib/ggt/storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
