# syntax=docker/dockerfile:1

FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=7777
ENV CONFIG_DIR=/data

# The data folder. When nothing is mounted at /data, Docker creates an anonymous volume here, so the folder always
# exists and settings and sign-in save. That volume belongs to the container it was made for: mount a folder or a
# named volume at /data to keep your data when you recreate the container (see the README).
VOLUME /data

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server.js ./

EXPOSE 7777

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||7777,path:'/api/health'},r=>{r.resume();process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["npm", "start"]
