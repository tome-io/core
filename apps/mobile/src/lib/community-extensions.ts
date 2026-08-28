import { parseExtensionManifest } from '@tomeio/extension-protocol';
import type { CommunityExtension } from '@tomeio/extension-runtime';

export const COMMUNITY_REGISTRY_URL =
  'https://raw.githubusercontent.com/tome-io/extensions/main/registry.json';

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function httpsUrl(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Community registry field "${field}" must be an HTTPS URL.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Community registry field "${field}" must be an HTTPS URL.`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`Community registry field "${field}" must be an HTTPS URL.`);
  }
  return url.toString();
}

async function responseJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${label} request failed (${response.status}).`);
  }
  try {
    return await response.json();
  } catch (cause) {
    throw new Error(
      `${label} returned invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`
    );
  }
}

export async function fetchCommunityExtensions(
  fetchFn: typeof fetch = fetch
): Promise<CommunityExtension[]> {
  const registryResponse = await fetchFn(COMMUNITY_REGISTRY_URL, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const registry = record(await responseJson(registryResponse, 'Community registry'));
  if (!registry || registry.registryVersion !== 1 || !Array.isArray(registry.extensions)) {
    throw new Error('Community registry does not use the supported version 1 format.');
  }

  return Promise.all(
    registry.extensions.map(async (candidate, index): Promise<CommunityExtension> => {
      const entry = record(candidate);
      if (!entry || typeof entry.id !== 'string' || !entry.id) {
        throw new Error(`Community registry entry ${index} has no id.`);
      }
      const manifestUrl = httpsUrl(entry.manifestUrl, `extensions[${index}].manifestUrl`);
      const repositoryUrl = httpsUrl(
        entry.repositoryUrl,
        `extensions[${index}].repositoryUrl`
      );
      const manifestResponse = await fetchFn(manifestUrl, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const manifest = parseExtensionManifest(
        await responseJson(manifestResponse, `Community manifest ${entry.id}`)
      );
      if (manifest.id !== entry.id) {
        throw new Error(
          `Community registry id "${entry.id}" does not match manifest id "${manifest.id}".`
        );
      }
      const hostAdapters = Array.isArray(entry.hostAdapters)
        ? entry.hostAdapters.map((adapter, adapterIndex) => {
            if (typeof adapter !== 'string' || !adapter) {
              throw new Error(
                `Community registry entry "${entry.id}" has an invalid host adapter at index ${adapterIndex}.`
              );
            }
            return adapter;
          })
        : undefined;
      const deviceCapabilities = Array.isArray(entry.deviceCapabilities)
        ? entry.deviceCapabilities.map((capability, capabilityIndex) => {
            if (typeof capability !== 'string' || !capability) {
              throw new Error(
                `Community registry entry "${entry.id}" has an invalid device capability at index ${capabilityIndex}.`
              );
            }
            return capability;
          })
        : undefined;
      const androidPackages = Array.isArray(entry.androidPackages)
        ? entry.androidPackages.map((packageName, packageIndex) => {
            if (typeof packageName !== 'string' || !packageName) {
              throw new Error(
                `Community registry entry "${entry.id}" has an invalid Android package at index ${packageIndex}.`
              );
            }
            return packageName;
          })
        : undefined;
      if (
        manifest.transport.kind === 'host' &&
        !hostAdapters?.includes(manifest.transport.adapter)
      ) {
        throw new Error(
          `Community registry entry "${entry.id}" has not reviewed host adapter "${manifest.transport.adapter}".`
        );
      }
      if (
        manifest.transport.kind === 'device' &&
        manifest.permissions?.device?.some(
          (capability) => !deviceCapabilities?.includes(capability)
        )
      ) {
        throw new Error(
          `Community registry entry "${entry.id}" has not reviewed every requested device capability.`
        );
      }
      if (
        manifest.transport.kind === 'device' &&
        manifest.permissions?.androidPackages?.some(
          (packageName) => !androidPackages?.includes(packageName)
        )
      ) {
        throw new Error(
          `Community registry entry "${entry.id}" has not reviewed every requested Android package.`
        );
      }
      return {
        manifest,
        manifestUrl,
        repositoryUrl,
        ...(typeof entry.minimumClientVersion === 'string'
          ? { minimumClientVersion: entry.minimumClientVersion }
          : {}),
        ...(typeof entry.reviewedAt === 'string' ? { reviewedAt: entry.reviewedAt } : {}),
        ...(hostAdapters ? { hostAdapters } : {}),
        ...(deviceCapabilities ? { deviceCapabilities } : {}),
        ...(androidPackages ? { androidPackages } : {}),
      };
    })
  );
}
