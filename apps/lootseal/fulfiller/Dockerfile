# Lootseal fulfiller image. Build from the repo root AFTER `yarn compile`
# (the image ships the compiled contract and its ZK keys; it does not need
# the Compact compiler):
#
#   docker build -f apps/lootseal/fulfiller/Dockerfile -t lootseal-fulfiller .
FROM node:22.12-bookworm-slim

WORKDIR /app
RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml tsconfig.base.json ./
COPY packages ./packages
COPY scripts ./scripts
COPY apps/lootseal ./apps/lootseal

RUN test -d apps/lootseal/contract/managed/lootseal/keys \
  || (echo "Run 'yarn compile' before building the image" && exit 1)
RUN yarn install --immutable && yarn cache clean

WORKDIR /app/apps/lootseal
ENV NODE_ENV=production
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10m CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["yarn", "fulfiller"]
