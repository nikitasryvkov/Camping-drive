import { FormEvent, useState } from "react";
import { AlertCircle, LoaderCircle, LockKeyhole } from "lucide-react";

import { loginAdministrator } from "./api";

export function LoginPage() {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await loginAdministrator(login, password);
      window.location.replace("/admin");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось войти в административную панель",
      );
      setIsSubmitting(false);
    }
  }

  return (
    <main className="admin-auth-shell">
      <div className="admin-auth-glow" aria-hidden="true" />
      <section className="admin-login-card" aria-labelledby="admin-login-title">
        <a className="admin-brand" href="/" aria-label="Вернуться на сайт Camping Drive">
          <span className="admin-brand-mark">
            <LockKeyhole size={22} aria-hidden="true" />
          </span>
          <span>
            <strong>Camping Drive</strong>
            <small>Управление сайтом</small>
          </span>
        </a>

        <div className="admin-login-heading">
          <p className="admin-kicker">Защищённая зона</p>
          <h1 id="admin-login-title">Вход в админ-панель</h1>
          <p>Используйте учётную запись администратора.</p>
        </div>

        <form className="admin-login-form" onSubmit={handleSubmit}>
          <label htmlFor="admin-login">Логин</label>
          <input
            id="admin-login"
            name="login"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck="false"
            minLength={3}
            maxLength={100}
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            disabled={isSubmitting}
            autoFocus
            required
          />

          <label htmlFor="admin-password">Пароль</label>
          <input
            id="admin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={1024}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isSubmitting}
            required
          />

          {error ? (
            <div className="admin-form-error" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <button className="admin-primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <LoaderCircle className="admin-spinner" size={19} aria-hidden="true" />
                Входим…
              </>
            ) : (
              "Войти"
            )}
          </button>
        </form>

        <a className="admin-back-link" href="/">
          ← Вернуться на сайт
        </a>
      </section>
    </main>
  );
}
