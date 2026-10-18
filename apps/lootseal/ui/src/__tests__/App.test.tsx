import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { App } from "../App";

// App pulls in the whole Midnight provider stack through its imports. Rendering
// it in jsdom also checks that those modules load without a wallet present.
describe("App", () => {
  it("renders the landing page and wallet button with no wallet connected", async () => {
    window.location.hash = "#/";
    render(<App />);
    expect(screen.getByText(/Prove the odds were real/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Vault" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Connect wallet/i })).toBeInTheDocument();
    expect(await screen.findByText("No drops yet")).toBeInTheDocument();
  });

  it("asks for a wallet on pages that need one", () => {
    window.location.hash = "#/vault";
    render(<App />);
    expect(screen.getByText(/Connect a Midnight wallet to see your items/)).toBeInTheDocument();
  });

  it("shows a not-found page for unknown routes", () => {
    window.location.hash = "#/does-not-exist";
    render(<App />);
    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });
});
