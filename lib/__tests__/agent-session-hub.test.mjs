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

test("createSession 生成唯一 id", async () => {
  const hub = createAgentSessionHub({ ptyFactory: fakePtyFactory });
  const a = await hub.createSession({ agent: "codex" });
  const b = await hub.createSession({ agent: "codex" });
  assert.notEqual(a.id, b.id);
  assert.match(b.id, /^sess_[0-9a-f]+$/);
});

test("setPrimarySessionId 在删除主会话后选下一个", async () => {
  const hub = createAgentSessionHub({ ptyFactory: fakePtyFactory });
  const a = await hub.createSession({ agent: "codex" });
  const b = await hub.createSession({ agent: "claude" });
  assert.equal(hub.getPrimarySessionId(), a.id);

  hub.setPrimarySessionId(b.id);
  assert.equal(hub.getPrimarySessionId(), b.id);

  hub.deleteSession(b.id);
  assert.equal(hub.getPrimarySessionId(), a.id);

  hub.deleteSession(a.id);
  assert.equal(hub.getPrimarySessionId(), null);
});

test("renameSession 限长 24 字符", async () => {
  const hub = createAgentSessionHub({ ptyFactory: fakePtyFactory });
  const session = await hub.createSession({ agent: "codex" });
  hub.renameSession(session.id, "x".repeat(50));
  assert.equal(hub.getSession(session.id).name.length, 24);
});

test("renameSession 空字符串保留原名", async () => {
  const hub = createAgentSessionHub({ ptyFactory: fakePtyFactory });
  const session = await hub.createSession({ agent: "codex" });
  const original = session.name;
  hub.renameSession(session.id, "   ");
  assert.equal(hub.getSession(session.id).name, original);
});

test("setPrimarySessionId 不存在的 id 返回 false", async () => {
  const hub = createAgentSessionHub({ ptyFactory: fakePtyFactory });
  await hub.createSession({ agent: "codex" });
  assert.equal(hub.setPrimarySessionId("sess_unknown"), false);
});
