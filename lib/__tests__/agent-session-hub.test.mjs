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

test("会话输出广播到 attach 该会话的客户端，并写入 outputBuffer", async () => {
  const hub = createAgentSessionHub({ ptyFactory: fakePtyFactory });
  const session = await hub.createSession({ agent: "codex" });

  const sentA = [];
  const sentB = [];
  const clientA = { readyState: 1, send: (msg) => sentA.push(JSON.parse(msg)) };
  const clientB = { readyState: 1, send: (msg) => sentB.push(JSON.parse(msg)) };

  hub.addClient(clientA);
  hub.addClient(clientB);
  hub.attachClient(clientA, session.id);

  hub.emitOutput(session.id, "hello");
  assert.deepEqual(sentA.at(-1), { type: "terminal_output", id: session.id, data: "hello" });
  assert.equal(sentB.find((m) => m.type === "terminal_output"), undefined);
  assert.equal(hub.getOutputSnapshot(session.id), "hello");
});

test("getOutputSnapshot 在传入未知 id 时返回空字符串", async () => {
  const hub = createAgentSessionHub({ ptyFactory: fakePtyFactory });
  assert.equal(hub.getOutputSnapshot("sess_unknown"), "");
});

test("detachClient 后再 emitOutput 不再发往该 socket", async () => {
  const hub = createAgentSessionHub({ ptyFactory: fakePtyFactory });
  const session = await hub.createSession({ agent: "codex" });
  const sent = [];
  const client = { readyState: 1, send: (m) => sent.push(JSON.parse(m)) };
  hub.addClient(client);
  hub.attachClient(client, session.id);
  hub.detachClient(client, session.id);
  hub.emitOutput(session.id, "x");
  assert.equal(sent.find((m) => m.type === "terminal_output"), undefined);
});

test("dispatchPrompt 写入主会话 PTY", async () => {
  const writes = [];
  function trackingFactory(message) {
    const session = {
      agent: message.agent,
      label: message.agent,
      cwd: "/tmp",
      command: "",
      closed: false,
      _id: null,
      write(data) { writes.push({ id: this._id, data }); },
      resize() {},
      kill() {},
    };
    return session;
  }
  const hub = createAgentSessionHub({ ptyFactory: trackingFactory });
  const a = await hub.createSession({ agent: "codex" });
  a.pty._id = a.id;
  const b = await hub.createSession({ agent: "claude" });
  b.pty._id = b.id;
  hub.setPrimarySessionId(b.id);

  const result = hub.dispatchPrompt("hello");
  assert.equal(result.ok, true);
  assert.equal(result.id, b.id);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].id, b.id);
  assert.equal(writes[0].data, "hello\r");
});

test("dispatchPrompt 主会话不存在时返回 no-agent", () => {
  const hub = createAgentSessionHub({ ptyFactory: fakePtyFactory });
  const result = hub.dispatchPrompt("hi");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-agent");
});

test("dispatchPrompt 空 prompt 返回 empty-prompt", async () => {
  const hub = createAgentSessionHub({ ptyFactory: fakePtyFactory });
  await hub.createSession({ agent: "codex" });
  const result = hub.dispatchPrompt("   ");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "empty-prompt");
});

test("getDispatchStatus 在主会话存在时返回 primary 字段", async () => {
  const hub = createAgentSessionHub({ ptyFactory: fakePtyFactory });
  const session = await hub.createSession({ agent: "codex" });
  const status = hub.getDispatchStatus();
  assert.equal(status.ok, true);
  assert.equal(status.primary.id, session.id);
  assert.equal(status.primary.name, session.name);
  assert.equal(status.primary.agent, "codex");
});

test("getDispatchStatus 主会话不存在时返回 no-session", () => {
  const hub = createAgentSessionHub({ ptyFactory: fakePtyFactory });
  const status = hub.getDispatchStatus();
  assert.equal(status.ok, false);
  assert.equal(status.reason, "no-session");
});

test("deleteSession 清理客户端的 attachedSessionId", async () => {
  const hub = createAgentSessionHub({ ptyFactory: fakePtyFactory });
  const session = await hub.createSession({ agent: "codex" });
  const client = { readyState: 1, send() {} };
  hub.addClient(client);
  hub.attachClient(client, session.id);
  hub.deleteSession(session.id);
  assert.equal(hub.getClientState(client).attachedSessionId, null);
});
