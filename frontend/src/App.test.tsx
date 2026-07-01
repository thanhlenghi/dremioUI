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
    expect(screen.queryByText("Object name")).not.toBeInTheDocument();
  });

  it("labels source, view, table, and file catalog entries distinctly", async () => {
    mockAuthenticatedFetch({
      catalogItems: [
        { id: "s3-source", path: ["s3-source"], type: "SOURCE", source_type: "S3" },
        { id: "sql-source", path: ["sql-source"], type: "SOURCE", source_type: "MSSQL" },
        { id: "orders-view", path: ["catalog", "orders_view"], type: "VIRTUAL_DATASET" },
        { id: "orders-table", path: ["catalog", "orders_table"], type: "PHYSICAL_DATASET" },
        { id: "sales-csv", path: ["catalog", "sales.csv"], type: "FILE" }
      ]
    });
    render(<App />);

    expect(await screen.findByText("S3")).toBeInTheDocument();
    expect(screen.getByText("MSSQL")).toBeInTheDocument();
    expect(screen.getByText("View")).toBeInTheDocument();
    expect(screen.getByText("Table")).toBeInTheDocument();
    expect(screen.getByText("CSV File")).toBeInTheDocument();
  });

  it("labels Dremio source metadata with plugin type as an S3 source", async () => {
    mockAuthenticatedFetch({
      catalogItems: [
        {
          id: "657e7168-3019-440f-a1da-7f7820c92c0c",
          path: ["local_s3"],
          type: "S3"
        }
      ]
    });
    render(<App />);

    expect(await screen.findByText("local_s3")).toBeInTheDocument();
    expect(screen.getByText("S3")).toBeInTheDocument();
    expect(screen.queryByText("File")).not.toBeInTheDocument();
    expect(document.querySelector(".catalog-icon.source-s3")).toBeInTheDocument();
  });

  it("shows started and off engine lights in the engine info pane", async () => {
    mockAuthenticatedFetch({
      engineItems: [
        { id: "hot", name: "Hot engine", status: "STARTED" },
        { id: "cold", name: "Cold engine", status: "STOPPED" }
      ]
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Engines/i }));

    expect(await screen.findByText("Started")).toBeInTheDocument();
    expect(document.querySelector(".engine-status.started")).toBeInTheDocument();

    fireEvent.click(await screen.findByText("Cold engine"));

    expect(await screen.findByText("Off")).toBeInTheDocument();
    expect(document.querySelector(".engine-status.off")).toBeInTheDocument();
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
  source_type?: string;
  type: string;
};

function mockAuthenticatedFetch({
  catalogItems = [],
  engineItems = []
}: {
  catalogItems?: MockCatalogItem[];
  engineItems?: Array<Record<string, unknown>>;
} = {}) {
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
      if (url === "/api/admin/engines") {
        return jsonResponse({ items: engineItems });
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
