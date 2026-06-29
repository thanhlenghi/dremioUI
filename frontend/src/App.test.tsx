import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("App", () => {
  beforeEach(() => {
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

  it("renders token login when there is no active session", async () => {
    render(<App />);

    expect(await screen.findByText("Dremio Console")).toBeInTheDocument();
    expect(screen.getByLabelText("User or email")).toBeInTheDocument();
    expect(screen.getByLabelText("Personal token")).toBeInTheDocument();
  });
});
