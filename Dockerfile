# AgencyDesk — API + frontend in one image
FROM node:20-alpine
ENV NODE_ENV=production TZ=Asia/Kolkata PORT=4000
RUN apk add --no-cache tzdata
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN npm ci --omit=dev --prefix server && npm cache clean --force
COPY index.html ./
COPY css css
COPY js js
COPY server server
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["node", "server/index.js"]
