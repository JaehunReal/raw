import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type RoutePath =
  | "/"
  | "/laws"
  | "/topics"
  | "/attachments"
  | "/guide"
  | "/demo"
  | "/login"
  | "/app";

interface RouterContextType {
  path: string;
  navigate: (to: string, replace?: boolean) => void;
  searchParams: URLSearchParams;
}

const RouterContext = createContext<RouterContextType>({
  path: window.location.pathname,
  navigate: () => {},
  searchParams: new URLSearchParams(window.location.search),
});

export function useRouter() {
  return useContext(RouterContext);
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [currentUrl, setCurrentUrl] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));

  useEffect(() => {
    const handlePopState = () => {
      setCurrentUrl({
        pathname: window.location.pathname,
        search: window.location.search,
      });
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = (to: string, replace = false) => {
    try {
      const url = new URL(to, window.location.origin);
      const relative = url.pathname + url.search;
      if (replace) {
        window.history.replaceState({}, "", relative);
      } else {
        window.history.pushState({}, "", relative);
      }
      setCurrentUrl({
        pathname: url.pathname,
        search: url.search,
      });
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch {
      window.location.href = to;
    }
  };

  const searchParams = new URLSearchParams(currentUrl.search);

  return (
    <RouterContext.Provider value={{ path: currentUrl.pathname, navigate, searchParams }}>
      {children}
    </RouterContext.Provider>
  );
}

export function Link({
  to,
  children,
  className,
  onClick,
  ...rest
}: {
  to: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  [key: string]: unknown;
}) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (onClick) onClick();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
