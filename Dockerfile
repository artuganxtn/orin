FROM node:22-slim
WORKDIR /app

COPY source/package*.json ./source/
COPY source/firebase-functions/package*.json ./source/firebase-functions/
RUN cd source && npm install --include=dev
RUN cd source/firebase-functions && npm install --include=dev

COPY source ./source
RUN cd source && npm run build:render
RUN cd source/firebase-functions && npm run build

ENV NODE_ENV=production
WORKDIR /app/source/firebase-functions
EXPOSE 10000
CMD ["npm", "start"]
