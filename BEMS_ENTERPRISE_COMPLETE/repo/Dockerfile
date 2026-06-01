FROM node:20-alpine AS ui-builder
WORKDIR /app
COPY ui/package.json ./ui/package.json
RUN cd ui && npm install
COPY ui ./ui
RUN cd ui && npm run build

FROM node:20-alpine AS api-builder
WORKDIR /app
COPY node-api/package.json ./package.json
RUN npm install --production
COPY node-api ./node-api
COPY --from=ui-builder /app/ui/dist ./node-api/ui/dist

WORKDIR /app/node-api
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
