import { describe, expect, it } from "vitest";
import type { AgAiConversationItem } from "ag-studio";
import { looksLikeAskBody, toContents, toDeclarations } from "./convert";

const user = (text: string): AgAiConversationItem => ({ id: "u", kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text }] });
const said = (text: string): AgAiConversationItem => ({ id: "a", kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text, annotations: [] }] });
const call = (callId: string, name: string, args: string): AgAiConversationItem => ({ id: `fc_${callId}`, kind: "output", type: "function_call", callId, name, arguments: args });
const result = (callId: string, output: string): AgAiConversationItem => ({ type: "function_call_output", callId, output, status: "completed" });

describe("turning an AG Studio chat into Gemini's shape", () => {
  it("keeps the order and joins neighbours from the same side into one turn", () => {
    const contents = toContents([user("Who was paid the most?"), said("Let me look."), call("c1", "view_schema", "{}"), result("c1", "ok"), said("friend.posts")], { c1: "sig-1" });
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user", "model"]);
    expect(contents[1].parts).toEqual([{ text: "Let me look." }, { functionCall: { id: "c1", name: "view_schema", args: {} }, thoughtSignature: "sig-1" }]);
    expect(contents[2].parts).toEqual([{ functionResponse: { id: "c1", name: "view_schema", response: { result: "ok" } } }]);
  });

  it("gives a tool's result the name of the call it answers", () => {
    const contents = toContents([user("go"), call("a", "execute_query", '{"limit":5}'), call("b", "view_report", "{}"), result("b", "report"), result("a", "rows")], { a: "sig-a" });
    expect(contents[1].parts!.map((p) => [p.functionCall!.name, p.functionCall!.args, p.thoughtSignature])).toEqual([
      ["execute_query", { limit: 5 }, "sig-a"],
      ["view_report", {}, undefined],
    ]);
    expect(contents[2].parts!.map((p) => p.functionResponse!.name)).toEqual(["view_report", "execute_query"]);
  });

  it("uses Google's stand-in when a call's signature was lost, and survives arguments that are not JSON", () => {
    const [, model] = toContents([user("go"), call("x", "add_widget", "{not json")]);
    expect(model.parts![0].functionCall!.args).toEqual({});
    expect(model.parts![0].thoughtSignature).toBe("context_engineering_is_the_way_to_go");
  });

  it("leaves out the AI's own notes", () => {
    const contents = toContents([user("go"), { id: "r", kind: "output", type: "reasoning", summary: [{ type: "summary", text: "thinking" }] }, said("done")]);
    expect(contents).toEqual([
      { role: "user", parts: [{ text: "go" }] },
      { role: "model", parts: [{ text: "done" }] },
    ]);
  });
});

describe("the tool list", () => {
  it("passes each tool's name, description and parameters, and drops tools only another provider could run", () => {
    const parameters = { type: "object", properties: { id: { type: "string" } } };
    expect(
      toDeclarations([
        { name: "view_widget", description: "Reads one widget", parameters },
        { name: "web_search", description: "Provider tool", parameters: {}, kind: "provided", provider: {} },
      ]),
    ).toEqual([{ name: "view_widget", description: "Reads one widget", parametersJsonSchema: parameters }]);
  });
});

describe("checking what the browser sent", () => {
  it("accepts a turn with a conversation and refuses anything else", () => {
    expect(looksLikeAskBody({ input: [user("hi")] })).toBe(true);
    expect(looksLikeAskBody({ input: [] })).toBe(false);
    expect(looksLikeAskBody({ input: [user("hi")], tools: "all" })).toBe(false);
    expect(looksLikeAskBody(null)).toBe(false);
    expect(looksLikeAskBody("hello")).toBe(false);
  });
});
