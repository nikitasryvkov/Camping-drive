import { useEffect, useState } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";

import { AdminDashboard } from "./AdminDashboard";
import { getAdministratorSession, type Administrator } from "./api";
import { LoginPage } from "./LoginPage";

type AuthenticationState =
  | { status: "checking" }
  | { status: "authenticated"; administrator: Administrator }
  | { status: "unauthenticated" }
  | { status: "unavailable"; message: string };

export function AdminApp() {
  const [authentication, setAuthentication] = useState<AuthenticationState>({ status: "checking" });
  const isLoginPage = window.location.pathname === "/admin/login";

  useAdminDocumentMetadata();

  useEffect(() => {
    let isCancelled = false;

    void getAdministratorSession()
      .then((administrator) => {
        if (!isCancelled) {
          setAuthentication(
            administrator
              ? { status: "authenticated", administrator }
              : { status: "unauthenticated" },
          );
        }
      })
      .catch((error: unknown) => {
        if (!isCancelled) {
          setAuthentication({
            status: "unavailable",
            message: error instanceof Error ? error.message : "Сервис временно недоступен",
          });
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  if (authentication.status === "checking") {
    return <AdminLoadingScreen />;
  }

  if (authentication.status === "unavailable") {
    return <AdminUnavailableScreen message={authentication.message} />;
  }

  if (isLoginPage) {
    if (authentication.status === "authenticated") {
      window.location.replace("/admin");
      return <AdminLoadingScreen />;
    }

    return <LoginPage />;
  }

  if (authentication.status === "unauthenticated") {
    window.location.replace("/admin/login");
    return <AdminLoadingScreen />;
  }

  return <AdminDashboard administrator={authentication.administrator} />;
}

function AdminLoadingScreen() {
  return (
    <main className="admin-state-screen" aria-live="polite">
      <LoaderCircle className="admin-spinner" size={28} aria-hidden="true" />
      <p>Проверяем доступ…</p>
    </main>
  );
}

function AdminUnavailableScreen({ message }: { message: string }) {
  return (
    <main className="admin-state-screen">
      <AlertCircle size={30} aria-hidden="true" />
      <h1>Админ-панель недоступна</h1>
      <p>{message}</p>
      <button className="admin-primary-button admin-retry-button" onClick={() => window.location.reload()}>
        Повторить
      </button>
    </main>
  );
}

function useAdminDocumentMetadata() {
  useEffect(() => {
    const previousTitle = document.title;
    const robotsMeta = document.createElement("meta");
    robotsMeta.name = "robots";
    robotsMeta.content = "noindex, nofollow, noarchive";
    document.head.append(robotsMeta);
    document.title = "Админ-панель — Camping Drive";

    return () => {
      document.title = previousTitle;
      robotsMeta.remove();
    };
  }, []);
}
