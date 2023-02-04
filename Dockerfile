FROM node:lts-alpine

RUN mkdir -p /app

WORKDIR /app

COPY package.json /app/ 

RUN npm install

COPY . /app

CMD ["node", "bin/server.js"]

EXPOSE 3000


