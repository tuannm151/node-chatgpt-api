# FROM node:19 AS app

# # We don't need the standalone Chromium
# RUN apt-get install -y wget \ 
#     && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \ 
#     && echo "deb http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list \
#     && apt-get update && apt-get -y install google-chrome-stable chromium  xvfb\
#     && rm -rf /var/lib/apt/lists/* \
#     && echo "Chrome: " && google-chrome --version

# WORKDIR /app
# COPY package*.json ./
# RUN npm install
# COPY . .
# # ENV WECHATY_PUPPET_WECHAT_ENDPOINT=/usr/bin/google-chrome
# CMD xvfb-run --server-args="-screen 0 1280x800x24 -ac -nolisten tcp -dpi 96 +extension RANDR" npm run start-hl

FROM node:lts-alpine

RUN mkdir -p /app

WORKDIR /app

RUN echo "http://dl-cdn.alpinelinux.org/alpine/edge/testing" >> /etc/apk/repositories

# install chrome and dependencies to run vnc
RUN apk upgrade --no-cache && \
    apk add --no-cache \
    xvfb xvfb-run x11vnc novnc git bash supervisor fluxbox && \
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
    DISPLAY_WIDTH=1024 \
    DISPLAY_HEIGHT=768

COPY package.json /app/ 

RUN npm install

COPY . /app

CMD ["/app/entrypoint.sh"]
EXPOSE 8045
EXPOSE 3000


