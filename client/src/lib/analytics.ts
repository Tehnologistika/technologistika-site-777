/**
 * Точка подключения необязательной аналитики.
 * Сейчас ни один счётчик не подключён: функция ничего не загружает и никуда не ходит.
 * Когда появится сервис с хранением в РФ, скрипт добавлять только сюда
 * и вызывать loadAnalytics() лишь после cookie_consent_v1.analytics === true.
 */
export function loadAnalytics(): void {
  if (typeof window === "undefined") return;
  const w = window as Window & { __technologistikaAnalyticsLoaded?: boolean };
  if (w.__technologistikaAnalyticsLoaded) return;
  w.__technologistikaAnalyticsLoaded = true;
}
