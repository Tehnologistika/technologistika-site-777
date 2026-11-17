import { useEffect, useState } from "react";
import { Link } from "wouter";
import { PDN } from "@shared/pdn";
import { loadAnalytics } from "@/lib/analytics";
import {
  OPEN_COOKIE_SETTINGS_EVENT,
  readCookieConsent,
  writeCookieConsent,
  type CookieConsentV1,
} from "@/lib/cookieConsent";

const choiceButtonStyle: React.CSSProperties = {
  flex: "1 1 140px",
  minHeight: "44px",
  padding: "0.7rem 1rem",
  background: "rgba(255,255,255,0.06)",
  color: "#F5F7FA",
  border: "1px solid rgba(255,255,255,0.28)",
  borderRadius: "0.25rem",
  fontFamily: "'Space Grotesk', sans-serif",
  fontWeight: 600,
  fontSize: "0.9375rem",
  cursor: "pointer",
};

export default function CookieBanner() {
  const [consent, setConsent] = useState<CookieConsentV1 | null>(() => {
    if (typeof window === "undefined") return null;
    return readCookieConsent();
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [thirdParty, setThirdParty] = useState(false);
  const [notice, setNotice] = useState(false);
  const showBanner = consent === null && !settingsOpen;

  useEffect(() => {
    document.body.style.paddingBottom = showBanner ? "240px" : "";
    return () => {
      document.body.style.paddingBottom = "";
    };
  }, [showBanner]);

  useEffect(() => {
    const current = readCookieConsent();
    if (current?.analytics) loadAnalytics();
    const open = () => {
      const stored = readCookieConsent();
      setAnalytics(stored?.analytics ?? false);
      setThirdParty(stored?.thirdparty ?? false);
      setSettingsOpen(true);
    };
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, open);
  }, []);

  const persist = (choice: { analytics: boolean; thirdparty: boolean }) => {
    const record = writeCookieConsent(choice);
    setConsent(record);
    setAnalytics(choice.analytics);
    setThirdParty(choice.thirdparty);
    setSettingsOpen(false);
    setNotice(true);
    window.setTimeout(() => setNotice(false), 4500);
  };

  return (
    <>
      {showBanner && (
        <div
          role="dialog"
          aria-labelledby="cookie-banner-title"
          style={{
            position: "fixed",
            left: "1rem",
            right: "1rem",
            bottom: "1rem",
            zIndex: 80,
            maxWidth: "720px",
            margin: "0 auto",
            background: "#161A20",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "0.5rem",
            padding: "1.1rem 1.15rem 1rem",
            boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}>
            <h2 id="cookie-banner-title" style={{ margin: 0, fontFamily: "'Space Grotesk', sans-serif", fontSize: "1.05rem", fontWeight: 700 }}>
              Файлы cookie
            </h2>
            <button
              type="button"
              aria-label="Закрыть и отказаться"
              onClick={() => persist({ analytics: false, thirdparty: false })}
              style={{
                background: "transparent",
                color: "#AAB3C2",
                border: "none",
                fontSize: "1.25rem",
                lineHeight: 1,
                cursor: "pointer",
                padding: "0 0.15rem",
              }}
            >
              ×
            </button>
          </div>
          <p style={{ color: "#AAB3C2", fontSize: "0.9rem", lineHeight: 1.55, margin: "0.65rem 0 1rem" }}>
            Мы используем необходимые файлы cookie — без них сайт не работает. Аналитические и другие необязательные cookie мы включаем только с вашего согласия. Вы можете отказаться: сайт будет работать так же. Подробнее — в{" "}
            <Link href="/cookies" style={{ color: "#4FD1FF" }}>Политике cookie</Link>.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button type="button" style={choiceButtonStyle} onClick={() => persist({ analytics: true, thirdparty: true })}>
              Принять
            </button>
            <button type="button" style={choiceButtonStyle} onClick={() => persist({ analytics: false, thirdparty: false })}>
              Отказаться
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setAnalytics(false);
              setThirdParty(false);
              setSettingsOpen(true);
            }}
            style={{
              marginTop: "0.75rem",
              background: "none",
              border: "none",
              color: "#4FD1FF",
              padding: 0,
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 600,
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Настроить
          </button>
        </div>
      )}

      {settingsOpen && (
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 90,
            background: "rgba(8,10,12,0.72)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: "1rem",
          }}
          onClick={() => setSettingsOpen(false)}
        >
          <div
            role="dialog"
            aria-labelledby="cookie-settings-title"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(640px, 100%)",
              background: "#161A20",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "0.5rem",
              padding: "1.15rem",
              maxHeight: "min(90vh, 640px)",
              overflow: "auto",
            }}
          >
            <h2 id="cookie-settings-title" style={{ margin: "0 0 0.85rem", fontFamily: "'Space Grotesk', sans-serif", fontSize: "1.15rem" }}>
              Настройки cookie
            </h2>
            <Category
              title="Необходимые"
              text="Нужны для работы сайта, безопасности формы и запоминания вашего выбора. Отключить нельзя."
              checked
              disabled
              onChange={() => undefined}
            />
            <Category
              title="Аналитические"
              text="Помогают понять, как используется сайт, и улучшать его. Включатся только с вашего согласия. Сейчас аналитика не подключена."
              checked={analytics}
              onChange={setAnalytics}
            />
            <Category
              title="Сторонние сервисы"
              text="Карты, видео и другие внешние сервисы. Включатся только с вашего согласия. Сейчас не подключены."
              checked={thirdParty}
              onChange={setThirdParty}
            />
            <p style={{ color: "#AAB3C2", fontSize: "0.8rem", margin: "0.25rem 0 0.9rem" }}>
              Версия политики cookie: {PDN.cookiePolicyVersion}. Выбор хранится в браузере 12 месяцев и на сервер не отправляется.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <button type="button" style={choiceButtonStyle} onClick={() => persist({ analytics, thirdparty: thirdParty })}>
                Сохранить выбор
              </button>
              <button type="button" style={choiceButtonStyle} onClick={() => persist({ analytics: true, thirdparty: true })}>
                Принять все
              </button>
              <button type="button" style={choiceButtonStyle} onClick={() => persist({ analytics: false, thirdparty: false })}>
                Отказаться от необязательных
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && consent && !settingsOpen && (
        <p
          role="status"
          style={{
            position: "fixed",
            left: "1rem",
            right: "1rem",
            bottom: "1rem",
            zIndex: 80,
            maxWidth: "720px",
            margin: "0 auto",
            background: "#161A20",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "0.5rem",
            padding: "0.85rem 1rem",
            color: "#C9D4E3",
            fontSize: "0.875rem",
          }}
        >
          Выбор сохранён. Изменить его можно в любой момент по ссылке «Настройки cookie» внизу страницы.
        </p>
      )}
    </>
  );
}

function Category({
  title,
  text,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  text: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", marginBottom: "0.85rem", cursor: disabled ? "default" : "pointer" }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        style={{ marginTop: "0.25rem", width: "1.05rem", height: "1.05rem", accentColor: "#4FD1FF" }}
      />
      <span>
        <span style={{ display: "block", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 650, color: "#F5F7FA" }}>{title}</span>
        <span style={{ display: "block", color: "#AAB3C2", fontSize: "0.875rem", lineHeight: 1.5 }}>{text}</span>
      </span>
    </label>
  );
}
