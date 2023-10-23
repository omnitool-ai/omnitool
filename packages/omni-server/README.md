
# Server

## Building

- Yarn build in the server directory will build.
- The codebase for server, shared and client is 90% typescript
- The compiler will reject any failed typing by default. Ideally errors should be fixed.
- In some situations //@ts-ignore is permissible which disables errors on the succeeding line
- On the server, we are targeting the latest ESM standard as there's no drawback or compatibility challenges
- On the client, ES2020 is the current target.
- To successfull pick up changes from omni-shared and other shared packages, yarn build has to be run.


## Server Architecture

- Server is started via src/run.ts
- Configuration is read from the monorepro root,  merging .mercs.yaml with .mercs.local.yaml

- The server uses the omni-shared/app framework which runs on both node and browser and  includes basic convenience functions like
  - logging (consola based)
  - event messaging (eventEmitter3)
  - service infrastructure
  - integrations infrastructure

- Services and integrations both inherit from Manageable.
- They are managed in the appy by a Manager for each type.
- Services provide constant functionality (e.g. web server, database, etc)
- Integrations provide smaller scoped feature functionality (such as API routes)

- Unversal services that could run on both server or client should be in mercs_hared/src/services
- Services that have significant overlap between client and server should inherit from a base service there
- Integrations will likely not have shared elements?

## Internal startup sequence

- server.instantiated
- server.use() called for any service or integration that needs to registered. Order matters.
- server.load() called
  - server.onConfigure hook fires to allow modification of configuration at runtime (optional)
  - all services are created()
  - all services are loaded()
  - app: loaded
  - all integration are created()
  - all integrations are loaded()
  - all services are started()
  - all integrations are started()
  - app: started
  - interrupt received
  - all integrations are stopped()
  - all services are stopped()
  - app: stopped


## RPC
- The only way currently to communicate from client to server is through API routes
- The server can continously send events to the client leveraging the Server-side-event channel provided by the MercenariesDefaultIntegration.

## Integrations

Currently the only server integrations are APIIntegrations which have plumbing to automatically register routes and proxy routes from mercs.yaml.

## Managing credentials

To avoid confidential things ending up in a github repro, use .mercs.yaml.local for that for now.

## Client Startup

- The client is basically identical to the server in architecture as they use the same shared app framework.

## Tips and tricks

- Consola logging on the server can be adjusted in mercs.yaml > server > logger
- Consola logging on the client currently is changed in the constructor in vite-frontend/app.ts



