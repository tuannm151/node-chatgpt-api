FROM node:lts-alpine

RUN mkdir -p /app

WORKDIR /app

RUN echo "http://dl-cdn.alpinelinux.org/alpine/edge/testing" >> /etc/apk/repositories

# install chrome and dependencies to run vnc
RUN apk update --no-cache && apk upgrade --no-cache && \
    apk add --no-cache \
    xvfb xvfb-run x11vnc novnc git bash supervisor fluxbox sqlite && \
    apk add --no-cache \
      chromium \
      harfbuzz \
      "freetype>2.8" \ 
      ttf-freefont \
      nss && \
      rm -rf /var/cache/apk/* && \
      rm -rf /usr/bin/websockify && \
      git clone https://github.com/novnc/websockify /usr/bin/websockify && \
      apk del git 
    

RUN ln -s /usr/share/novnc/vnc_lite.html /usr/share/novnc/index.html

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    DISPLAY=:0.0 \
    DISPLAY_WIDTH=1280 \
    DISPLAY_HEIGHT=1024

COPY package.json /app/ 

RUN npm install

COPY . /app

CMD ["/app/entrypoint.sh"]
EXPOSE 8045
EXPOSE 3000


