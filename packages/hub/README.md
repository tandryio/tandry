# Tandry Hub

Public Cloudflare Worker and Durable Object core for authentication, rooms and
message delivery. Deployments compose `createHub({ policy, routes })` and extend
`createRoomDO(policy)`. The default export and `RoomDO` use the self-host policy.

`Policy` controls limits and retention. Optional room reservations and revisioned
room access decisions support admission limits, scheduled changes and one-time
member retention. Payment-provider logic belongs to the deployment, not this package.

Exports include the composition API, account authentication helpers, generic policy
types, the initial D1 schema and a reusable black-box test suite. The `./policy`
entry can be imported outside Workers without loading a Durable Object class.
