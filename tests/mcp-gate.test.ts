import assert from "node:assert/strict";
import { test } from "node:test";

import { mcpInputOf, writeVerbOf } from "../src/mcp-gate.ts";

test("writeVerbOf matches a write verb as a whole token", () => {
  assert.equal(writeVerbOf("github_delete_issue"), "delete");
  assert.equal(writeVerbOf("mcp__srv__deleteIssue"), "delete");
  assert.equal(writeVerbOf("Create_Item"), "create");
  assert.equal(writeVerbOf("get_settings"), undefined); // "set" is not a token of "settings"
  assert.equal(writeVerbOf("sender_list"), undefined); // "send" is not a token of "sender"
  assert.equal(writeVerbOf("search_code"), undefined);
});

test("mcpInputOf returns the input evidence text, or undefined when absent", () => {
  assert.equal(mcpInputOf([{ label: "input", text: '{"q":1}' }]), '{"q":1}');
  assert.equal(mcpInputOf([]), undefined);
  assert.equal(mcpInputOf([{ label: "full command", text: "x" }]), undefined);
});
