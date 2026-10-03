import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { AuthProvider } from "@/auth/AuthProvider";
import { router } from "@/router";
// Initialises i18next before the first render, so nothing shows English for a
// frame and then swaps. Imported for its side effect; the default export is
// only needed by code that changes language.
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
