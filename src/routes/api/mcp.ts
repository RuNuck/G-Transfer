import { createFileRoute } from "@tanstack/react-router";
import { handleMcpHttp } from "@/lib/mcp/handler";

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => handleMcpHttp(request),
      HEAD: ({ request }) => handleMcpHttp(request),
      POST: ({ request }) => handleMcpHttp(request),
      PUT: ({ request }) => handleMcpHttp(request),
      PATCH: ({ request }) => handleMcpHttp(request),
      OPTIONS: ({ request }) => handleMcpHttp(request),
      DELETE: ({ request }) => handleMcpHttp(request),
    },
  },
});
