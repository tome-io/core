import { createAddonHandler } from '@tomeio/addon-sdk';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import { createEgressFetch } from './proxy-client';
import { createKoboAddon } from './kobo';

interface Bindings {
  EGRESS_PROXY_SECRET?: string;
  EGRESS_PROXY_URL?: string;
  RAKUTEN_ACCESS_KEY?: string;
  RAKUTEN_AFFILIATE_ID?: string;
  RAKUTEN_APPLICATION_ID?: string;
}

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', secureHeaders());
app.get('/', (context) =>
  context.json({
    service: 'Tomeio Catalog API',
    status: 'ok',
  })
);
app.get('/health', (context) =>
  context.json({
    status: 'ok',
    rakutenConfigured: Boolean(
      context.env.RAKUTEN_APPLICATION_ID?.trim() && context.env.RAKUTEN_ACCESS_KEY?.trim()
    ),
    egressConfigured: Boolean(
      context.env.EGRESS_PROXY_URL?.trim() && context.env.EGRESS_PROXY_SECRET?.trim()
    ),
  })
);
app.all('*', (context) => {
  const addon = createKoboAddon(
    {
      RAKUTEN_ACCESS_KEY: context.env.RAKUTEN_ACCESS_KEY,
      RAKUTEN_AFFILIATE_ID: context.env.RAKUTEN_AFFILIATE_ID,
      RAKUTEN_APPLICATION_ID: context.env.RAKUTEN_APPLICATION_ID,
    },
    createEgressFetch({
      secret: context.env.EGRESS_PROXY_SECRET,
      url: context.env.EGRESS_PROXY_URL,
    })
  );
  return createAddonHandler(addon)(context.req.raw);
});

export default app;
