import test from "node:test";
import assert from "node:assert/strict";
import { createAgentSessionHub } from "../agent-server.mjs";

function fakePtyFactory(message) {
  return {
    agent: message.agent,
    label: message.agent === "codex" ? "Codex" : message.agent,
    cwd: "/tmp",
    command: "",
    closed: false,
    write() {},
    resize() {},
    kill() { this.closed = true; },
  };
}

test("agent-session-hub: scaffold smoke", () => {
  assert.equal(1, 1);
});

test("createSession 创建独立会话并自动设为主会话", async () => {
  const hub = createAgentSessionHub({ ptyFactory: fakePtyFactory });
  const session = await hub.createSession({ agent: "codex" });
  assert.equal(session.agent, "codex");
  assert.match(session.id, /^sess_/);
  assert.equal(session.name, "Codex #1");
  assert.equal(hub.getPrimarySessionId(), session.id);
  assert.equal(hub.listSessions().length, 1);
});
