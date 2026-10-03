import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { AuthProvider } from "@/auth/AuthProvider";
import { router } from "@/router";
// Before the first render: the catalogues are in the bundle, so the console
// paints in the viewer's language rather than in English and then again.
import "@/lib/i18n";
import "./index.css";
import { loadBrand } from "@/lib/brand";

// The cluster's brand, before the first render: its stylesheet carries the
// colours the first paint should already have.
loadBrand();

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
