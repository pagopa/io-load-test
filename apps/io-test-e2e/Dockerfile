FROM node:18.13.0 as builder

WORKDIR /usr/src/app

COPY / /usr/src/app/

ENV NODE_OPTIONS=--openssl-legacy-provider

RUN yarn install \
  && yarn generate \
  && yarn build \
  && yarn webpack

FROM grafana/k6:latest

COPY /package.json /package.json
COPY --from=builder /usr/src/app/dist /dist
COPY --from=builder /usr/src/app/node_modules /node_modules

CMD [ "run","/dist/index.js"]
