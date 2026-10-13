# Permission boundary

`PermissionBroker` holds SDK permission callbacks until the user decides through
Tandem. It exposes the operation and exact scope to the browser.

The available decisions are:

- allow this operation once;
- remember a narrow SDK-supported approval for this session; or
- deny the operation with explicit feedback to the agent.

Pending requests are denied when the runtime stops. No request is auto-approved.
