FROM jrottenberg/ffmpeg:6-alpine
RUN apk add --no-cache nodejs npm
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
CMD ["node", "worker.js"]
