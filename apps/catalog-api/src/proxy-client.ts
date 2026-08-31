import { AddonProtocolError } from '@tomeio/addon-sdk';

import type { FetchFunction } from './kobo';
import { signProxyRequest } from './proxy-auth';

interface EgressConfiguration {
  secret?: string;
  url?: string;
}

export function createEgressFetch(configuration: EgressConfiguration): FetchFunction {
  return async (input, init) => {
    const proxyUrl = configuration.url?.trim();
    const secret = configuration.secret?.trim();
    if (!proxyUrl || !secret) {
      throw new AddonProtocolError('Catalog egress has not been configured.', 503);
    }

    const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const requestHeaders = new Headers(init?.headers);
    const body = JSON.stringify({
      url: requestUrl,
      headers: {
        accept: requestHeaders.get('accept') ?? 'application/json',
        accessKey: requestHeaders.get('accessKey') ?? '',
      },
    });
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const signature = await signProxyRequest(secret, timestamp, nonce, body);

    return fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tomeio-Nonce': nonce,
        'X-Tomeio-Signature': signature,
        'X-Tomeio-Timestamp': timestamp,
      },
      body,
      redirect: 'manual',
    });
  };
}
