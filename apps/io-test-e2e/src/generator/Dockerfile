FROM node:18.13.0 as builder

WORKDIR /usr/src/app

COPY / /usr/src/app/

ENV NODE_OPTIONS=--openssl-legacy-provider

RUN yarn install \
  && yarn generate \
  && yarn build \
  && yarn webpack

EXPOSE 8001

CMD [ "bash", "./dockerinit.sh"]
