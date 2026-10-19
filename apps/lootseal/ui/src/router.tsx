// SPDX-License-Identifier: Apache-2.0
// A small hash router: #/drop/<addr>, #/vault, … Hash routes work on any
// static host without rewrite rules.
import { useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from "react";

export type Route =
  | { name: "home" }
  | { name: "drop"; address: string }
  | { name: "vault" }
  | { name: "bazaar" }
  | { name: "studio" }
  | { name: "fieldTest" }
  | { name: "audit"; address: string }
  | { name: "verify"; address: string; badge: string }
  | { name: "notFound"; path: string };

const HEX64 = /^[0-9a-f]{64}$/i;

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/";
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return { name: "home" };
  const [head, a, b] = parts;
  if (head === "vault" && parts.length === 1) return { name: "vault" };
  if (head === "bazaar" && parts.length === 1) return { name: "bazaar" };
  if (head === "studio" && parts.length === 1) return { name: "studio" };
  if (head === "field-test" && parts.length === 1) return { name: "fieldTest" };
  if (head === "drop" && a && HEX64.test(a) && parts.length === 2) return { name: "drop", address: a.toLowerCase() };
  if (head === "audit" && a && HEX64.test(a) && parts.length === 2) return { name: "audit", address: a.toLowerCase() };
  if (head === "verify" && a && b && HEX64.test(a) && HEX64.test(b) && parts.length === 3) {
    return { name: "verify", address: a.toLowerCase(), badge: b.toLowerCase() };
  }
  return { name: "notFound", path };
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case "home":
      return "#/";
    case "drop":
      return `#/drop/${route.address}`;
    case "audit":
      return `#/audit/${route.address}`;
    case "verify":
      return `#/verify/${route.address}/${route.badge}`;
    case "fieldTest":
      return "#/field-test";
    case "notFound":
      return `#${route.path}`;
    default:
      return `#/${route.name}`;
  }
}

export function navigate(route: Route): void {
  window.location.hash = hrefFor(route).slice(1);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash));
      try {
        window.scrollTo({ top: 0 });
      } catch {
        /* not available (tests) */
      }
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function Link({
  to,
  children,
  ...rest
}: { to: Route; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <a href={hrefFor(to)} {...rest}>
      {children}
    </a>
  );
}
