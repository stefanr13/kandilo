import { HttpsError } from 'firebase-functions/v2/https';

const LOCAL_HTTP_APP_URL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

type StripeReturnAppUrlErrorCode =
  | ''
  | 'app_url_invalid'
  | 'app_url_not_https'
  | 'app_url_not_base_url';

export type StripeReturnAppUrlReadiness = {
  configured: boolean;
  value: string;
  usesHttps: boolean;
  runtimeValid: boolean;
  errorCode: StripeReturnAppUrlErrorCode;
};

function functionsEmulatorAllowsLocalHttp(): boolean {
  return process.env.FUNCTIONS_EMULATOR === 'true';
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function configuredStripeReturnAppUrl(
  rawValue: unknown,
  fallback: string,
  purpose: string
): string {
  const readiness = stripeReturnAppUrlReadiness(rawValue, fallback);
  if (readiness.runtimeValid) {
    return readiness.value;
  }

  if (readiness.errorCode === 'app_url_invalid') {
    throw new HttpsError('failed-precondition', `${purpose} requires APP_URL to be a valid URL.`);
  }
  if (readiness.errorCode === 'app_url_not_base_url') {
    throw new HttpsError(
      'failed-precondition',
      `${purpose} requires APP_URL to be a base URL without credentials, query, or fragment.`
    );
  }
  throw new HttpsError('failed-precondition', `${purpose} requires APP_URL to be an HTTPS URL.`);
}

export function stripeReturnAppUrlReadiness(
  rawValue: unknown,
  fallback: string
): StripeReturnAppUrlReadiness {
  const configured = typeof rawValue === 'string' && rawValue.trim().length > 0;
  const candidate = configured ? rawValue.trim() : fallback.trim();

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return {
      configured,
      value: candidate,
      usesHttps: false,
      runtimeValid: false,
      errorCode: 'app_url_invalid',
    };
  }

  const value = stripTrailingSlash(url.toString());
  const usesHttps = url.protocol === 'https:';
  if (url.username || url.password || url.search || url.hash) {
    return {
      configured,
      value,
      usesHttps,
      runtimeValid: false,
      errorCode: 'app_url_not_base_url',
    };
  }

  const localHttpAllowed =
    functionsEmulatorAllowsLocalHttp()
    && url.protocol === 'http:'
    && LOCAL_HTTP_APP_URL_HOSTNAMES.has(url.hostname);

  if (!usesHttps && !localHttpAllowed) {
    return {
      configured,
      value,
      usesHttps,
      runtimeValid: false,
      errorCode: 'app_url_not_https',
    };
  }

  return {
    configured,
    value,
    usesHttps,
    runtimeValid: true,
    errorCode: '',
  };
}
