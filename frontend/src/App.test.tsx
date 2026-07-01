import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("renders a jobs warning without leaving the Jobs view", async () => {
    mockAuthenticatedFetch();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Jobs/i }));

    expect(await screen.findByText("Recent Jobs")).toBeInTheDocument();
    expect(await screen.findByText("Job history unavailable")).toBeInTheDocument();
    expect(screen.getByText("No recent jobs returned.")).toBeInTheDocument();
  });

  it("copies the selected catalog object name from the info pane", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    mockAuthenticatedFetch({
      catalogItems: [
        {
          id: "reportnet3-energy",
          path: ["catalog", "test", "reportnet3", "energyfromRN3"],
          type: "DATASET"
        }
      ]
    });
    render(<App />);

    fireEvent.click(await screen.findByText("energyfromRN3"));
    fireEvent.click(await screen.findByLabelText("Copy object name"));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("catalog.test.reportnet3.energyfromRN3")
    );
    expect(await screen.findByText("Copied")).toBeInTheDocument();
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

type MockCatalogItem = {
  id: string;
  path: string[];
  type: string;
};

function mockAuthenticatedFetch({ catalogItems = [] }: { catalogItems?: MockCatalogItem[] } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/session") {
        return jsonResponse({ authenticated: true, user_id: "allowed@example.org" });
      }
      if (url === "/api/catalog") {
        return jsonResponse({ items: catalogItems });
      }
      if (url.startsWith("/api/catalog/") && !url.endsWith("/children")) {
        const catalogId = decodeURIComponent(url.replace("/api/catalog/", ""));
        const item = catalogItems.find((catalogItem) => catalogItem.id === catalogId);
        return jsonResponse({
          id: catalogId,
          raw: { id: catalogId, path: item?.path ?? [] },
          permissions: { effectivePermissions: [], grants: [] }
        });
      }
      if (url === "/api/jobs?limit=50") {
        return jsonResponse({ jobs: [], warning: "Job history unavailable" });
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
