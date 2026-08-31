const encoder = new TextEncoder();

async function signingKey(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usage
  );
}

function encoded(value: string): ArrayBuffer {
  const bytes = encoder.encode(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function signaturePayload(timestamp: string, nonce: string, body: string): ArrayBuffer {
  return encoded(`${timestamp}.${nonce}.${body}`);
}

function hexadecimal(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexadecimalBytes(value: string): ArrayBuffer | null {
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  return new Uint8Array(
    value.match(/../g)?.map((byte) => Number.parseInt(byte, 16)) ?? []
  ).buffer as ArrayBuffer;
}

export async function signProxyRequest(
  secret: string,
  timestamp: string,
  nonce: string,
  body: string
): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(secret, ['sign']),
    signaturePayload(timestamp, nonce, body)
  );
  return hexadecimal(signature);
}

export async function verifyProxyRequest(
  secret: string,
  timestamp: string,
  nonce: string,
  body: string,
  signature: string
): Promise<boolean> {
  const bytes = hexadecimalBytes(signature);
  if (!bytes) return false;
  return crypto.subtle.verify(
    'HMAC',
    await signingKey(secret, ['verify']),
    bytes,
    signaturePayload(timestamp, nonce, body)
  );
}
