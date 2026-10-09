/** Backward-compatible route alias for the renamed Animes page. */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/series")({
  beforeLoad: () => {
    throw redirect({ to: "/animes" });
  },
});
