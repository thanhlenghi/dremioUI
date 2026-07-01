import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/session") {
          return new Response(JSON.stringify({ authenticated: false, user_id: null }), {
            status: 401
          });
        }
        return new Response("not found", { status: 404 });
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders token login when there is no active session", async () => {
    render(<App />);

    expect(await screen.findByText("Dremio Console")).toBeInTheDocument();
    expect(screen.getByLabelText("User or email")).toBeInTheDocument();
    expect(screen.getByLabelText("Personal token")).toBeInTheDocument();
  });

  it("renders Ask Dremio chat composer without SQL draft controls", async () => {
    mockAuthenticatedFetch();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Ask Dremio/i }));

    expect(await screen.findByLabelText("Ask Dremio question")).toBeInTheDocument();
    expect(screen.getByText(/Context: no catalog object selected/i)).toBeInTheDocument();
    expect(screen.queryByText("SQL Draft")).not.toBeInTheDocument();
    expect(screen.queryByText("Run manually")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("RBAC user or email")).not.toBeInTheDocument();
  });

  it("submitting a question appends messages and renders selected raw response", async () => {
    mockAuthenticatedFetch();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Ask Dremio/i }));
    fireEvent.change(await screen.findByLabelText("Ask Dremio question"), {
      target: { value: "Which roles have permission here?" }
    });
    fireEvent.click(screen.getByTitle("Send question"));

    expect(await screen.findByText("Which roles have permission here?")).toBeInTheDocument();
    expect(await screen.findByText("Reader has SELECT on this object.")).toBeInTheDocument();
    expect(screen.getByText("Selected assistant response")).toBeInTheDocument();
    expect(document.querySelector(".ask-raw-panel pre")).toHaveTextContent(
      '"detected_rbac_intent": true'
    );
  });
});

function mockAuthenticatedFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/session") {
        return jsonResponse({ authenticated: true, user_id: "allowed@example.org" });
      }
      if (url === "/api/catalog") {
        return jsonResponse({ items: [] });
      }
      if (url === "/api/qna" && init?.method === "POST") {
        return jsonResponse({
          answer: "Reader has SELECT on this object.",
          citations: [],
          raw: {
            selected_catalog_object: null,
            detected_rbac_intent: true,
            deterministic_rbac_context: {
              mode: "object",
              object_grants: [{ grantee_name: "Reader", privilege: "SELECT" }]
            },
            unresolved: []
          }
        });
      }
      return new Response("not found", { status: 404 });
    })
  );
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
