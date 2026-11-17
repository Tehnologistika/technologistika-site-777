import { PDN } from "@shared/pdn";
import { loadAnalytics } from "@/lib/analytics";

export const COOKIE_CONSENT_KEY = "cookie_consent_v1";
export const OPEN_COOKIE_SETTINGS_EVENT = "technologistika:open-cookie-settings";

const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

export interface CookieConsentV1 {
  v: 1;
  analytics: boolean;
  thirdparty: boolean;
  ts: string;
  policyVersion: string;
}

export function readCookieConsent(): CookieConsentV1 | null {
  try {
    const raw = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<CookieConsentV1>;
    if (data.v !== 1 || typeof data.analytics !== "boolean" || typeof data.thirdparty !== "boolean") {
      return null;
    }
    if (data.policyVersion !== PDN.cookiePolicyVersion || typeof data.ts !== "string") return null;
    const ts = Date.parse(data.ts);
    if (!Number.isFinite(ts) || Date.now() - ts > TWELVE_MONTHS_MS) return null;
    return {
      v: 1,
      analytics: data.analytics,
      thirdparty: data.thirdparty,
      ts: data.ts,
      policyVersion: data.policyVersion,
    };
  } catch {
    return null;
  }
}

export function writeCookieConsent(choice: { analytics: boolean; thirdparty: boolean }): CookieConsentV1 {
  const record: CookieConsentV1 = {
    v: 1,
    analytics: choice.analytics,
    thirdparty: choice.thirdparty,
    ts: new Date().toISOString(),
    policyVersion: PDN.cookiePolicyVersion,
  };
  localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(record));
  if (choice.analytics) loadAnalytics();
  return record;
}

export function openCookieSettings(): void {
  window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS_EVENT));
}
