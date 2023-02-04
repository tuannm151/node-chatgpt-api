FROM node:lts-alpine

RUN mkdir -p /app

WORKDIR /app

COPY package.json /app/ 

RUN npm install

COPY . /app

CMD ["npm", "server"]
EXPOSE 8045
EXPOSE 3000


